import { describe, expect, it } from 'vitest';
import {
  getCatalogProductRole,
  filterAvailableCatalog,
  normalizeCatalogSearchText,
  resolveCatalogUsageAvailability,
  resolveCatalogProductAvailability,
  isExactCatalogProductNameDuplicate,
  isSimilarCatalogProductName,
} from './zelomenuCatalog';

describe('catalog canonical product rules', () => {
  it('normalizes accents and punctuation for search and duplicate checks', () => {
    expect(normalizeCatalogSearchText(' Bife à rolê ')).toBe('bife a role');
    expect(isExactCatalogProductNameDuplicate('bife a role', [{ id: 1, nome: 'Bife à rolê' }])?.id).toBe(1);
    expect(isSimilarCatalogProductName('bife role', { nome: 'Bife à rolê' })).toBe(true);
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
        minSelections: 1, maxSelections: 1, allowsQuantity: false, maxPerOption: null, active: true, order: 0,
        options: [{ id: 'option', name: 'Bife', priceDelta: 0, active: true, order: 0, linkedProduct: { productId: 11, name: 'Bife', photoUrl: null, price: 0, available: false } }],
      }],
    );
    expect(result.state).toBe('blocked_by_required_options');
    expect(result.available).toBe(false);
    expect(result.blockingGroups[0].name).toBe('Escolha a mistura');
  });

  it('keeps optional groups from hiding the parent', () => {
    const result = resolveCatalogProductAvailability(
      { ocultar_no_pdv: false, controlar_estoque: false, estoque_atual: 0 },
      [{
        id: 'group', productId: 10, name: 'Extra', kind: 'adicional', pricingMode: 'somar',
        minSelections: 0, maxSelections: null, allowsQuantity: false, maxPerOption: null, active: true, order: 0,
        options: [],
      }],
    );
    expect(result.available).toBe(true);
  });

  it('pauses a shared component only in the paused parent context', () => {
    const linked = { ocultar_no_pdv: false, controlar_estoque: false, estoque_atual: 0 };
    const activeParent = { ocultar_no_pdv: false, controlar_estoque: false, estoque_atual: 0 };
    const pausedParent = { ocultar_no_pdv: true, controlar_estoque: false, estoque_atual: 0 };

    expect(resolveCatalogUsageAvailability({
      parent: pausedParent,
      linked,
      groupActive: true,
      optionActive: true,
    })).toBe(false);
    expect(resolveCatalogUsageAvailability({
      parent: activeParent,
      linked,
      groupActive: true,
      optionActive: true,
    })).toBe(true);
  });

  it('keeps a global child pause unavailable in every parent', () => {
    const pausedChild = { ocultar_no_pdv: true, controlar_estoque: false, estoque_atual: 0 };
    const activeParent = { ocultar_no_pdv: false, controlar_estoque: false, estoque_atual: 0 };

    expect(resolveCatalogUsageAvailability({
      parent: activeParent,
      linked: pausedChild,
      groupActive: true,
      optionActive: true,
    })).toBe(false);
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
