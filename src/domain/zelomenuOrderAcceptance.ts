/**
 * Automatic acceptance is only eligible after checkout has moved an order to
 * review. A payment-pending order must never skip its payment gate.
 */
export function shouldAutoAcceptPublicOrder(input: {
  enabled: boolean;
  orderStatus: string;
}): boolean {
  return input.enabled && input.orderStatus === 'pending_review';
}
