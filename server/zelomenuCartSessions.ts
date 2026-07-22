import { randomUUID } from 'node:crypto';
import { createHash, randomBytes } from 'node:crypto';
import { getConfig, loadCatalogFromDb, type CatalogCategoriaGroup, type CatalogProduct } from './configStore.js';
import { getServiceSupabase, getEmpresaUserId } from './supabaseServer.js';
import { getMesaContext } from './zelomenuMesaHandler.js';
import { isReservedZeloMenuSlug, normalizeZeloMenuSlug } from '../src/domain/zelomenuSlug.js';
import {
  resolveModifierSelections,
  formatModifierAwareCartItem,
  type ZeloMenuModifierSelectionInput,
} from '../src/domain/zelomenuModifiers.js';
import { buildModifierSignature } from '../src/domain/zelomenuCartItemKey.js';
import type {
  ZeloMenuCartItemSnapshot,
  ZeloMenuCartSnapshot,
  ZeloMenuPricingSnapshot,
  ZeloMenuPaymentSnapshot,
  ZeloMenuCartRevalidationIssue,
  ZeloMenuCartRevalidation,
} from '../src/domain/zelomenuCartSchema.js';
import { resolveDeliveryFeeForNeighborhood } from '../src/domain/zelomenuDelivery.js';
import { normalizeCouponCode, validateCouponRule, applyCoupon } from '../src/domain/zelomenuCoupon.js';
import { normalizeComparableText } from '../src/domain/pixReceipt.js';
import { toWhatsAppNumber } from '../src/domain/whatsappOrder.js';
import { firstZeloMenuCheckoutError, validateZeloMenuCheckoutDetails } from '../src/domain/zelomenuCheckout.js';
import {
  businessDayLabel,
  isBusinessWindowOpen,
  isPickupInPast,
  parseBusinessTime,
} from '../src/domain/zelomenuBusinessHours.js';
import {
  DAY_KEYS,
  hasAnyOpenWindow,
  isMinuteWithinDay,
  isOpenAt,
  type DayKey,
} from '../src/domain/businessHours.js';
import { buildCanonicalOrderSnapshots, usesCanonicalOrderEngine } from '../src/domain/zeloCanonicalOrder.js';
import { findActiveCouponByCode, reserveCouponRedemption, attachOrderToRedemption, releaseCouponRedemption } from './zelomenuCoupons.js';
import { normalizePhoneNumber } from '../src/domain/chat.js';

// ─── Token helpers (node:crypto, backend only) ─────────────────────────────────

function normalizePublicCartToken(value: string): string | null {
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{20,120}$/.test(trimmed) ? trimmed : null;
}

function hashPublicCartToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function createPublicCartToken(): { token: string; tokenHash: string; tokenLast4: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, tokenHash: hashPublicCartToken(token), tokenLast4: token.slice(-4) };
}

function buildPublicCartPath(token: string): string {
  return `/menu/carrinho/${encodeURIComponent(token)}`;
}

// ─── Pix helpers ───────────────────────────────────────────────────────────────

function isPixReceiptConfigActive(config: ReturnType<typeof getConfig>['pixReceiptConfig']): boolean {
  if (!config) return false;
  return config.available === true && config.enabled === true && config.beneficiaryNames.length > 0;
}

function isPixPaymentMethod(value: string | null | undefined): boolean {
  if (!value) return false;
  return /\bpix\b/i.test(value.normalize('NFD').replace(/[̀-ͯ]/g, ''));
}

// ─── Pricing ───────────────────────────────────────────────────────────────────

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeCartPricing(
  items: Array<{ lineTotal: number }>,
  deliveryFee = 0,
  discount = 0,
  coupon: { code: string; discountType: 'valor' | 'percentual' | 'frete_gratis'; discountValue: number | null } | null = null,
): ZeloMenuPricingSnapshot {
  const fee = Number.isFinite(deliveryFee) ? Number(deliveryFee) : 0;
  const subtotal = items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
  const cap = roundCurrency(subtotal) + roundCurrency(fee);
  const clampedDiscount = Math.max(0, Math.min(Number(discount) || 0, cap));
  return {
    subtotal: roundCurrency(subtotal),
    deliveryFee: roundCurrency(fee),
    discount: roundCurrency(clampedDiscount),
    couponCode: coupon?.code ?? null,
    couponDiscountType: coupon?.discountType ?? null,
    couponDiscountValue: coupon?.discountValue ?? null,
    total: roundCurrency(subtotal + fee - clampedDiscount),
  };
}

// ─── Snapshot types ────────────────────────────────────────────────────────────

export type ZeloMenuCartState =
  | 'cart_open'
  | 'confirmed_waiting_review'
  | 'confirmed_waiting_payment'
  | 'needs_customer_adjustment'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'archived';

export type ZeloMenuCartContext = 'whatsapp_order' | 'public_order' | 'table_order';

export type ZeloMenuCartItemInput = {
  productId?: number | null;
  productName: string;
  quantity: number;
  notes?: string | null;
  selectedOptions?: ZeloMenuModifierSelectionInput[] | null;
};

// ZeloMenuCartItemSnapshot, ZeloMenuCartSnapshot, ZeloMenuPricingSnapshot,
// ZeloMenuPaymentSnapshot, ZeloMenuCartRevalidationIssue, ZeloMenuCartRevalidation
// are imported from src/domain/zelomenuCartSchema (canonical shared types).

export type { ZeloMenuCartItemSnapshot, ZeloMenuCartSnapshot, ZeloMenuCartRevalidationIssue, ZeloMenuCartRevalidation };

export type ZeloMenuCustomerSnapshot = {
  name: string | null;
  phone: string | null;
};

export type ZeloMenuFulfillmentSnapshot = {
  type: 'pickup' | 'delivery';
  asap?: boolean;
  pickupDate: string | null;
  pickupTime: string | null;
  deliveryAddress: string | null;
  deliveryNeighborhood: string | null;
  deliveryFee: number;
  deliveryFeeToConfirm: boolean;
};

// ─── DB row types ─────────────────────────────────────────────────────────────

type SessionRow = {
  id: string;
  empresa_id: string;
  ordering_id: string;
  context: ZeloMenuCartContext;
  state: ZeloMenuCartState;
  source_ref: string;
  customer_snapshot: unknown;
  cart_snapshot: unknown;
  fulfillment_snapshot: unknown;
  pricing_snapshot: unknown;
  payment_snapshot: unknown;
  metadata: unknown;
  revision: number;
  current_token_hash: string | null;
  current_token_last4: string | null;
  last_revalidated_at: string | null;
  last_revalidation: unknown;
  confirmed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type TokenRow = {
  id: string;
  session_id: string;
  token_hash: string;
  token_last4: string;
  issued_for_revision: number;
  revoked_at: string | null;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string | null;
};

const CART_SESSION_COLUMNS = `
  id,
  empresa_id,
  ordering_id,
  context,
  state,
  source_ref,
  customer_snapshot,
  cart_snapshot,
  fulfillment_snapshot,
  pricing_snapshot,
  payment_snapshot,
  metadata,
  revision,
  current_token_hash,
  current_token_last4,
  last_revalidated_at,
  last_revalidation,
  confirmed_at,
  archived_at,
  created_at,
  updated_at
`;

// ─── Session types ─────────────────────────────────────────────────────────────

type PublicCartSession = {
  id: string;
  orderingId: string;
  context: ZeloMenuCartContext;
  state: ZeloMenuCartState;
  revision: number;
  customer: ZeloMenuCustomerSnapshot;
  cart: ZeloMenuCartSnapshot;
  fulfillment: ZeloMenuFulfillmentSnapshot;
  pricing: ZeloMenuPricingSnapshot;
  payment: ZeloMenuPaymentSnapshot;
  metadata: Record<string, unknown>;
  lastRevalidatedAt: string | null;
  lastRevalidation: ZeloMenuCartRevalidation | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  archivedAt: string | null;
};

type PublicBusinessHoursStatus = {
  configured: boolean;
  openNow: boolean;
  label: string | null;
  closedDays: string[];
  timezone: string;
};

export type PublicCartResponse = {
  session: PublicCartSession;
  business: {
    name: string;
    address: string;
    whatsapp: string | null;
    pixEnabled: boolean;
    deliveryEnabled: boolean;
    deliveryNeighborhoods: Array<{ name: string; fee: number }>;
    logoUrl?: string | null;
    welcomeText?: string | null;
    featuredEnabled?: boolean;
    featuredProductIds?: number[];
    recommendationsEnabled?: boolean;
    recommendationProductIds?: number[];
    businessHours?: PublicBusinessHoursStatus;
  };
  catalog: CatalogCategoriaGroup[];
  link: { path: string; tokenStatus: 'current' | 'stale' };
  revalidation: ZeloMenuCartRevalidation;
  order: { id: string; status: string; revision: number } | null;
};

export type PublicCartConfirmResponse = PublicCartResponse & {
  confirmation: {
    confirmed: boolean;
    alreadyConfirmed: boolean;
    state: ZeloMenuCartState;
    customerMessage: string | null;
  };
};

type PublicStoreResponse = {
  business: PublicCartResponse['business'];
  catalog: CatalogCategoriaGroup[];
};

const publicStoreCache = new Map<string, { expiresAt: number; response: PublicStoreResponse }>();
const PUBLIC_STORE_CACHE_MS = 15_000;

type ZeloMenuProfileRow = {
  logo_url?: string | null;
  zelomenu_welcome_text?: string | null;
  zelomenu_featured_enabled?: boolean;
  zelomenu_featured_product_ids?: unknown;
  zelomenu_category_order?: unknown;
  zelomenu_recommendations_enabled?: boolean;
  zelomenu_recommendation_product_ids?: unknown;
};

const ZELOMENU_PROFILE_CORE_COLUMNS =
  'logo_url, zelomenu_welcome_text, zelomenu_featured_enabled, zelomenu_featured_product_ids, zelomenu_category_order';
const ZELOMENU_PROFILE_RECOMMENDATION_COLUMNS =
  'zelomenu_recommendations_enabled, zelomenu_recommendation_product_ids';
const ZELOMENU_PROFILE_ALL_COLUMNS =
  `${ZELOMENU_PROFILE_CORE_COLUMNS}, ${ZELOMENU_PROFILE_RECOMMENDATION_COLUMNS}`;

function isMissingZeloMenuRecommendationColumn(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  if (error.code === '42703') return true;
  const message = error.message ?? '';
  return message.includes('zelomenu_recommendations_enabled')
    || message.includes('zelomenu_recommendation_product_ids');
}

/**
 * Keep recommendation settings isolated from the original store settings.
 * That way a migration lag cannot hide the restaurant/catalog data or block
 * saving the welcome text.
 */
async function loadZeloMenuProfile(empresaId: string): Promise<ZeloMenuProfileRow> {
  const supabase = getServiceSupabase();
  const profileResult = await supabase
    .from('empresa_perfil')
    .select(ZELOMENU_PROFILE_ALL_COLUMNS)
    .eq('id', empresaId)
    .maybeSingle();
  if (!profileResult.error) {
    return (profileResult.data as ZeloMenuProfileRow | null) ?? {};
  }
  if (!isMissingZeloMenuRecommendationColumn(profileResult.error)) {
    throw profileResult.error;
  }

  console.warn('[ZeloMenu] recommendation columns are not available yet; using defaults until the migration is applied.');
  const coreResult = await supabase
    .from('empresa_perfil')
    .select(ZELOMENU_PROFILE_CORE_COLUMNS)
    .eq('id', empresaId)
    .maybeSingle();
  if (coreResult.error) throw coreResult.error;
  return (coreResult.data as ZeloMenuProfileRow | null) ?? {};
}

// ─── Sanitizers ───────────────────────────────────────────────────────────────

function sanitizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function sanitizeObservations(value: unknown): string | null {
  return sanitizeText(value, 500);
}

function normalizePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : null;
}

function normalizeDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

function normalizeTime(value: unknown): string | null {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value.trim()) ? value.trim() : null;
}

// ─── Snapshot parsers ─────────────────────────────────────────────────────────

function parseCustomerSnapshot(value: unknown): ZeloMenuCustomerSnapshot {
  if (!value || typeof value !== 'object') return { name: null, phone: null };
  const row = value as { name?: unknown; phone?: unknown };
  return { name: sanitizeText(row.name, 120), phone: sanitizeText(row.phone, 40) };
}

function parseSelectedModifiers(value: unknown): ZeloMenuCartItemSnapshot['selectedModifiers'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((group) => {
    if (!group || typeof group !== 'object') return [];
    const typed = group as { groupId?: unknown; groupName?: unknown; kind?: unknown; selectedOptions?: unknown };
    const groupId = sanitizeText(typed.groupId, 64);
    const groupName = sanitizeText(typed.groupName, 120);
    if (!groupId || !groupName) return [];
    const selectedOptions = Array.isArray(typed.selectedOptions)
      ? typed.selectedOptions.flatMap((option) => {
        if (!option || typeof option !== 'object') return [];
        const candidate = option as { optionId?: unknown; optionName?: unknown; priceDelta?: unknown };
        const optionId = sanitizeText(candidate.optionId, 64);
        const optionName = sanitizeText(candidate.optionName, 120);
        const priceDelta = Number(candidate.priceDelta ?? 0);
        if (!optionId || !optionName || !Number.isFinite(priceDelta)) return [];
        return [{ optionId, optionName, priceDelta }];
      })
      : [];
    return [{ groupId, groupName, kind: typed.kind === 'variacao' ? 'variacao' : 'adicional', selectedOptions }];
  });
}

function parseCartSnapshot(value: unknown): ZeloMenuCartSnapshot {
  if (!value || typeof value !== 'object') return { items: [], observations: null };
  const row = value as { items?: unknown; observations?: unknown };
  const items = Array.isArray(row.items)
    ? row.items.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const typed = item as {
        productId?: unknown;
        productName?: unknown;
        baseUnitPrice?: unknown;
        selectedModifiers?: unknown;
        modifierDeltaTotal?: unknown;
        quantity?: unknown;
        unitPrice?: unknown;
        lineTotal?: unknown;
        notes?: unknown;
      };
      const productId = typed.productId == null ? null : Number(typed.productId);
      const productName = sanitizeText(typed.productName, 120);
      const baseUnitPrice = Number(typed.baseUnitPrice ?? typed.unitPrice);
      const quantity = normalizePositiveInt(typed.quantity);
      const unitPrice = Number(typed.unitPrice);
      const lineTotal = Number(typed.lineTotal);
      const modifierDeltaTotal = Number(typed.modifierDeltaTotal ?? 0);
      if (!productName || quantity === null || !Number.isFinite(unitPrice) || !Number.isFinite(lineTotal)) return [];
      return [{
        productId: Number.isFinite(productId) ? productId : null,
        productName,
        baseUnitPrice: Number.isFinite(baseUnitPrice) ? baseUnitPrice : unitPrice,
        selectedModifiers: parseSelectedModifiers(typed.selectedModifiers),
        modifierDeltaTotal: Number.isFinite(modifierDeltaTotal) ? modifierDeltaTotal : 0,
        quantity,
        unitPrice,
        lineTotal,
        notes: sanitizeText(typed.notes, 200),
      }];
    })
    : [];
  return { items, observations: sanitizeObservations(row.observations) };
}

function parseFulfillmentSnapshot(value: unknown): ZeloMenuFulfillmentSnapshot {
  if (!value || typeof value !== 'object') {
    return { type: 'pickup', asap: false, pickupDate: null, pickupTime: null, deliveryAddress: null, deliveryNeighborhood: null, deliveryFee: 0, deliveryFeeToConfirm: false };
  }
  const row = value as {
    type?: unknown; asap?: unknown; pickupDate?: unknown; pickupTime?: unknown;
    deliveryAddress?: unknown; deliveryNeighborhood?: unknown; deliveryFee?: unknown; deliveryFeeToConfirm?: unknown;
  };
  return {
    type: row.type === 'delivery' ? 'delivery' : 'pickup',
    asap: row.asap === true,
    pickupDate: normalizeDate(row.pickupDate),
    pickupTime: normalizeTime(row.pickupTime),
    deliveryAddress: sanitizeText(row.deliveryAddress, 250),
    deliveryNeighborhood: sanitizeText(row.deliveryNeighborhood, 120),
    deliveryFee: Number.isFinite(Number(row.deliveryFee)) ? Number(row.deliveryFee) : 0,
    deliveryFeeToConfirm: row.deliveryFeeToConfirm === true,
  };
}

function parsePricingSnapshot(value: unknown): ZeloMenuPricingSnapshot {
  if (!value || typeof value !== 'object') {
    return { subtotal: 0, deliveryFee: 0, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: 0 };
  }
  const row = value as {
    subtotal?: unknown; deliveryFee?: unknown; discount?: unknown;
    couponCode?: unknown; couponDiscountType?: unknown; couponDiscountValue?: unknown; total?: unknown;
  };
  return {
    subtotal: Number.isFinite(Number(row.subtotal)) ? Number(row.subtotal) : 0,
    deliveryFee: Number.isFinite(Number(row.deliveryFee)) ? Number(row.deliveryFee) : 0,
    discount: Number.isFinite(Number(row.discount)) ? Number(row.discount) : 0,
    couponCode: typeof row.couponCode === 'string' ? row.couponCode : null,
    couponDiscountType: row.couponDiscountType === 'valor' || row.couponDiscountType === 'percentual' || row.couponDiscountType === 'frete_gratis'
      ? row.couponDiscountType
      : null,
    couponDiscountValue: Number.isFinite(Number(row.couponDiscountValue)) ? Number(row.couponDiscountValue) : null,
    total: Number.isFinite(Number(row.total)) ? Number(row.total) : 0,
  };
}

function parsePaymentSnapshot(value: unknown): ZeloMenuPaymentSnapshot {
  if (!value || typeof value !== 'object') return { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false };
  const row = value as { declaredMethod?: unknown; pixReceiptRequired?: unknown; pixReceiptApproved?: unknown };
  return {
    declaredMethod: sanitizeText(row.declaredMethod, 40),
    pixReceiptRequired: row.pixReceiptRequired === true,
    pixReceiptApproved: row.pixReceiptApproved === true,
  };
}

function parseRevalidation(value: unknown): ZeloMenuCartRevalidation | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<ZeloMenuCartRevalidation>;
  if (typeof row.checkedAt !== 'string' || typeof row.ok !== 'boolean' || !Array.isArray(row.issues)) return null;
  return {
    checkedAt: row.checkedAt,
    ok: row.ok,
    issues: row.issues,
    previewCart: row.previewCart ?? null,
    previewPricing: row.previewPricing ?? null,
    previewPayment: row.previewPayment ?? null,
  };
}

function parseMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mapSessionRow(row: SessionRow): PublicCartSession {
  return {
    id: row.id,
    orderingId: row.ordering_id,
    context: row.context,
    state: row.state,
    revision: Number(row.revision || 1),
    customer: parseCustomerSnapshot(row.customer_snapshot),
    cart: parseCartSnapshot(row.cart_snapshot),
    fulfillment: parseFulfillmentSnapshot(row.fulfillment_snapshot),
    pricing: parsePricingSnapshot(row.pricing_snapshot),
    payment: parsePaymentSnapshot(row.payment_snapshot),
    metadata: parseMetadata(row.metadata),
    lastRevalidatedAt: row.last_revalidated_at,
    lastRevalidation: parseRevalidation(row.last_revalidation),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    archivedAt: row.archived_at,
  };
}

// ─── Business hours ───────────────────────────────────────────────────────────

const PUBLIC_DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function publicMinutesLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Mapeia a data civil de retirada (YYYY-MM-DD) para a chave de dia do modelo
 * `horario_semanal`, passando por `businessDayLabel` para manter os rótulos
 * PT consistentes com `PUBLIC_DAY_LABELS` (Dom..Sáb / index = getUTCDay).
 */
function pickupDayKey(pickupDate: string): DayKey | null {
  const label = businessDayLabel(pickupDate);
  if (!label) return null;
  const idx = PUBLIC_DAY_LABELS.indexOf(label);
  return idx >= 0 ? DAY_KEYS[idx] : null;
}

function buildPublicBusinessHoursStatus(config: ReturnType<typeof getConfig>): PublicBusinessHoursStatus {
  const timezone = config.timezone || 'America/Sao_Paulo';
  const openMinutes = parseBusinessTime(config.openTime);
  const closeMinutes = parseBusinessTime(config.closeTime);
  // Rótulo continua sendo a faixa legada (open–close) para o chip de status. Em
  // lojas multi-janela é o shadow lossy da faixa do dia — não bloqueia nada.
  const label = openMinutes !== null && closeMinutes !== null
    ? `${publicMinutesLabel(openMinutes)}–${publicMinutesLabel(closeMinutes)}`
    : null;

  // Modelo multi-janela: "aberto agora" vem de isOpenAt (respeita o vão do dia).
  if (hasAnyOpenWindow(config.weeklyHours)) {
    return {
      configured: true,
      openNow: isOpenAt(config.weeklyHours, new Date(), timezone).open,
      label,
      closedDays: config.closedDays ?? [],
      timezone,
    };
  }

  // Legado single-window (comportamento idêntico ao anterior).
  if (openMinutes === null || closeMinutes === null) return { configured: false, openNow: true, label: null, closedDays: config.closedDays ?? [], timezone };
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, weekday: 'short' }).format(now).toLowerCase().replace(/\./g, '');
  const dayMap: Record<string, string> = { dom: 'Dom', seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb', 'sáb': 'Sáb' };
  const timeParts = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const rawHour = Number(timeParts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(timeParts.find((part) => part.type === 'minute')?.value ?? '0');
  const hour = rawHour === 24 ? 0 : rawHour;
  const nowMinutes = hour * 60 + minute;
  const day = dayMap[weekday] ?? PUBLIC_DAY_LABELS[now.getDay()] ?? 'Dom';
  const closedToday = config.closedDays.includes(day);
  return {
    configured: true,
    openNow: !closedToday && isBusinessWindowOpen(nowMinutes, openMinutes, closeMinutes),
    label,
    closedDays: config.closedDays ?? [],
    timezone: timezone,
  };
}

// ─── Catalog helpers ──────────────────────────────────────────────────────────

function filterVisibleCatalog(groups: CatalogCategoriaGroup[]): CatalogCategoriaGroup[] {
  return groups
    .map((group) => {
      const subcategorias = group.subcategorias
        .map((sub) => ({ nome: sub.nome, produtos: sub.produtos.filter((p) => p.available) }))
        .filter((sub) => sub.produtos.length > 0);
      const produtosDireto = group.produtosDireto.filter((p) => p.available);
      return { nome: group.nome, subcategorias, produtosDireto };
    })
    .filter((group) => group.subcategorias.length > 0 || group.produtosDireto.length > 0);
}

function applyCategoryOrder(catalog: CatalogCategoriaGroup[], order: string[]): CatalogCategoriaGroup[] {
  if (order.length === 0) return catalog;
  const idx = new Map(order.map((n, i) => [n, i]));
  return [...catalog].sort((a, b) => (idx.get(a.nome) ?? 9999) - (idx.get(b.nome) ?? 9999));
}

function findCatalogProduct(
  products: CatalogProduct[],
  productRef: { productId?: number | null; productName: string },
): CatalogProduct | null {
  if (productRef.productId != null) {
    const byId = products.find((p) => p.id === productRef.productId);
    if (byId) return byId;
  }
  const normalizedTarget = normalizeComparableText(productRef.productName);
  if (!normalizedTarget) return null;
  return products.find((p) => normalizeComparableText(p.name) === normalizedTarget) ?? null;
}

function normalizeIncomingModifierSelections(value: unknown): ZeloMenuModifierSelectionInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((selection) => {
    if (!selection || typeof selection !== 'object') return [];
    const typed = selection as { groupId?: unknown; optionIds?: unknown };
    const groupId = sanitizeText(typed.groupId, 64);
    if (!groupId || !Array.isArray(typed.optionIds)) return [];
    const optionIds = typed.optionIds
      .map((id) => sanitizeText(id, 64))
      .filter((id): id is string => Boolean(id));
    return [{ groupId, optionIds }];
  });
}

function normalizeIncomingItems(items: unknown): ZeloMenuCartItemInput[] {
  if (!Array.isArray(items)) return [];
  if (items.length > 50) throw new Error('CART_LINE_LIMIT_EXCEEDED');
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const typed = item as { productId?: unknown; productName?: unknown; quantity?: unknown; notes?: unknown; selectedOptions?: unknown };
    const productName = sanitizeText(typed.productName, 120);
    const productId = typed.productId == null ? null : Number(typed.productId);
    const quantity = normalizePositiveInt(typed.quantity);
    if (!productName || quantity === null || quantity > 999 || !Number.isSafeInteger(quantity)) throw new Error('INVALID_QUANTITY');
    return [{
      productId: Number.isFinite(productId) ? productId : null,
      productName,
      quantity,
      notes: sanitizeText(typed.notes, 200),
      selectedOptions: normalizeIncomingModifierSelections(typed.selectedOptions),
    }];
  });
}

function toCartItemInputs(cart: ZeloMenuCartSnapshot): ZeloMenuCartItemInput[] {
  return cart.items.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    notes: item.notes ?? null,
    selectedOptions: item.selectedModifiers.map((group) => ({
      groupId: group.groupId,
      optionIds: group.selectedOptions.map((option) => option.optionId),
    })),
  }));
}

// ─── Snapshot resolution ──────────────────────────────────────────────────────

type ResolvedCart = {
  cart: ZeloMenuCartSnapshot;
  fulfillment: ZeloMenuFulfillmentSnapshot;
  pricing: ZeloMenuPricingSnapshot;
  payment: ZeloMenuPaymentSnapshot;
};

async function resolveSnapshots(
  empresaId: string,
  params: {
    items: ZeloMenuCartItemInput[];
    fulfillment?: Partial<ZeloMenuFulfillmentSnapshot> | null;
    paymentMethod?: string | null;
    observations?: string | null;
    context: ZeloMenuCartContext;
    couponCode?: string | null;
  },
): Promise<ResolvedCart> {
  await loadCatalogFromDb(empresaId);
  const config = getConfig(empresaId);
  const resolvedItems: ZeloMenuCartItemSnapshot[] = [];

  const aggregated = new Map<number, number>();
  for (const item of params.items) {
    if (item.productId != null) aggregated.set(item.productId, (aggregated.get(item.productId) ?? 0) + item.quantity);
  }

  for (const item of params.items) {
    const product = findCatalogProduct(config.products, { productId: item.productId ?? null, productName: item.productName });
    if (!product) throw new Error('PRODUCT_NOT_FOUND');
    if (!product.available) throw new Error('PRODUCT_UNAVAILABLE');
    if (product.stockControlled) {
      const stockQuantity = Number(product.stockQuantity ?? 0);
      if ((item.productId != null ? aggregated.get(item.productId) ?? item.quantity : item.quantity) > stockQuantity) throw new Error('PRODUCT_STOCK_EXCEEDED');
    }
    const modifierResolution = resolveModifierSelections(product.modifierGroups, item.selectedOptions ?? []);
    if (modifierResolution.ok === false) throw new Error(`MODIFIER_INVALID:${modifierResolution.message}`);
    const baseUnitPrice = Number(product.basePrice ?? product.price);
    const unitPrice = Number((baseUnitPrice + modifierResolution.deltaTotal).toFixed(2));
    resolvedItems.push({
      productId: product.id ?? null,
      productName: product.name,
      baseUnitPrice,
      selectedModifiers: modifierResolution.selectedGroups,
      modifierDeltaTotal: modifierResolution.deltaTotal,
      quantity: item.quantity,
      unitPrice,
      lineTotal: Number((unitPrice * item.quantity).toFixed(2)),
      notes: sanitizeText(item.notes, 200),
    });
  }

  const fulfillmentType = params.fulfillment?.type === 'delivery' ? 'delivery' : 'pickup';
  const deliveryNeighborhood = sanitizeText(params.fulfillment?.deliveryNeighborhood, 120);

  let deliveryFee = 0;
  let deliveryFeeToConfirm = false;
  if (fulfillmentType === 'delivery') {
    if (!config.deliveryConfig?.enabled) throw new Error('DELIVERY_DISABLED');
    const resolved = resolveDeliveryFeeForNeighborhood({
      type: 'delivery',
      neighborhood: deliveryNeighborhood,
      neighborhoods: config.deliveryConfig.neighborhoods,
    });
    deliveryFee = resolved.fee;
    deliveryFeeToConfirm = resolved.toConfirm;
  }

  const fulfillment: ZeloMenuFulfillmentSnapshot = {
    type: fulfillmentType,
    asap: params.fulfillment?.asap === true,
    pickupDate: normalizeDate(params.fulfillment?.pickupDate),
    pickupTime: normalizeTime(params.fulfillment?.pickupTime),
    deliveryAddress: sanitizeText(params.fulfillment?.deliveryAddress, 250),
    deliveryNeighborhood,
    deliveryFee,
    deliveryFeeToConfirm,
  };

  // ── Coupon validation ────────────────────────────────────────────────────
  let discount = 0;
  let appliedCoupon: { code: string; discountType: 'valor' | 'percentual' | 'frete_gratis'; discountValue: number | null } | null = null;
  if (params.context === 'public_order' && params.couponCode) {
    const normalizedCode = normalizeCouponCode(params.couponCode);
    const ownerUserId = normalizedCode ? await getEmpresaUserId(empresaId) : null;
    const coupon = normalizedCode && ownerUserId
      ? await findActiveCouponByCode(ownerUserId, normalizedCode)
      : null;
    const subtotalSoFar = roundCurrency(resolvedItems.reduce((sum, item) => sum + item.lineTotal, 0));
    const validation = validateCouponRule(coupon, { subtotal: subtotalSoFar });
    if (!validation.ok) {
      throw new Error(
        validation.code === 'coupon_min_not_met' ? 'COUPON_MIN_NOT_MET'
        : validation.code === 'coupon_expired' ? 'COUPON_EXPIRED'
        : 'COUPON_INVALID',
      );
    }
    const applied = applyCoupon(subtotalSoFar, deliveryFee, coupon!);
    discount = applied.discount;
    appliedCoupon = { code: coupon!.code, discountType: coupon!.discountType, discountValue: coupon!.discountValue };
  }

  const pricing = computeCartPricing(resolvedItems, deliveryFee, discount, appliedCoupon);
  if (!Number.isFinite(pricing.total) || pricing.total < 0 || pricing.total > Number(process.env.ZELOMENU_MAX_ORDER_TOTAL || 100000)) throw new Error('ORDER_TOTAL_LIMIT_EXCEEDED');
  const declaredMethod = sanitizeText(params.paymentMethod, 40);
  const payment: ZeloMenuPaymentSnapshot = {
    declaredMethod,
    pixReceiptRequired: isPixReceiptConfigActive(config.pixReceiptConfig) && isPixPaymentMethod(declaredMethod),
    pixReceiptApproved: false,
  };
  return { cart: { items: resolvedItems, observations: sanitizeObservations(params.observations) }, fulfillment, pricing, payment };
}

// ─── Token management ─────────────────────────────────────────────────────────

async function findTokenRowByHash(token: string): Promise<TokenRow | null> {
  const normalized = normalizePublicCartToken(token);
  if (!normalized) return null;
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_tokens')
    .select('id, session_id, token_hash, token_last4, issued_for_revision, revoked_at, created_at, last_seen_at, expires_at')
    .eq('token_hash', hashPublicCartToken(normalized))
    .maybeSingle();
  if (error) throw error;
  const row = (data as TokenRow | null) ?? null;
  if (row?.expires_at && Date.parse(row.expires_at) <= Date.now()) throw new Error('CART_TOKEN_EXPIRED');
  return row;
}

async function findSessionById(sessionId: string): Promise<SessionRow | null> {
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .select(CART_SESSION_COLUMNS)
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return (data as SessionRow | null) ?? null;
}

async function touchToken(tokenId: string): Promise<void> {
  const { error } = await getServiceSupabase()
    .from('zelomenu_cart_tokens')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', tokenId);
  if (error) throw error;
}

async function issueFreshCartToken(
  sessionId: string,
  revision: number,
  now: string,
): Promise<{ token: string; tokenHash: string; tokenLast4: string }> {
  const tokenData = createPublicCartToken();
  await getServiceSupabase().from('zelomenu_cart_tokens').update({ revoked_at: now }).eq('session_id', sessionId).is('revoked_at', null);
  const { error: tokenError } = await getServiceSupabase()
    .from('zelomenu_cart_tokens')
    .insert({ session_id: sessionId, token_hash: tokenData.tokenHash, token_last4: tokenData.tokenLast4, issued_for_revision: revision, created_at: now, expires_at: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString() });
  if (tokenError) throw tokenError;
  const { error: sessionTokenError } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .update({ current_token_hash: tokenData.tokenHash, current_token_last4: tokenData.tokenLast4, updated_at: now })
    .eq('id', sessionId);
  if (sessionTokenError) throw sessionTokenError;
  return tokenData;
}

// ─── Revalidation ─────────────────────────────────────────────────────────────

function cartIssueFromError(message: string): ZeloMenuCartRevalidationIssue | null {
  if (message === 'PRODUCT_NOT_FOUND') return { code: 'product_missing', message: 'Um item desse carrinho não existe mais no cardápio.' };
  if (message === 'PRODUCT_UNAVAILABLE') return { code: 'product_unavailable', message: 'Um item desse carrinho não está disponível no momento.' };
  if (message === 'PRODUCT_STOCK_EXCEEDED') return { code: 'stock_insufficient', message: 'A quantidade de um item ultrapassa o estoque atual.' };
  if (message === 'DELIVERY_DISABLED') return { code: 'schedule_unavailable', message: 'A entrega precisa ser revista antes da confirmação.' };
  if (message.startsWith('MODIFIER_INVALID:')) return { code: 'modifier_invalid', message: message.slice('MODIFIER_INVALID:'.length) };
  if (message === 'COUPON_INVALID') return { code: 'coupon_invalid', message: 'Este cupom não é válido para esta loja.' };
  if (message === 'COUPON_EXPIRED') return { code: 'coupon_expired', message: 'Este cupom não está mais válido.' };
  if (message === 'COUPON_MIN_NOT_MET') return { code: 'coupon_min_not_met', message: 'O pedido ainda não atingiu o valor mínimo para este cupom.' };
  return null;
}

async function runRevalidation(session: PublicCartSession): Promise<ZeloMenuCartRevalidation> {
  const currentInput = toCartItemInputs(session.cart);
  const issues: ZeloMenuCartRevalidationIssue[] = [];
  let previewCart: ZeloMenuCartSnapshot | null = null;
  let previewPricing: ZeloMenuPricingSnapshot | null = null;
  let previewPayment: ZeloMenuPaymentSnapshot | null = null;

  try {
    const resolved = await resolveSnapshots(session.metadata.empresaId as string, {
      items: currentInput,
      fulfillment: session.fulfillment,
      paymentMethod: session.payment.declaredMethod,
      observations: session.cart.observations,
      context: session.context,
      couponCode: session.pricing.couponCode,
    });
    previewCart = resolved.cart;
    previewPricing = resolved.pricing;
    previewPayment = resolved.payment;

    for (const storedItem of session.cart.items) {
      const resolvedItem = resolved.cart.items.find(
        (item) =>
          (item.productId === storedItem.productId || normalizeComparableText(item.productName) === normalizeComparableText(storedItem.productName))
          && buildModifierSignature(item.selectedModifiers.map((g) => ({ groupId: g.groupId, optionIds: g.selectedOptions.map((o) => o.optionId) })))
          === buildModifierSignature(storedItem.selectedModifiers.map((g) => ({ groupId: g.groupId, optionIds: g.selectedOptions.map((o) => o.optionId) }))),
      );
      if (!resolvedItem) {
        issues.push({ code: 'product_missing', message: `O item ${formatModifierAwareCartItem(storedItem)} não está mais disponível nesse carrinho.`, productName: storedItem.productName });
        continue;
      }
      if (storedItem.unitPrice !== resolvedItem.unitPrice) {
        issues.push({ code: 'price_changed', message: `O preço de ${resolvedItem.productName} foi atualizado.`, productName: resolvedItem.productName, previousUnitPrice: storedItem.unitPrice, currentUnitPrice: resolvedItem.unitPrice });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN';
    const issue = cartIssueFromError(message);
    if (issue) {
      issues.push(issue);
    } else {
      throw error;
    }
  }

  return { checkedAt: new Date().toISOString(), ok: issues.length === 0, issues, previewCart, previewPricing, previewPayment };
}

async function persistRevalidation(sessionId: string, revalidation: ZeloMenuCartRevalidation): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .update({ last_revalidated_at: now, last_revalidation: revalidation, updated_at: now })
    .eq('id', sessionId);
  if (error) throw error;
}

async function buildPublicResponse(token: string, sessionRow: SessionRow, tokenRow: TokenRow, persistAccess = true): Promise<PublicCartResponse> {
  const session = mapSessionRow(sessionRow);
  const sessionForRevalidation = { ...session, metadata: { ...session.metadata, empresaId: sessionRow.empresa_id } };
  const revalidation = await runRevalidation(sessionForRevalidation);
  if (persistAccess) {
    await persistRevalidation(session.id, revalidation);
    // Sample access writes to avoid turning every public GET into two UPDATEs.
    if (!tokenRow.last_seen_at || Date.now() - Date.parse(tokenRow.last_seen_at) > 15 * 60 * 1000) await touchToken(tokenRow.id);
  }
  await loadCatalogFromDb(sessionRow.empresa_id);
  const config = getConfig(sessionRow.empresa_id);
  session.lastRevalidatedAt = revalidation.checkedAt;
  session.lastRevalidation = revalidation;
  session.updatedAt = revalidation.checkedAt;

  const publicMetadata: Record<string, unknown> = {};
  if (session.context === 'public_order' && typeof session.metadata.slug === 'string') {
    publicMetadata.slug = session.metadata.slug;
  }
  session.metadata = publicMetadata;

  let order: PublicCartResponse['order'] = null;
  if (session.context === 'public_order' && session.state !== 'cart_open') {
    const { data, error } = await getServiceSupabase()
      .from('zelo_orders')
      .select('id, status, revision')
      .eq('zelomenu_session_id', session.id)
      .maybeSingle();
    if (error) throw error;
    order = data ? {
      id: String(data.id),
      status: String(data.status),
      revision: Number(data.revision),
    } : null;
  }

  const perfilData = await loadZeloMenuProfile(sessionRow.empresa_id);

  return {
    session,
    business: {
      name: config.name,
      address: config.address,
      whatsapp: toWhatsAppNumber(config.contato),
      pixEnabled: isPixReceiptConfigActive(config.pixReceiptConfig),
      deliveryEnabled: config.deliveryConfig?.enabled === true,
      deliveryNeighborhoods: config.deliveryConfig?.neighborhoods ?? [],
      featuredEnabled: perfilData?.zelomenu_featured_enabled ?? false,
      featuredProductIds: Array.isArray(perfilData?.zelomenu_featured_product_ids) ? (perfilData.zelomenu_featured_product_ids as number[]) : [],
      recommendationsEnabled: perfilData?.zelomenu_recommendations_enabled ?? false,
      recommendationProductIds: Array.isArray(perfilData?.zelomenu_recommendation_product_ids) ? (perfilData.zelomenu_recommendation_product_ids as number[]) : [],
      businessHours: buildPublicBusinessHoursStatus(config),
    },
    catalog: filterVisibleCatalog(config.catalogHierarchy),
    link: {
      path: buildPublicCartPath(token),
      tokenStatus: sessionRow.current_token_hash === tokenRow.token_hash && !tokenRow.revoked_at ? 'current' : 'stale',
    },
    revalidation,
    order,
  };
}

// ─── Table order materialization ─────────────────────────────────────────────

// ─── Order materialization ────────────────────────────────────────────────────

// ─── Slug resolution ──────────────────────────────────────────────────────────

export async function resolveEmpresaIdBySlug(slug: string): Promise<string | null> {
  const normalized = normalizeZeloMenuSlug(slug);
  if (!normalized) return null;
  const { data, error } = await getServiceSupabase()
    .from('empresa_perfil')
    .select('id')
    .eq('zelomenu_slug', normalized)
    .maybeSingle();
  if (error) throw error;
  return (data as { id?: string } | null)?.id ?? null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getPublicStoreBySlug(slug: string): Promise<PublicStoreResponse | null> {
  const normalizedSlug = normalizeZeloMenuSlug(slug);
  if (!normalizedSlug) return null;
  const cached = publicStoreCache.get(normalizedSlug);
  if (cached && cached.expiresAt > Date.now()) return cached.response;

  const empresaId = await resolveEmpresaIdBySlug(normalizedSlug);
  if (!empresaId) return null;

  const [, perfil] = await Promise.all([
    loadCatalogFromDb(empresaId),
    loadZeloMenuProfile(empresaId),
  ]);
  const config = getConfig(empresaId);
  const rawCatalog = filterVisibleCatalog(config.catalogHierarchy);
  const categoryOrder = Array.isArray(perfil?.zelomenu_category_order) ? (perfil.zelomenu_category_order as string[]) : [];

  const response: PublicStoreResponse = {
    business: {
      name: config.name,
      address: config.address,
      whatsapp: toWhatsAppNumber(config.contato),
      pixEnabled: isPixReceiptConfigActive(config.pixReceiptConfig),
      deliveryEnabled: config.deliveryConfig?.enabled === true,
      deliveryNeighborhoods: config.deliveryConfig?.neighborhoods ?? [],
      logoUrl: perfil?.logo_url ?? null,
      welcomeText: perfil?.zelomenu_welcome_text ?? null,
      featuredEnabled: perfil?.zelomenu_featured_enabled ?? false,
      featuredProductIds: Array.isArray(perfil?.zelomenu_featured_product_ids) ? (perfil.zelomenu_featured_product_ids as number[]) : [],
      recommendationsEnabled: perfil?.zelomenu_recommendations_enabled ?? false,
      recommendationProductIds: Array.isArray(perfil?.zelomenu_recommendation_product_ids) ? (perfil.zelomenu_recommendation_product_ids as number[]) : [],
      businessHours: buildPublicBusinessHoursStatus(config),
    },
    catalog: applyCategoryOrder(rawCatalog, categoryOrder),
  };
  publicStoreCache.set(normalizedSlug, { expiresAt: Date.now() + PUBLIC_STORE_CACHE_MS, response });
  return response;
}

// ─── Store settings (admin) ─────────────────────────────────────────────────────

export type ZeloMenuStoreSettings = {
  logoUrl: string | null;
  companyName: string;
  companySpecialty: string;
  welcomeText: string | null;
  featuredEnabled: boolean;
  featuredProductIds: number[];
  recommendationsEnabled: boolean;
  recommendationProductIds: number[];
  categoryOrder: string[];
  availableProducts: Array<{ id: number; name: string; categoryName: string }>;
  availableCategories: string[];
};

export async function getZeloMenuStoreSettings(empresaId: string): Promise<ZeloMenuStoreSettings> {
  const [, perfil] = await Promise.all([
    loadCatalogFromDb(empresaId),
    loadZeloMenuProfile(empresaId),
  ]);
  const config = getConfig(empresaId);
  const catalog = filterVisibleCatalog(config.catalogHierarchy);

  const availableProducts: Array<{ id: number; name: string; categoryName: string }> = [];
  for (const cat of catalog) {
    for (const p of cat.produtosDireto) if (p.id != null) availableProducts.push({ id: p.id, name: p.name, categoryName: cat.nome });
    for (const sub of cat.subcategorias) for (const p of sub.produtos) if (p.id != null) availableProducts.push({ id: p.id, name: p.name, categoryName: cat.nome });
  }

  return {
    logoUrl: perfil?.logo_url ?? null,
    companyName: config.name,
    companySpecialty: '',
    welcomeText: perfil?.zelomenu_welcome_text ?? null,
    featuredEnabled: perfil?.zelomenu_featured_enabled ?? false,
    featuredProductIds: Array.isArray(perfil?.zelomenu_featured_product_ids) ? (perfil.zelomenu_featured_product_ids as number[]) : [],
    recommendationsEnabled: perfil?.zelomenu_recommendations_enabled ?? false,
    recommendationProductIds: Array.isArray(perfil?.zelomenu_recommendation_product_ids) ? (perfil.zelomenu_recommendation_product_ids as number[]) : [],
    categoryOrder: Array.isArray(perfil?.zelomenu_category_order) ? (perfil.zelomenu_category_order as string[]) : [],
    availableProducts,
    availableCategories: catalog.map((c) => c.nome),
  };
}

export async function updateZeloMenuStoreSettings(
  empresaId: string,
  patch: Partial<Pick<ZeloMenuStoreSettings, 'welcomeText' | 'featuredEnabled' | 'featuredProductIds' | 'recommendationsEnabled' | 'recommendationProductIds' | 'categoryOrder'>>,
): Promise<void> {
  const coreUpdate: Record<string, unknown> = {};
  const recommendationUpdate: Record<string, unknown> = {};
  if ('welcomeText' in patch) coreUpdate.zelomenu_welcome_text = patch.welcomeText ?? null;
  if ('featuredEnabled' in patch) coreUpdate.zelomenu_featured_enabled = patch.featuredEnabled;
  if ('featuredProductIds' in patch) coreUpdate.zelomenu_featured_product_ids = patch.featuredProductIds;
  if ('categoryOrder' in patch) coreUpdate.zelomenu_category_order = patch.categoryOrder;
  if ('recommendationsEnabled' in patch) recommendationUpdate.zelomenu_recommendations_enabled = patch.recommendationsEnabled;
  if ('recommendationProductIds' in patch) recommendationUpdate.zelomenu_recommendation_product_ids = patch.recommendationProductIds;

  const supabase = getServiceSupabase();
  const update = { ...coreUpdate, ...recommendationUpdate };
  if (Object.keys(update).length === 0) return;

  const { error } = await supabase.from('empresa_perfil').update(update).eq('id', empresaId);
  if (!error) return;
  if (!isMissingZeloMenuRecommendationColumn(error)) throw error;

  if (Object.keys(coreUpdate).length > 0) {
    const { error: coreError } = await supabase.from('empresa_perfil').update(coreUpdate).eq('id', empresaId);
    if (coreError) throw coreError;
  }
  console.warn('[ZeloMenu] recommendation settings were not persisted because their migration is not applied yet.');
}

export async function openPublicOrderCartSession(input: {
  slug: string;
  customerName?: string | null;
  customerPhone?: string | null;
  items?: ZeloMenuCartItemInput[];
  fulfillment?: Partial<ZeloMenuFulfillmentSnapshot> | null;
  paymentMethod?: string | null;
  observations?: string | null;
  context?: 'public_order' | 'table_order';
  mesa_id?: string;
  comanda_id?: string;
}): Promise<{ sessionId: string; orderingId: string; revision: number; token: string; path: string } | null> {
  const empresaId = await resolveEmpresaIdBySlug(input.slug);
  if (!empresaId) return null;

  // If table_order context, validate comanda is still open
  if (input.context === 'table_order') {
    if (!input.mesa_id || !input.comanda_id) throw new Error('MISSING_TABLE_CONTEXT');

    const tableOwnerUserId = await getEmpresaUserId(empresaId);
    if (!tableOwnerUserId) throw new Error('COMANDA_CLOSED');
    const mesaResult = await getMesaContext(input.mesa_id, tableOwnerUserId);
    if (!mesaResult.ok) throw new Error('COMANDA_CLOSED');
    if (mesaResult.comanda_id !== input.comanda_id) throw new Error('TABLE_TAKEN_BY_OTHER_GROUP');
  }

  const items = normalizeIncomingItems(input.items ?? []);
  if (items.length === 0) throw new Error('EMPTY_CART');

  const customer: ZeloMenuCustomerSnapshot = {
    name: sanitizeText(input.customerName, 120),
    phone: sanitizeText(input.customerPhone, 40),
  };
  const sessionContext: ZeloMenuCartContext = input.context ?? 'public_order';
  const resolved = await resolveSnapshots(empresaId, {
    items,
    fulfillment: input.fulfillment,
    paymentMethod: input.paymentMethod,
    observations: input.observations,
    context: input.context ?? 'public_order',
  });
  const normalizedSlug = normalizeZeloMenuSlug(input.slug);
  const sourceRef = `public:${randomUUID()}`;
  const now = new Date().toISOString();
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .insert({
      empresa_id: empresaId,
      context: sessionContext,
      state: 'cart_open',
      source_ref: sourceRef,
      customer_snapshot: customer,
      cart_snapshot: resolved.cart,
      fulfillment_snapshot: resolved.fulfillment,
      pricing_snapshot: resolved.pricing,
      payment_snapshot: resolved.payment,
      metadata: {
        source: input.context === 'table_order' ? 'mesa' : 'public_link',
        slug: normalizedSlug,
        ...(input.context === 'table_order' ? { mesa_id: input.mesa_id, comanda_id: input.comanda_id } : {}),
      },
      revision: 1,
      created_at: now,
      updated_at: now,
    })
    .select(CART_SESSION_COLUMNS)
    .single();
  if (error) throw error;
  const sessionRow = data as SessionRow;
  const tokenData = await issueFreshCartToken(sessionRow.id, sessionRow.revision, now);
  return {
    sessionId: sessionRow.id,
    orderingId: sessionRow.ordering_id,
    revision: sessionRow.revision,
    token: tokenData.token,
    path: buildPublicCartPath(tokenData.token),
  };
}

export async function getPublicCartSession(token: string): Promise<PublicCartResponse | null> {
  const normalized = normalizePublicCartToken(token);
  if (!normalized) return null;
  const tokenRow = await findTokenRowByHash(normalized);
  if (!tokenRow) return null;
  const sessionRow = await findSessionById(tokenRow.session_id);
  if (!sessionRow || sessionRow.archived_at) return null;
  return buildPublicResponse(normalized, sessionRow, tokenRow, false);
}

export async function updatePublicCartSession(
  token: string,
  patch: {
    expectedRevision?: number;
    customerName?: string | null;
    customerPhone?: string | null;
    items?: ZeloMenuCartItemInput[];
    fulfillment?: Partial<ZeloMenuFulfillmentSnapshot> | null;
    paymentMethod?: string | null;
    observations?: string | null;
  },
): Promise<PublicCartResponse | null> {
  const normalized = normalizePublicCartToken(token);
  if (!normalized) return null;
  const tokenRow = await findTokenRowByHash(normalized);
  if (!tokenRow) return null;
  const sessionRow = await findSessionById(tokenRow.session_id);
  if (!sessionRow || sessionRow.archived_at) return null;
  if (sessionRow.current_token_hash !== tokenRow.token_hash || tokenRow.revoked_at) throw new Error('STALE_CART_TOKEN');
  if (sessionRow.state !== 'cart_open') throw new Error('CART_ALREADY_CONFIRMED');
  if (!Number.isSafeInteger(patch.expectedRevision) || patch.expectedRevision !== sessionRow.revision) {
    throw new Error('REVISION_CONFLICT');
  }

  const current = mapSessionRow(sessionRow);
  const customer: ZeloMenuCustomerSnapshot = {
    name: patch.customerName === undefined ? current.customer.name : sanitizeText(patch.customerName, 120),
    phone: patch.customerPhone === undefined ? current.customer.phone : sanitizeText(patch.customerPhone, 40),
  };
  const nextCouponCode = 'couponCode' in patch
    ? (patch.couponCode || null)
    : current.pricing.couponCode;

  const resolved = await resolveSnapshots(sessionRow.empresa_id, {
    items: patch.items === undefined ? toCartItemInputs(current.cart) : normalizeIncomingItems(patch.items),
    fulfillment: patch.fulfillment === undefined ? current.fulfillment : patch.fulfillment,
    paymentMethod: patch.paymentMethod === undefined ? current.payment.declaredMethod : patch.paymentMethod,
    observations: patch.observations === undefined ? current.cart.observations : patch.observations,
    context: sessionRow.context,
    couponCode: nextCouponCode,
  });
  const nextRevision = current.revision + 1;
  const now = new Date().toISOString();
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_cart_sessions')
    .update({
      customer_snapshot: customer,
      cart_snapshot: resolved.cart,
      fulfillment_snapshot: resolved.fulfillment,
      pricing_snapshot: resolved.pricing,
      payment_snapshot: resolved.payment,
      revision: nextRevision,
      last_revalidated_at: null,
      last_revalidation: null,
      updated_at: now,
    })
    .eq('id', sessionRow.id)
    .eq('revision', patch.expectedRevision)
    .eq('state', 'cart_open')
    .eq('current_token_hash', tokenRow.token_hash)
    .select(CART_SESSION_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('REVISION_CONFLICT');
  return buildPublicResponse(normalized, data as SessionRow, tokenRow);
}

export async function confirmPublicCartSession(token: string, expectedRevision: number, idempotencyKey: string): Promise<PublicCartConfirmResponse | null> {
  const normalized = normalizePublicCartToken(token);
  if (!normalized) return null;
  const tokenRow = await findTokenRowByHash(normalized);
  if (!tokenRow) return null;
  const sessionRow = await findSessionById(tokenRow.session_id);
  if (!sessionRow || sessionRow.archived_at) return null;
  if (sessionRow.current_token_hash !== tokenRow.token_hash || tokenRow.revoked_at) throw new Error('STALE_CART_TOKEN');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== sessionRow.revision) throw new Error('REVISION_CONFLICT');
  if (!/^[A-Za-z0-9_-]{16,120}$/.test(idempotencyKey)) throw new Error('IDEMPOTENCY_KEY_REQUIRED');

  if (sessionRow.state !== 'cart_open') {
    const isAlreadyConfirmed = sessionRow.state === 'confirmed_waiting_review' || sessionRow.state === 'confirmed_waiting_payment' || sessionRow.state === 'accepted';
    if (!isAlreadyConfirmed) throw new Error('CART_ALREADY_CLOSED');
    const payload = await buildPublicResponse(normalized, sessionRow, tokenRow);
    return { ...payload, confirmation: { confirmed: true, alreadyConfirmed: true, state: payload.session.state, customerMessage: null } };
  }

  const current = mapSessionRow(sessionRow);
  if (current.context === 'public_order') {
    const detailError = firstZeloMenuCheckoutError(validateZeloMenuCheckoutDetails({
      customerName: current.customer.name,
      customerPhone: current.customer.phone,
      fulfillmentType: current.fulfillment.type,
      deliveryAddress: current.fulfillment.deliveryAddress,
      pickupDate: current.fulfillment.pickupDate,
      pickupTime: current.fulfillment.pickupTime,
    }));
    if (detailError) throw new Error('CUSTOMER_DETAILS_REQUIRED');
  }

  // ── Business hours validation ──────────────────────────────────────────────
  await loadCatalogFromDb(sessionRow.empresa_id);
  const config = getConfig(sessionRow.empresa_id);
  const openMinutes = parseBusinessTime(config.openTime);
  const closeMinutes = parseBusinessTime(config.closeTime);
  // Fonte multi-janela quando `horario_semanal` está configurado (ou derivado do
  // legado). `useWeekly=false` só quando não há nenhuma janela — aí caímos no
  // check legado exato (idêntico ao comportamento atual). Lojas single-window
  // continuam batendo com hoje; só multi-janela ganha o bloqueio do vão.
  const useWeekly = hasAnyOpenWindow(config.weeklyHours);
  if (useWeekly || (openMinutes !== null && closeMinutes !== null)) {
    const closedDays = Array.isArray(config.closedDays) ? config.closedDays : [];
    const timezone = config.timezone || 'America/Sao_Paulo';

    if (current.fulfillment.asap === true) {
      // "Pra já" — check if store is currently open (multi-janela via isOpenAt
      // quando há janelas; senão a lógica single-window legada).
      const hoursStatus = buildPublicBusinessHoursStatus(config);
      if (hoursStatus.openNow === false) {
        throw new Error(
          'STORE_CLOSED_ASAP:Loja fechada agora. Você pode montar o pedido e agendar para um horário de funcionamento disponível.'
        );
      }
    } else {
      // Agendado — validate pickup time against business hours
      const pickupTime = current.fulfillment.pickupTime;
      const pickupDate = current.fulfillment.pickupDate;
      const pickupMinutes = parseBusinessTime(pickupTime);

      if (pickupMinutes === null) {
        throw new Error('PICKUP_TIME_INVALID:Horário de retirada inválido.');
      }

      // Check if pickup date+time is in the past (in the store's timezone)
      if (typeof pickupDate === 'string' && pickupTime) {
        if (isPickupInPast(pickupDate, pickupTime, timezone)) {
          throw new Error(
            'PICKUP_IN_PAST:Horário de retirada já passou. Escolha um horário futuro.'
          );
        }
      }

      if (useWeekly) {
        // O horário de retirada precisa cair numa das janelas do DIA escolhido.
        // Isso rejeita corretamente um horário que caia no vão almoço→jantar
        // (o check single-window legado permitiria por engano).
        const dayKey = typeof pickupDate === 'string' ? pickupDayKey(pickupDate) : null;
        if (dayKey) {
          if (config.weeklyHours[dayKey].length === 0) {
            throw new Error(
              'PICKUP_CLOSED_DAY:A loja não funciona no dia selecionado. Escolha outro dia.'
            );
          }
          if (!isMinuteWithinDay(config.weeklyHours, dayKey, pickupMinutes)) {
            throw new Error(
              'PICKUP_OUTSIDE_HOURS:Horário escolhido fora do horário de funcionamento da loja. Escolha um horário entre os disponíveis.'
            );
          }
        }
      } else {
        // Legado single-window (comportamento idêntico ao anterior).
        if (!isBusinessWindowOpen(pickupMinutes, openMinutes!, closeMinutes!)) {
          throw new Error(
            'PICKUP_OUTSIDE_HOURS:Horário escolhido fora do horário de funcionamento da loja. Escolha um horário entre os disponíveis.'
          );
        }

        // Weekly closed days apply to the selected civil date.
        if (typeof pickupDate === 'string') {
          const mapped = businessDayLabel(pickupDate);
          if (mapped && closedDays.includes(mapped)) {
            throw new Error(
              'PICKUP_CLOSED_DAY:A loja não funciona no dia selecionado. Escolha outro dia.'
            );
          }
        }
      }
    }
  }

  const revalidation = await runRevalidation({ ...current, metadata: { ...current.metadata, empresaId: sessionRow.empresa_id } });

  if (!revalidation.ok || !revalidation.previewCart || !revalidation.previewPricing || !revalidation.previewPayment) {
    await persistRevalidation(current.id, revalidation);
    const payload = await buildPublicResponse(normalized, sessionRow, tokenRow);
    return { ...payload, confirmation: { confirmed: false, alreadyConfirmed: false, state: payload.session.state, customerMessage: null } };
  }

  // ── Coupon redemption: reserve antes de materializar (só public_order) ──
  let couponRedemptionId: string | undefined;
  if (sessionRow.context === 'public_order' && current.pricing.couponCode) {
    const ownerUserId = await getEmpresaUserId(sessionRow.empresa_id);
    const couponRow = await findActiveCouponByCode(ownerUserId, current.pricing.couponCode);
    if (!couponRow) {
      // cupom sumiu desde a última revalidação — injeta um coupon_invalid
      const staleRevalidation: ZeloMenuCartRevalidation = {
        checkedAt: new Date().toISOString(), ok: false, issues: [
          { code: 'coupon_invalid', message: 'Este cupom não é mais válido.' },
        ], previewCart: revalidation.previewCart, previewPricing: revalidation.previewPricing, previewPayment: revalidation.previewPayment,
      };
      await persistRevalidation(current.id, staleRevalidation);
      const payload = await buildPublicResponse(normalized, sessionRow, tokenRow);
      return { ...payload, confirmation: { confirmed: false, alreadyConfirmed: false, state: payload.session.state, customerMessage: null } };
    }
    const customerPhone = normalizePhoneNumber(current.customer.phone ?? '');
    const reservation = await reserveCouponRedemption({
      couponId: couponRow.id,
      ownerUserId,
      customerPhone,
    });
    if (reservation.ok) {
      couponRedemptionId = reservation.redemptionId;
    } else {
      // Já usado por este telefone — coupon_already_used
      const alreadyUsedRevalidation: ZeloMenuCartRevalidation = {
        checkedAt: new Date().toISOString(), ok: false, issues: [
          { code: 'coupon_already_used', message: 'Este cupom já foi usado por este telefone.' },
        ], previewCart: revalidation.previewCart, previewPricing: revalidation.previewPricing, previewPayment: revalidation.previewPayment,
      };
      await persistRevalidation(current.id, alreadyUsedRevalidation);
      const payload = await buildPublicResponse(normalized, sessionRow, tokenRow);
      return { ...payload, confirmation: { confirmed: false, alreadyConfirmed: false, state: payload.session.state, customerMessage: null } };
    }
  }

  // ── table_order: write to ZeloPDV pedidos + double-validate comanda ──────────
  const confirmationRpc = usesCanonicalOrderEngine(sessionRow.context)
    ? getServiceSupabase().rpc('create_zelo_order', {
      p_session_id: sessionRow.id,
      p_expected_revision: expectedRevision,
      p_idempotency_key: idempotencyKey,
      p_snapshots: buildCanonicalOrderSnapshots({
        empresaId: sessionRow.empresa_id,
        customer: current.customer,
        cart: revalidation.previewCart,
        fulfillment: current.fulfillment,
        pricing: revalidation.previewPricing,
        payment: revalidation.previewPayment,
      }),
    })
    : getServiceSupabase().rpc('confirm_zelomenu_cart', {
      p_session_id: sessionRow.id,
      p_token_hash: tokenRow.token_hash,
      p_expected_revision: expectedRevision,
      p_idempotency_key: idempotencyKey,
    });
  const { data: confirmation, error: confirmationError } = await confirmationRpc;
  if (confirmationError) {
    // Rollback da reserva do cupom se houve
    if (couponRedemptionId) void releaseCouponRedemption(couponRedemptionId).catch(() => {});
    const codes = ['CART_NOT_FOUND', 'STALE_CART_TOKEN', 'REVISION_CONFLICT', 'CART_ALREADY_CLOSED', 'IDEMPOTENCY_KEY_REQUIRED', 'TABLE_SESSION_EXPIRED', 'PRODUCT_STOCK_EXCEEDED', 'COMANDA_CLOSED'];
    throw new Error(codes.find((code) => confirmationError.message.includes(code)) || 'ORDER_MATERIALIZATION_FAILED');
  }
  const atomic = confirmation as { orderStatus?: string; sessionState?: ZeloMenuCartState; state?: ZeloMenuCartState; alreadyConfirmed?: boolean };
  const atomicRow = await findSessionById(sessionRow.id);
  if (!atomicRow) {
    if (couponRedemptionId) void releaseCouponRedemption(couponRedemptionId).catch(() => {});
    throw new Error('ORDER_MATERIALIZATION_FAILED');
  }

  // Se a confirmação foi bem-sucedida e temos reserva, attach order_id
  if (couponRedemptionId && atomicRow.ordering_id) {
    void attachOrderToRedemption(couponRedemptionId, atomicRow.ordering_id).catch(() => {});
  }

  const atomicPayload = await buildPublicResponse(normalized, atomicRow, tokenRow);
  return { ...atomicPayload, confirmation: { confirmed: true, alreadyConfirmed: atomic.alreadyConfirmed === true, state: atomic.sessionState ?? atomic.state ?? atomicRow.state, customerMessage: atomicRow.context === 'table_order' ? 'Pedido enviado! Aguarde o garçom.' : `Pedido enviado para a loja! Número: #${atomicRow.ordering_id.slice(0, 8).toUpperCase()}. Aguarde a confirmação.` } };

}

export async function setEmpresaZeloMenuSlug(empresaId: string, rawSlug: string): Promise<string> {
  const normalized = normalizeZeloMenuSlug(rawSlug);
  if (!normalized) throw new Error('INVALID_SLUG');
  if (isReservedZeloMenuSlug(normalized)) throw new Error('RESERVED_SLUG');
  const { error } = await getServiceSupabase().from('empresa_perfil').update({ zelomenu_slug: normalized }).eq('id', empresaId);
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('SLUG_TAKEN');
    throw error;
  }
  return normalized;
}

export async function getEmpresaZeloMenuSlug(empresaId: string): Promise<string | null> {
  const { data, error } = await getServiceSupabase().from('empresa_perfil').select('zelomenu_slug').eq('id', empresaId).maybeSingle();
  if (error) throw error;
  return (data as { zelomenu_slug?: string | null } | null)?.zelomenu_slug ?? null;
}
