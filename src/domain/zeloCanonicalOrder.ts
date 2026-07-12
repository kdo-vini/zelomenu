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
}) {
  return {
    empresaId: input.empresaId,
    source: 'zelomenu' as const,
    customer: input.customer,
    cart: input.cart,
    fulfillment: input.fulfillment,
    pricing: input.pricing,
    payment: input.payment,
  };
}

export function usesCanonicalOrderEngine(context: string): boolean {
  return context === 'public_order';
}
