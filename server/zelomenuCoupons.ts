import { getServiceSupabase } from './supabaseServer.js';
import type { ZeloMenuCouponRule } from '../src/domain/zelomenuCoupon.js';
import { normalizeCouponCode } from '../src/domain/zelomenuCoupon.js';

export type ZeloMenuCouponRow = ZeloMenuCouponRule & { id: string };

function mapCouponRow(row: any): ZeloMenuCouponRow {
  return {
    id: row.id,
    code: row.code,
    discountType: row.discount_type,
    discountValue: row.discount_value === null ? null : Number(row.discount_value),
    minOrderValue: row.min_order_value === null ? null : Number(row.min_order_value),
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    active: row.active === true,
  };
}

// Usada pelo pricing (resolveSnapshots) — busca por código exato já
// normalizado (uppercase A-Z0-9-), nunca por LIKE/ILIKE.
export async function findActiveCouponByCode(ownerUserId: string, normalizedCode: string): Promise<ZeloMenuCouponRow | null> {
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_coupons')
    .select('id, code, discount_type, discount_value, min_order_value, starts_at, expires_at, active')
    .eq('id_usuario', ownerUserId)
    .eq('code', normalizedCode)
    .maybeSingle();
  if (error) throw error;
  return data ? mapCouponRow(data) : null;
}

// Reserva o resgate (insert com unique(coupon_id, customer_phone)).
export async function reserveCouponRedemption(params: {
  couponId: string;
  ownerUserId: string;
  customerPhone: string;
}): Promise<{ ok: true; redemptionId: string } | { ok: false }> {
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_coupon_redemptions')
    .insert({ coupon_id: params.couponId, id_usuario: params.ownerUserId, customer_phone: params.customerPhone })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return { ok: false }; // unique_violation — já usado por este telefone
    throw error;
  }
  return { ok: true, redemptionId: (data as { id: string }).id };
}

export async function attachOrderToRedemption(redemptionId: string, orderId: string): Promise<void> {
  const { error } = await getServiceSupabase()
    .from('zelomenu_coupon_redemptions')
    .update({ order_id: orderId })
    .eq('id', redemptionId);
  if (error) throw error;
}

// Rollback manual — usado quando a reserva foi feita mas a criação do
// pedido falhou depois.
export async function releaseCouponRedemption(redemptionId: string): Promise<void> {
  await getServiceSupabase().from('zelomenu_coupon_redemptions').delete().eq('id', redemptionId);
}

// ─── Admin CRUD (empresaId já convertido para ownerUserId pelo chamador) ──

export async function listZeloMenuCoupons(ownerUserId: string): Promise<ZeloMenuCouponRow[]> {
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_coupons')
    .select('id, code, discount_type, discount_value, min_order_value, starts_at, expires_at, active, created_at')
    .eq('id_usuario', ownerUserId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapCouponRow);
}

export async function createZeloMenuCoupon(ownerUserId: string, input: {
  code: string; discountType: 'valor' | 'percentual' | 'frete_gratis'; discountValue: number | null;
  minOrderValue: number | null; startsAt: string | null; expiresAt: string | null; active: boolean;
}): Promise<ZeloMenuCouponRow> {
  const normalized = normalizeCouponCode(input.code);
  if (!normalized) throw new Error('COUPON_INVALID_CODE');
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_coupons')
    .insert({
      id_usuario: ownerUserId,
      code: normalized,
      discount_type: input.discountType,
      discount_value: input.discountType === 'frete_gratis' ? null : input.discountValue,
      min_order_value: input.minOrderValue,
      starts_at: input.startsAt,
      expires_at: input.expiresAt,
      active: input.active,
    })
    .select('id, code, discount_type, discount_value, min_order_value, starts_at, expires_at, active, created_at')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('COUPON_CODE_TAKEN');
    if (error.code === '23514') throw new Error('COUPON_INVALID_DISCOUNT_VALUE');
    throw error;
  }
  return mapCouponRow(data);
}

export async function updateZeloMenuCoupon(ownerUserId: string, id: string, patch: Partial<{
  code: string; discountType: 'valor' | 'percentual' | 'frete_gratis'; discountValue: number | null;
  minOrderValue: number | null; startsAt: string | null; expiresAt: string | null; active: boolean;
}>): Promise<ZeloMenuCouponRow> {
  const update: Record<string, unknown> = {};
  if (patch.code !== undefined) {
    const normalized = normalizeCouponCode(patch.code);
    if (!normalized) throw new Error('COUPON_INVALID_CODE');
    update.code = normalized;
  }
  if (patch.discountType !== undefined) update.discount_type = patch.discountType;
  if (patch.discountValue !== undefined) update.discount_value = patch.discountValue;
  // Se o tipo está virando frete_gratis, força discount_value=null mesmo que
  // o chamador não tenha mandado — evita violar zelomenu_coupons_frete_gratis_no_value
  // quando o admin troca o tipo sem limpar o campo de valor no mesmo PATCH.
  if (patch.discountType === 'frete_gratis') update.discount_value = null;
  if (patch.minOrderValue !== undefined) update.min_order_value = patch.minOrderValue;
  if (patch.startsAt !== undefined) update.starts_at = patch.startsAt;
  if (patch.expiresAt !== undefined) update.expires_at = patch.expiresAt;
  if (patch.active !== undefined) update.active = patch.active;
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_coupons')
    .update(update)
    .eq('id', id)
    .eq('id_usuario', ownerUserId)
    .select('id, code, discount_type, discount_value, min_order_value, starts_at, expires_at, active, created_at')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') throw new Error('COUPON_CODE_TAKEN');
    if (error.code === '23514') throw new Error('COUPON_INVALID_DISCOUNT_VALUE');
    throw error;
  }
  if (!data) throw new Error('COUPON_NOT_FOUND');
  return mapCouponRow(data);
}

// "Excluir" no admin é soft-delete (active=false). Nunca remove a linha —
// preserva o histórico de zelomenu_coupon_redemptions e evita reusar um
// código apagado por engano.
export async function deleteZeloMenuCoupon(ownerUserId: string, id: string): Promise<void> {
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_coupons')
    .update({ active: false })
    .eq('id', id)
    .eq('id_usuario', ownerUserId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('COUPON_NOT_FOUND');
}
