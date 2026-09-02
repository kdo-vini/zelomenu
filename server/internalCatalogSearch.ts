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
