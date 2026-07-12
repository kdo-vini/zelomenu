import { describe, expect, it } from 'vitest';
import { isValidBrazilianPhone, validateZeloMenuCheckoutDetails } from './zelomenuCheckout';

describe('ZeloMenu checkout validation', () => {
  it.each([
    ['11987654321', true],
    ['1132654321', true],
    ['00987654321', false],
    ['11111111111', false],
    ['11876543210', false],
  ])('validates Brazilian phone %s', (phone, expected) => {
    expect(isValidBrazilianPhone(phone)).toBe(expected);
  });

  it.each([
    ['2024-02-29', false],
    ['2025-02-29', true],
    ['2026-04-31', true],
    ['2026-12-01', false],
  ])('validates civil date %s', (pickupDate, invalid) => {
    const errors = validateZeloMenuCheckoutDetails({
      customerName: 'Ana', customerPhone: '11987654321', fulfillmentType: 'pickup',
      deliveryAddress: null, pickupDate, pickupTime: '12:00',
    });
    expect(Boolean(errors.pickupDate)).toBe(invalid);
  });
});
