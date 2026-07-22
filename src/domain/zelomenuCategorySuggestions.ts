import type { ZeloMenuCatalogGroup, ZeloMenuCatalogProduct } from '../services/zelomenuApi';

function collectProducts(catalog: ZeloMenuCatalogGroup[]): ZeloMenuCatalogProduct[] {
  const all: ZeloMenuCatalogProduct[] = [];
  for (const g of catalog) {
    for (const p of g.produtosDireto) all.push(p);
    for (const sub of g.subcategorias) for (const p of sub.produtos) all.push(p);
  }
  return all;
}

export function resolveCategorySuggestions(
  catalog: ZeloMenuCatalogGroup[],
  cartProductIds: number[],
  categoryName: string,
  suggestionsByCategory: Record<string, number[]>,
): ZeloMenuCatalogProduct[] {
  const ids = suggestionsByCategory[categoryName] ?? [];
  if (ids.length === 0) return [];

  const byId = new Map(collectProducts(catalog).map((p) => [p.id, p]));
  const inCart = new Set(cartProductIds);

  return ids
    .map((id) => byId.get(id))
    .filter((p): p is ZeloMenuCatalogProduct =>
      p != null
      && p.available !== false
      && p.modifierGroups.length === 0
      && !inCart.has(p.id),
    )
    .slice(0, 3);
}
