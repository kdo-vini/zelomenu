import { describe, expect, it, vi } from 'vitest';
import { bemServidoConversationCatalog } from './fixtures/bemServidoConversationCatalog';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const massFixture = bemServidoConversationCatalog.find((product) => product.id === 1007)!;
const massCatalogConfig = deepFreeze({
  catalogHierarchy: [{
    nome: 'Massas',
    produtosDireto: [{
      id: massFixture.id,
      name: massFixture.name,
      price: massFixture.basePrice,
      basePrice: massFixture.basePrice,
      available: massFixture.available,
      modifierGroups: [...massFixture.modifierGroups].reverse().map((group) => ({
        ...group,
        productId: massFixture.id,
        active: true,
        options: [...group.options].reverse().map((option) => ({
          id: option.id,
          name: option.name,
          priceDelta: option.priceDelta,
          active: option.available,
          order: option.order,
        })),
      })),
    }],
    subcategorias: [],
  }],
});

const configByEmpresa = {
  'empresa-a': {
    catalogHierarchy: [{ nome: 'Bebidas', produtosDireto: [{ id: 1, name: 'Suco de laranja', price: 8, basePrice: 8, available: true, modifierGroups: [] }], subcategorias: [] }],
  },
  'empresa-b': {
    catalogHierarchy: [{ nome: 'Lanches', produtosDireto: [{ id: 2, name: 'X-bacon', price: 19, basePrice: 19, available: true, modifierGroups: [] }], subcategorias: [] }],
  },
  'empresa-massa': massCatalogConfig,
  'empresa-estoque': {
    catalogHierarchy: [{
      nome: 'Bebidas',
      produtosDireto: [
        { id: 2001, name: 'Coca-Cola Pausada', price: 6, basePrice: 6, available: false, stockControlled: false, stockQuantity: 0, modifierGroups: [] },
        { id: 2002, name: 'Coca-Cola Sem Estoque', price: 6, basePrice: 6, available: false, stockControlled: true, stockQuantity: 0, modifierGroups: [] },
        { id: 2003, name: 'Coca-Cola Estoque Livre', price: 6, basePrice: 6, available: true, stockControlled: false, stockQuantity: 0, modifierGroups: [] },
      ],
      subcategorias: [],
    }],
  },
  'empresa-limite': {
    catalogHierarchy: [{
      nome: 'Itens',
      produtosDireto: Array.from({ length: 13 }, (_, index) => ({
        id: 3000 + index,
        name: `Item ${String(index).padStart(2, '0')}`,
        price: 5,
        basePrice: 5,
        available: true,
        modifierGroups: [],
      })),
      subcategorias: [],
    }],
  },
};

vi.mock('./configStore.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./configStore.js')>()),
  loadCatalogFromDb: vi.fn(async () => undefined),
  getConfig: (empresaId: keyof typeof configByEmpresa) => configByEmpresa[empresaId],
}));

import { CatalogDiscovery, parseInternalCatalogSearchRequest } from './internalCatalogSearch';

describe('CatalogDiscovery', () => {
  it('carrega e pesquisa somente o catálogo da empresa solicitada', async () => {
    const [a, b] = await Promise.all([
      CatalogDiscovery.search({ empresaId: 'empresa-a', query: 'suco' }),
      CatalogDiscovery.search({ empresaId: 'empresa-b', query: 'bacon' }),
    ]);

    expect(a.results.map((candidate) => candidate.productId)).toEqual([1]);
    expect(b.results.map((candidate) => candidate.productId)).toEqual([2]);
  });

  it('expõe a montagem completa da massa com o menor preço vendável, sem alterar o catálogo em cache', async () => {
    const result = await CatalogDiscovery.search({ empresaId: 'empresa-massa', query: 'Monte Sua Massa' });
    const product = result.results[0];

    expect(product.displayPrice).toEqual({ kind: 'from', amount: 22 });
    expect(product.modifierGroups.map((group) => group.id)).toEqual(['g001', 'g002', 'g003', 'g004', 'g005']);
    expect(product.modifierGroups[0]).toMatchObject({
      id: 'g001',
      kind: 'variacao',
      pricingMode: 'substituir',
      minSelections: 1,
      maxSelections: 1,
      minTotalQuantity: 1,
      maxTotalQuantity: 1,
      allowsQuantity: false,
      maxPerOption: 1,
      options: [
        { id: 'o001', currentPrice: 22, priceDelta: 22, available: true },
        { id: 'o002', currentPrice: 25, priceDelta: 25, available: true },
      ],
    });
    expect(product.modifierGroups[2]).toMatchObject({
      id: 'g003',
      kind: 'adicional',
      pricingMode: 'somar',
      minSelections: 0,
      maxSelections: 2,
      minTotalQuantity: 0,
      maxTotalQuantity: 2,
      allowsQuantity: true,
      maxPerOption: 2,
    });
    expect(product.modifierGroups[3].options).toContainEqual(expect.objectContaining({
      id: 'o010', currentPrice: 0, priceDelta: 0, available: false,
    }));
    expect(Object.isFrozen(massCatalogConfig.catalogHierarchy[0].produtosDireto[0].modifierGroups)).toBe(true);
  });

  it('omite SKU pausado e estoque controlado zerado, mas mantém estoque zero sem controle', async () => {
    const result = await CatalogDiscovery.search({ empresaId: 'empresa-estoque', query: 'Coca-Cola' });

    expect(result.results).toMatchObject([{
      productId: 2003,
      displayPrice: { kind: 'fixed', amount: 6 },
    }]);
  });

  it('mantém o teto de doze resultados na resposta serializada', async () => {
    const result = await CatalogDiscovery.search({ empresaId: 'empresa-limite', query: 'Item', limit: 99 });

    expect(result.limit).toBe(12);
    expect(result.total).toBe(13);
    expect(result.results).toHaveLength(12);
  });
});

describe('parseInternalCatalogSearchRequest', () => {
  it('rejeita empresa, consulta e limite inválidos antes de carregar o catálogo', () => {
    expect(parseInternalCatalogSearchRequest({ empresaId: '', query: 'suco' }).ok).toBe(false);
    expect(parseInternalCatalogSearchRequest({ empresaId: 'empresa-a', query: '   ' }).ok).toBe(false);
    expect(parseInternalCatalogSearchRequest({ empresaId: 'empresa-a', query: 'suco', limit: '12' }).ok).toBe(false);
  });

  it('normaliza o limite aceito para no máximo doze resultados', () => {
    expect(parseInternalCatalogSearchRequest({ empresaId: 'empresa-a', query: 'suco', limit: 99 })).toEqual({
      ok: true,
      value: { empresaId: 'empresa-a', query: 'suco', limit: 12 },
    });
  });
});
