import type { ZeloMenuModifierGroup, ZeloMenuModifierOption } from './zelomenuModifiers';
import { normalizeText } from '../utils/normalizeText';

export type CatalogProductRole = 'standalone' | 'component' | 'standalone_and_component' | 'draft';

export type OperationalAvailability = 'available' | 'paused' | 'out_of_stock' | 'blocked_by_required_options';

export type CatalogProductForResolution = {
  id: number;
  nome: string;
  preco?: number;
  id_categoria?: number | null;
  ocultar_no_pdv?: boolean;
  controlar_estoque?: boolean;
  estoque_atual?: number;
};

export type CatalogOperationalProduct = Pick<
  CatalogProductForResolution,
  'controlar_estoque' | 'estoque_atual'
> & {
  /** Legacy row compatibility; this internal PDV flag is deliberately ignored here. */
  ocultar_no_pdv?: boolean;
};

export type CatalogVisibilityGroup<T extends { available: boolean }> = {
  nome: string;
  subcategorias: Array<{ nome: string; produtos: T[] }>;
  produtosDireto: T[];
};

export type CatalogProductUsage = {
  productId: number;
  containerId: number;
  containerName: string;
  groupId: string;
  groupName: string;
  active: boolean;
};

export type CatalogProductAvailability = {
  available: boolean;
  state: OperationalAvailability;
  reason: string | null;
  blockingGroups: Array<{ id: string; name: string; availableOptions: number; minimum: number }>;
};

export function isRequiredModifierGroupSatisfiable(group: ZeloMenuModifierGroup): boolean {
  if (!group.active) return true;
  const requiredDistinct = Math.max(0, group.minSelections);
  const requiredTotal = group.allowsQuantity
    ? Math.max(requiredDistinct, Math.max(0, group.minTotalQuantity ?? 0))
    : requiredDistinct;
  if (requiredTotal === 0) return true;

  const availableOptions = group.options.filter((option) => option.active && option.linkedProduct?.available !== false);
  if (availableOptions.length < requiredDistinct) return false;
  const perOptionCapacity = group.allowsQuantity ? group.maxPerOption ?? Number.MAX_SAFE_INTEGER : 1;
  const optionsCapacity = availableOptions.reduce((total, _option) => Math.min(Number.MAX_SAFE_INTEGER, total + perOptionCapacity), 0);
  const totalCapacity = Math.min(optionsCapacity, group.maxTotalQuantity ?? Number.MAX_SAFE_INTEGER);
  return totalCapacity >= requiredTotal;
}

export type CatalogUsageAvailabilityInput = {
  parent: CatalogOperationalProduct;
  linked: CatalogOperationalProduct;
  groupActive: boolean;
  optionActive: boolean;
};

export function normalizeCatalogSearchText(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

export function getCatalogProductRole(
  publicationVisible: boolean,
  usageCount: number,
): CatalogProductRole {
  if (usageCount > 0 && publicationVisible) return 'standalone_and_component';
  if (usageCount > 0) return 'component';
  if (publicationVisible) return 'standalone';
  return 'draft';
}

export function getProductOperationalAvailability(
  product: CatalogOperationalProduct,
): CatalogProductAvailability {
  if (product.controlar_estoque && Number(product.estoque_atual ?? 0) <= 0) {
    return { available: false, state: 'out_of_stock', reason: 'Produto sem estoque.', blockingGroups: [] };
  }
  return { available: true, state: 'available', reason: null, blockingGroups: [] };
}

/**
 * Resolves a linked option in the context of one product-pai. The canonical
 * child availability remains global, while a stocked-out parent only disables
 * this particular usage. `ocultar_no_pdv` is intentionally absent: it is an
 * internal ZeloPDV visibility flag and must not affect the customer catalog.
 */
export function resolveCatalogUsageAvailability({
  parent,
  linked,
  groupActive,
  optionActive,
}: CatalogUsageAvailabilityInput): boolean {
  if (!groupActive || !optionActive) return false;
  return getProductOperationalAvailability(parent).available
    && getProductOperationalAvailability(linked).available;
}

/**
 * Keeps only products eligible for a standalone public card. Linked options
 * remain untouched inside each product so component-only products can still be
 * selected from their parent groups.
 */
export function filterAvailableCatalog<T extends { available: boolean }>(
  groups: Array<CatalogVisibilityGroup<T>>,
): Array<CatalogVisibilityGroup<T>> {
  return groups
    .map((group) => {
      const subcategorias = group.subcategorias
        .map((sub) => ({ nome: sub.nome, produtos: sub.produtos.filter((product) => product.available) }))
        .filter((sub) => sub.produtos.length > 0);
      const produtosDireto = group.produtosDireto.filter((product) => product.available);
      return { nome: group.nome, subcategorias, produtosDireto };
    })
    .filter((group) => group.subcategorias.length > 0 || group.produtosDireto.length > 0);
}

export function getUnavailableRequiredModifierGroups(
  groups: ZeloMenuModifierGroup[] | null | undefined,
): CatalogProductAvailability['blockingGroups'] {
  return (groups ?? [])
    .filter((group) => group.active && !isRequiredModifierGroupSatisfiable(group))
    .map((group) => {
      const availableOptions = group.options.filter((option) => option.active && option.linkedProduct?.available !== false).length;
      return { id: group.id, name: group.name, availableOptions, minimum: Math.max(group.minSelections, group.allowsQuantity ? group.minTotalQuantity : 0) };
    })
    ;
}

export function resolveCatalogProductAvailability(
  product: CatalogOperationalProduct,
  groups: ZeloMenuModifierGroup[] | null | undefined,
): CatalogProductAvailability {
  const base = getProductOperationalAvailability(product);
  if (!base.available) return base;

  const blockingGroups = getUnavailableRequiredModifierGroups(groups);
  if (blockingGroups.length === 0) return base;

  return {
    available: false,
    state: 'blocked_by_required_options',
    reason: blockingGroups
      .map((group) => `${group.name} tem ${group.availableOptions} de ${group.minimum} opções disponíveis`)
      .join('; '),
    blockingGroups,
  };
}

export function buildCatalogProductUsages(
  products: CatalogProductForResolution[],
  groupsByProductId: Record<number, ZeloMenuModifierGroup[]>,
): Record<number, CatalogProductUsage[]> {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const usages: Record<number, CatalogProductUsage[]> = {};

  for (const groups of Object.values(groupsByProductId)) {
    for (const group of groups) {
      const container = productsById.get(group.productId);
      if (!container) continue;
      for (const option of group.options) {
        const linkedProduct = option.linkedProduct;
        if (!linkedProduct) continue;
        const active = group.active && option.active && linkedProduct.available !== false;
        const list = usages[linkedProduct.productId] ?? [];
        list.push({
          productId: linkedProduct.productId,
          containerId: container.id,
          containerName: container.nome,
          groupId: group.id,
          groupName: group.name,
          active,
        });
        usages[linkedProduct.productId] = list;
      }
    }
  }
  return usages;
}

export function isExactCatalogProductNameDuplicate(
  name: string,
  products: Array<Pick<CatalogProductForResolution, 'id' | 'nome'>>,
  excludeId?: number,
): CatalogProductForResolution | null {
  const normalizedName = normalizeCatalogSearchText(name);
  if (!normalizedName) return null;
  return products.find((product) => (
    product.id !== excludeId && normalizeCatalogSearchText(product.nome) === normalizedName
  )) ?? null;
}

export function isSimilarCatalogProductName(
  name: string,
  candidate: Pick<CatalogProductForResolution, 'nome'>,
): boolean {
  const normalizedName = normalizeCatalogSearchText(name);
  const normalizedCandidate = normalizeCatalogSearchText(candidate.nome);
  if (normalizedName.length <= 2 || normalizedCandidate.length <= 2) return false;
  if (normalizedCandidate.includes(normalizedName) || normalizedName.includes(normalizedCandidate)) return true;
  const queryTokens = normalizedName.split(' ').filter(Boolean);
  const candidateTokens = new Set(normalizedCandidate.split(' ').filter(Boolean));
  const sharedTokens = queryTokens.filter((token) => candidateTokens.has(token)).length;
  return queryTokens.length > 1 && sharedTokens >= Math.min(2, queryTokens.length);
}

export function countActiveModifierOptions(group: Pick<ZeloMenuModifierGroup, 'active' | 'minSelections' | 'options'>): number {
  return group.active
    ? group.options.filter((option: ZeloMenuModifierOption) => option.active && option.linkedProduct?.available !== false).length
    : 0;
}
