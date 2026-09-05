import type { Page } from '@playwright/test';

// Deterministic UI contract fixture; never writes orders to a real database.
type DeliveryQuoteMock = {
  deliveryStatus: string;
  deliveryFee: number;
  deliveryFeeToConfirm: boolean;
};

type PublicApiMockState = {
  revision: number;
  quote: DeliveryQuoteMock;
  fulfillment: Record<string, unknown>;
  patchDelayMs: number;
  business?: Record<string, unknown>;
};

export const publicApiMockStates = new WeakMap<Page, PublicApiMockState>();

export function buildMockCartResponse(state: PublicApiMockState) {
  const business = state.business ?? {
    name: 'Casa dos Salgados',
    address: 'Rua de teste, 100',
    pixEnabled: false,
    deliveryEnabled: true,
    deliveryNeighborhoods: [],
    businessHours: { configured: false, openNow: true, label: null },
  };
  const deliveryFee = state.quote.deliveryFee;
  const fulfillment = {
    ...state.fulfillment,
    deliveryStatus: state.quote.deliveryStatus,
    deliveryFee,
    deliveryFeeToConfirm: state.quote.deliveryFeeToConfirm,
  };
  const issues = state.quote.deliveryStatus === 'out_of_area'
    ? [{ code: 'delivery_out_of_area', message: 'Fora da area de entrega.' }]
    : [];
  return {
    session: {
      id: 'e2e-session', orderingId: 'e2e-ordering', context: 'public_order', state: 'cart_open', revision: state.revision,
      customer: { name: null, phone: null },
      cart: { items: [{ productId: 1, productName: 'Coxinha', baseUnitPrice: 12, selectedModifiers: [], modifierDeltaTotal: 0, quantity: 1, unitPrice: 12, lineTotal: 12, notes: null }], observations: null },
      fulfillment,
      pricing: { subtotal: 12, deliveryFee, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: 12 + deliveryFee },
      payment: { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false, pixCopyPaste: null },
      metadata: {}, lastRevalidatedAt: null, lastRevalidation: { checkedAt: new Date().toISOString(), ok: issues.length === 0, issues, previewCart: null, previewPricing: null, previewPayment: null },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), confirmedAt: null, archivedAt: null,
    },
    business,
    catalog: [
      { nome: 'Salgados', subcategorias: [], produtosDireto: [{ id: 1, name: 'Coxinha', price: 12, basePrice: 12, available: true, description: 'Coxinha de teste', modifierGroups: [] }] },
      { nome: 'Bebidas', subcategorias: [], produtosDireto: [{ id: 2, name: 'Suco de laranja', price: 8, basePrice: 8, available: true, description: 'Suco natural', modifierGroups: [] }] },
    ],
    link: { path: '/menu/carrinho/e2e-cart-token', tokenStatus: 'current' },
    revalidation: { checkedAt: new Date().toISOString(), ok: issues.length === 0, issues, previewCart: null, previewPricing: null, previewPayment: null },
    order: null,
  };
}

export async function mockPublicApi(page: Page) {
  const state: PublicApiMockState = {
    revision: 1,
    quote: { deliveryStatus: 'pending', deliveryFee: 0, deliveryFeeToConfirm: true },
    patchDelayMs: 0,
    business: {
      name: 'Casa dos Salgados',
      address: 'Rua de teste, 100',
      pixEnabled: false,
      deliveryEnabled: true,
      deliveryEstimatedMinutes: 40,
      deliveryNeighborhoods: [{ name: 'Centro', fee: 8 }, { name: 'Jardim', fee: 12 }],
      whatsapp: '5514999999999',
      coverUrl: 'https://cdn.test/casa-cover.jpg',
      logoUrl: 'https://cdn.test/casa-logo.jpg',
      description: 'Salgados artesanais',
      welcomeText: 'Peça seus salgados favoritos.',
      businessHours: {
        configured: true,
        openNow: true,
        label: 'Fecha às 23:00',
        timezone: 'America/Sao_Paulo',
        nextOpen: null,
        weeklySchedule: { sun: [{ start: '17:00', end: '23:00' }], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] },
        schedulingEnabled: false,
        schedulingLeadTimeMinutes: 0,
      },
    },
    fulfillment: { type: 'pickup', asap: true, pickupDate: null, pickupTime: null, deliveryAddress: null, deliveryNeighborhood: null, deliveryPostalCode: null, deliveryNumber: null, deliveryComplement: null, deliveryStreet: null, deliveryCity: null, deliveryState: null, deliveryFee: 0, deliveryFeeToConfirm: false },
  };
  publicApiMockStates.set(page, state);

  await page.route('**/api/public/zelomenu/store/**', async (route) => {
    if (route.request().method() === 'GET') {
      if (new URL(route.request().url()).pathname.endsWith('/slug-publico-inexistente-zelomenu')) {
        await route.fulfill({ status: 404, json: { error: 'STORE_NOT_FOUND' } });
        return;
      }
      await route.fulfill({ json: buildMockCartResponse(state) });
      return;
    }
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: { token: 'e2e-cart-token', path: '/menu/carrinho/e2e-cart-token', orderingId: 'e2e-ordering' } });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/public/zelomenu/cart/**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ json: buildMockCartResponse(state) });
      return;
    }
    if (method === 'PATCH') {
      const body = route.request().postDataJSON() as { expectedRevision?: number; fulfillment?: Record<string, unknown> };
      if (state.patchDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.patchDelayMs));
      state.revision = Number(body.expectedRevision ?? state.revision) + 1;
      if (body.fulfillment) state.fulfillment = { ...state.fulfillment, ...body.fulfillment };
      await route.fulfill({ json: buildMockCartResponse(state) });
      return;
    }
    if (method === 'POST') {
      await route.fulfill({ json: { ...buildMockCartResponse(state), confirmation: { confirmed: true, alreadyConfirmed: false, state: 'confirmed_waiting_review', customerMessage: null } } });
      return;
    }
    await route.continue();
  });
}

export function updateMockStoreBusiness(page: Page, patch: Record<string, unknown>) {
  const state = publicApiMockStates.get(page);
  if (!state) throw new Error('mockPublicApi must be called before updateMockStoreBusiness');
  state.business = { ...state.business, ...patch };
}
