// ZeloMenu — delivery por distância (FONTE ÚNICA, node-free).
//
// Substitui resolveDeliveryFeeForNeighborhood por um sistema que calcula o
// frete pela distância real de rota entre loja e cliente, usando:
//   ViaCEP     → CEP → endereço
//   Nominatim  → endereço → coordenadas
//   OSRM       → coordenadas → distância da rota
//
// Cache L1 (memória do processo) e L2 (Supabase) são gerenciados pelo módulo
// de serviço no servidor. Este arquivo contém apenas tipos e lógica pura.

import { normalizeComparableText } from './pixReceipt';

// ─── Constantes ───────────────────────────────────────────────────────────────

export const DELIVERY_STATUS = {
  NOT_APPLICABLE: 'not_applicable',
  PENDING: 'pending',
  ELIGIBLE: 'eligible',
  ELIGIBLE_STALE: 'eligible_stale',
  OUT_OF_AREA: 'out_of_area',
  UNAVAILABLE: 'unavailable',
  QUOTE_PENDING: 'quote_pending',
} as const;

export type DeliveryStatus = (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS];

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type ViaCepResult = {
  postalCode: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type GeoCoordinates = {
  latitude: number;
  longitude: number;
};

export type DeliveryRange = {
  maxDistanceM: number;
  price: number;
};

/** Endereço estruturado do cliente no checkout */
export type DeliveryAddress = {
  postalCode: string;
  number: string;
  complement: string | null;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

/** Snapshot completo do fulfillment (substitui gradualmente o legado) */
export type DeliveryFulfillmentDetail = {
  address: DeliveryAddress | null;
  coordinates: GeoCoordinates | null;
  distanceM: number | null;
  deliveryFee: number;
  status: DeliveryStatus;
  cacheLayer: 'none' | 'memory' | 'supabase' | 'provider' | 'stale' | null;
  quoteRequestId: string | null;
};

/** Resultado de uma cotação de frete */
export type DeliveryQuote = {
  /** Endereço completo (do ViaCEP) */
  address: DeliveryAddress;
  /** Coordenadas do destino (do geocoding) */
  coordinates: GeoCoordinates;
  /** Distância da rota em metros (do OSRM) */
  distanceM: number;
  /** Faixa aplicada */
  rangeApplied: DeliveryRange;
  /** Valor do frete */
  fee: number;
  /** Bairro (para compatibilidade com snapshot legado) */
  neighborhood: string;
};

// ─── Utilitários ──────────────────────────────────────────────────────────────

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Normaliza CEP para 8 dígitos */
export function normalizePostalCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 8);
}

/** Valida CEP de 8 dígitos */
export function isValidPostalCode(value: string): boolean {
  return /^\d{8}$/.test(value);
}

// ─── Range matching ───────────────────────────────────────────────────────────

export type DeliveryRangeMatchInput = {
  distanceM: number;
  ranges: DeliveryRange[];
};

export type DeliveryRangeMatchResult =
  | { matched: true; range: DeliveryRange; fee: number }
  | { matched: false; reason: 'out_of_area' | 'no_ranges_configured' };

/**
 * Encontra a primeira faixa que cobre a distância fornecida.
 * As faixas devem estar ordenadas por maxDistanceM (crescente).
 */
export function matchDeliveryRange(input: DeliveryRangeMatchInput): DeliveryRangeMatchResult {
  const { distanceM, ranges } = input;

  if (!ranges.length) return { matched: false, reason: 'no_ranges_configured' };

  const sorted = [...ranges].sort((a, b) => a.maxDistanceM - b.maxDistanceM);
  const match = sorted.find((r) => distanceM <= r.maxDistanceM);

  if (!match) return { matched: false, reason: 'out_of_area' };

  return { matched: true, range: match, fee: roundCurrency(match.price) };
}

// ─── Construção de URL para provedores ────────────────────────────────────────

export function buildViaCepUrl(cep: string): string {
  const base = process.env.VIACEP_BASE_URL || 'https://viacep.com.br';
  return `${base}/ws/${cep}/json/`;
}

export function buildNominatimUrl(address: DeliveryAddress): string {
  const base = process.env.GEOCODING_BASE_URL || 'https://nominatim.openstreetmap.org';
  const q = encodeURIComponent(`${address.street}, ${address.number} - ${address.neighborhood}, ${address.city}, ${address.state}, Brasil`);
  return `${base}/search?q=${q}&format=json&limit=1&countrycodes=br`;
}

export function buildOsrmUrl(origin: GeoCoordinates, destination: GeoCoordinates): string {
  const base = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
  return `${base}/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=false`;
}

// ─── HMAC para cache ──────────────────────────────────────────────────────────

/**
 * Gera um hash HMAC-SHA-256 do endereço normalizado para usar como chave
 * de cache de geocoding. Usa o segredo do servidor (ou um fallback).
 * Node-free: aceita a secret como parâmetro.
 */
export async function hashAddress(
  postalCode: string,
  number: string,
  secret: string,
): Promise<string> {
  const data = `${postalCode}|${number}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex;
}

// ─── Resolvedor legado (mantido para compatibilidade) ─────────────────────────

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
