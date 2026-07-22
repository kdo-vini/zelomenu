import { describe, it, expect } from 'vitest';
import { resolveCategorySuggestions } from './zelomenuCategorySuggestions';

const mkProduct = (id: number, opts?: { available?: boolean; modifierCount?: number }): any => ({
  id,
  name: `Produto ${id}`,
  basePrice: 10,
  available: opts?.available ?? true,
  photoUrl: null,
  description: null,
  modifierGroups: Array.from({ length: opts?.modifierCount ?? 0 }, (_, i) => ({
    id: `g${i}`,
    name: `Grupo ${i}`,
    active: true,
    minSelections: 0,
    maxSelections: 1,
    options: [],
  })),
  unitBased: false,
});

const catalog = [
  {
    nome: 'Massas',
    subcategorias: [],
    produtosDireto: [mkProduct(1), mkProduct(2), mkProduct(3), mkProduct(4)],
  },
  {
    nome: 'Bebidas',
    subcategorias: [],
    produtosDireto: [mkProduct(5), mkProduct(6)],
  },
];

describe('resolveCategorySuggestions', () => {
  it('retorna sugestões para a categoria', () => {
    const result = resolveCategorySuggestions(catalog, [], 'Massas', { Massas: [1, 2, 3] });
    expect(result.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it('respeita a ordem configurada', () => {
    const result = resolveCategorySuggestions(catalog, [], 'Massas', { Massas: [3, 1, 2] });
    expect(result.map((p) => p.id)).toEqual([3, 1, 2]);
  });

  it('remove item já no carrinho', () => {
    const result = resolveCategorySuggestions(catalog, [2], 'Massas', { Massas: [1, 2, 3] });
    expect(result.map((p) => p.id)).toEqual([1, 3]);
  });

  it('remove produto indisponível', () => {
    const cat = [
      {
        nome: 'Massas',
        subcategorias: [],
        produtosDireto: [mkProduct(1), mkProduct(2, { available: false }), mkProduct(3)],
      },
    ];
    const result = resolveCategorySuggestions(cat, [], 'Massas', { Massas: [1, 2, 3] });
    expect(result.map((p) => p.id)).toEqual([1, 3]);
  });

  it('remove produto com modificador', () => {
    const cat = [
      {
        nome: 'Massas',
        subcategorias: [],
        produtosDireto: [mkProduct(1), mkProduct(2, { modifierCount: 1 }), mkProduct(3)],
      },
    ];
    const result = resolveCategorySuggestions(cat, [], 'Massas', { Massas: [1, 2, 3] });
    expect(result.map((p) => p.id)).toEqual([1, 3]);
  });

  it('corta em 3', () => {
    const cat = [
      {
        nome: 'Massas',
        subcategorias: [],
        produtosDireto: [mkProduct(1), mkProduct(2), mkProduct(3), mkProduct(4)],
      },
    ];
    const result = resolveCategorySuggestions(cat, [], 'Massas', { Massas: [1, 2, 3, 4] });
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it('categoria sem config → vazio', () => {
    const result = resolveCategorySuggestions(catalog, [], 'Bebidas', { Massas: [1, 2] });
    expect(result).toEqual([]);
  });

  it('id inexistente no catálogo → ignorado', () => {
    const result = resolveCategorySuggestions(catalog, [], 'Massas', { Massas: [99, 1] });
    expect(result.map((p) => p.id)).toEqual([1]);
  });

  it('lista vazia após filtro → vazio', () => {
    const result = resolveCategorySuggestions(catalog, [1, 2, 3], 'Massas', { Massas: [1, 2, 3] });
    expect(result).toEqual([]);
  });
});
