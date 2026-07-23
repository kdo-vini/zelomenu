/**
 * Automatic acceptance follows the store preference. A pending-payment order
 * keeps its gate only while ZeloChat's Pix receipt verification is active;
 * this also releases stale carts when the operator turns that verification off.
 */
export function shouldAutoAcceptPublicOrder(input: {
  enabled: boolean;
  pixReceiptVerificationEnabled: boolean;
  orderStatus: string;
}): boolean {
  if (!input.enabled) return false;
  if (input.orderStatus === 'pending_review') return true;
  return input.orderStatus === 'pending_payment' && !input.pixReceiptVerificationEnabled;
}
