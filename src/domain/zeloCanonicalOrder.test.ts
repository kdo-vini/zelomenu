import { describe, expect, it } from 'vitest';
import { buildCanonicalOrderSnapshots, usesCanonicalOrderEngine } from './zeloCanonicalOrder';

describe('canonical Zelo order boundary', () => {
  it('routes public orders to the canonical engine while keeping table orders in comandas', () => {
    expect(usesCanonicalOrderEngine('public_order')).toBe(true);
    expect(usesCanonicalOrderEngine('table_order')).toBe(false);
  });

  it('preserves the server-authoritative snapshots expected by create_zelo_order', () => {
    const snapshots = buildCanonicalOrderSnapshots({
      empresaId: 'empresa-1',
      customer: { name: 'Cliente', phone: null },
      cart: { observations: null, items: [] },
      fulfillment: { type: 'pickup' },
      pricing: { subtotal: 10, deliveryFee: 0, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: 10 },
      payment: { declaredMethod: 'pix', pixReceiptRequired: true, pixReceiptApproved: false },
    });
    expect(snapshots.source).toBe('zelomenu');
    expect(snapshots.pricing.total).toBe(10);
    expect(snapshots.payment.pixReceiptRequired).toBe(true);
  });
});
