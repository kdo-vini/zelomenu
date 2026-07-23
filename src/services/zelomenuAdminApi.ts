// ZeloMenu admin API client — plain fetch against the same-origin Express API.
// All admin endpoints require a Supabase Bearer token, read straight from the
// active session (no token prop threading — components just call these fns).
//
// In dev, Vite proxies `/api` → :3101; in prod the Express server serves both
// the SPA and the API from the same origin, so relative paths work everywhere.

import { supabase } from './supabaseClient';
import type { PixKeyType } from '../domain/pixBrCode';

// ─── Types ───────────────────────────────────────────────────────────────────

export type { PixKeyType };

export type ZeloMenuStoreSettings = {
  logoUrl: string | null;
  companyName: string;
  companySpecialty: string;
  welcomeText: string | null;
  featuredEnabled: boolean;
  featuredProductIds: number[];
  recommendationsEnabled: boolean;
  recommendationProductIds: number[];
  categorySuggestions: Record<string, number[]>;
  categoryOrder: string[];
  availableProducts: Array<{ id: number; name: string; categoryName: string }>;
  availableCategories: string[];
  pixKey: string | null;
  pixKeyType: PixKeyType | null;
  autoAcceptOrders: boolean;
  pixReceiptVerificationEnabled: boolean;
};

export type ZeloMenuSettingsPatch = {
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
};

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
