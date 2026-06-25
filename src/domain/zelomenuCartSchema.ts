import type { ZeloMenuSelectedModifierGroup } from './zelomenuModifiers';

export type ZeloMenuCartItem = {
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
    | 'modifier_invalid';
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
