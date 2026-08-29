import { previewModifierPrice } from './zelomenuModifiers';
import { normalizeCatalogSearchText } from './zelomenuCatalog';
import type { ZeloMenuModifierGroup, ZeloMenuModifierOption } from './zelomenuModifiers';

export type CatalogDiscoveryEntityType = 'product' | 'modifier_group' | 'modifier_option';

export type CatalogDiscoveryParent = {
  productId: number;
  publicName: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  currentPrice: number;
};

export type CatalogDiscoveryModifierOption = Pick<ZeloMenuModifierOption, 'id' | 'name' | 'priceDelta' | 'order'>;

export type CatalogDiscoveryModifierGroup = Omit<ZeloMenuModifierGroup, 'active' | 'options'> & {
  options: CatalogDiscoveryModifierOption[];
};

export type CatalogSearchCandidate = {
  productId: number;
  entityType: CatalogDiscoveryEntityType;
  groupId?: string;
  optionId?: string;
  parent: CatalogDiscoveryParent;
  publicName: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  currentPrice: number;
  basePrice: number;
  modifierGroups: CatalogDiscoveryModifierGroup[];
  matchReason: string;
  confidence: number;
  ambiguous: boolean;
};

export type CatalogSearchResult = {
  empresaId: string;
  query: string;
  normalizedQuery: string;
  limit: number;
  total: number;
  ambiguous: boolean;
  results: CatalogSearchCandidate[];
};

export type CatalogDiscoverySearchInput = {
  empresaId: string;
  query: string;
  limit?: number;
  catalog: CatalogDiscoveryCategory[];
};

export type CatalogDiscoveryProduct = {
  id: number;
  name: string;
  price: number;
  basePrice: number;
  available: boolean;
  description?: string | null;
  modifierGroups: ZeloMenuModifierGroup[];
};

export type CatalogDiscoveryCategory = {
  nome: string;
  subcategorias: Array<{ nome: string; produtos: CatalogDiscoveryProduct[] }>;
  produtosDireto: CatalogDiscoveryProduct[];
};

type PublicProductContext = {
  product: CatalogDiscoveryProduct;
  category: string;
  subcategory: string | null;
  groups: CatalogDiscoveryModifierGroup[];
  currentPrice: number;
};

type RankedCandidate = Omit<CatalogSearchCandidate, 'ambiguous'> & { score: number };

const MAX_RESULTS = 12;

/**
 * The aliases deliberately stay deterministic and local. They map recurring
 * WhatsApp phrasing to menu concepts; no external model is involved.
 */
function expandSearchAliases(normalizedQuery: string): Array<{ term: string; reason: string }> {
  const terms = [{ term: normalizedQuery, reason: 'consulta_normalizada' }];
  const words = new Set(normalizedQuery.split(' ').filter(Boolean));
  const hasMarmitaPhrase = normalizedQuery.includes('cardapio de hoje')
    || normalizedQuery.includes('cardapio hoje')
    || normalizedQuery.includes('marmita do dia')
    || (words.has('mistura') && (words.has('hoje') || words.has('tem')))
    || (words.has('proteina') && (words.has('hoje') || words.has('marmita')));
  if (hasMarmitaPhrase) terms.push({ term: 'marmita do dia', reason: 'alias_marmita_do_dia' });
  return terms;
}

export function sanitizeCatalogSearchLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return MAX_RESULTS;
  return Math.min(MAX_RESULTS, Math.max(1, Math.trunc(limit)));
}

function activePublicGroups(groups: ZeloMenuModifierGroup[]): CatalogDiscoveryModifierGroup[] {
  return groups
    .filter((group) => group.active)
    .map((group) => ({
      id: group.id,
      productId: group.productId,
      name: group.name,
      kind: group.kind,
      pricingMode: group.pricingMode,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      minTotalQuantity: group.minTotalQuantity,
      maxTotalQuantity: group.maxTotalQuantity,
      allowsQuantity: group.allowsQuantity,
      maxPerOption: group.maxPerOption,
      order: group.order,
      options: group.options
        .filter((option) => option.active && option.linkedProduct?.available !== false)
        .map((option) => ({ id: option.id, name: option.name, priceDelta: option.priceDelta, order: option.order })),
    }))
    .filter((group) => group.minSelections === 0 || group.options.length >= group.minSelections)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR'));
}

function flattenPublicCatalog(catalog: CatalogDiscoveryCategory[]): PublicProductContext[] {
  const rows: PublicProductContext[] = [];
  for (const category of catalog) {
    const append = (product: CatalogDiscoveryProduct, subcategory: string | null) => {
      // `available` is the canonical public projection: publication, manual
      // pause, stock and required-complement viability are resolved upstream.
      if (!product.available) return;
      const groups = activePublicGroups(product.modifierGroups ?? []);
      const pricePreview = previewModifierPrice(product.modifierGroups ?? [], [], product.basePrice);
      rows.push({ product, category: category.nome, subcategory, groups, currentPrice: pricePreview.unitPrice });
    };
    for (const product of category.produtosDireto) append(product, null);
    for (const subcategory of category.subcategorias) {
      for (const product of subcategory.produtos) append(product, subcategory.nome);
    }
  }
  return rows;
}

function scoreField(value: string | null | undefined, term: string): number {
  const normalizedValue = normalizeCatalogSearchText(value ?? '');
  if (!normalizedValue || !term) return 0;
  if (normalizedValue === term) return 95;
  if (normalizedValue.startsWith(term)) return 82;
  if (normalizedValue.includes(term)) return 72;
  const queryTokens = term.split(' ').filter(Boolean);
  const valueTokens = new Set(normalizedValue.split(' ').filter(Boolean));
  const shared = queryTokens.filter((token) => valueTokens.has(token)).length;
  return shared === 0 ? 0 : 45 + Math.min(20, shared * 10);
}

function bestScore(fields: Array<{ value: string | null | undefined; reason: string }>, terms: Array<{ term: string; reason: string }>): { score: number; reason: string } | null {
  let best: { score: number; reason: string } | null = null;
  for (const term of terms) {
    for (const field of fields) {
      const fieldScore = scoreField(field.value, term.term);
      if (fieldScore === 0) continue;
      const score = term.reason.startsWith('alias_') ? Math.max(fieldScore, 100) : fieldScore;
      const reason = term.reason.startsWith('alias_') ? term.reason : field.reason;
      if (!best || score > best.score || (score === best.score && reason.localeCompare(best.reason, 'pt-BR') < 0)) best = { score, reason };
    }
  }
  return best;
}

function parentFor(context: PublicProductContext): CatalogDiscoveryParent {
  return {
    productId: context.product.id,
    publicName: context.product.name,
    category: context.category,
    subcategory: context.subcategory,
    description: context.product.description ?? null,
    currentPrice: context.currentPrice,
  };
}

function candidateBase(context: PublicProductContext, entityType: CatalogDiscoveryEntityType, score: number, matchReason: string): Omit<CatalogSearchCandidate, 'groupId' | 'optionId' | 'ambiguous'> & { score: number } {
  return {
    productId: context.product.id,
    entityType,
    parent: parentFor(context),
    publicName: context.product.name,
    category: context.category,
    subcategory: context.subcategory,
    description: context.product.description ?? null,
    currentPrice: context.currentPrice,
    basePrice: context.product.basePrice,
    modifierGroups: context.groups,
    matchReason,
    confidence: Math.min(1, Math.round((score / 100) * 100) / 100),
    score,
  };
}

function compareCandidates(a: RankedCandidate, b: RankedCandidate): number {
  return b.score - a.score
    || a.publicName.localeCompare(b.publicName, 'pt-BR')
    || a.entityType.localeCompare(b.entityType)
    || (a.groupId ?? '').localeCompare(b.groupId ?? '')
    || (a.optionId ?? '').localeCompare(b.optionId ?? '')
    || a.productId - b.productId;
}

export function searchCatalogDiscovery({ empresaId, query, limit, catalog }: CatalogDiscoverySearchInput): CatalogSearchResult {
  const normalizedQuery = normalizeCatalogSearchText(query);
  const safeLimit = sanitizeCatalogSearchLimit(limit);
  if (!normalizedQuery) return { empresaId, query, normalizedQuery, limit: safeLimit, total: 0, ambiguous: false, results: [] };

  const terms = expandSearchAliases(normalizedQuery);
  const candidates: RankedCandidate[] = [];
  for (const context of flattenPublicCatalog(catalog)) {
    const productMatch = bestScore([
      { value: context.product.name, reason: 'nome_publico' },
      { value: context.product.description, reason: 'descricao' },
      { value: context.category, reason: 'categoria' },
      { value: context.subcategory, reason: 'subcategoria' },
      ...context.groups.map((group) => ({ value: group.name, reason: 'nome_do_grupo' })),
      ...context.groups.flatMap((group) => group.options.map((option) => ({ value: option.name, reason: 'nome_da_opcao' }))),
    ], terms);
    if (productMatch) candidates.push(candidateBase(context, 'product', productMatch.score, productMatch.reason));

    for (const group of context.groups) {
      const groupMatch = bestScore([{ value: group.name, reason: 'nome_do_grupo' }], terms);
      if (groupMatch) candidates.push({ ...candidateBase(context, 'modifier_group', groupMatch.score, groupMatch.reason), groupId: group.id });
      for (const option of group.options) {
        const optionMatch = bestScore([{ value: option.name, reason: 'nome_da_opcao' }], terms);
        if (optionMatch) candidates.push({ ...candidateBase(context, 'modifier_option', optionMatch.score, optionMatch.reason), groupId: group.id, optionId: option.id });
      }
    }
  }

  const ranked = candidates.sort(compareCandidates);
  const ambiguous = ranked.length > 1;
  return {
    empresaId,
    query,
    normalizedQuery,
    limit: safeLimit,
    total: ranked.length,
    ambiguous,
    results: ranked.slice(0, safeLimit).map(({ score: _score, ...candidate }) => ({ ...candidate, ambiguous })),
  };
}
