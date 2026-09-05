import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import type { BusinessConfig } from './configStore';

const state = vi.hoisted(() => ({ session: {} as any, token: {} as any, rpc: vi.fn(), updates: [] as any[], race: false, quoteFee: 7, pending: false }));
const config = {
  name: 'Loja', address: '', contato: null, pixReceiptConfig: null, pixPayment: null,
  products: [{ id: 1, name: 'Café', price: 10, basePrice: 10, available: true, modifierGroups: [], stockControlled: false, stockQuantity: 0 }],
  catalogHierarchy: [], deliveryConfig: { enabled: true, neighborhoods: [] },
  weeklyHours: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] },
  schedulingEnabled: true, schedulingLeadTimeMinutes: 0, closedDays: [],
} as unknown as BusinessConfig;
vi.mock('./configStore.js', async (original) => ({ ...await original<typeof import('./configStore.js')>(), loadCatalogFromDb: vi.fn(), getConfig: () => config }));
vi.mock('./zelomenuDeliveryService.js', () => ({
  revalidateDeliveryForCart: async () => ({ fee: state.pending ? 0 : state.quoteFee, feeToConfirm: state.pending, detail: { status: state.pending ? 'unavailable' : 'eligible', deliveryFee: state.quoteFee, address: {}, coordinates: {}, distanceM: 100, cacheLayer: 'l1' } }),
  findDeliveryQuoteRequest: vi.fn(), createDeliveryQuoteRequest: async () => ({ id: 'quote-1' }),
}));
vi.mock('./supabaseServer.js', () => ({
  getEmpresaUserId: async () => 'owner',
  getServiceSupabase: () => ({
    rpc: state.rpc,
    from(table: string) {
      const filters: [string, unknown][] = [];
      let patch: any;
      const execute = () => {
        if (table === 'zelomenu_cart_tokens') return { data: state.token, error: null };
        if (table === 'empresa_perfil') return { data: {}, error: null };
        if (table === 'zelo_orders') return { data: { id: 'order-1', status: 'ready', revision: 3 }, error: null };
        if (table === 'zelomenu_cart_sessions') {
          if (patch) {
            if (state.race) { state.session.revision++; state.race = false; }
            state.updates.push({ patch, filters });
            if (!filters.every(([key, value]) => state.session[key] === value)) return { data: null, error: null };
            Object.assign(state.session, patch);
          }
          return { data: structuredClone(state.session), error: null };
        }
        return { data: null, error: null };
      };
      const q: any = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
        update: (value: any) => { patch = value; return q; }, maybeSingle: async () => execute(), single: async () => execute(),
        then: (resolve: any) => Promise.resolve(execute()).then(resolve) };
      return q;
    },
  }),
}));
import { resolvePizza } from '../src/domain/pizza.js';
import { confirmPublicCartSession } from './zelomenuCartSessions';

const initialProducts = structuredClone(config.products);
const token = 'a'.repeat(43);
beforeEach(() => {
  config.products = structuredClone(initialProducts);
  vi.clearAllMocks(); state.updates.length = 0; state.race = false; state.quoteFee = 7; state.pending = false;
  state.token = { id: 'token-1', session_id: 'session-1', token_hash: createHash('sha256').update(token).digest('hex'), revoked_at: null, expires_at: null, last_seen_at: new Date().toISOString() };
  state.session = { id: 'session-1', empresa_id: 'empresa', ordering_id: 'legacy-1', context: 'public_order', state: 'cart_open', revision: 5,
    current_token_hash: state.token.token_hash, archived_at: null, metadata: {},
    customer_snapshot: { name: 'Ana', phone: '11999999999' },
    cart_snapshot: { items: [{ productId: 1, productName: 'Café', quantity: 1, unitPrice: 10, baseUnitPrice: 10, lineTotal: 10, selectedModifiers: [] }], observations: null },
    fulfillment_snapshot: { type: 'delivery', deliveryAddress: 'Rua A, 1', deliveryPostalCode: '01001000', deliveryNumber: '1', deliveryFee: 5, deliveryFeeToConfirm: false, pickupDate: '2099-01-01', pickupTime: '14:30' },
    pricing_snapshot: { subtotal: 10, deliveryFee: 5, discount: 0, total: 15 }, payment_snapshot: { declaredMethod: 'dinheiro' },
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
});

it('fences a pending quote against a concurrent address edit', async () => {
  state.pending = true; state.race = true;
  await expect(confirmPublicCartSession(token, 5, 'key-1234567890123456')).rejects.toThrow('REVISION_CONFLICT');
  expect(state.session.fulfillment_snapshot.deliveryQuoteRequestId).toBeUndefined();
  expect(state.rpc).not.toHaveBeenCalled();
});

it('preserves an approved manual quote and sends it to the atomic confirmation', async () => {
  state.session.fulfillment_snapshot.deliveryQuoteOverride = { requestId: 'quote-1', fee: 5, distanceM: null, address: null, coordinates: null, cacheLayer: 'manual' };
  state.rpc.mockImplementation(async (_name, payload) => {
    expect(payload.p_snapshots.pricing.deliveryFee).toBe(5);
    state.session.state = 'confirmed_waiting_review';
    return { data: { orderId: 'order-1', alreadyConfirmed: false, status: 'pending_review' }, error: null };
  });
  const result = await confirmPublicCartSession(token, 5, 'key-1234567890123456');
  expect(result?.confirmation.confirmed).toBe(true);
  expect(state.rpc.mock.calls[0][0]).toBe('confirm_public_zelo_order_atomic');
});

it('does not overwrite a newer cart when the delivery quote finishes late', async () => {
  state.race = true;
  await expect(confirmPublicCartSession(token, 5, 'key-1234567890123456')).rejects.toThrow('REVISION_CONFLICT');
  expect(state.session.fulfillment_snapshot.deliveryFee).toBe(5);
  expect(state.rpc).not.toHaveBeenCalled();
});

it('advances the revision when a changed delivery quote is persisted', async () => {
  await expect(confirmPublicCartSession(token, 5, 'key-1234567890123456')).rejects.toThrow('DELIVERY_FEE_CHANGED');
  expect(state.session.revision).toBe(6);
  expect(state.session.pricing_snapshot.deliveryFee).toBe(7);
});

it('recovers a confirmed order with the same valid token even if the submitted revision is old', async () => {
  state.session.state = 'confirmed_waiting_review';
  const result = await confirmPublicCartSession(token, 4, 'key-1234567890123456');
  expect(result?.confirmation.alreadyConfirmed).toBe(true);
  expect(result?.order?.id).toBe('order-1');
  expect(state.rpc).not.toHaveBeenCalled();
});

function tablePizza(price = 60) {
  const pizza = { version: 1 as const, revision: 'r1', pricingMode: 'highest' as const,
    sizes: [{ id: 'g', name: 'Grande', maxFlavors: 2, active: true, stockProductId: null }],
    flavors: [{ id: 'a', name: 'Calabresa', active: true, prices: { g: 40 } }, { id: 'b', name: 'Portuguesa', active: true, prices: { g: 60 } }],
  };
  const resolved = resolvePizza(pizza, { revision: 'r1', sizeId: 'g', flavorIds: ['a', 'b'] });
  if (!resolved.ok) throw new Error(resolved.message);
  config.products = [{ id: 1, name: 'Pizza', price, basePrice: 40, available: true, modifierGroups: [], productType: 'pizza',
    pizza: { ...pizza, revision: 'r2', flavors: pizza.flavors.map(f => ({ ...f, prices: { g: f.id === 'b' ? price : 40 } })) },
  }];
  state.session.context = 'table_order';
  state.session.fulfillment_snapshot = { type: 'pickup', asap: true };
  state.session.cart_snapshot = { items: [{ productId: 1, productName: 'Pizza', quantity: 1, unitPrice: 60, baseUnitPrice: 60, lineTotal: 60, selectedModifiers: resolved.modifiers, modifierDeltaTotal: 0, pizza: resolved.pizza }], observations: null };
  state.session.pricing_snapshot = { subtotal: 60, deliveryFee: 0, discount: 0, total: 60 };
}

it('refreshes a table pizza revision before the stored-snapshot RPC with a CAS', async () => {
  tablePizza();
  state.rpc.mockImplementation(async (name, payload) => {
    expect(name).toBe('confirm_zelomenu_cart');
    expect(payload.p_expected_revision).toBe(6);
    expect(state.session.cart_snapshot.items[0].pizza.revision).toBe('r2');
    expect(state.session.cart_snapshot.items[0].unitPrice).toBe(60);
    state.session.state = 'confirmed_waiting_review';
    return { data: { alreadyConfirmed: false }, error: null };
  });
  const result = await confirmPublicCartSession(token, 5, 'table-pizza-1234567890');
  expect(result?.confirmation.confirmed).toBe(true);
  expect(state.updates[0].filters).toEqual(expect.arrayContaining([['revision', 5], ['current_token_hash', state.token.token_hash], ['state', 'cart_open'], ['empresa_id', 'empresa']]));
});

it('does not refresh a table pizza over a concurrent cart edit', async () => {
  tablePizza(); state.race = true;
  await expect(confirmPublicCartSession(token, 5, 'table-pizza-1234567890')).rejects.toThrow('REVISION_CONFLICT');
  expect(state.session.cart_snapshot.items[0].pizza.revision).toBe('r1');
  expect(state.rpc).not.toHaveBeenCalled();
});

it('keeps table pizza price changes pending acceptance without confirming', async () => {
  tablePizza(70);
  const result = await confirmPublicCartSession(token, 5, 'table-pizza-1234567890');
  expect(result?.confirmation.confirmed).toBe(false);
  expect(state.session.cart_snapshot.items[0].pizza.revision).toBe('r1');
  expect(state.session.cart_snapshot.items[0].unitPrice).toBe(60);
  expect(state.rpc).not.toHaveBeenCalled();
  expect(state.session.last_revalidation.issues).toContainEqual(expect.objectContaining({ code: 'price_changed', currentUnitPrice: 70 }));
});

it('submits the full revalidated pizza composition to public atomic confirmation', async () => {
  tablePizza();
  state.session.context = 'public_order';
  state.session.fulfillment_snapshot = { type: 'pickup', asap: true, pickupDate: '2099-01-01', pickupTime: '14:30' };
  state.rpc.mockImplementation(async (name, payload) => {
    expect(name).toBe('confirm_public_zelo_order_atomic');
    expect(payload.p_snapshots.cart.items[0]).toMatchObject({ unitPrice: 60, pizza: { revision: 'r2', sizeName: 'Grande', flavors: [{ name: 'Calabresa', denominator: 2 }, { name: 'Portuguesa', denominator: 2 }] } });
    state.session.state = 'confirmed_waiting_review';
    return { data: { alreadyConfirmed: false }, error: null };
  });
  const result = await confirmPublicCartSession(token, 5, 'public-pizza-1234567890');
  expect(result?.confirmation.confirmed).toBe(true);
});
