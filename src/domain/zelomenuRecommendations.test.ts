import { describe, it, expect } from 'vitest';
import { resolveCheckoutSuggestions } from './zelomenuRecommendations';

const mkProduct = (id: number, opts?: { available?: boolean }): any => ({
  id,
  name: `Produto ${id}`,
  basePrice: 10,
  available: opts?.available ?? true,
  photoUrl: null,
  description: null,
  modifierGroups: [],
  hasRequiredModifier: false,
  unitBased: false,
});

const mkCatalog = (products: any[]) => [
  {
    groupId: 'g1',
    nome: 'Categoria',
    produtosDireto: products,
    subcategorias: [],
  },
];

const base = {
  enabled: true,
  catalog: mkCatalog([mkProduct(1), mkProduct(2), mkProduct(3)]),
  cartProductIds: [] as number[],
  recommendationProductIds: [1, 2, 3],
};

describe('resolveCheckoutSuggestions', () => {
  it('desabilitado → vazio', () => {
    const result = resolveCheckoutSuggestions({ ...base, enabled: false });
    expect(result).toEqual([]);
  });

  it('respeita a ordem de recommendationProductIds', () => {
    const result = resolveCheckoutSuggestions({ ...base, recommendationProductIds: [3, 1, 2] });
    expect(result.map((p) => p.id)).toEqual([3, 1, 2]);
  });

  it('remove item already in cart', () => {
    const result = resolveCheckoutSuggestions({ ...base, cartProductIds: [2] });
    expect(result.map((p) => p.id)).toEqual([1, 3]);
  });

  it('remove indisponível', () => {
    const catalog = mkCatalog([mkProduct(1), mkProduct(2, { available: false }), mkProduct(3)]);
    const result = resolveCheckoutSuggestions({ ...base, catalog });
    expect(result.map((p) => p.id)).toEqual([1, 3]);
  });

  it('remove id inexistente', () => {
    const result = resolveCheckoutSuggestions({ ...base, recommendationProductIds: [99, 1] });
    expect(result.map((p) => p.id)).toEqual([1]);
  });

  it('respeita o cap', () => {
    const catalog = mkCatalog([mkProduct(1), mkProduct(2), mkProduct(3), mkProduct(4)]);
    const result = resolveCheckoutSuggestions({ ...base, catalog, recommendationProductIds: [1, 2, 3, 4], max: 2 });
    expect(result).toHaveLength(2);
  });

  it('lista vazia após filtro → vazio', () => {
    const result = resolveCheckoutSuggestions({ ...base, cartProductIds: [1, 2, 3] });
    expect(result).toEqual([]);
  });

  it('recommendationProductIds vazio → vazio', () => {
    const result = resolveCheckoutSuggestions({ ...base, recommendationProductIds: [] });
    expect(result).toEqual([]);
  });
});
