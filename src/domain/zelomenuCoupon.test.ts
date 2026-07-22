import { describe, it, expect } from 'vitest';
import { applyCoupon, validateCouponRule, normalizeCouponCode } from './zelomenuCoupon';

describe('normalizeCouponCode', () => {
  it('normaliza para uppercase', () => {
    expect(normalizeCouponCode('promo10')).toBe('PROMO10');
  });

  it('aceita hífen e dígitos', () => {
    expect(normalizeCouponCode('BLACK-FRI-2024')).toBe('BLACK-FRI-2024');
  });

  it('rejeita string vazia', () => {
    expect(normalizeCouponCode('')).toBeNull();
  });

  it('rejeita menos de 3 caracteres', () => {
    expect(normalizeCouponCode('AB')).toBeNull();
  });

  it('rejeita mais de 30 caracteres', () => {
    expect(normalizeCouponCode('A'.repeat(31))).toBeNull();
  });

  it('rejeita caracteres especiais fora de A-Z0-9-', () => {
    expect(normalizeCouponCode('PROMO_10')).toBeNull();
    expect(normalizeCouponCode('PROMO.10')).toBeNull();
  });
});

describe('validateCouponRule', () => {
  const baseCoupon = {
    code: 'PROMO10',
    discountType: 'valor' as const,
    discountValue: 10,
    minOrderValue: null,
    startsAt: null,
    expiresAt: null,
    active: true,
  };

  it('pedido mínimo não atingido → coupon_min_not_met', () => {
    const result = validateCouponRule(
      { ...baseCoupon, minOrderValue: 50 },
      { subtotal: 30 },
    );
    expect(result).toEqual({ ok: false, code: 'coupon_min_not_met' });
  });

  it('pedido mínimo atingido passa', () => {
    const result = validateCouponRule(
      { ...baseCoupon, minOrderValue: 50 },
      { subtotal: 50 },
    );
    expect(result).toEqual({ ok: true });
  });

  it('now antes de starts_at → coupon_expired', () => {
    const result = validateCouponRule(
      { ...baseCoupon, startsAt: '2025-06-01T00:00:00Z' },
      { subtotal: 100, now: new Date('2024-01-01') },
    );
    expect(result).toEqual({ ok: false, code: 'coupon_expired' });
  });

  it('now depois de expires_at → coupon_expired', () => {
    const result = validateCouponRule(
      { ...baseCoupon, expiresAt: '2024-12-31T23:59:59Z' },
      { subtotal: 100, now: new Date('2025-01-01') },
    );
    expect(result).toEqual({ ok: false, code: 'coupon_expired' });
  });

  it('active: false → coupon_invalid', () => {
    const result = validateCouponRule(
      { ...baseCoupon, active: false },
      { subtotal: 100 },
    );
    expect(result).toEqual({ ok: false, code: 'coupon_invalid' });
  });

  it('coupon: null → coupon_invalid', () => {
    const result = validateCouponRule(null, { subtotal: 100 });
    expect(result).toEqual({ ok: false, code: 'coupon_invalid' });
  });
});

describe('applyCoupon', () => {
  it('tipo valor: desconto = valor do cupom quando <= subtotal', () => {
    const result = applyCoupon(100, 0, { discountType: 'valor', discountValue: 15 });
    expect(result.discount).toBe(15);
  });

  it('tipo valor: clamp para subtotal quando valor > subtotal', () => {
    const result = applyCoupon(30, 0, { discountType: 'valor', discountValue: 50 });
    expect(result.discount).toBe(30);
  });

  it('tipo percentual: desconto = round(subtotal * pct / 100)', () => {
    const result = applyCoupon(200, 0, { discountType: 'percentual', discountValue: 25 });
    expect(result.discount).toBe(50);
  });

  it('tipo frete_gratis: desconto = deliveryFee', () => {
    const result = applyCoupon(100, 15, { discountType: 'frete_gratis', discountValue: null });
    expect(result.discount).toBe(15);
  });

  it('tipo frete_gratis com retirada (deliveryFee=0): desconto = 0', () => {
    const result = applyCoupon(100, 0, { discountType: 'frete_gratis', discountValue: null });
    expect(result.discount).toBe(0);
  });

  it('clamp total >= 0 mesmo com valor absurdo', () => {
    const result = applyCoupon(10, 0, { discountType: 'valor', discountValue: 99999 });
    expect(result.discount).toBe(10);
  });

  it('cupom null → discount 0', () => {
    const result = applyCoupon(100, 10, null);
    expect(result.discount).toBe(0);
  });
});
