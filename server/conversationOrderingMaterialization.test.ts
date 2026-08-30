import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessConfig, CatalogProduct } from './configStore';

let products: CatalogProduct[] = [];

const weeklyHours = {
  sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [],
};

function config(): BusinessConfig {
  return {
    name: 'Lanchonete Canônica',
    address: 'Rua Teste, 10',
    contato: null,
    deliveryConfig: null,
    pixReceiptConfig: null,
    pixPayment: null,
    publicationSummary: { total: products.length, published: products.filter((p) => p.available).length, unpublished: 0, paused: 0, hidden: 0, outOfStock: 0, missingCategory: 0, attention: 0 },
    catalogHierarchy: [{ nome: 'Lanches', subcategorias: [], produtosDireto: products }],
    products,
    weeklyHours,
    schedulingEnabled: true,
    schedulingLeadTimeMinutes: 0,
    closedDays: [],
  };
}

vi.mock('./configStore.js', () => ({
  loadCatalogFromDb: vi.fn(async () => undefined),
  getConfig: () => config(),
}));

vi.mock('./zelomenuDeliveryService.js', () => ({
  revalidateDeliveryForCart: vi.fn(),
  createDeliveryQuoteRequest: vi.fn(),
  findDeliveryQuoteRequest: vi.fn(),
}));

import { materializeWhatsAppOrderDraft } from './zelomenuCartSessions';

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 10,
    name: 'X-Bacon oficial',
    price: 20,
    basePrice: 20,
    available: true,
    stockControlled: false,
    stockQuantity: 0,
    modifierGroups: [{
      id: 'g1', productId: 10, name: 'Adicionais', kind: 'adicional', pricingMode: 'somar',
      minSelections: 0, maxSelections: 2, minTotalQuantity: 0, maxTotalQuantity: null,
      allowsQuantity: false, maxPerOption: null, active: true, order: 0,
      options: [{ id: 'o1', name: 'Bacon extra', priceDelta: 3, active: true, order: 0 }],
    }],
    ...overrides,
  };
}

beforeEach(() => { products = [product()]; });

describe('materializeWhatsAppOrderDraft', () => {
  it('materializa nomes, preços, complementos, subtotal e asap somente pelo servidor', async () => {
    const result = await materializeWhatsAppOrderDraft({
      empresaId: '10000000-0000-4000-8000-000000000001',
      items: [{ productId: 10, quantity: 2, selectedOptions: [{ groupId: 'g1', optionSelections: [{ optionId: 'o1', quantity: 1 }] }] }],
    });

    expect(result.cart.items[0]).toMatchObject({ productName: 'X-Bacon oficial', baseUnitPrice: 20, unitPrice: 23, quantity: 2, lineTotal: 46 });
    expect(result.cart.items[0].selectedModifiers[0].selectedOptions[0]).toMatchObject({ optionName: 'Bacon extra', priceDelta: 3 });
    expect(result.pricing).toMatchObject({ subtotal: 46, deliveryFee: 0, total: 46 });
    expect(result.fulfillment).toMatchObject({ type: 'pickup', asap: true });
  });

  it.each(['invisível', 'pausado'])('rejeita produto %s na projeção pública canônica', async () => {
    products = [product({ available: false })];
    await expect(materializeWhatsAppOrderDraft({ empresaId: '10000000-0000-4000-8000-000000000001', items: [{ productId: 10, quantity: 1 }] }))
      .rejects.toThrow('PRODUCT_UNAVAILABLE');
  });

  it('rejeita produto sem estoque e montagem com opção inválida', async () => {
    products = [product({ stockControlled: true, stockQuantity: 0 })];
    await expect(materializeWhatsAppOrderDraft({ empresaId: '10000000-0000-4000-8000-000000000001', items: [{ productId: 10, quantity: 1 }] }))
      .rejects.toThrow(/PRODUCT_STOCK_EXCEEDED/);

    products = [product()];
    await expect(materializeWhatsAppOrderDraft({
      empresaId: '10000000-0000-4000-8000-000000000001',
      items: [{ productId: 10, quantity: 1, selectedOptions: [{ groupId: 'g1', optionSelections: [{ optionId: 'inexistente', quantity: 1 }] }] }],
    })).rejects.toThrow(/MODIFIER_INVALID/);
  });

  it('não usa nome como fallback quando o ID solicitado não existe', async () => {
    await expect(materializeWhatsAppOrderDraft({ empresaId: '10000000-0000-4000-8000-000000000001', items: [{ productId: 999, quantity: 1 }] }))
      .rejects.toThrow('PRODUCT_NOT_FOUND');
  });
});
