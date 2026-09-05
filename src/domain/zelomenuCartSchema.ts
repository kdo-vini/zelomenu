import type { ZeloMenuSelectedModifierGroup } from './zelomenuModifiers';

export type ZeloMenuCartItem = {
  pizza?: import('./pizzaTypes').PizzaSnapshot | null;
  lineId?: string;
  productId: number | null;
  productName: string;
  baseUnitPrice: number;
  selectedModifiers: ZeloMenuSelectedModifierGroup[];
  modifierDeltaTotal: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  notes?: string | null;
};

export type ZeloMenuCartItemSnapshot = ZeloMenuCartItem;

export type ZeloMenuCartSnapshot = {
  items: ZeloMenuCartItem[];
  observations: string | null;
};

export type ZeloMenuPricingSnapshot = {
  subtotal: number;
  deliveryFee: number;
  discount: number;
  couponCode: string | null;
  // Detalhes da regra do cupom aplicado, ecoados pelo servidor para o
  // cliente poder recalcular a MESMA estimativa localmente (via applyCoupon)
  // entre um autosave e outro, sem esperar round-trip. Ambos null quando
  // couponCode é null.
  couponDiscountType: 'valor' | 'percentual' | 'frete_gratis' | null;
  couponDiscountValue: number | null;
  total: number;
};

export type ZeloMenuPaymentSnapshot = {
  declaredMethod: string | null;
  pixReceiptRequired: boolean;
  pixReceiptApproved: boolean;
};

export type ZeloMenuCartRevalidationIssue = {
  code:
    | 'product_missing'
    | 'product_unavailable'
    | 'stock_insufficient'
    | 'price_changed'
    | 'schedule_unavailable'
    | 'modifier_invalid'
    | 'coupon_invalid'
    | 'coupon_expired'
    | 'coupon_min_not_met'
    | 'coupon_already_used'
    | 'delivery_address_invalid'
    | 'delivery_out_of_area'
    | 'delivery_quote_pending';
  message: string;
  productName?: string;
  requestedQuantity?: number;
  availableQuantity?: number | null;
  previousUnitPrice?: number;
  currentUnitPrice?: number;
};

export type ZeloMenuCartRevalidation = {
  checkedAt: string;
  ok: boolean;
  issues: ZeloMenuCartRevalidationIssue[];
  previewCart: ZeloMenuCartSnapshot | null;
  previewPricing: ZeloMenuPricingSnapshot | null;
  previewPayment: ZeloMenuPaymentSnapshot | null;
};
