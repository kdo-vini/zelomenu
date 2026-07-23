import { describe, expect, it } from 'vitest';
import { shouldAutoAcceptPublicOrder } from './zelomenuOrderAcceptance';

describe('shouldAutoAcceptPublicOrder', () => {
  it('accepts a reviewed public order when the store enabled the preference', () => {
    expect(shouldAutoAcceptPublicOrder({ enabled: true, pixReceiptVerificationEnabled: true, orderStatus: 'pending_review' })).toBe(true);
  });

  it('keeps the current manual-review behavior when disabled', () => {
    expect(shouldAutoAcceptPublicOrder({ enabled: false, pixReceiptVerificationEnabled: false, orderStatus: 'pending_review' })).toBe(false);
  });

  it('keeps the pending-payment gate when Pix receipt verification is active', () => {
    expect(shouldAutoAcceptPublicOrder({ enabled: true, pixReceiptVerificationEnabled: true, orderStatus: 'pending_payment' })).toBe(false);
  });

  it('does not keep a stale pending-payment order blocked after verification is disabled', () => {
    expect(shouldAutoAcceptPublicOrder({ enabled: true, pixReceiptVerificationEnabled: false, orderStatus: 'pending_payment' })).toBe(true);
  });

  it('does not re-accept an order that already moved forward', () => {
    expect(shouldAutoAcceptPublicOrder({ enabled: true, pixReceiptVerificationEnabled: false, orderStatus: 'accepted' })).toBe(false);
  });
});
