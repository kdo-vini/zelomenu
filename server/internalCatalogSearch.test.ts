import { describe, expect, it, vi } from 'vitest';

const configByEmpresa = {
  'empresa-a': {
    catalogHierarchy: [{ nome: 'Bebidas', produtosDireto: [{ id: 1, name: 'Suco de laranja', price: 8, basePrice: 8, available: true, modifierGroups: [] }], subcategorias: [] }],
  },
  'empresa-b': {
    catalogHierarchy: [{ nome: 'Lanches', produtosDireto: [{ id: 2, name: 'X-bacon', price: 19, basePrice: 19, available: true, modifierGroups: [] }], subcategorias: [] }],
  },
};

vi.mock('./configStore.js', () => ({
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
