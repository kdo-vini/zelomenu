// ZeloMenu — server-side delivery service (CEP lookup, geocoding, routing, cache).
//
// Todos os provedores externos (ViaCEP, Nominatim, OSRM) são chamados com
// timeout controlado. O cache é consultado antes de qualquer chamada externa.

import { getServiceSupabase } from './supabaseServer.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizePostalCode,
  isValidPostalCode,
  buildViaCepUrl,
  buildNominatimUrl,
  buildOsrmUrl,
  hashAddress,
  matchDeliveryRange,
  roundCurrency,
  type DeliveryAddress,
  type DeliveryQuote,
  type DeliveryRange,
  type DeliveryStatus,
  type GeoCoordinates,
  type ViaCepResult,
} from '../src/domain/zelomenuDelivery.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

const PROVIDER_TIMEOUT_MS = Number(process.env.DELIVERY_PROVIDER_TIMEOUT_MS) || 2500;
const TOTAL_DEADLINE_MS = Number(process.env.DELIVERY_TOTAL_DEADLINE_MS) || 6000;
const CACHE_TTL_DAYS = Number(process.env.DELIVERY_CACHE_TTL_DAYS) || 30;
const ROUTE_CACHE_TTL_DAYS = Number(process.env.DELIVERY_ROUTE_CACHE_TTL_DAYS) || 7;
const GEOCODING_MIN_INTERVAL_MS = Number(process.env.GEOCODING_MIN_INTERVAL_MS) || 1000;
const STALE_MAX_DAYS = Number(process.env.DELIVERY_STALE_MAX_DAYS) || 30;
const HMAC_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'dev-secret';

// ─── Cache L1 (memória do processo) ──────────────────────────────────────────

const cepCacheL1 = new Map<string, { result: ViaCepResult; expiresAt: number }>();
const geocodingCacheL1 = new Map<string, { result: GeoCoordinates; expiresAt: number }>();
const distanceCacheL1 = new Map<string, { result: number; expiresAt: number }>();

const CACHE_L1_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedL1<T>(map: Map<string, { result: T; expiresAt: number }>, key: string): T | null {
  const entry = map.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry.result;
}

function setCachedL1<T>(map: Map<string, { result: T; expiresAt: number }>, key: string, result: T): void {
  if (map.size > 1000) map.clear(); // guard
  map.set(key, { result, expiresAt: Date.now() + CACHE_L1_TTL_MS });
}

// ─── Shared supabase client ──────────────────────────────────────────────────

function getDb(): SupabaseClient {
  return getServiceSupabase();
}

// ─── ViaCEP ──────────────────────────────────────────────────────────────────

async function fetchViaCep(cep: string): Promise<ViaCepResult> {
  const url = buildViaCepUrl(cep);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`VIACEP_HTTP_${response.status}`);
    const data = (await response.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (data.erro === true) throw new Error('ADDRESS_INVALID');
    const street = (data.logradouro ?? '').trim();
    const neighborhood = (data.bairro ?? '').trim();
    const city = (data.localidade ?? '').trim();
    const state = (data.uf ?? '').trim();
    if (!city || !state) throw new Error('ADDRESS_INVALID');
    return { postalCode: cep, street: street || 's/n', neighborhood: neighborhood || 'Centro', city, state };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Geocoding (Nominatim) ──────────────────────────────────────────────────

export async function fetchGeocoding(address: DeliveryAddress): Promise<GeoCoordinates | null> {
  const url = buildNominatimUrl(address);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': process.env.GEOCODING_USER_AGENT || 'ZeloMenu/1.0 (contato@zelopdv.com.br)' },
    });
    if (!response.ok) throw new Error(`GEOCODING_HTTP_${response.status}`);
    const data = (await response.json()) as Array<{ lat?: string; lon?: string }>;
    if (!data.length) return null;
    const lat = Number(data[0].lat);
    const lon = Number(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { latitude: lat, longitude: lon };
  } finally {
    clearTimeout(timer);
  }
}

// ─── OSRM ────────────────────────────────────────────────────────────────────

async function fetchOsrmDistance(origin: GeoCoordinates, destination: GeoCoordinates): Promise<number | null> {
  const url = buildOsrmUrl(origin, destination);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`OSRM_HTTP_${response.status}`);
    const data = (await response.json()) as { code?: string; routes?: Array<{ distance?: number }> };
    if (data.code !== 'Ok' || !data.routes?.length) return null;
    const distance = data.routes[0].distance;
    return Number.isFinite(distance) ? Math.round(distance) : null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Cache L2 (Supabase) ────────────────────────────────────────────────────

type CacheLayer = 'none' | 'memory' | 'supabase' | 'provider' | 'stale';

async function getCachedCep(cep: string): Promise<{ result: ViaCepResult; layer: CacheLayer } | null> {
  const l1 = getCachedL1(cepCacheL1, cep);
  if (l1) return { result: l1, layer: 'memory' };

  const { data } = await getDb()
    .from('zelomenu_delivery_cep_cache')
    .select('street, neighborhood, city, state, expires_at')
    .eq('postal_code', cep)
    .maybeSingle();

  if (!data) return null;
  const now = new Date().toISOString();
  if (data.expires_at < now) return null; // expired

  const result: ViaCepResult = {
    postalCode: cep,
    street: data.street,
    neighborhood: data.neighborhood,
    city: data.city,
    state: data.state,
  };
  setCachedL1(cepCacheL1, cep, result);
  return { result, layer: 'supabase' };
}

async function saveCachedCep(result: ViaCepResult): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 86400000).toISOString();
  await getDb()
    .from('zelomenu_delivery_cep_cache')
    .upsert(
      {
        postal_code: result.postalCode,
        street: result.street,
        neighborhood: result.neighborhood,
        city: result.city,
        state: result.state,
        provider: 'viacep',
        expires_at: expiresAt,
      },
      { onConflict: 'postal_code' },
    )
    .catch(() => {}); // non-critical, best-effort
  setCachedL1(cepCacheL1, result.postalCode, result);
}

async function getCachedGeocoding(addressHash: string): Promise<{ result: GeoCoordinates; layer: CacheLayer } | null> {
  // L1
  const l1 = getCachedL1(geocodingCacheL1, addressHash);
  if (l1) return { result: l1, layer: 'memory' };

  // L2
  const { data } = await getDb()
    .from('zelomenu_delivery_geocoding_cache')
    .select('latitude, longitude, expires_at')
    .eq('address_hash', addressHash)
    .maybeSingle();

  if (!data) return null;
  if (data.expires_at < new Date().toISOString()) return null;

  const coords: GeoCoordinates = { latitude: data.latitude, longitude: data.longitude };
  setCachedL1(geocodingCacheL1, addressHash, coords);
  return { result: coords, layer: 'supabase' };
}

async function saveCachedGeocoding(addressHash: string, postalCode: string, number: string, coords: GeoCoordinates): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 86400000).toISOString();
  await getDb()
    .from('zelomenu_delivery_geocoding_cache')
    .upsert(
      {
        address_hash: addressHash,
        postal_code: postalCode,
        number,
        latitude: coords.latitude,
        longitude: coords.longitude,
        provider: 'nominatim',
        expires_at: expiresAt,
      },
      { onConflict: 'address_hash,provider' },
    )
    .catch(() => {});
  setCachedL1(geocodingCacheL1, addressHash, coords);
}

async function getCachedDistance(
  companyId: string,
  destHash: string,
  originVersion: number,
): Promise<{ result: number; layer: CacheLayer } | null> {
  const cacheKey = `${companyId}:${destHash}:${originVersion}`;

  // L1
  const l1 = getCachedL1(distanceCacheL1, cacheKey);
  if (l1 != null) return { result: l1, layer: 'memory' };

  // L2
  const { data } = await getDb()
    .from('zelomenu_delivery_distance_cache')
    .select('distance_m, is_stale, expires_at')
    .eq('company_id', companyId)
    .eq('destination_address_hash', destHash)
    .eq('origin_location_version', originVersion)
    .maybeSingle();

  if (!data) return null;

  const now = new Date().toISOString();
  if (data.expires_at >= now) {
    setCachedL1(distanceCacheL1, cacheKey, data.distance_m);
    return { result: data.distance_m, layer: data.is_stale ? 'stale' : 'supabase' };
  }

  return null;
}

async function saveCachedDistance(
  companyId: string,
  destHash: string,
  originVersion: number,
  destination: GeoCoordinates,
  distanceM: number,
  isStale: boolean,
): Promise<void> {
  const cacheKey = `${companyId}:${destHash}:${originVersion}`;
  const expiresAt = new Date(Date.now() + ROUTE_CACHE_TTL_DAYS * 86400000).toISOString();
  await getDb()
    .from('zelomenu_delivery_distance_cache')
    .upsert(
      {
        company_id: companyId,
        destination_address_hash: destHash,
        origin_location_version: originVersion,
        latitude: destination.latitude,
        longitude: destination.longitude,
        distance_m: distanceM,
        geocoding_provider: 'nominatim',
        routing_provider: 'osrm',
        is_stale: isStale,
        expires_at: expiresAt,
      },
      { onConflict: 'company_id,destination_address_hash,origin_location_version' },
    )
    .catch(() => {});
  setCachedL1(distanceCacheL1, cacheKey, distanceM);
}

// ─── Quote principal ─────────────────────────────────────────────────────────

export type DeliveryQuoteInput = {
  companyId: string;
  postalCode: string;
  number: string;
  complement?: string | null;
  ranges: DeliveryRange[];
  storeCoordinates: GeoCoordinates | null;
  storeLocationVersion: number;
  signal?: AbortSignal;
};

export type DeliveryQuoteOutcome =
  | { status: 'eligible'; quote: DeliveryQuote; cacheLayer: CacheLayer }
  | { status: 'out_of_area'; reason: 'out_of_area' }
  | { status: 'store_not_configured'; reason: 'store_address_missing' | 'no_ranges' }
  | { status: 'unavailable'; reason: string }
  | { status: 'address_invalid'; reason: string };

export async function quoteDelivery(input: DeliveryQuoteInput): Promise<DeliveryQuoteOutcome> {
  const cep = normalizePostalCode(input.postalCode);
  if (!isValidPostalCode(cep)) return { status: 'address_invalid', reason: 'CEP inválido' };
  if (!input.ranges.length) return { status: 'store_not_configured', reason: 'no_ranges' };

  const number = input.number.trim();
  if (!number) return { status: 'address_invalid', reason: 'Número obrigatório' };

  // 1. CEP lookup
  const cepResult = await resolveCep(cep);
  if (!cepResult) return { status: 'address_invalid', reason: 'CEP não encontrado' };

  const address: DeliveryAddress = {
    postalCode: cep,
    number,
    complement: input.complement?.trim() ?? null,
    street: cepResult.street,
    neighborhood: cepResult.neighborhood,
    city: cepResult.city,
    state: cepResult.state,
  };

  // 2. Se a loja não tem coordenadas, não dá pra calcular rota
  if (!input.storeCoordinates) {
    return { status: 'store_not_configured', reason: 'store_address_missing' };
  }

  // 3. Geocoding do endereço do cliente
  const addressHash = await hashAddress(cep, number, HMAC_SECRET);
  const geoResult = await resolveGeocoding(addressHash, address);

  if (!geoResult) {
    return { status: 'unavailable', reason: 'Endereço não encontrado no geocoding' };
  }

  const { coordinates, layer: geoLayer } = geoResult;

  // 4. Distância da rota
  const distResult = await resolveDistance(
    input.companyId,
    addressHash,
    input.storeLocationVersion,
    input.storeCoordinates,
    coordinates,
  );

  if (distResult == null) {
    return { status: 'unavailable', reason: 'Não foi possível calcular a rota' };
  }

  const { distanceM, layer: distLayer } = distResult;

  // 5. Match faixa
  const match = matchDeliveryRange({ distanceM, ranges: input.ranges });
  if (!match.matched) {
    return { status: 'out_of_area', reason: 'out_of_area' };
  }

  const fee = roundCurrency(Number(match.fee));
  const quote: DeliveryQuote = {
    address,
    coordinates,
    distanceM,
    rangeApplied: match.range,
    fee,
    neighborhood: address.neighborhood,
  };

  // 6. Cache layer: report the outermost layer used
  const layer: CacheLayer = distLayer === 'provider' ? 'provider'
    : distLayer === 'stale' ? 'stale'
    : distLayer; // 'supabase' or 'memory'

  return { status: 'eligible', quote, cacheLayer: layer };
}

// ─── Helpers internos ────────────────────────────────────────────────────────

async function resolveCep(cep: string): Promise<ViaCepResult | null> {
  const cached = await getCachedCep(cep);
  if (cached) return cached.result;

  try {
    const result = await fetchViaCep(cep);
    await saveCachedCep(result);
    return result;
  } catch {
    return null;
  }
}

async function resolveGeocoding(
  addressHash: string,
  address: DeliveryAddress,
): Promise<{ coordinates: GeoCoordinates; layer: CacheLayer } | null> {
  const cached = await getCachedGeocoding(addressHash);
  if (cached) return { coordinates: cached.result, layer: cached.layer };

  // Rate limiting básico
  await new Promise((r) => setTimeout(r, GEOCODING_MIN_INTERVAL_MS));

  try {
    const coords = await fetchGeocoding(address);
    if (!coords) return null;
    await saveCachedGeocoding(addressHash, address.postalCode, address.number, coords);
    return { coordinates: coords, layer: 'provider' };
  } catch {
    return null;
  }
}

async function resolveDistance(
  companyId: string,
  destHash: string,
  originVersion: number,
  origin: GeoCoordinates,
  destination: GeoCoordinates,
): Promise<{ distanceM: number; layer: CacheLayer } | null> {
  const cached = await getCachedDistance(companyId, destHash, originVersion);
  if (cached) return { distanceM: cached.result, layer: cached.layer };

  try {
    const distanceM = await fetchOsrmDistance(origin, destination);
    if (distanceM == null) return null;
    await saveCachedDistance(companyId, destHash, originVersion, destination, distanceM, false);
    return { distanceM, layer: 'provider' };
  } catch {
    return null;
  }
}

// ─── Consulta de CEP apenas (sem cotação completa) ──────────────────────────

export async function lookupCepOnly(cep: string): Promise<ViaCepResult | null> {
  const normalized = normalizePostalCode(cep);
  if (!isValidPostalCode(normalized)) return null;

  const cached = await getCachedCep(normalized);
  if (cached) return cached.result;

  try {
    const result = await fetchViaCep(normalized);
    await saveCachedCep(result);
    return result;
  } catch {
    return null;
  }
}

// ─── Store data queries ──────────────────────────────────────────────────────

export type DeliveryStoreData = {
  coordinates: GeoCoordinates | null;
  locationVersion: number;
  ranges: DeliveryRange[];
  enabledViaConfig: boolean;
};

export async function getDeliveryStoreData(empresaId: string): Promise<DeliveryStoreData> {
  const supabase = getServiceSupabase();

  const [perfilRes, rangesRes] = await Promise.all([
    supabase
      .from('empresa_perfil')
      .select('delivery_latitude, delivery_longitude, delivery_location_version, delivery_config')
      .eq('id', empresaId)
      .maybeSingle(),
    supabase
      .from('zelomenu_delivery_ranges')
      .select('max_distance_m, delivery_price')
      .eq('company_id', empresaId)
      .order('max_distance_m', { ascending: true }),
  ]);

  const perfil = perfilRes.data;
  const lat = perfil?.delivery_latitude;
  const lng = perfil?.delivery_longitude;
  const coordinates: GeoCoordinates | null =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? { latitude: Number(lat), longitude: Number(lng) }
      : null;

  const ranges: DeliveryRange[] = (rangesRes.data ?? []).map((r) => ({
    maxDistanceM: r.max_distance_m,
    price: Number(r.delivery_price),
  }));

  const dc = perfil?.delivery_config as { enabled?: boolean } | null;
  const enabledViaConfig = dc?.enabled === true;

  return {
    coordinates,
    locationVersion: Number(perfil?.delivery_location_version ?? 0),
    ranges,
    enabledViaConfig,
  };
}

// ─── Admin: CRUD de faixas ──────────────────────────────────────────────────

export type DeliveryRangeRow = {
  id: string;
  maxDistanceM: number;
  price: number;
};

export async function listDeliveryRanges(empresaId: string): Promise<DeliveryRangeRow[]> {
  const { data } = await getDb()
    .from('zelomenu_delivery_ranges')
    .select('id, max_distance_m, delivery_price')
    .eq('company_id', empresaId)
    .order('max_distance_m', { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id,
    maxDistanceM: r.max_distance_m,
    price: Number(r.delivery_price),
  }));
}

export async function upsertDeliveryRange(
  empresaId: string,
  input: { id?: string | null; maxDistanceM: number; price: number },
): Promise<DeliveryRangeRow> {
  const payload: Record<string, unknown> = {
    company_id: empresaId,
    max_distance_m: Math.round(input.maxDistanceM),
    delivery_price: roundCurrency(input.price),
  };

  if (input.id) {
    await getDb()
      .from('zelomenu_delivery_ranges')
      .update(payload)
      .eq('id', input.id)
      .eq('company_id', empresaId);
    return { id: input.id, maxDistanceM: payload.max_distance_m as number, price: payload.delivery_price as number };
  }

  const { data } = await getDb()
    .from('zelomenu_delivery_ranges')
    .insert(payload)
    .select('id, max_distance_m, delivery_price')
    .single();
  if (!data) throw new Error('COULD_NOT_CREATE_RANGE');
  return { id: data.id, maxDistanceM: data.max_distance_m, price: Number(data.delivery_price) };
}

export async function deleteDeliveryRange(empresaId: string, rangeId: string): Promise<void> {
  await getDb()
    .from('zelomenu_delivery_ranges')
    .delete()
    .eq('id', rangeId)
    .eq('company_id', empresaId);
}

// ─── Admin: store address ───────────────────────────────────────────────────

export type StoreDeliveryAddressData = {
  postalCode: string | null;
  number: string | null;
  complement: string | null;
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  locationVersion: number;
};

export async function getStoreDeliveryAddress(empresaId: string): Promise<StoreDeliveryAddressData> {
  const { data } = await getDb()
    .from('empresa_perfil')
    .select(
      'delivery_postal_code, delivery_number, delivery_complement, delivery_street, delivery_neighborhood, delivery_city, delivery_state, delivery_latitude, delivery_longitude, delivery_location_version',
    )
    .eq('id', empresaId)
    .maybeSingle();

  if (!data) throw new Error('EMPRESA_NOT_FOUND');

  return {
    postalCode: data.delivery_postal_code ?? null,
    number: data.delivery_number ?? null,
    complement: data.delivery_complement ?? null,
    street: data.delivery_street ?? null,
    neighborhood: data.delivery_neighborhood ?? null,
    city: data.delivery_city ?? null,
    state: data.delivery_state ?? null,
    latitude: Number.isFinite(Number(data.delivery_latitude)) ? Number(data.delivery_latitude) : null,
    longitude: Number.isFinite(Number(data.delivery_longitude)) ? Number(data.delivery_longitude) : null,
    locationVersion: Number(data.delivery_location_version ?? 0),
  };
}

export async function updateStoreDeliveryAddress(
  empresaId: string,
  patch: {
    postalCode?: string;
    number?: string;
    complement?: string | null;
    street?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    latitude?: number | null;
    longitude?: number | null;
  },
): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (patch.postalCode !== undefined) updates.delivery_postal_code = patch.postalCode;
  if (patch.number !== undefined) updates.delivery_number = patch.number;
  if (patch.complement !== undefined) updates.delivery_complement = patch.complement;
  if (patch.street !== undefined) updates.delivery_street = patch.street;
  if (patch.neighborhood !== undefined) updates.delivery_neighborhood = patch.neighborhood;
  if (patch.city !== undefined) updates.delivery_city = patch.city;
  if (patch.state !== undefined) updates.delivery_state = patch.state;

  // If coordinates changed, bump location version
  if (patch.latitude !== undefined || patch.longitude !== undefined) {
    updates.delivery_latitude = patch.latitude ?? null;
    updates.delivery_longitude = patch.longitude ?? null;
    updates.delivery_location_version = 0; // will be bumped
  }

  if (Object.keys(updates).length === 0) return;

  // Fetch current version first to bump it
  let newVersion = 1;
  if (patch.latitude !== undefined || patch.longitude !== undefined) {
    const current = await getStoreDeliveryAddress(empresaId);
    newVersion = current.locationVersion + 1;
    updates.delivery_location_version = newVersion;
  }

  await getDb()
    .from('empresa_perfil')
    .update(updates)
    .eq('id', empresaId);
}

// ─── Integração com o carrinho (revalidação do frete) ────────────────────────

export async function revalidateDeliveryForCart(input: {
  empresaId: string;
  postalCode: string;
  number: string;
  complement?: string | null;
}): Promise<{
  fee: number;
  feeToConfirm: boolean;
  detail: DeliveryFulfillmentDetail | null;
}> {
  const storeData = await getDeliveryStoreData(input.empresaId);

  if (!storeData.coordinates || !storeData.ranges.length) {
    return {
      fee: 0,
      feeToConfirm: true,
      detail: null,
    };
  }

  const outcome = await quoteDelivery({
    companyId: input.empresaId,
    postalCode: input.postalCode,
    number: input.number,
    complement: input.complement,
    ranges: storeData.ranges,
    storeCoordinates: storeData.coordinates,
    storeLocationVersion: storeData.locationVersion,
  });

  if (outcome.status === 'eligible') {
    const status: DeliveryStatus = outcome.cacheLayer === 'stale' ? 'eligible_stale' : 'eligible';
    return {
      fee: outcome.quote.fee,
      feeToConfirm: false,
      detail: {
        address: outcome.quote.address,
        coordinates: outcome.quote.coordinates,
        distanceM: outcome.quote.distanceM,
        deliveryFee: outcome.quote.fee,
        status,
        cacheLayer: outcome.cacheLayer,
        quoteRequestId: null,
      },
    };
  }

  return {
    fee: 0,
    feeToConfirm: true,
    detail: {
      address: null,
      coordinates: null,
      distanceM: null,
      deliveryFee: 0,
      status: outcome.status === 'out_of_area' ? 'out_of_area' : 'unavailable',
      cacheLayer: null,
      quoteRequestId: null,
    },
  };
}

// Re-export needed types
export type { DeliveryFulfillmentDetail, DeliveryStatus } from '../src/domain/zelomenuDelivery.js';
export { DELIVERY_STATUS } from '../src/domain/zelomenuDelivery.js';
