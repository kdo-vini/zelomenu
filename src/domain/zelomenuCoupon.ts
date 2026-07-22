// ZeloMenu — cupons de desconto (FONTE ÚNICA, node-free).
// Mesma lógica no client (estimativa) e no server (validação real): frontend
// e backend importam a mesma função pra o desconto exibido nunca divergir do
// revalidado pelo servidor.

export type ZeloMenuCouponDiscountType = 'valor' | 'percentual' | 'frete_gratis';

export type ZeloMenuCouponRule = {
  code: string;
  discountType: ZeloMenuCouponDiscountType;
  discountValue: number | null;
  minOrderValue: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
};

export type ZeloMenuCouponValidationIssueCode =
  | 'coupon_invalid'
  | 'coupon_expired'
  | 'coupon_min_not_met';

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

// Normaliza um código digitado pelo usuário para o formato canônico
// (A-Z0-9-, 3-30 chars). Retorna null se não bater com o formato — chamador
// decide se isso vira "cupom inválido" ou apenas ignora silenciosamente.
export function normalizeCouponCode(raw: string): string | null {
  const normalized = raw.trim().toUpperCase();
  return /^[A-Z0-9-]{3,30}$/.test(normalized) ? normalized : null;
}

// Valida janela de validade, flag `active` e pedido mínimo. NÃO valida
// "um por cliente" (isso depende de telefone + banco; fica no servidor,
// em server/zelomenuCoupons.ts, na hora de confirmar).
export function validateCouponRule(
  coupon: ZeloMenuCouponRule | null,
  input: { subtotal: number; now?: Date },
): { ok: true } | { ok: false; code: ZeloMenuCouponValidationIssueCode } {
  if (!coupon || !coupon.active) return { ok: false, code: 'coupon_invalid' };
  const now = input.now ?? new Date();
  if (coupon.startsAt && now < new Date(coupon.startsAt)) return { ok: false, code: 'coupon_expired' };
  if (coupon.expiresAt && now > new Date(coupon.expiresAt)) return { ok: false, code: 'coupon_expired' };
  if (coupon.minOrderValue != null && input.subtotal < coupon.minOrderValue) {
    return { ok: false, code: 'coupon_min_not_met' };
  }
  return { ok: true };
}

// Calcula o desconto para um pedido inteiro. Clamp: nunca negativo, nunca
// maior que subtotal + entrega (total nunca fica negativo).
export function applyCoupon(
  subtotal: number,
  deliveryFee: number,
  coupon: Pick<ZeloMenuCouponRule, 'discountType' | 'discountValue'> | null,
): { discount: number } {
  if (!coupon) return { discount: 0 };
  let discount = 0;
  if (coupon.discountType === 'valor') {
    discount = Math.min(Number(coupon.discountValue) || 0, subtotal);
  } else if (coupon.discountType === 'percentual') {
    discount = roundCurrency((subtotal * (Number(coupon.discountValue) || 0)) / 100);
  } else if (coupon.discountType === 'frete_gratis') {
    discount = deliveryFee;
  }
  const cap = roundCurrency(subtotal) + roundCurrency(deliveryFee);
  return { discount: roundCurrency(Math.max(0, Math.min(discount, cap))) };
}
