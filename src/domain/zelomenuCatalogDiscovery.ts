import { previewModifierPrice, resolveModifierOptionPrice } from './zelomenuModifiers';
import { isRequiredModifierGroupSatisfiable, normalizeCatalogSearchText } from './zelomenuCatalog';
import { isSearchStopword } from './portugueseStopwords';
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

export type CatalogDiscoveryModifierOption = Pick<ZeloMenuModifierOption, 'id' | 'name' | 'priceDelta' | 'order'> & {
  currentPrice: number;
};

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
  optionCurrentPrice?: number;
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
function expandSearchAliases(rawNormalizedQuery: string, normalizedQuery: string): Array<{ term: string; reason: string }> {
  const terms = [{ term: normalizedQuery, reason: 'consulta_normalizada' }];
  const words = new Set(rawNormalizedQuery.split(' ').filter(Boolean));
  const hasMarmitaPhrase = rawNormalizedQuery.includes('cardapio de hoje')
    || rawNormalizedQuery.includes('cardapio hoje')
    || rawNormalizedQuery.includes('marmita do dia')
    || (words.has('mistura') && (words.has('hoje') || words.has('tem')))
    || (words.has('proteina') && (words.has('hoje') || words.has('marmita')));
  if (hasMarmitaPhrase) terms.push({ term: 'marmita do dia', reason: 'alias_marmita_do_dia' });
  return terms;
}

function normalizeDiscoveryQuery(value: string): string {
  const stopWords = new Set(['a', 'as', 'da', 'de', 'do', 'o', 'os', 'oq', 'que', 'tem']);
  return normalizeCatalogSearchText(value).split(' ').filter((word) => !stopWords.has(word)).join(' ');
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
        .map((option) => ({ id: option.id, name: option.name, priceDelta: option.priceDelta, currentPrice: resolveModifierOptionPrice(option), order: option.order })),
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
      if ((product.modifierGroups ?? []).some((group) => !isRequiredModifierGroupSatisfiable(group))) return;
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

/**
 * FIX 2026-09-09: o ranking anterior era `45 + tokens_compartilhados * 10`,
 * com nome, descrição, categoria e opção valendo o mesmo. Um único token em
 * comum já valia 55 pontos, então "vc pode mandar o cardapio?" casou com
 * "Batata frita com cheddar e bacon" — cuja descrição pública diz "vai
 * surpreender **vc** com a cobertura" — e foi o ÚNICO produto do catálogo a
 * pontuar. O cliente pediu o cardápio e recebeu uma porção de fritas.
 *
 * O modelo agora é cobertura: a nota é a fração do peso da consulta que o
 * produto cobre, cada acerto valendo conforme o campo em que caiu. Um termo de
 * quatro cobrindo só a descrição fica em 0,3 e não passa do piso; a mesma
 * consulta batendo no nome do prato fecha em 1,0. A nota volta em `confidence`.
 */
const FIELD_WEIGHTS = {
  nome_publico: 1,
  categoria: 0.7,
  subcategoria: 0.7,
  nome_do_grupo: 0.6,
  nome_da_opcao: 0.6,
  descricao: 0.3,
} as const;

export type CatalogSearchFieldReason = keyof typeof FIELD_WEIGHTS;

/** Abaixo disto o produto não é resposta: é ruído de token. */
const RELEVANCE_FLOOR = 0.45;
/** Similaridade de trigrama que aceita um erro de digitação. */
const TYPO_SIMILARITY_FLOOR = 0.7;
/** Qualidade atribuída a um acerto por distância de edição 1. */
const EDIT_DISTANCE_QUALITY = 0.85;

/** Plural simples do português: caldo/caldos, massa/massas. */
function stemToken(token: string): string {
  return token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token;
}

function tokenizeForSearch(value: string | null | undefined): string[] {
  return normalizeCatalogSearchText(value ?? '').split(' ').filter(Boolean).map(stemToken);
}

function trigramSet(word: string): Set<string> {
  const padded = `  ${word} `;
  const out = new Set<string>();
  for (let index = 0; index < padded.length - 2; index += 1) out.add(padded.slice(index, index + 3));
  return out;
}

function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const first = trigramSet(a);
  const second = trigramSet(b);
  let shared = 0;
  for (const gram of first) if (second.has(gram)) shared += 1;
  const union = first.size + second.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Levenshtein com teto: desiste assim que a linha inteira passa de `max`. */
function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < rowBest) rowBest = value;
    }
    if (rowBest > max) return false;
    previous = current;
  }
  return previous[b.length] <= max;
}

type QueryTerm = { token: string; weight: number; quality: number };
type ScoredField = { tokens: Set<string>; reason: CatalogSearchFieldReason };
type QueryVocabulary = { documentFrequency: Map<string, number>; total: number };

function fieldsFor(values: Array<{ value: string | null | undefined; reason: CatalogSearchFieldReason }>): ScoredField[] {
  return values.map((entry) => ({ tokens: new Set(tokenizeForSearch(entry.value)), reason: entry.reason }));
}

/**
 * Vocabulário do catálogo e em quantos produtos cada token aparece. O peso IDF
 * daí derivado separa "canjiquinha" (um produto) de "frango" (vinte e seis) —
 * mas nunca substitui a lista de stopwords: num cardápio pequeno as palavras
 * mais buscadas são também as mais frequentes, então corte por frequência
 * descartaria justamente o que o cliente digita.
 */
function buildVocabulary(contexts: PublicProductContext[]): QueryVocabulary {
  const documentFrequency = new Map<string, number>();
  for (const context of contexts) {
    const seen = new Set<string>();
    for (const field of productFields(context)) for (const token of field.tokens) seen.add(token);
    for (const token of seen) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  return { documentFrequency, total: contexts.length };
}

function productFields(context: PublicProductContext): ScoredField[] {
  return fieldsFor([
    { value: context.product.name, reason: 'nome_publico' },
    { value: context.category, reason: 'categoria' },
    { value: context.subcategory, reason: 'subcategoria' },
    { value: context.product.description, reason: 'descricao' },
    ...context.groups.map((group) => ({ value: group.name, reason: 'nome_do_grupo' as const })),
    ...context.groups.flatMap((group) => group.options.map((option) => ({ value: option.name, reason: 'nome_da_opcao' as const }))),
  ]);
}

/**
 * Traduz a frase do cliente em termos que o catálogo entende. Um token que não
 * existe no vocabulário nem se parece com nada dele é descartado: não consegue
 * separar produto nenhum, e mantê-lo faria a consulta inteira ficar abaixo do
 * piso — é assim que "tem caldos hj?" continua achando caldo.
 */
function resolveQueryTerms(query: string, vocabulary: QueryVocabulary): QueryTerm[] {
  const { documentFrequency, total } = vocabulary;
  // log(1 + N/df) nunca zera, nem quando o token está em todos os produtos —
  // catálogo pequeno chega nesse caso com facilidade.
  const idf = (token: string) => Math.log(1 + total / (documentFrequency.get(token) ?? total));
  const known = [...documentFrequency.keys()].filter((token) => !isSearchStopword(token));
  const terms: QueryTerm[] = [];
  const seen = new Set<string>();

  for (const raw of tokenizeForSearch(query)) {
    if (isSearchStopword(raw)) continue;
    let resolved: { token: string; quality: number } | null = null;
    if (documentFrequency.has(raw)) {
      resolved = { token: raw, quality: 1 };
    } else if (raw.length >= 4) {
      for (const candidate of known) {
        if (candidate.length < 4 || candidate[0] !== raw[0]) continue;
        const similarity = trigramSimilarity(raw, candidate);
        if (similarity >= TYPO_SIMILARITY_FLOOR && (!resolved || similarity > resolved.quality)) {
          resolved = { token: candidate, quality: similarity };
        }
      }
      // Trigrama não pega troca de letra no miolo de palavra curta:
      // "marmyta" x "marmita" dá 0,45. Uma edição de distância 1 pega.
      if (!resolved && raw.length >= 5) {
        for (const candidate of known) {
          if (candidate.length < 5 || candidate[0] !== raw[0]) continue;
          if (withinEditDistance(raw, candidate, 1)) {
            resolved = { token: candidate, quality: EDIT_DISTANCE_QUALITY };
            break;
          }
        }
      }
    }
    if (!resolved || seen.has(resolved.token)) continue;
    seen.add(resolved.token);
    terms.push({ token: resolved.token, weight: idf(resolved.token), quality: resolved.quality });
  }
  return terms;
}

/**
 * Fração do peso da consulta que estes campos cobrem, com o campo do melhor
 * acerto como `reason`. `null` quando fica abaixo do piso de relevância.
 */
function coverageScore(
  fields: ScoredField[],
  termSets: Array<{ terms: QueryTerm[]; reason: string | null }>,
): { score: number; reason: string } | null {
  let best: { score: number; reason: string } | null = null;
  for (const termSet of termSets) {
    const denominator = termSet.terms.reduce((sum, term) => sum + term.weight, 0);
    if (!denominator) continue;
    let numerator = 0;
    let bestReason: CatalogSearchFieldReason | null = null;
    let bestContribution = 0;
    for (const term of termSet.terms) {
      let termBest = 0;
      let termReason: CatalogSearchFieldReason | null = null;
      for (const field of fields) {
        if (!field.tokens.has(term.token)) continue;
        const contribution = term.weight * term.quality * FIELD_WEIGHTS[field.reason];
        if (contribution > termBest) {
          termBest = contribution;
          termReason = field.reason;
        }
      }
      numerator += termBest;
      if (termBest > bestContribution && termReason) {
        bestContribution = termBest;
        bestReason = termReason;
      }
    }
    const score = numerator / denominator;
    if (score < RELEVANCE_FLOOR) continue;
    const reason = termSet.reason ?? bestReason ?? 'nome_publico';
    if (!best || score > best.score) best = { score, reason };
  }
  return best;
}

function supportsMarmitaAlias(context: PublicProductContext): boolean {
  if (normalizeCatalogSearchText(context.product.name).includes('marmita')) return true;
  return context.groups.some((group) => /(?:mistura|proteina)/.test(normalizeCatalogSearchText(group.name)));
}

function usesMarmitaConcept(group: CatalogDiscoveryModifierGroup): boolean {
  return /(?:mistura|proteina|marmita)/.test(normalizeCatalogSearchText(group.name));
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
    // `score` agora é cobertura 0..1, que é o que `confidence` sempre
    // prometeu — antes era a nota bruta de 0 a 95 dividida por 100.
    confidence: Math.min(1, Math.round(score * 100) / 100),
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
  const rawNormalizedQuery = normalizeCatalogSearchText(query);
  const normalizedQuery = normalizeDiscoveryQuery(query);
  const safeLimit = sanitizeCatalogSearchLimit(limit);
  if (!normalizedQuery) return { empresaId, query, normalizedQuery, limit: safeLimit, total: 0, ambiguous: false, results: [] };

  const contexts = flattenPublicCatalog(catalog);
  const vocabulary = buildVocabulary(contexts);
  const aliases = expandSearchAliases(rawNormalizedQuery, normalizedQuery);
  // Cada alias vira um conjunto de termos alternativo; o produto fica com a
  // melhor cobertura entre eles. `reason` de alias vence o campo, como antes.
  const termSets = aliases.map((alias) => ({
    terms: resolveQueryTerms(alias.term, vocabulary),
    reason: alias.reason.startsWith('alias_') ? alias.reason : null,
  }));
  const plainTermSets = termSets.filter((set) => !set.reason);
  if (!termSets.some((set) => set.terms.length)) {
    return { empresaId, query, normalizedQuery, limit: safeLimit, total: 0, ambiguous: false, results: [] };
  }

  const candidates: RankedCandidate[] = [];
  for (const context of contexts) {
    const productSets = supportsMarmitaAlias(context) ? termSets : plainTermSets;
    const productMatch = coverageScore(productFields(context), productSets);
    if (productMatch) candidates.push(candidateBase(context, 'product', productMatch.score, productMatch.reason));

    for (const group of context.groups) {
      const groupSets = usesMarmitaConcept(group) ? termSets : plainTermSets;
      const groupMatch = coverageScore(fieldsFor([{ value: group.name, reason: 'nome_do_grupo' }]), groupSets);
      if (groupMatch) candidates.push({ ...candidateBase(context, 'modifier_group', groupMatch.score, groupMatch.reason), groupId: group.id });
      for (const option of group.options) {
        const optionMatch = coverageScore(fieldsFor([{ value: option.name, reason: 'nome_da_opcao' }]), groupSets);
        if (optionMatch) candidates.push({ ...candidateBase(context, 'modifier_option', optionMatch.score, optionMatch.reason), groupId: group.id, optionId: option.id, optionCurrentPrice: option.currentPrice });
      }
    }
  }

  const ranked = candidates.sort(compareCandidates);
  const candidatesByProduct = new Map<number, RankedCandidate[]>();
  for (const candidate of ranked) {
    const productCandidates = candidatesByProduct.get(candidate.productId) ?? [];
    productCandidates.push(candidate);
    candidatesByProduct.set(candidate.productId, productCandidates);
  }
  const semanticSenses = new Set<string>();
  for (const [productId, productCandidates] of candidatesByProduct) {
    const optionIds = new Set(productCandidates.filter((candidate) => candidate.entityType === 'modifier_option').map((candidate) => candidate.optionId));
    const hasDirectProductMatch = productCandidates.some((candidate) => (
      candidate.entityType === 'product'
      && candidate.matchReason !== 'nome_do_grupo'
      && candidate.matchReason !== 'nome_da_opcao'
    ));
    if (hasDirectProductMatch && optionIds.size > 0) {
      semanticSenses.add(`product:${productId}`);
      for (const optionId of optionIds) semanticSenses.add(`option:${productId}:${optionId}`);
    } else if (optionIds.size > 1) {
      for (const optionId of optionIds) semanticSenses.add(`option:${productId}:${optionId}`);
    } else {
      semanticSenses.add(`product:${productId}`);
    }
  }
  const ambiguous = semanticSenses.size > 1;
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
