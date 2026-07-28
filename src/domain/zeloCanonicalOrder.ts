import type {
  ZeloMenuCartSnapshot,
  ZeloMenuPaymentSnapshot,
  ZeloMenuPricingSnapshot,
} from './zelomenuCartSchema';

type CustomerSnapshot = { name: string | null; phone: string | null };
type FulfillmentSnapshot = Record<string, unknown>;

export function buildCanonicalOrderSnapshots(input: {
  empresaId: string;
  customer: CustomerSnapshot;
  cart: ZeloMenuCartSnapshot;
  fulfillment: FulfillmentSnapshot;
  pricing: ZeloMenuPricingSnapshot;
  payment: ZeloMenuPaymentSnapshot;
  source?: 'zelomenu' | 'mesa';
  tableContext?: { mesaId?: string | null; comandaId?: string | null } | null;
}) {
  const source = input.source ?? 'zelomenu';
  const fulfillment = input.tableContext
    ? {
      ...input.fulfillment,
      type: 'mesa',
      mesaId: input.tableContext.mesaId ?? null,
      comandaId: input.tableContext.comandaId ?? null,
    }
    : input.fulfillment;

  return {
    empresaId: input.empresaId,
    source,
    customer: input.customer,
    cart: input.cart,
    fulfillment,
    pricing: input.pricing,
    payment: input.payment,
  };
}

export function usesCanonicalOrderEngine(context: string): boolean {
  return context === 'public_order' || context === 'table_order';
}
