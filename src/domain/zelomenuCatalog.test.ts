import { describe, expect, it } from 'vitest';
import {
  getCatalogProductRole,
  filterAvailableCatalog,
  normalizeCatalogSearchText,
  resolveCatalogUsageAvailability,
  resolveCatalogProductAvailability,
  isExactCatalogProductNameDuplicate,
  isSimilarCatalogProductName,
  searchCatalogModifierOptions,
  filterPublicCatalogByQuery,
} from './zelomenuCatalog';

describe('catalog canonical product rules', () => {
  it('finds a pizza pelo nome de um sabor disponível', () => {
    const pizza = {
      id: 10,
      available: true,
      name: 'Pizzas tradicionais',
      description: 'Escolha o tamanho',
      productType: 'pizza' as const,
      pizza: {
        version: 1,
        revision: 'r1',
        pricingMode: 'highest' as const,
        sizes: [{ id: 'g', name: 'Grande', maxFlavors: 2 }],
        flavors: [
          { id: 'cal', name: 'Calabresa', active: true, prices: { g: 40 } },
          { id: 'fra', name: 'Frango com catupiry', active: false, prices: { g: 45 } },
        ],
      },
    };
    const catalog = [{ nome: 'Pizzas', produtosDireto: [pizza], subcategorias: [] }];

    expect(filterPublicCatalogByQuery(catalog, 'calabresa')[0].produtosDireto).toEqual([pizza]);
    expect(filterPublicCatalogByQuery(catalog, 'frango')).toEqual([]);
  });
  it('normalizes accents and punctuation for search and duplicate checks', () => {
    expect(normalizeCatalogSearchText(' Bife à rolê ')).toBe('bife a role');
    expect(isExactCatalogProductNameDuplicate('bife a role', [{ id: 1, nome: 'Bife à rolê' }])?.id).toBe(1);
    expect(isSimilarCatalogProductName('bife role', { nome: 'Bife à rolê' })).toBe(true);
  });

  it('returns one canonical component result for repeated group occurrences', () => {
    const results = searchCatalogModifierOptions(
      [
        { id: 878, nome: 'Marmita executiva 700 ml' },
        { id: 879, nome: 'Marmita executiva 500 ml' },
      ],
      {
        878: [{
          productId: 878,
          name: 'Escolha 1 mistura',
          options: [
            { id: 'egg-first', name: 'Ovo frito', priceDelta: 0, active: true, order: 1 },
          ],
        }],
        879: [{
          productId: 879,
          name: 'Escolha 2 acompanhamentos',
          options: [
            { id: 'egg-second', name: 'Ovo frito', priceDelta: 2, active: true, order: 1 },
          ],
        }],
      },
      {
        'egg-first': { componentId: 'ovo-frito', priceOverride: 0 },
        'egg-second': { componentId: 'ovo-frito', priceOverride: 2 },
      } as any,
      'ovo frito',
      [{ id: 'ovo-frito', nome: 'Ovo frito', pausado_manualmente: false }],
    );

    expect(results).toEqual([{
      id: 'ovo-frito',
      name: 'Ovo frito',
      active: true,
      usageCount: 2,
      usages: [
        {
          parentProductId: 878,
          parentProductName: 'Marmita executiva 700 ml',
          groupName: 'Escolha 1 mistura',
        },
        {
          parentProductId: 879,
          parentProductName: 'Marmita executiva 500 ml',
          groupName: 'Escolha 2 acompanhamentos',
        },
      ],
    }]);
  });

  it.each([
    [false, 0, 'draft'],
    [true, 0, 'standalone'],
    [false, 2, 'component'],
    [true, 2, 'standalone_and_component'],
  ] as const)('derives role %s/%s as %s', (published, usages, expected) => {
    expect(getCatalogProductRole(published, usages)).toBe(expected);
  });

  it('hides a parent when a required group has fewer available options than its minimum', () => {
    const result = resolveCatalogProductAvailability(
      { ocultar_no_pdv: false, controlar_estoque: false, estoque_atual: 0 },
      [{
        id: 'group', productId: 10, name: 'Escolha a mistura', kind: 'variacao', pricingMode: 'substituir',
        minSelections: 1, maxSelections: 1, minTotalQuantity: 0, maxTotalQuantity: null, allowsQuantity: false, maxPerOption: null, active: true, order: 0,
        options: [{ id: 'option', name: 'Bife', priceDelta: 0, active: true, order: 0, linkedProduct: { productId: 11, name: 'Bife', photoUrl: null, price: 0, available: false } }],
      }],
    );
    expect(result.state).toBe('blocked_by_required_options');
    expect(result.available).toBe(false);
    expect(result.blockingGroups[0].name).toBe('Escolha a mistura');
  });

  it('hides a parent when the required quantity cannot fit the active options caps', () => {
    const result = resolveCatalogProductAvailability(
      { controlar_estoque: false, estoque_atual: 0 },
      [{
        id: 'quantity-group', productId: 10, name: 'Escolha os acompanhamentos', kind: 'adicional', pricingMode: 'somar',
        minSelections: 0, maxSelections: null, minTotalQuantity: 2, maxTotalQuantity: null, allowsQuantity: true, maxPerOption: 1, active: true, order: 0,
        options: [{ id: 'only-option', name: 'Arroz', priceDelta: 0, active: true, order: 0 }],
      }],
    );

    expect(result).toMatchObject({ available: false, state: 'blocked_by_required_options' });
  });

  it('hides a parent when maxSelections limits the quantity capacity below the required total', () => {
    const result = resolveCatalogProductAvailability(
      { controlar_estoque: false, estoque_atual: 0 },
      [{
        id: 'selection-cap', productId: 10, name: 'Monte o prato', kind: 'adicional', pricingMode: 'somar',
        minSelections: 0, maxSelections: 2, minTotalQuantity: 5, maxTotalQuantity: null, allowsQuantity: true, maxPerOption: 2, active: true, order: 0,
        options: [
          { id: 'rice', name: 'Arroz', priceDelta: 0, active: true, order: 0 },
          { id: 'beans', name: 'Feijão', priceDelta: 0, active: true, order: 1 },
          { id: 'salad', name: 'Salada', priceDelta: 0, active: true, order: 2 },
        ],
      }],
    );

    expect(result).toMatchObject({ available: false, state: 'blocked_by_required_options' });
  });

  it('keeps optional groups from hiding the parent', () => {
    const result = resolveCatalogProductAvailability(
      { ocultar_no_pdv: false, controlar_estoque: false, estoque_atual: 0 },
      [{
        id: 'group', productId: 10, name: 'Extra', kind: 'adicional', pricingMode: 'somar',
        minSelections: 0, maxSelections: null, minTotalQuantity: 0, maxTotalQuantity: null, allowsQuantity: false, maxPerOption: null, active: true, order: 0,
        options: [],
      }],
    );
    expect(result.available).toBe(true);
  });

  it('keeps a linked component available when the parent is hidden only in the PDV', () => {
    const linked = { ocultar_no_pdv: false, controlar_estoque: false, estoque_atual: 0 };
    const activeParent = { ocultar_no_pdv: false, controlar_estoque: false, estoque_atual: 0 };
    const pausedParent = { ocultar_no_pdv: true, controlar_estoque: false, estoque_atual: 0 };

    expect(resolveCatalogUsageAvailability({
      parent: pausedParent,
      linked,
      groupActive: true,
      optionActive: true,
    })).toBe(true);
    expect(resolveCatalogUsageAvailability({
      parent: activeParent,
      linked,
      groupActive: true,
      optionActive: true,
    })).toBe(true);
  });

  it('keeps a linked child available when it is hidden only in the PDV', () => {
    const pausedChild = { ocultar_no_pdv: true, controlar_estoque: false, estoque_atual: 0 };
    const activeParent = { ocultar_no_pdv: false, controlar_estoque: false, estoque_atual: 0 };

    expect(resolveCatalogUsageAvailability({
      parent: activeParent,
      linked: pausedChild,
      groupActive: true,
      optionActive: true,
    })).toBe(true);
  });

  it('filters component-only products from standalone cards without touching parent options', () => {
    const linkedOption = { id: 'option', available: false };
    const catalog = [{
      nome: 'Marmitas',
      produtosDireto: [{ id: 1, available: true, modifierGroups: [{ options: [linkedOption] }] }],
      subcategorias: [{
        nome: 'Componentes',
        produtos: [
          { id: 2, available: false, modifierGroups: [] },
          { id: 3, available: true, modifierGroups: [] },
        ],
      }],
    }];

    const visible = filterAvailableCatalog(catalog);

    expect(visible).toHaveLength(1);
    expect(visible[0].produtosDireto.map((product) => product.id)).toEqual([1]);
    expect(visible[0].subcategorias[0].produtos.map((product) => product.id)).toEqual([3]);
    expect(visible[0].produtosDireto[0].modifierGroups[0].options).toEqual([linkedOption]);
  });
});
