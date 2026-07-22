import type { ZeloMenuCatalogGroup, ZeloMenuCatalogProduct } from '../services/zelomenuApi';

function collectProducts(catalog: ZeloMenuCatalogGroup[]): ZeloMenuCatalogProduct[] {
  const all: ZeloMenuCatalogProduct[] = [];
  for (const g of catalog) {
    for (const p of g.produtosDireto) all.push(p);
    for (const sub of g.subcategorias) for (const p of sub.produtos) all.push(p);
  }
  return all;
}

export function resolveCheckoutSuggestions(input: {
  enabled: boolean;
  recommendationProductIds: number[];
  catalog: ZeloMenuCatalogGroup[];
  cartProductIds: number[];
  max?: number;
}): ZeloMenuCatalogProduct[] {
  if (!input.enabled || input.recommendationProductIds.length === 0) return [];

  const max = input.max ?? 10;
  const byId = new Map(collectProducts(input.catalog).map((p) => [p.id, p]));
  const inCart = new Set(input.cartProductIds);

  const result: ZeloMenuCatalogProduct[] = [];
  for (const id of input.recommendationProductIds) {
    if (result.length >= max) break;
    const product = byId.get(id);
    if (!product) continue;
    if (product.available === false) continue;
    if (inCart.has(id)) continue;
    result.push(product);
  }
  return result;
}
