import { describe, expect, it } from 'vitest';
import { shouldAutoAcceptPublicOrder } from './zelomenuOrderAcceptance';

describe('shouldAutoAcceptPublicOrder', () => {
  it('accepts a reviewed public order when the store enabled the preference', () => {
    expect(shouldAutoAcceptPublicOrder({ enabled: true, orderStatus: 'pending_review' })).toBe(true);
  });

  it('keeps the current manual-review behavior when disabled', () => {
    expect(shouldAutoAcceptPublicOrder({ enabled: false, orderStatus: 'pending_review' })).toBe(false);
  });

  it('never skips the pending-payment gate', () => {
    expect(shouldAutoAcceptPublicOrder({ enabled: true, orderStatus: 'pending_payment' })).toBe(false);
  });

  it('does not re-accept an order that already moved forward', () => {
    expect(shouldAutoAcceptPublicOrder({ enabled: true, orderStatus: 'accepted' })).toBe(false);
  });
});
