import type { Request, RequestHandler, Response } from 'express';
import {
  getConfig,
  loadCatalogFromDb,
  resolveConversationCatalogDisplayPrice,
  toConversationModifierGroups,
  type CatalogProduct,
  type ConversationCatalogDisplayPrice,
} from './configStore.js';
import {
  sanitizeCatalogSearchLimit,
  searchCatalogDiscovery,
  type CatalogSearchCandidate,
  type CatalogSearchResult,
} from '../src/domain/zelomenuCatalogDiscovery.js';
import type { ConversationModifierGroupDefinition } from './conversationOrderRequirements.js';

export type CatalogDiscoverySearchRequest = {
  empresaId: string;
  query: string;
  limit?: number;
};

export type ParsedCatalogSearchRequest =
  | { ok: true; value: Required<CatalogDiscoverySearchRequest> }
  | { ok: false; message: string };

export type ConversationCatalogSearchCandidate = Omit<CatalogSearchCandidate, 'modifierGroups'> & {
  displayPrice: ConversationCatalogDisplayPrice;
  modifierGroups: ConversationModifierGroupDefinition[];
};

export type ConversationCatalogSearchResult = Omit<CatalogSearchResult, 'results'> & {
  results: ConversationCatalogSearchCandidate[];
};

const EMPRESA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function parseInternalCatalogSearchRequest(input: unknown): ParsedCatalogSearchRequest {
  if (!input || typeof input !== 'object') return { ok: false, message: 'Envie os dados da consulta.' };
  const row = input as { empresaId?: unknown; query?: unknown; limit?: unknown };
  const empresaId = typeof row.empresaId === 'string' ? row.empresaId.trim() : '';
  if (!EMPRESA_ID_PATTERN.test(empresaId)) return { ok: false, message: 'Informe uma empresa válida.' };
  const query = typeof row.query === 'string' ? row.query.trim() : '';
  if (!query || query.length > 240) return { ok: false, message: 'Informe uma busca válida.' };
  if (row.limit != null && (typeof row.limit !== 'number' || !Number.isFinite(row.limit))) {
    return { ok: false, message: 'Informe um limite numérico válido.' };
  }
  return { ok: true, value: { empresaId, query, limit: sanitizeCatalogSearchLimit(row.limit as number | undefined) } };
}

/**
 * Internal adapter used by ZeloChat. It always reloads the requested company
 * before searching and delegates eligibility to the canonical public catalog
 * projection maintained by configStore.
 */
export const CatalogDiscovery = {
  async search({ empresaId, query, limit }: CatalogDiscoverySearchRequest): Promise<ConversationCatalogSearchResult> {
    await loadCatalogFromDb(empresaId);
    const catalog = getConfig(empresaId).catalogHierarchy;
    const productsById = new Map<number, CatalogProduct>();
    for (const category of catalog) {
      for (const product of category.produtosDireto) productsById.set(product.id, product);
      for (const subcategory of category.subcategorias) {
        for (const product of subcategory.produtos) productsById.set(product.id, product);
      }
    }

    const result = searchCatalogDiscovery({ empresaId, query, limit, catalog });
    return {
      ...result,
      results: result.results.map((candidate) => {
        const product = productsById.get(candidate.productId);
        if (!product) throw new Error(`CATALOG_PRODUCT_NOT_FOUND:${candidate.productId}`);
        const displayPrice = resolveConversationCatalogDisplayPrice(product);
        return {
          ...candidate,
          parent: { ...candidate.parent, currentPrice: displayPrice.amount },
          currentPrice: displayPrice.amount,
          displayPrice,
          modifierGroups: toConversationModifierGroups(product.modifierGroups),
        };
      }),
    };
  },
};

type InternalCatalogSearchHandlerOptions = {
  rateLimit: RequestHandler;
  search?: typeof CatalogDiscovery.search;
};

async function executeInternalCatalogSearch(
  res: Response,
  parsed: Extract<ParsedCatalogSearchRequest, { ok: true }>,
  search: typeof CatalogDiscovery.search,
): Promise<void> {
  try {
    const result = await search(parsed.value);
    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    // Do not log request headers/body: both can contain the internal key.
    console.error('[ZeloMenu] internal catalog search error:', error);
    res.status(500).json({
      error: 'CONSULTA_INDISPONIVEL',
      detail: 'Não foi possível consultar o cardápio agora. Tente novamente em instantes.',
      requestId: res.locals.requestId,
    });
  }
}

export function createInternalCatalogSearchHandler({
  rateLimit,
  search = CatalogDiscovery.search,
}: InternalCatalogSearchHandlerOptions): RequestHandler {
  return async (req, res) => {
    if (res.locals.internalCatalogKeyValid !== true) {
      return res.status(401).json({
        error: 'NAO_AUTORIZADO',
        detail: 'Não foi possível autorizar esta consulta.',
        requestId: res.locals.requestId,
      });
    }

    const parsed = parseInternalCatalogSearchRequest(req.body);
    if (!parsed.ok) {
      return res.status(400).json({
        error: 'CONSULTA_INVALIDA',
        detail: parsed.message,
        requestId: res.locals.requestId,
      });
    }
    (req as Request & { internalCatalogEmpresaId?: string }).internalCatalogEmpresaId = parsed.value.empresaId;
    return rateLimit(req, res, () => { void executeInternalCatalogSearch(res, parsed, search); });
  };
}
