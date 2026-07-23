export type OrderStatusStep = {
  key: string;
  label: string;
};

export type OrderStatusInfo = {
  steps: OrderStatusStep[];
  currentStepIndex: number;
  isTerminal: boolean;
  isCancelled: boolean;
};

/**
 * Maps an order status and fulfillment type to a visual step timeline.
 *
 * Delivery steps (6): Pedido recebido → Confirmado → Em preparo → Pronto →
 *   Saiu para entrega → Entregue
 * Pickup steps (5): Pedido recebido → Confirmado → Em preparo →
 *   Pronto para retirada → Retirado
 *
 * `rejected` and `cancelled` return a single terminal step (not part of the
 * timeline) so callers render an independent terminal state.
 */
export function resolveOrderStatus(
  status: string,
  isDelivery: boolean,
): OrderStatusInfo {
  const deliverySteps: OrderStatusStep[] = [
    { key: 'received', label: 'Pedido recebido' },
    { key: 'accepted', label: 'Pedido confirmado pela loja' },
    { key: 'preparing', label: 'Em preparo' },
    { key: 'ready', label: 'Pronto' },
    { key: 'out_for_delivery', label: 'Saiu para entrega' },
    { key: 'delivered', label: 'Entregue' },
  ];

  const pickupSteps: OrderStatusStep[] = [
    { key: 'received', label: 'Pedido recebido' },
    { key: 'accepted', label: 'Pedido confirmado pela loja' },
    { key: 'preparing', label: 'Em preparo' },
    { key: 'ready', label: 'Pronto para retirada' },
    { key: 'delivered', label: 'Retirado' },
  ];

  const steps = isDelivery ? deliverySteps : pickupSteps;

  // Terminal states — not part of the timeline
  if (status === 'cancelled') {
    return { steps, currentStepIndex: 0, isTerminal: true, isCancelled: true };
  }
  if (status === 'rejected') {
    return { steps, currentStepIndex: 0, isTerminal: true, isCancelled: false };
  }

  // Build a reverse-lookup: status → step index
  const statusToIndex: Record<string, number> = {
    pending_payment: 0,
    pending_review: 0,
    accepted: 1,
    preparing: 2,
    ready: 3,
    out_for_delivery: 4,
    delivered: isDelivery ? 5 : 4,
  };

  const currentStepIndex = statusToIndex[status] ?? 0;

  return { steps, currentStepIndex, isTerminal: false, isCancelled: false };
}
