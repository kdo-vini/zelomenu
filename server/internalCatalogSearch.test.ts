import { createServer } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bemServidoConversationCatalog } from './fixtures/bemServidoConversationCatalog';
import { createInternalCatalogFailureLimiter } from './internalCatalogRateLimit';

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

import { CatalogDiscovery, createInternalCatalogSearchHandler, parseInternalCatalogSearchRequest } from './internalCatalogSearch';

const servers: ReturnType<typeof createServer>[] = [];

async function startHttp(search?: NonNullable<Parameters<typeof createInternalCatalogSearchHandler>[0]['search']>) {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.requestId = 'req-catalog-1';
    res.setHeader('x-request-id', res.locals.requestId);
    next();
  });
  app.use('/internal/catalog/search', createInternalCatalogFailureLimiter({ isInternalKeyValid: (key) => key === 'valid' }));
  app.use(express.json());
  app.post('/internal/catalog/search', createInternalCatalogSearchHandler({
    rateLimit: (_req, _res, next) => next(),
    ...(search ? { search } : {}),
  }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  try {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
  } finally {
    vi.restoreAllMocks();
  }
});

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

  it('congela o JSON completo do catálogo rico consumido pelo ZeloChat', async () => {
    const baseUrl = await startHttp();
    const response = await fetch(`${baseUrl}/internal/catalog/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' },
      body: JSON.stringify({ empresaId: 'empresa-massa', query: 'Monte Sua Massa', limit: 1 }),
    });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(result).toEqual({
      empresaId: 'empresa-massa',
      query: 'Monte Sua Massa',
      normalizedQuery: 'monte sua massa',
      limit: 1,
      total: 2,
      ambiguous: false,
      results: [{
        productId: 1007,
        entityType: 'product',
        parent: {
          productId: 1007,
          publicName: 'Monte Sua Massa',
          category: 'Massas',
          subcategory: null,
          description: null,
          currentPrice: 22,
        },
        publicName: 'Monte Sua Massa',
        category: 'Massas',
        subcategory: null,
        description: null,
        currentPrice: 22,
        basePrice: 0,
        displayPrice: { kind: 'from', amount: 22 },
        modifierGroups: [
          {
            id: 'g001', name: 'Escolha a massa', kind: 'variacao', pricingMode: 'substituir',
            minSelections: 1, maxSelections: 1, minTotalQuantity: 1, maxTotalQuantity: 1,
            allowsQuantity: false, maxPerOption: 1, order: 1,
            options: [
              { id: 'o001', name: 'Espaguete', currentPrice: 22, priceDelta: 22, available: true, order: 1 },
              { id: 'o002', name: 'Talharim', currentPrice: 25, priceDelta: 25, available: true, order: 2 },
            ],
          },
          {
            id: 'g002', name: 'Escolha o molho', kind: 'adicional', pricingMode: 'somar',
            minSelections: 1, maxSelections: 1, minTotalQuantity: 1, maxTotalQuantity: 1,
            allowsQuantity: false, maxPerOption: 1, order: 2,
            options: [
              { id: 'o003', name: 'Molho ao sugo', currentPrice: 0, priceDelta: 0, available: true, order: 1 },
              { id: 'o004', name: 'Molho branco', currentPrice: 0, priceDelta: 0, available: true, order: 2 },
            ],
          },
          {
            id: 'g003', name: 'Proteínas', kind: 'adicional', pricingMode: 'somar',
            minSelections: 0, maxSelections: 2, minTotalQuantity: 0, maxTotalQuantity: 2,
            allowsQuantity: true, maxPerOption: 2, order: 3,
            options: [
              { id: 'o005', name: 'Bife acebolado', currentPrice: 12, priceDelta: 12, available: true, order: 1 },
              { id: 'o006', name: 'Frango grelhado', currentPrice: 10, priceDelta: 10, available: true, order: 2 },
              { id: 'o007', name: 'Calabresa acebolada', currentPrice: 9, priceDelta: 9, available: true, order: 3 },
            ],
          },
          {
            id: 'g004', name: 'Acompanhamentos', kind: 'adicional', pricingMode: 'somar',
            minSelections: 0, maxSelections: 2, minTotalQuantity: 0, maxTotalQuantity: 2,
            allowsQuantity: false, maxPerOption: 1, order: 4,
            options: [
              { id: 'o008', name: 'Salada', currentPrice: 0, priceDelta: 0, available: true, order: 1 },
              { id: 'o009', name: 'Batata palha', currentPrice: 0, priceDelta: 0, available: true, order: 2 },
              { id: 'o010', name: 'Legumes', currentPrice: 0, priceDelta: 0, available: false, order: 3 },
            ],
          },
          {
            id: 'g005', name: 'Extra pago', kind: 'adicional', pricingMode: 'somar',
            minSelections: 0, maxSelections: 2, minTotalQuantity: 0, maxTotalQuantity: 4,
            allowsQuantity: true, maxPerOption: 2, order: 5,
            options: [
              { id: 'o011', name: 'Queijo ralado', currentPrice: 3, priceDelta: 3, available: true, order: 1 },
              { id: 'o012', name: 'Bacon crocante', currentPrice: 5, priceDelta: 5, available: true, order: 2 },
            ],
          },
        ],
        matchReason: 'nome_publico',
        confidence: 0.95,
        ambiguous: false,
      }],
    });
  });

  it('redige erro técnico e dados de cliente na resposta HTTP do catálogo', async () => {
    const technicalFailure = 'Supabase catalog RPC falhou empresa=empresa-massa cliente=Cliente de teste';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const baseUrl = await startHttp(vi.fn(async () => { throw new Error(technicalFailure); }));

    const response = await fetch(`${baseUrl}/internal/catalog/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' },
      body: JSON.stringify({ empresaId: 'empresa-massa', query: 'Monte Sua Massa', limit: 1 }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'CONSULTA_INDISPONIVEL',
      detail: 'Não foi possível consultar o cardápio agora. Tente novamente em instantes.',
      requestId: 'req-catalog-1',
    });
    expect(JSON.stringify(body)).not.toContain(technicalFailure);
    expect(JSON.stringify(body)).not.toMatch(/Supabase|RPC|empresa-massa|Cliente de teste/i);
    expect(consoleError).toHaveBeenCalledOnce();
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
