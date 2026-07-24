// ZeloMenu — taxa de entrega por bairro (FONTE ÚNICA, node-free).
//
// Mesma lógica do ZeloChat — frontend e backend importam EXATAMENTE a mesma
// função para que o total exibido no carrinho nunca divirja do revalidado pelo servidor.

import { normalizeComparableText } from './pixReceipt';

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export type ZeloMenuResolvedDeliveryFee = {
  fee: number;
  toConfirm: boolean;
};

export function resolveDeliveryFeeForNeighborhood(input: {
  type: 'pickup' | 'delivery';
  neighborhood: string | null;
  neighborhoods: Array<{ name: string; fee: number }>;
}): ZeloMenuResolvedDeliveryFee {
  if (input.type !== 'delivery') return { fee: 0, toConfirm: false };

  const trimmed = (input.neighborhood ?? '').trim();
  if (!trimmed) return { fee: 0, toConfirm: true };

  const target = normalizeComparableText(trimmed);
  const match = input.neighborhoods.find(
    (item) => normalizeComparableText(item.name) === target,
  );
  if (!match) return { fee: 0, toConfirm: true };

  return { fee: roundCurrency(Number(match.fee) || 0), toConfirm: false };
}
