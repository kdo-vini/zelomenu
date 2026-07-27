// ZeloMenu admin API client — plain fetch against the same-origin Express API.
// All admin endpoints require a Supabase Bearer token, read straight from the
// active session (no token prop threading — components just call these fns).
//
// In dev, Vite proxies `/api` → :3101; in prod the Express server serves both
// the SPA and the API from the same origin, so relative paths work everywhere.

import { supabase } from './supabaseClient';
import type { PixKeyType } from '../domain/pixBrCode';
import type {
  DeliveryCepLookup,
  DeliveryGeocodeResult,
  DeliverySettings,
} from '../domain/deliverySettings';

// ─── Types ───────────────────────────────────────────────────────────────────

export type { PixKeyType };

export type ZeloMenuStoreSettings = {
  logoUrl: string | null;
  coverUrl: string | null;
  description: string | null;
  companyName: string;
  companySpecialty: string;
  welcomeText: string | null;
  featuredEnabled: boolean;
  featuredProductIds: number[];
  recommendationsEnabled: boolean;
  recommendationProductIds: number[];
  categorySuggestions: Record<string, number[]>;
  categoryOrder: string[];
  availableProducts: Array<{ id: number; name: string; categoryName: string; price: number; photoUrl: string | null }>;
  availableCategories: string[];
  pixKey: string | null;
  pixKeyType: PixKeyType | null;
  autoAcceptOrders: boolean;
  pixReceiptVerificationEnabled: boolean;
};

export type ZeloMenuSettingsPatch = {
  logoUrl?: string | null;
  coverUrl?: string | null;
  description?: string | null;
  welcomeText?: string | null;
  featuredEnabled?: boolean;
  featuredProductIds?: number[];
  recommendationsEnabled?: boolean;
  recommendationProductIds?: number[];
  categorySuggestions?: Record<string, number[]>;
  categoryOrder?: string[];
  pixKey?: string | null;
  pixKeyType?: PixKeyType | null;
  autoAcceptOrders?: boolean;
};

export type DeliveryQuoteRequestSummary = {
  id: string;
  companyId: string;
  sessionId: string;
  idempotencyKey: string;
  status: 'pending' | 'resolved' | 'expired' | 'cancelled';
  reasonCode: string;
  createdAt: string;
  expiresAt: string;
};

export type DeliveryQuoteRequestDetail = DeliveryQuoteRequestSummary & {
  customer: unknown;
  cart: unknown;
  fulfillment: unknown;
  pricing: unknown;
  lastError: unknown;
  resolvedFee: number | null;
  resolvedAt: string | null;
};

// ─── Auth header ───────────────────────────────────────────────────────────────

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

// ─── Error mapping ───────────────────────────────────────────────────────────

// Map the server's machine `error` codes to friendly PT-BR copy where useful.
// Anything not in the table falls through to the raw code / HTTP status.
const ERROR_MESSAGES: Record<string, string> = {
  INTERNAL_ERROR: 'NÃ£o foi possÃ­vel salvar as configuraÃ§Ãµes. Tente novamente.',
  SLUG_TAKEN: 'Esse link já está em uso.',
  INVALID_SLUG: 'Link inválido.',
  RESERVED_SLUG: 'Esse link é reservado.',
  AI_UNAVAILABLE: 'A geração com IA está indisponível no momento. Tente de novo mais tarde.',
  COUPON_CODE_TAKEN: 'Este código já está em uso.',
  COUPON_INVALID_CODE: 'Código inválido. Use letras, números e hífen (3 a 30 caracteres).',
  COUPON_INVALID_DISCOUNT_VALUE: 'Valor de desconto inválido para o tipo escolhido.',
  COUPON_NOT_FOUND: 'Cupom não encontrado.',
  PIX_KEY_INVALID: 'Chave Pix inválida para o tipo selecionado.',
  AUTO_ACCEPT_SETTINGS_UNAVAILABLE: 'A configuração de pedidos ainda não está disponível. Atualize o painel e tente novamente.',
  DELIVERY_TIMEOUT: 'A operação demorou mais que o esperado. Confira a conexão e tente novamente.',
  DELIVERY_NOT_FOUND: 'A configuração de entrega não foi encontrada. Tente recarregar o painel.',
  DELIVERY_ADDRESS_INVALID: 'Confira o endereço da loja antes de continuar.',
  DELIVERY_GEOCODING_UNAVAILABLE: 'Não foi possível localizar a loja agora. Tente novamente em instantes.',
  DELIVERY_PRICING_RULE_INVALID: 'Verifique os horários personalizados — há informações inválidas.',
  DELIVERY_PRICING_RULE_OVERLAP: 'Dois horários personalizados não podem se sobrepor.',
  DELIVERY_PRICING_RANGE_PRICE_MISSING: 'Informe um preço para cada faixa em todos os horários.',
  QUOTE_REQUEST_NOT_FOUND: 'Solicitação de cotação não encontrada.',
  QUOTE_REQUEST_NOT_PENDING: 'Esta solicitação já foi processada ou cancelada.',
  QUOTE_REQUEST_MISSING_ADDRESS: 'Endereço não disponível para recálculo.',
  INVALID_FEE: 'Valor de frete inválido.',
};

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = 8_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('DELIVERY_TIMEOUT');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// Parse a Response into JSON, throwing a friendly Error (mapped where possible)
// when the request failed.
async function parseResponse<T>(response: Response): Promise<T> {
  // 401 = sessão expirada — força logout imediato para redirecionar ao login
  if (response.status === 401) {
    await supabase.auth.signOut();
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    const code = body.error ?? body.message;
    const friendly = code ? ERROR_MESSAGES[code] : undefined;
    throw new Error(friendly ?? code ?? `HTTP ${response.status}`);
  }
  return body as T;
}

// ─── Endpoints ─────────────────────────────────────────────────────────────────

export async function getZeloMenuSettings(): Promise<ZeloMenuStoreSettings> {
  const response = await fetch('/api/admin/zelomenu/settings', {
    headers: await authHeader(),
    cache: 'no-store',
  });
  return parseResponse<ZeloMenuStoreSettings>(response);
}

export async function updateZeloMenuSettings(
  patch: ZeloMenuSettingsPatch,
): Promise<{ ok: true }> {
  const response = await fetch('/api/admin/zelomenu/settings', {
    method: 'PATCH',
    headers: await authHeader(),
    body: JSON.stringify(patch),
  });
  return parseResponse<{ ok: true }>(response);
}

// ─── Delivery settings ──────────────────────────────────────────────────────

export async function getDeliverySettings(): Promise<DeliverySettings> {
  const response = await fetchWithTimeout('/api/admin/zelomenu/delivery', {
    headers: await authHeader(),
    cache: 'no-store',
  });
  return parseResponse<DeliverySettings>(response);
}

export async function lookupDeliveryCep(postalCode: string): Promise<DeliveryCepLookup> {
  const response = await fetchWithTimeout('/api/admin/zelomenu/delivery/lookup-cep', {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify({ postalCode: postalCode.replace(/\D/g, '') }),
  });
  return parseResponse<DeliveryCepLookup>(response);
}

export async function geocodeDeliveryStore(params: {
  postalCode: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
}): Promise<DeliveryGeocodeResult> {
  const response = await fetchWithTimeout('/api/admin/zelomenu/delivery/geocode-store', {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify(params),
  });
  return parseResponse<DeliveryGeocodeResult>(response);
}

export async function updateDeliverySettings(settings: DeliverySettings): Promise<{ ok: true; settings?: DeliverySettings }> {
  const response = await fetchWithTimeout('/api/admin/zelomenu/delivery', {
    method: 'PATCH',
    headers: await authHeader(),
    body: JSON.stringify(settings),
  });
  return parseResponse<{ ok: true; settings?: DeliverySettings }>(response);
}

export async function listPendingDeliveryQuoteRequests(): Promise<DeliveryQuoteRequestSummary[]> {
  const response = await fetchWithTimeout('/api/admin/zelomenu/delivery/quote-requests', {
    headers: await authHeader(),
    cache: 'no-store',
  });
  const body = await parseResponse<{ requests: DeliveryQuoteRequestSummary[] }>(response);
  return body.requests;
}

export async function getDeliveryQuoteRequestDetail(id: string): Promise<DeliveryQuoteRequestDetail> {
  const response = await fetchWithTimeout(`/api/admin/zelomenu/delivery/quote-requests/${encodeURIComponent(id)}`, {
    headers: await authHeader(),
    cache: 'no-store',
  });
  return parseResponse<DeliveryQuoteRequestDetail>(response);
}

export type DeliveryHealthStatus = {
  supabase: 'ok' | 'error';
  circuits: Record<string, { state: 'open' | 'closed' | 'half-open'; failures: number; opensInMs: number | null }>;
  pendingRequests: number;
  oldestPendingMs: number | null;
};

export async function getDeliveryHealth(): Promise<DeliveryHealthStatus> {
  const response = await fetchWithTimeout('/api/admin/zelomenu/delivery/health', {
    headers: await authHeader(),
    cache: 'no-store',
  });
  return parseResponse<DeliveryHealthStatus>(response);
}

export async function expireDeliveryQuoteRequests(): Promise<{ expired: number }> {
  const response = await fetchWithTimeout('/api/admin/zelomenu/delivery/cleanup-expired', {
    method: 'POST',
    headers: await authHeader(),
  });
  return parseResponse<{ expired: number }>(response);
}

export async function retryDeliveryQuoteRequest(id: string): Promise<{ ok: boolean; fee?: number; error?: string }> {
  const response = await fetchWithTimeout(`/api/admin/zelomenu/delivery/quote-requests/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
    headers: await authHeader(),
  });
  return parseResponse<{ ok: boolean; fee?: number; error?: string }>(response);
}

export async function resolveDeliveryQuoteRequest(id: string, fee: number): Promise<{ ok: true }> {
  const response = await fetchWithTimeout(`/api/admin/zelomenu/delivery/quote-requests/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify({ fee }),
  });
  return parseResponse<{ ok: true }>(response);
}

export async function cancelDeliveryQuoteRequest(id: string): Promise<{ ok: true }> {
  const response = await fetchWithTimeout(`/api/admin/zelomenu/delivery/quote-requests/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    headers: await authHeader(),
  });
  return parseResponse<{ ok: true }>(response);
}

export async function generateZeloMenuWelcome(params: {
  companyName: string;
  companySpecialty: string;
  categories: string[];
}): Promise<string> {
  const response = await fetch('/api/admin/zelomenu/welcome', {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify(params),
  });
  // parseResponse maps AI_UNAVAILABLE → friendly PT-BR Error.
  const body = await parseResponse<{ text: string }>(response);
  return body.text;
}

export async function generateZeloMenuProductDescription(productName: string): Promise<string> {
  const response = await fetch('/api/admin/zelomenu/product-description', {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify({ productName }),
  });
  const body = await parseResponse<{ text: string }>(response);
  return body.text;
}

export async function getZeloMenuSlug(): Promise<{ slug: string | null }> {
  const response = await fetch('/api/admin/zelomenu/slug', {
    headers: await authHeader(),
    cache: 'no-store',
  });
  return parseResponse<{ slug: string | null }>(response);
}

export async function setZeloMenuSlug(slug: string): Promise<{ slug: string }> {
  const response = await fetch('/api/admin/zelomenu/slug', {
    method: 'PUT',
    headers: await authHeader(),
    body: JSON.stringify({ slug }),
  });
  return parseResponse<{ slug: string }>(response);
}

// ─── Mesas ────────────────────────────────────────────────────────────────────

export type MesaRow = {
  id: string;
  numero: string;
  capacidade: number | null;
  status: string;
  ativa: boolean;
};

export async function listMesasAdmin(): Promise<MesaRow[]> {
  const response = await fetch('/api/admin/zelomenu/mesas', {
    headers: await authHeader(),
    cache: 'no-store',
  });
  const body = await parseResponse<{ mesas: MesaRow[] }>(response);
  return body.mesas;
}

// ─── Coupons ────────────────────────────────────────────────────────────────

export type ZeloMenuCoupon = {
  id: string;
  code: string;
  discountType: 'valor' | 'percentual' | 'frete_gratis';
  discountValue: number | null;
  minOrderValue: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
};

export type ZeloMenuCouponInput = Omit<ZeloMenuCoupon, 'id'>;

export async function listZeloMenuCouponsAdmin(): Promise<ZeloMenuCoupon[]> {
  const response = await fetch('/api/admin/zelomenu/coupons', { headers: await authHeader(), cache: 'no-store' });
  const body = await parseResponse<{ coupons: ZeloMenuCoupon[] }>(response);
  return body.coupons;
}

export async function createZeloMenuCouponAdmin(input: ZeloMenuCouponInput): Promise<ZeloMenuCoupon> {
  const response = await fetch('/api/admin/zelomenu/coupons', { method: 'POST', headers: await authHeader(), body: JSON.stringify(input) });
  return parseResponse<ZeloMenuCoupon>(response);
}

export async function updateZeloMenuCouponAdmin(id: string, patch: Partial<ZeloMenuCouponInput>): Promise<ZeloMenuCoupon> {
  const response = await fetch(`/api/admin/zelomenu/coupons/${encodeURIComponent(id)}`, { method: 'PATCH', headers: await authHeader(), body: JSON.stringify(patch) });
  return parseResponse<ZeloMenuCoupon>(response);
}

export async function deleteZeloMenuCouponAdmin(id: string): Promise<{ ok: true }> {
  const response = await fetch(`/api/admin/zelomenu/coupons/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeader() });
  return parseResponse<{ ok: true }>(response);
}
