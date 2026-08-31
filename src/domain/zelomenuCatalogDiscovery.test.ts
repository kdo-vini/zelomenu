import { describe, expect, it } from 'vitest';
import type { CatalogCategoriaGroup, CatalogProduct } from '../../server/configStore';
import { searchCatalogDiscovery } from './zelomenuCatalogDiscovery';

function product(overrides: Partial<CatalogProduct> & Pick<CatalogProduct, 'id' | 'name'>): CatalogProduct {
  return {
    price: 10,
    basePrice: 10,
    available: true,
    modifierGroups: [],
    ...overrides,
  };
}

const marmita = product({
  id: 10,
  name: 'Marmita do dia',
  price: 0,
  basePrice: 0,
  description: 'Monte sua marmita com arroz, feijão e salada.',
  modifierGroups: [
    {
      id: 'sizes', productId: 10, name: 'Escolha o tamanho', kind: 'variacao', pricingMode: 'substituir',
      minSelections: 1, maxSelections: 1, minTotalQuantity: 0, maxTotalQuantity: null, allowsQuantity: false, maxPerOption: null, active: true, order: 0,
      options: [
        { id: 'p', name: 'Pequena', priceDelta: 18, active: true, order: 0 },
        { id: 'm', name: 'Média', priceDelta: 22, active: true, order: 1 },
      ],
    },
    {
      id: 'mix', productId: 10, name: 'Escolha a mistura', kind: 'variacao', pricingMode: 'somar',
      minSelections: 1, maxSelections: 1, minTotalQuantity: 0, maxTotalQuantity: null, allowsQuantity: false, maxPerOption: null, active: true, order: 1,
      options: [
        { id: 'bife', name: 'Bife acebolado', priceDelta: 0, active: true, order: 0 },
        { id: 'frango', name: 'Frango grelhado', priceDelta: 0, active: true, order: 1 },
        { id: 'inactive-mix', name: 'Linguiça', priceDelta: 0, active: false, order: 2 },
      ],
    },
    {
      id: 'inactive-group', productId: 10, name: 'Molhos antigos', kind: 'adicional', pricingMode: 'somar',
      minSelections: 0, maxSelections: null, minTotalQuantity: 0, maxTotalQuantity: null, allowsQuantity: false, maxPerOption: null, active: false, order: 2,
      options: [{ id: 'inactive-option', name: 'Molho secreto', priceDelta: 1, active: true, order: 0 }],
    },
  ],
});

const catalog: CatalogCategoriaGroup[] = [{
  nome: 'Marmitas',
  produtosDireto: [marmita],
  subcategorias: [{
    nome: 'Almoço',
    produtos: [
      product({ id: 20, name: 'Porção de batata', description: 'Batata frita crocante.' }),
      product({ id: 30, name: 'Produto invisível', available: false }),
      product({ id: 31, name: 'Produto pausado', available: false }),
      product({ id: 32, name: 'Produto sem estoque', available: false }),
      product({
        id: 40,
        name: 'Prato executivo',
        modifierGroups: [{
          id: 'side', productId: 40, name: 'Acompanhamento', kind: 'adicional', pricingMode: 'somar',
          minSelections: 0, maxSelections: null, minTotalQuantity: 0, maxTotalQuantity: null, allowsQuantity: false, maxPerOption: null, active: true, order: 0,
          options: [{ id: 'side-batata', name: 'Batata frita', priceDelta: 0, active: true, order: 0 }],
        }],
      }),
    ],
  }],
}];

describe('searchCatalogDiscovery', () => {
  it('encontra somente produtos elegíveis na projeção pública, sem expor invisíveis, pausados ou sem estoque', () => {
    const result = searchCatalogDiscovery({ empresaId: 'empresa-a', query: 'produto', catalog });

    expect(result.results.map((candidate) => candidate.productId)).toEqual([]);
  });

  it('interpreta mistura informal como marmita do dia e preserva tamanhos e opções válidos', () => {
    const result = searchCatalogDiscovery({ empresaId: 'empresa-a', query: 'oq tem de mistura hoje', catalog });
    const marmitaResult = result.results.find((candidate) => candidate.entityType === 'product' && candidate.productId === 10);

    expect(marmitaResult).toMatchObject({
      publicName: 'Marmita do dia',
      category: 'Marmitas',
      subcategory: null,
      currentPrice: 18,
      matchReason: 'alias_marmita_do_dia',
    });
    expect(marmitaResult?.modifierGroups.map((group) => group.name)).toEqual(['Escolha o tamanho', 'Escolha a mistura']);
    expect(marmitaResult?.modifierGroups[0].options.map((option) => option.name)).toEqual(['Pequena', 'Média']);
    expect(marmitaResult?.modifierGroups[1].options.map((option) => option.name)).toEqual(['Bife acebolado', 'Frango grelhado']);
  });

  it('não eleva descrições parcialmente parecidas acima da marmita ao aplicar o alias do dia', () => {
    const catalogWithDistractors: CatalogCategoriaGroup[] = [{
      ...catalog[0],
      subcategorias: [{
        ...catalog[0].subcategorias[0],
        produtos: [
          ...catalog[0].subcategorias[0].produtos,
          product({ id: 50, name: 'Prato caseiro', description: 'Preparado no dia.' }),
          product({ id: 51, name: 'Doce do chef', description: 'Sobremesa da casa.' }),
        ],
      }],
    }];

    const result = searchCatalogDiscovery({ empresaId: 'empresa-a', query: 'oq tem de mistura hoje', catalog: catalogWithDistractors });

    expect(result.results[0]).toMatchObject({ productId: 10, publicName: 'Marmita do dia', confidence: 0.95 });
    expect(result.results.filter((candidate) => candidate.productId === 50 || candidate.productId === 51)
      .every((candidate) => candidate.confidence < 1)).toBe(true);
  });

  it('prioriza Marmita do dia exata sobre outra marmita ao expandir o cardápio de hoje', () => {
    const marmitaAliasCatalog: CatalogCategoriaGroup[] = [{
      nome: 'Marmitas',
      produtosDireto: [
        product({ id: 80, name: 'Marmita de frango' }),
        product({ id: 81, name: 'Marmita do dia' }),
      ],
      subcategorias: [],
    }];

    const result = searchCatalogDiscovery({ empresaId: 'empresa-a', query: 'cardápio de hoje', catalog: marmitaAliasCatalog });

    expect(result.results[0]).toMatchObject({ productId: 81, publicName: 'Marmita do dia', matchReason: 'alias_marmita_do_dia' });
  });

  it('mantém o vínculo com o produto-pai ao encontrar uma opção', () => {
    const result = searchCatalogDiscovery({ empresaId: 'empresa-a', query: 'bife acebolado', catalog });
    const option = result.results.find((candidate) => candidate.entityType === 'modifier_option');

    expect(option).toMatchObject({
      productId: 10,
      groupId: 'mix',
      optionId: 'bife',
      parent: { productId: 10, publicName: 'Marmita do dia' },
    });
  });

  it('expõe o preço vigente de uma opção vinculada ao produto, não apenas o delta', () => {
    const linkedCatalog: CatalogCategoriaGroup[] = [{
      nome: 'Pratos',
      produtosDireto: [product({
        id: 60,
        name: 'Executivo',
        modifierGroups: [{
          id: 'protein', productId: 60, name: 'Proteína', kind: 'variacao', pricingMode: 'substituir',
          minSelections: 1, maxSelections: 1, minTotalQuantity: 0, maxTotalQuantity: null, allowsQuantity: false, maxPerOption: null, active: true, order: 0,
          options: [{ id: 'linked', name: 'Filé de frango', priceDelta: 0, active: true, order: 0, linkedProduct: { productId: 61, name: 'Filé de frango', photoUrl: null, price: 7, available: true } }],
        }],
      })],
      subcategorias: [],
    }];

    const option = searchCatalogDiscovery({ empresaId: 'empresa-a', query: 'filé de frango', catalog: linkedCatalog })
      .results.find((candidate) => candidate.entityType === 'modifier_option') as { optionCurrentPrice?: number } | undefined;

    expect(option?.optionCurrentPrice).toBe(7);
  });

  it('expõe os sentidos distintos de batata sem escolher um candidato silenciosamente', () => {
    const result = searchCatalogDiscovery({ empresaId: 'empresa-a', query: 'batata', limit: 12, catalog });

    expect(result.ambiguous).toBe(true);
    expect(result.results.map((candidate) => [candidate.entityType, candidate.productId, candidate.optionId ?? null])).toEqual(expect.arrayContaining([
      ['product', 20, null],
      ['modifier_option', 40, 'side-batata'],
    ]));
  });

  it('não chama de ambiguidade as linhas técnicas do mesmo produto para uma única opção', () => {
    const result = searchCatalogDiscovery({ empresaId: 'empresa-a', query: 'bife acebolado', catalog });

    expect(result.ambiguous).toBe(false);
  });

  it('mantém a ambiguidade quando o nome do produto e uma opção diferente casam de forma independente', () => {
    const independentMeaningsCatalog: CatalogCategoriaGroup[] = [{
      nome: 'Pratos',
      produtosDireto: [product({
        id: 66,
        name: 'Frango especial',
        modifierGroups: [{
          id: 'protein-choice', productId: 66, name: 'Escolha a proteína', kind: 'variacao', pricingMode: 'somar',
          minSelections: 1, maxSelections: 1, minTotalQuantity: 0, maxTotalQuantity: null, allowsQuantity: false, maxPerOption: null, active: true, order: 0,
          options: [{ id: 'grilled-chicken', name: 'Frango grelhado', priceDelta: 0, active: true, order: 0 }],
        }],
      })],
      subcategorias: [],
    }];

    const result = searchCatalogDiscovery({ empresaId: 'empresa-a', query: 'frango', catalog: independentMeaningsCatalog });
    expect(result.results.map((candidate) => [candidate.entityType, candidate.matchReason])).toEqual(expect.arrayContaining([
      ['product', 'nome_publico'],
      ['modifier_option', 'nome_da_opcao'],
    ]));
    expect(result.ambiguous).toBe(true);
  });

  it('mantém a ambiguidade quando duas opções distintas do mesmo produto são sentidos plausíveis', () => {
    const choicesCatalog: CatalogCategoriaGroup[] = [{
      nome: 'Pratos',
      produtosDireto: [product({
        id: 65,
        name: 'Prato com acompanhamento',
        modifierGroups: [{
          id: 'potato-choice', productId: 65, name: 'Escolha a batata', kind: 'adicional', pricingMode: 'somar',
          minSelections: 1, maxSelections: 1, minTotalQuantity: 0, maxTotalQuantity: null, allowsQuantity: false, maxPerOption: null, active: true, order: 0,
          options: [
            { id: 'fries', name: 'Batata frita', priceDelta: 0, active: true, order: 0 },
            { id: 'rustic', name: 'Batata rústica', priceDelta: 0, active: true, order: 1 },
          ],
        }],
      })],
      subcategorias: [],
    }];

    expect(searchCatalogDiscovery({ empresaId: 'empresa-a', query: 'batata', catalog: choicesCatalog }).ambiguous).toBe(true);
  });

  it('não oferece um produto marcado como disponível quando sua montagem obrigatória é impossível', () => {
    const impossibleCatalog: CatalogCategoriaGroup[] = [{
      nome: 'Pratos',
      produtosDireto: [product({
        id: 70,
        name: 'Prato impossível',
        modifierGroups: [{
          id: 'impossible', productId: 70, name: 'Escolha os itens', kind: 'adicional', pricingMode: 'somar',
          minSelections: 0, maxSelections: null, minTotalQuantity: 2, maxTotalQuantity: null, allowsQuantity: true, maxPerOption: 1, active: true, order: 0,
          options: [{ id: 'rice', name: 'Arroz', priceDelta: 0, active: true, order: 0 }],
        }],
      })],
      subcategorias: [],
    }];

    expect(searchCatalogDiscovery({ empresaId: 'empresa-a', query: 'impossível', catalog: impossibleCatalog }).results).toEqual([]);
  });

  it('isola a resposta na empresa e limita o resultado de forma sanitizada', () => {
    const result = searchCatalogDiscovery({ empresaId: 'empresa-b', query: 'a', limit: 999, catalog });

    expect(result.empresaId).toBe('empresa-b');
    expect(result.limit).toBe(12);
    expect(result.results).toHaveLength(result.total);
    expect(result.results.length).toBeLessThanOrEqual(12);
  });
});
