import { describe, expect, it } from 'vitest';
import { resolvePublicPushOrderId } from './zelomenuPush';

describe('resolvePublicPushOrderId', () => {
  it('uses the canonical public order id for push subscriptions', () => {
    expect(resolvePublicPushOrderId({ id: 'canonical-order-id' })).toBe('canonical-order-id');
  });

  it('does not create an order link when there is no canonical order', () => {
    expect(resolvePublicPushOrderId(null)).toBeUndefined();
  });
});
