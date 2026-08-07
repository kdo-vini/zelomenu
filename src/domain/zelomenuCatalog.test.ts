import { describe, expect, it } from 'vitest';
import {
  getCatalogProductRole,
  normalizeCatalogSearchText,
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
});
