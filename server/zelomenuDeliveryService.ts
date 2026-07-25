// ZeloMenu — server-side delivery service (CEP lookup, geocoding, routing, cache).
//
// Todos os provedores externos (ViaCEP, Nominatim, OSRM) são chamados com
// timeout controlado. O cache é consultado antes de qualquer chamada externa.

import { recordCacheHit, recordCircuitBreaker, recordLatency, recordProviderCall, recordQuote } from './deliveryMetrics.js';
import { getServiceSupabase } from './supabaseServer.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizePostalCode,
  isValidPostalCode,
  buildViaCepUrl,
  buildBrasilApiCepUrl,
  buildNominatimUrl,
  buildOsrmUrl,
  hashAddress,
  matchDeliveryRange,
  roundCurrency,
  type DeliveryAddress,
  type DeliveryQuote,
  type DeliveryRange,
  type DeliveryStatus,
  type DeliveryFulfillmentDetail,
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
const HMAC_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!HMAC_SECRET) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for delivery address hashing');

const DELIVERY_ERROR_BACKOFF_MS = 30_000;
const providerCircuits = new Map<string, { failures: number; openUntil: number }>();

class DeliveryProviderUnavailableError extends Error {
  constructor(provider: string, cause?: unknown) {
    super(`DELIVERY_PROVIDER_UNAVAILABLE:${provider}`);
    this.name = 'DeliveryProviderUnavailableError';
    if (cause) this.cause = cause;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));
}

function providerCanRun(provider: string): boolean {
  const circuit = providerCircuits.get(provider);
  if (!circuit) return true;
  if (circuit.openUntil <= Date.now()) {
    providerCircuits.delete(provider);
    recordCircuitBreaker('half-open');
    return true;
  }
  recordCircuitBreaker('open');
  return false;
}

function recordProviderSuccess(provider: string): void {
  providerCircuits.delete(provider);
  recordProviderCall(provider, 'success');
}

function recordProviderFailure(provider: string, result: 'failure' | 'timeout' = 'failure'): void {
  const previous = providerCircuits.get(provider);
  const failures = (previous?.failures ?? 0) + 1;
  providerCircuits.set(provider, {
    failures,
    openUntil: failures >= 3 ? Date.now() + DELIVERY_ERROR_BACKOFF_MS : previous?.openUntil ?? 0,
  });
  recordProviderCall(provider, result);
}

function linkedProviderSignal(parentSignal: AbortSignal | undefined): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  const abortFromParent = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

function deadlineSignal(parentSignal?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOTAL_DEADLINE_MS);
  const abortFromParent = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

async function waitWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DeliveryProviderUnavailableError('deadline'));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
  });
}

// Nominatim's public service requires roughly one request per second. A delay
// inside each request is not enough because concurrent addresses would all
// wake up together; this queue serializes every geocoding call in the process.
let geocodingThrottleTail: Promise<void> = Promise.resolve();
let nextGeocodingAllowedAt = 0;

async function waitForGeocodingSlot(signal?: AbortSignal): Promise<void> {
  const previous = geocodingThrottleTail;
  let release!: () => void;
  geocodingThrottleTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    await waitWithSignal(Math.max(0, nextGeocodingAllowedAt - Date.now()), signal);
    nextGeocodingAllowedAt = Date.now() + GEOCODING_MIN_INTERVAL_MS;
  } finally {
    release();
  }
}

// ─── Cache L1 (memória do processo) ──────────────────────────────────────────

const cepCacheL1 = new Map<string, { result: ViaCepResult; expiresAt: number }>();
const geocodingCacheL1 = new Map<string, { result: GeoCoordinates; expiresAt: number }>();
const distanceCacheL1 = new Map<string, { result: number; expiresAt: number }>();
const cepInFlight = new Map<string, Promise<ViaCepResult>>();
const geocodingInFlight = new Map<string, Promise<GeoCoordinates | null>>();
const distanceInFlight = new Map<string, Promise<number | null>>();

const CACHE_L1_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DELIVERY_STORE_DATA_TTL_MS = Number(process.env.DELIVERY_STORE_DATA_TTL_MS) || 60_000;

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

async function bestEffortWrite(query: PromiseLike<unknown>): Promise<void> {
  try { await query; } catch { /* cache writes never block checkout */ }
}

// ─── ViaCEP ──────────────────────────────────────────────────────────────────

async function fetchViaCep(cep: string, parentSignal?: AbortSignal): Promise<ViaCepResult> {
  if (!providerCanRun('viacep')) throw new DeliveryProviderUnavailableError('viacep');
  const url = buildViaCepUrl(cep);
  const linked = linkedProviderSignal(parentSignal);

  try {
    const response = await fetch(url, { signal: linked.signal });
    if (!response.ok) throw new DeliveryProviderUnavailableError('viacep', new Error(`VIACEP_HTTP_${response.status}`));
    const data = (await response.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (data.erro === true) throw new Error('ADDRESS_INVALID');
    const street = (data.logradouro ?? '').trim();
    const neighborhood = (data.bairro ?? '').trim();
    const city = (data.localidade ?? '').trim();
    const state = (data.uf ?? '').trim();
    if (!city || !state) throw new Error('ADDRESS_INVALID');
    recordProviderSuccess('viacep');
    return { postalCode: cep, street, neighborhood, city, state };
  } catch (error) {
    if (error instanceof Error && error.message === 'ADDRESS_INVALID') throw error;
    recordProviderFailure('viacep', isAbortError(error) || parentSignal?.aborted ? 'timeout' : 'failure');
    if (isAbortError(error) || parentSignal?.aborted) throw new DeliveryProviderUnavailableError('viacep', error);
    if (error instanceof DeliveryProviderUnavailableError) throw error;
    throw new DeliveryProviderUnavailableError('viacep', error);
  } finally {
    linked.dispose();
  }
}

// ─── BrasilAPI (fallback de CEP) ────────────────────────────────────────────

async function fetchBrasilApiCep(cep: string, parentSignal?: AbortSignal): Promise<ViaCepResult> {
  if (!providerCanRun('brasilapi')) throw new DeliveryProviderUnavailableError('brasilapi');
  const url = buildBrasilApiCepUrl(cep);
  const linked = linkedProviderSignal(parentSignal);

  try {
    const response = await fetch(url, { signal: linked.signal });
    if (response.status === 404) throw new Error('ADDRESS_INVALID');
    if (!response.ok) throw new DeliveryProviderUnavailableError('brasilapi', new Error(`BRASILAPI_HTTP_${response.status}`));
    const data = (await response.json()) as { cep?: string; state?: string; city?: string; neighborhood?: string; street?: string };
    const street = (data.street ?? '').trim();
    const neighborhood = (data.neighborhood ?? '').trim();
    const city = (data.city ?? '').trim();
    const state = (data.state ?? '').trim();
    if (!city || !state) throw new Error('ADDRESS_INVALID');
    recordProviderSuccess('brasilapi');
    return { postalCode: cep, street, neighborhood, city, state };
  } catch (error) {
    if (error instanceof Error && error.message === 'ADDRESS_INVALID') throw error;
    recordProviderFailure('brasilapi', isAbortError(error) || parentSignal?.aborted ? 'timeout' : 'failure');
    if (isAbortError(error) || parentSignal?.aborted) throw new DeliveryProviderUnavailableError('brasilapi', error);
    if (error instanceof DeliveryProviderUnavailableError) throw error;
    throw new DeliveryProviderUnavailableError('brasilapi', error);
  } finally {
    linked.dispose();
  }
}

// ─── Geocoding (Nominatim) ──────────────────────────────────────────────────

type GeocodingProviderResult = {
  coordinates: GeoCoordinates;
  provider: string;
};

async function fetchGeocodingResult(address: DeliveryAddress, parentSignal?: AbortSignal): Promise<GeocodingProviderResult | null> {
  const providers = [
    {
      kind: process.env.GEOCODING_PROVIDER || 'nominatim',
      base: process.env.GEOCODING_BASE_URL || 'https://nominatim.openstreetmap.org',
    },
    ...(process.env.GEOCODING_FALLBACK_BASE_URL
      ? [{
        kind: process.env.GEOCODING_FALLBACK_PROVIDER || 'arcgis',
        base: process.env.GEOCODING_FALLBACK_BASE_URL,
      }]
      : []),
  ].filter((provider, index, all) => all.findIndex((candidate) => candidate.base === provider.base) === index);
  let lastError: unknown = null;
  for (const [index, providerConfig] of providers.entries()) {
    const provider = `geocoding_${index === 0 ? 'primary' : 'fallback'}`;
    if (!providerCanRun(provider)) continue;
    const linked = linkedProviderSignal(parentSignal);
    try {
      const requestUrl = providerConfig.kind === 'arcgis'
        ? buildArcgisGeocodingUrl(address, providerConfig.base)
        : buildNominatimUrl(address, providerConfig.base);
      const response = await fetch(requestUrl, {
        signal: linked.signal,
        headers: { 'User-Agent': process.env.GEOCODING_USER_AGENT || 'ZeloMenu/1.0 (contato@zelopdv.com.br)' },
      });
      if (!response.ok) throw new Error(`GEOCODING_HTTP_${response.status}`);
      const data = await response.json() as unknown;
      const coordinates = providerConfig.kind === 'arcgis'
        ? parseArcgisCoordinates(data)
        : parseNominatimCoordinates(data);
      if (!coordinates) {
        recordProviderSuccess(provider);
        continue;
      }
      recordProviderSuccess(provider);
      return { coordinates, provider: providerConfig.kind };
    } catch (error) {
      lastError = error;
      recordProviderFailure(provider, isAbortError(error) || parentSignal?.aborted ? 'timeout' : 'failure');
      if (parentSignal?.aborted) break;
    } finally {
      linked.dispose();
    }
  }
  if (lastError && parentSignal?.aborted) throw new DeliveryProviderUnavailableError('geocoding', lastError);
  if (lastError && providers.length > 0 && providers.every((_, index) => !providerCanRun(`geocoding_${index === 0 ? 'primary' : 'fallback'}`))) {
    throw new DeliveryProviderUnavailableError('geocoding', lastError);
  }
  return null;
}

export async function fetchGeocoding(address: DeliveryAddress, parentSignal?: AbortSignal): Promise<GeoCoordinates | null> {
  const result = await fetchGeocodingResult(address, parentSignal);
  return result?.coordinates ?? null;
}

function parseNominatimCoordinates(data: unknown): GeoCoordinates | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0] as { lat?: string; lon?: string } | undefined;
  return parseCoordinates(Number(first?.lat), Number(first?.lon));
}

function parseArcgisCoordinates(data: unknown): GeoCoordinates | null {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { candidates?: unknown }).candidates)) return null;
  const first = (data as { candidates: Array<{ location?: { x?: number; y?: number } }> }).candidates[0];
  return parseCoordinates(Number(first?.location?.y), Number(first?.location?.x));
}

function parseCoordinates(latitude: number, longitude: number): GeoCoordinates | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return { latitude, longitude };
}

function buildArcgisGeocodingUrl(address: DeliveryAddress, base: string): string {
  const url = new URL(base);
  if (!url.pathname.endsWith('/findAddressCandidates')) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/findAddressCandidates`;
  }
  url.searchParams.set('SingleLine', `${address.street}, ${address.number}, ${address.city}, ${address.state}, Brasil`);
  url.searchParams.set('f', 'json');
  url.searchParams.set('maxLocations', '1');
  url.searchParams.set('outFields', 'Match_addr,Addr_type');
  // ArcGIS' public endpoint is strict about spaces in SingleLine. URLSearchParams
  // serializes them as `+`; encode them as `%20` so Brazilian address queries are
  // interpreted consistently by the provider.
  return `${url.origin}${url.pathname}?${url.searchParams.toString().replace(/\+/g, '%20')}`;
}

// ─── OSRM ────────────────────────────────────────────────────────────────────

async function fetchOsrmDistance(origin: GeoCoordinates, destination: GeoCoordinates, parentSignal?: AbortSignal): Promise<number | null> {
  const bases = [process.env.OSRM_BASE_URL || 'https://router.project-osrm.org', process.env.OSRM_FALLBACK_BASE_URL].filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
  );
  let lastError: unknown = null;
  for (const [index, base] of bases.entries()) {
    const provider = `osrm_${index === 0 ? 'primary' : 'fallback'}`;
    if (!providerCanRun(provider)) continue;
    const linked = linkedProviderSignal(parentSignal);
    try {
      const response = await fetch(buildOsrmUrl(origin, destination, base), { signal: linked.signal });
      if (!response.ok) throw new Error(`OSRM_HTTP_${response.status}`);
      const data = (await response.json()) as { code?: string; routes?: Array<{ distance?: number }> };
      if (data.code !== 'Ok' || !data.routes?.length) {
        recordProviderSuccess(provider);
        continue;
      }
      const distance = data.routes[0]?.distance;
      // A rota entre a loja e o próprio endereço da loja é uma cotação válida:
      // OSRM retorna 0 m e a primeira faixa deve ser aplicada normalmente.
      if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0) throw new Error('OSRM_INVALID_DISTANCE');
      recordProviderSuccess(provider);
      return Math.round(distance);
    } catch (error) {
      lastError = error;
      recordProviderFailure(provider, isAbortError(error) || parentSignal?.aborted ? 'timeout' : 'failure');
      if (parentSignal?.aborted) break;
    } finally {
      linked.dispose();
    }
  }
  if (lastError && parentSignal?.aborted) throw new DeliveryProviderUnavailableError('osrm', lastError);
  if (lastError && bases.length > 0 && bases.every((_, index) => !providerCanRun(`osrm_${index}`))) {
    throw new DeliveryProviderUnavailableError('osrm', lastError);
  }
  return null;
}

// ─── Cache L2 (Supabase) ────────────────────────────────────────────────────

type CacheLayer = 'none' | 'memory' | 'supabase' | 'provider' | 'stale';

async function getCachedCep(cep: string): Promise<{ result: ViaCepResult; layer: CacheLayer } | null> {
  const l1 = getCachedL1(cepCacheL1, cep);
  if (l1) { recordCacheHit('memory'); return { result: l1, layer: 'memory' }; }

  let data: { street: string; neighborhood: string; city: string; state: string; expires_at: string } | null = null;
  try {
    const response = await getDb()
      .from('zelomenu_delivery_cep_cache')
      .select('street, neighborhood, city, state, expires_at')
      .eq('postal_code', cep)
      .maybeSingle();
    if (response.error) return null;
    data = response.data;
  } catch {
    return null;
  }

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
  recordCacheHit('supabase');
  return { result, layer: 'supabase' };
}

async function saveCachedCep(result: ViaCepResult): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 86400000).toISOString();
  await bestEffortWrite(getDb()
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
    ));
  setCachedL1(cepCacheL1, result.postalCode, result);
}

async function getCachedGeocoding(addressHash: string): Promise<{ result: GeoCoordinates; layer: CacheLayer } | null> {
  // L1
  const l1 = getCachedL1(geocodingCacheL1, addressHash);
  if (l1) return { result: l1, layer: 'memory' };

  // L2
  let data: { latitude: number; longitude: number; expires_at: string } | null = null;
  try {
    const response = await getDb()
      .from('zelomenu_delivery_geocoding_cache')
      .select('latitude, longitude, expires_at')
      .eq('address_hash', addressHash)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (response.error) return null;
    data = response.data;
  } catch {
    return null;
  }

  if (!data) return null;
  if (data.expires_at < new Date().toISOString()) return null;

  const coords: GeoCoordinates = { latitude: data.latitude, longitude: data.longitude };
  setCachedL1(geocodingCacheL1, addressHash, coords);
  return { result: coords, layer: 'supabase' };
}

async function saveCachedGeocoding(addressHash: string, postalCode: string, number: string, coords: GeoCoordinates, provider: string): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 86400000).toISOString();
  await bestEffortWrite(getDb()
    .from('zelomenu_delivery_geocoding_cache')
    .upsert(
      {
        address_hash: addressHash,
        postal_code: postalCode,
        number,
        latitude: coords.latitude,
        longitude: coords.longitude,
        provider,
        expires_at: expiresAt,
      },
      { onConflict: 'address_hash,provider' },
    ));
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
  let data: { distance_m: number; is_stale: boolean; expires_at: string } | null = null;
  try {
    const response = await getDb()
      .from('zelomenu_delivery_distance_cache')
      .select('distance_m, is_stale, expires_at')
      .eq('company_id', companyId)
      .eq('destination_address_hash', destHash)
      .eq('origin_location_version', originVersion)
      .maybeSingle();
    if (response.error) return null;
    data = response.data;
  } catch {
    return null;
  }

  if (!data) return null;

  const now = new Date().toISOString();
  if (data.expires_at >= now) {
    setCachedL1(distanceCacheL1, cacheKey, data.distance_m);
    return { result: data.distance_m, layer: data.is_stale ? 'stale' : 'supabase' };
  }

  const staleUntil = Date.parse(data.expires_at) + STALE_MAX_DAYS * 86400000;
  if (Date.now() <= staleUntil) {
    setCachedL1(distanceCacheL1, cacheKey, data.distance_m);
    return { result: data.distance_m, layer: 'stale' };
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
  await bestEffortWrite(getDb()
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
    ));
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
  const deadline = deadlineSignal(input.signal);
  const start = performance.now();
  try {
  const cep = normalizePostalCode(input.postalCode);
  if (!isValidPostalCode(cep)) { recordQuote('address_invalid'); return { status: 'address_invalid', reason: 'CEP inválido' }; }
  if (!input.ranges.length) { recordQuote('store_not_configured'); return { status: 'store_not_configured', reason: 'no_ranges' }; }

  const number = input.number.trim();
  if (!number) { recordQuote('address_invalid'); return { status: 'address_invalid', reason: 'Número obrigatório' }; }

  // 1. CEP lookup
  const cepResult = await resolveCep(cep, deadline.signal);
  if (!cepResult) { recordQuote('address_invalid'); return { status: 'address_invalid', reason: 'CEP não encontrado' }; }

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
    recordQuote('store_not_configured');
    return { status: 'store_not_configured', reason: 'store_address_missing' };
  }

  // 3. Geocoding do endereço do cliente
  const addressHash = await hashAddress(cep, number, HMAC_SECRET);
  const geoResult = await resolveGeocoding(addressHash, address, deadline.signal);

  if (!geoResult) {
    recordQuote('unavailable');
    return { status: 'unavailable', reason: 'Endereço não encontrado no geocoding' };
  }

  const { coordinates } = geoResult;

  // 4. Distância da rota
  const distResult = await resolveDistance(
    input.companyId,
    addressHash,
    input.storeLocationVersion,
    input.storeCoordinates,
    coordinates,
    deadline.signal,
  );

  if (distResult == null) {
    recordQuote('unavailable');
    return { status: 'unavailable', reason: 'Não foi possível calcular a rota' };
  }

  const { distanceM, layer: distLayer } = distResult;

  // 5. Match faixa
  const match = matchDeliveryRange({ distanceM, ranges: input.ranges });
  if (!match.matched) {
    recordQuote('out_of_area');
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

  recordQuote('eligible');
  return { status: 'eligible', quote, cacheLayer: layer };
  } catch (error) {
    if (error instanceof Error && error.message === 'ADDRESS_INVALID') {
      recordQuote('address_invalid');
      return { status: 'address_invalid', reason: 'CEP não encontrado' };
    }
    const reason = error instanceof DeliveryProviderUnavailableError
      ? (deadline.signal.aborted ? 'deadline_exceeded' : error.message.replace('DELIVERY_PROVIDER_UNAVAILABLE:', ''))
      : 'quote_unavailable';
    recordQuote('unavailable');
    return { status: 'unavailable', reason };
  } finally {
    const elapsed = performance.now() - start;
    recordLatency(Math.round(elapsed));
    deadline.dispose();
  }
}

// ─── Helpers internos ────────────────────────────────────────────────────────

async function resolveCep(cep: string, signal?: AbortSignal): Promise<ViaCepResult | null> {
  const cached = await getCachedCep(cep);
  if (cached) return cached.result;

  const existing = cepInFlight.get(cep);
  if (existing) return existing;

  const request = (async () => {
    try {
      const result = await fetchViaCep(cep, signal);
      await saveCachedCep(result);
      return result;
    } catch (firstError) {
      // If ViaCEP fails, try BrasilAPI as fallback
      try {
        const result = await fetchBrasilApiCep(cep, signal);
        await saveCachedCep(result);
        return result;
      } catch {
        throw firstError;
      }
    }
  })().finally(() => cepInFlight.delete(cep));

  cepInFlight.set(cep, request);
  return request;
}

async function resolveGeocoding(
  addressHash: string,
  address: DeliveryAddress,
  signal?: AbortSignal,
): Promise<{ coordinates: GeoCoordinates; layer: CacheLayer } | null> {
  const cached = await getCachedGeocoding(addressHash);
  if (cached) return { coordinates: cached.result, layer: cached.layer };

  // Rate limiting básico
  const existing = geocodingInFlight.get(addressHash);
  if (existing) {
    const coordinates = await existing;
    return coordinates ? { coordinates, layer: 'provider' } : null;
  }
  const request = (async () => {
    await waitForGeocodingSlot(signal);
    const result = await fetchGeocodingResult(address, signal);
    if (result) await saveCachedGeocoding(addressHash, address.postalCode, address.number, result.coordinates, result.provider);
    return result?.coordinates ?? null;
  })().finally(() => geocodingInFlight.delete(addressHash));
  geocodingInFlight.set(addressHash, request);
  const coords = await request;
  return coords ? { coordinates: coords, layer: 'provider' } : null;
}

/**
 * Resolve the store origin through the same cache-first path used by checkout.
 * Admin geocoding must not bypass L1/L2, otherwise returning to a previously
 * configured address would unnecessarily call an external provider again.
 */
export async function resolveDeliveryStoreGeocoding(address: DeliveryAddress): Promise<GeoCoordinates | null> {
  const postalCode = normalizePostalCode(address.postalCode);
  const addressHash = await hashAddress(postalCode, address.number.trim(), HMAC_SECRET);
  const result = await resolveGeocoding(addressHash, { ...address, postalCode, number: address.number.trim() });
  return result?.coordinates ?? null;
}

async function resolveDistance(
  companyId: string,
  destHash: string,
  originVersion: number,
  origin: GeoCoordinates,
  destination: GeoCoordinates,
  signal?: AbortSignal,
): Promise<{ distanceM: number; layer: CacheLayer } | null> {
  const cached = await getCachedDistance(companyId, destHash, originVersion);
  if (cached) return { distanceM: cached.result, layer: cached.layer };

  const cacheKey = `${companyId}:${destHash}:${originVersion}`;
  const existing = distanceInFlight.get(cacheKey);
  if (existing) {
    const distanceM = await existing;
    return distanceM == null ? null : { distanceM, layer: 'provider' };
  }
  const request = fetchOsrmDistance(origin, destination, signal)
    .then(async (distanceM) => {
      if (distanceM == null) return null;
      await saveCachedDistance(companyId, destHash, originVersion, destination, distanceM, false);
      return distanceM;
    })
    .finally(() => distanceInFlight.delete(cacheKey));
  distanceInFlight.set(cacheKey, request);
  const distanceM = await request;
  return distanceM == null ? null : { distanceM, layer: 'provider' };
}

// ─── Consulta de CEP apenas (sem cotação completa) ──────────────────────────

export async function lookupCepOnly(cep: string): Promise<ViaCepResult | null> {
  const normalized = normalizePostalCode(cep);
  if (!isValidPostalCode(normalized)) return null;

  const cached = await getCachedCep(normalized);
  if (cached) return cached.result;

  try {
    return await resolveCep(normalized);
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

const deliveryStoreDataL1 = new Map<string, { result: DeliveryStoreData; expiresAt: number }>();
const deliveryStoreDataInFlight = new Map<string, Promise<DeliveryStoreData>>();

function invalidateDeliveryStoreData(empresaId: string): void {
  deliveryStoreDataL1.delete(empresaId);
}

export async function getDeliveryStoreData(empresaId: string): Promise<DeliveryStoreData> {
  const cached = deliveryStoreDataL1.get(empresaId);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) deliveryStoreDataL1.delete(empresaId);

  const inFlight = deliveryStoreDataInFlight.get(empresaId);
  if (inFlight) return inFlight;

  const request = (async () => {
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

  if (perfilRes.error) throw perfilRes.error;
  if (rangesRes.error) throw rangesRes.error;

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

  const result = {
    coordinates,
    locationVersion: Number(perfil?.delivery_location_version ?? 0),
    ranges,
    enabledViaConfig,
  };
  deliveryStoreDataL1.set(empresaId, { result, expiresAt: Date.now() + DELIVERY_STORE_DATA_TTL_MS });
  return result;
  })().finally(() => deliveryStoreDataInFlight.delete(empresaId));
  deliveryStoreDataInFlight.set(empresaId, request);
  return request;
}

// ─── Admin: CRUD de faixas ──────────────────────────────────────────────────

export type DeliveryRangeRow = {
  id: string;
  maxDistanceM: number;
  price: number;
};

export async function listDeliveryRanges(empresaId: string): Promise<DeliveryRangeRow[]> {
  const { data, error } = await getDb()
    .from('zelomenu_delivery_ranges')
    .select('id, max_distance_m, delivery_price')
    .eq('company_id', empresaId)
    .order('max_distance_m', { ascending: true });
  if (error) throw error;
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
    invalidateDeliveryStoreData(empresaId);
    return { id: input.id, maxDistanceM: payload.max_distance_m as number, price: payload.delivery_price as number };
  }

  const { data } = await getDb()
    .from('zelomenu_delivery_ranges')
    .insert(payload)
    .select('id, max_distance_m, delivery_price')
    .single();
  if (!data) throw new Error('COULD_NOT_CREATE_RANGE');
  invalidateDeliveryStoreData(empresaId);
  return { id: data.id, maxDistanceM: data.max_distance_m, price: Number(data.delivery_price) };
}

export async function deleteDeliveryRange(empresaId: string, rangeId: string): Promise<void> {
  await getDb()
    .from('zelomenu_delivery_ranges')
    .delete()
    .eq('id', rangeId)
    .eq('company_id', empresaId);
  invalidateDeliveryStoreData(empresaId);
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
  const { data, error } = await getDb()
    .from('empresa_perfil')
    .select(
      'delivery_postal_code, delivery_number, delivery_complement, delivery_street, delivery_neighborhood, delivery_city, delivery_state, delivery_latitude, delivery_longitude, delivery_location_version',
    )
    .eq('id', empresaId)
    .maybeSingle();

  if (error) throw error;
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

  const { error } = await getDb()
    .from('empresa_perfil')
    .update(updates)
    .eq('id', empresaId);
  if (error) throw error;
  invalidateDeliveryStoreData(empresaId);
}

export async function saveDeliverySettings(
  empresaId: string,
  input: { enabled: boolean; address: Record<string, unknown>; ranges: Array<{ maxDistanceM: number; price: number }> },
): Promise<void> {
  const address = input.address;
  const postalCode = normalizePostalCode(String(address.postalCode ?? ''));
  const latitude = Number(address.latitude);
  const longitude = Number(address.longitude);
  const uniqueDistances = new Set<number>();
  if (input.enabled && (
    !isValidPostalCode(postalCode)
    || !String(address.number ?? '').trim()
    || !String(address.street ?? '').trim()
    || !String(address.city ?? '').trim()
    || !/^[A-Za-z]{2}$/.test(String(address.state ?? '').trim())
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
  )) throw new Error('DELIVERY_CONFIGURATION_INVALID');
  const ranges = input.ranges.map((range) => ({
    maxDistanceM: Math.round(Number(range.maxDistanceM)),
    price: roundCurrency(Number(range.price)),
  }));
  if (input.enabled && ranges.length === 0) throw new Error('DELIVERY_CONFIGURATION_INVALID');
  for (const range of ranges) {
    if (!Number.isFinite(range.maxDistanceM) || range.maxDistanceM <= 0 || !Number.isFinite(range.price) || range.price < 0 || uniqueDistances.has(range.maxDistanceM)) {
      throw new Error('DELIVERY_CONFIGURATION_INVALID');
    }
    uniqueDistances.add(range.maxDistanceM);
  }
  const { error } = await getDb().rpc('save_zelomenu_delivery_settings', {
    p_empresa_id: empresaId,
    p_enabled: Boolean(input.enabled),
    p_address: input.address,
    p_ranges: ranges,
  });
  if (error) throw new Error(error.message.includes('DELIVERY_CONFIGURATION_INVALID') ? 'DELIVERY_CONFIGURATION_INVALID' : 'DELIVERY_SETTINGS_SAVE_FAILED');
  invalidateDeliveryStoreData(empresaId);
}

export type DeliveryQuoteRequest = {
  id: string;
  companyId: string;
  sessionId: string;
  idempotencyKey: string;
  status: 'pending' | 'resolved' | 'expired' | 'cancelled';
  reasonCode: string;
  createdAt: string;
  expiresAt: string;
};

function mapQuoteRequest(row: Record<string, unknown>): DeliveryQuoteRequest {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    sessionId: String(row.session_id),
    idempotencyKey: String(row.idempotency_key),
    status: row.status as DeliveryQuoteRequest['status'],
    reasonCode: String(row.reason_code),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
  };
}

export async function findDeliveryQuoteRequest(sessionId: string, idempotencyKey: string): Promise<DeliveryQuoteRequest | null> {
  const { data, error } = await getDb()
    .from('zelomenu_delivery_quote_requests')
    .select('id, company_id, session_id, idempotency_key, status, reason_code, created_at, expires_at')
    .eq('session_id', sessionId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data ? mapQuoteRequest(data as Record<string, unknown>) : null;
}

export async function listPendingDeliveryQuoteRequests(empresaId: string): Promise<DeliveryQuoteRequest[]> {
  const { data, error } = await getDb()
    .from('zelomenu_delivery_quote_requests')
    .select('id, company_id, session_id, idempotency_key, status, reason_code, created_at, expires_at')
    .eq('company_id', empresaId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => mapQuoteRequest(row as Record<string, unknown>));
}

export async function createDeliveryQuoteRequest(input: {
  companyId: string;
  sessionId: string;
  idempotencyKey: string;
  reasonCode: string;
  customer: unknown;
  cart: unknown;
  fulfillment: unknown;
  pricing: unknown;
}): Promise<DeliveryQuoteRequest> {
  const { data, error } = await getDb()
    .from('zelomenu_delivery_quote_requests')
    .upsert({
      company_id: input.companyId,
      session_id: input.sessionId,
      idempotency_key: input.idempotencyKey,
      reason_code: input.reasonCode,
      customer_snapshot: input.customer,
      cart_snapshot: input.cart,
      fulfillment_snapshot: input.fulfillment,
      pricing_snapshot: input.pricing,
    }, { onConflict: 'session_id,idempotency_key' })
    .select('id, company_id, session_id, idempotency_key, status, reason_code, created_at, expires_at')
    .single();
  if (error || !data) throw error ?? new Error('DELIVERY_QUOTE_REQUEST_SAVE_FAILED');
  return mapQuoteRequest(data as Record<string, unknown>);
}

// ─── Administração da fila de cotação pendente ──────────────────────────────

export type DeliveryQuoteRequestDetail = DeliveryQuoteRequest & {
  customer: unknown;
  cart: unknown;
  fulfillment: unknown;
  pricing: unknown;
  lastError: unknown;
  resolvedFee: number | null;
  resolvedAt: string | null;
};

export async function getDeliveryQuoteRequestById(
  empresaId: string,
  requestId: string,
): Promise<DeliveryQuoteRequestDetail | null> {
  const { data, error } = await getDb()
    .from('zelomenu_delivery_quote_requests')
    .select('*')
    .eq('id', requestId)
    .eq('company_id', empresaId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    sessionId: String(row.session_id),
    idempotencyKey: String(row.idempotency_key),
    status: row.status as DeliveryQuoteRequest['status'],
    reasonCode: String(row.reason_code),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    customer: row.customer_snapshot,
    cart: row.cart_snapshot,
    fulfillment: row.fulfillment_snapshot,
    pricing: row.pricing_snapshot,
    lastError: row.last_error,
    resolvedFee: row.resolved_fee != null ? Number(row.resolved_fee) : null,
    resolvedAt: row.resolved_at != null ? String(row.resolved_at) : null,
  };
}

async function resolveQuoteRequestAndSession(
  empresaId: string,
  requestId: string,
  fee: number,
  resolvedSnapshot: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await getDb().rpc('resolve_zelomenu_delivery_quote_request', {
    p_company_id: empresaId,
    p_request_id: requestId,
    p_fee: roundCurrency(fee),
    p_resolved_snapshot: resolvedSnapshot,
  });
  if (error) {
    if (error.message.includes('QUOTE_REQUEST_NOT_PENDING')) throw new Error('QUOTE_REQUEST_NOT_PENDING');
    if (error.message.includes('CART_SESSION_NOT_OPEN')) throw new Error('CART_SESSION_NOT_OPEN');
    if (error.message.includes('INVALID_FEE')) throw new Error('INVALID_FEE');
    throw error;
  }
  if (!data) throw new Error('DELIVERY_QUOTE_RESOLUTION_FAILED');
}

/**
 * Retry a pending quote request: recalculate the delivery fee against current
 * store configuration. If successful, marks the request as resolved with the
 * new fee. If still unavailable, saves the error for operator visibility.
 */
export async function retryDeliveryQuoteRequest(
  empresaId: string,
  requestId: string,
): Promise<{ ok: boolean; fee?: number; distanceM?: number; error?: string }> {
  const request = await getDeliveryQuoteRequestById(empresaId, requestId);
  if (!request) throw new Error('QUOTE_REQUEST_NOT_FOUND');
  if (request.status !== 'pending') throw new Error('QUOTE_REQUEST_NOT_PENDING');

  const fulfillment = request.fulfillment as { deliveryPostalCode?: string; deliveryNumber?: string; deliveryComplement?: string } | null;
  const postalCode = fulfillment?.deliveryPostalCode ?? '';
  const number = fulfillment?.deliveryNumber ?? '';
  if (!postalCode || !number) {
    throw new Error('QUOTE_REQUEST_MISSING_ADDRESS');
  }

  const storeData = await getDeliveryStoreData(empresaId);
  if (!storeData.coordinates || !storeData.ranges.length) {
    const { error: saveError } = await getDb()
      .from('zelomenu_delivery_quote_requests')
      .update({ last_error: { code: 'store_not_ready', message: 'Loja sem coordenadas ou faixas configuradas.' }, updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('company_id', empresaId);
    if (saveError) throw saveError;
    return { ok: false, error: 'store_not_ready' };
  }

  const outcome = await quoteDelivery({
    companyId: empresaId,
    postalCode,
    number,
    complement: fulfillment?.deliveryComplement ?? null,
    ranges: storeData.ranges,
    storeCoordinates: storeData.coordinates,
    storeLocationVersion: storeData.locationVersion,
  });

  if (outcome.status === 'eligible') {
    const resolvedSnapshot = {
      fee: outcome.quote.fee,
      distanceM: outcome.quote.distanceM,
      address: outcome.quote.address,
      coordinates: outcome.quote.coordinates,
      cacheLayer: outcome.cacheLayer,
    };
    await resolveQuoteRequestAndSession(empresaId, requestId, outcome.quote.fee, resolvedSnapshot);
    return { ok: true, fee: outcome.quote.fee, distanceM: outcome.quote.distanceM };
  }

  // Still unavailable — record the error
  const errorInfo = { status: outcome.status, reason: 'reason' in outcome ? outcome.reason : 'unknown' };
  await bestEffortWrite(getDb()
    .from('zelomenu_delivery_quote_requests')
    .update({ last_error: errorInfo, updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('company_id', empresaId));
  return { ok: false, error: outcome.status };
}

/**
 * Resolve a pending quote request manually with a specific fee.
 */
export async function resolveDeliveryQuoteRequest(
  empresaId: string,
  requestId: string,
  fee: number,
): Promise<void> {
  const request = await getDeliveryQuoteRequestById(empresaId, requestId);
  if (!request) throw new Error('QUOTE_REQUEST_NOT_FOUND');
  if (request.status !== 'pending') throw new Error('QUOTE_REQUEST_NOT_PENDING');
  if (!Number.isFinite(fee) || fee < 0) throw new Error('INVALID_FEE');

  await resolveQuoteRequestAndSession(empresaId, requestId, fee, { fee: roundCurrency(fee), manual: true });
}

/**
 * Cancel a pending quote request.
 */
export async function cancelDeliveryQuoteRequest(
  empresaId: string,
  requestId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await getDb()
    .from('zelomenu_delivery_quote_requests')
    .update({
      status: 'cancelled',
      last_error: { code: 'cancelled_by_operator', message: 'Cancelado pelo operador.' },
      updated_at: now,
    })
    .eq('id', requestId)
    .eq('company_id', empresaId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (data) return;

  const existing = await getDeliveryQuoteRequestById(empresaId, requestId);
  if (!existing) throw new Error('QUOTE_REQUEST_NOT_FOUND');
  throw new Error('QUOTE_REQUEST_NOT_PENDING');
}

// ─── Health check ───────────────────────────────────────────────────────────

export type DeliveryHealthStatus = {
  supabase: 'ok' | 'error';
  circuits: Record<string, { state: 'open' | 'closed' | 'half-open'; failures: number; opensInMs: number | null }>;
  pendingRequests: number;
  oldestPendingMs: number | null;
};

export async function getDeliveryHealth(empresaId: string): Promise<DeliveryHealthStatus> {
  // Check Supabase connectivity
  let supabase: 'ok' | 'error' = 'ok';
  try {
    const { error } = await getDb().from('zelomenu_delivery_cep_cache').select('postal_code').limit(1);
    if (error) supabase = 'error';
  } catch { supabase = 'error'; }

  // Circuit breaker state
  const circuits: DeliveryHealthStatus['circuits'] = {};
  const now = Date.now();
  for (const [provider, circuit] of providerCircuits) {
    const isOpen = circuit.openUntil > now;
    circuits[provider] = {
      state: isOpen ? 'open' : circuit.failures >= 3 ? 'half-open' : 'closed',
      failures: circuit.failures,
      opensInMs: isOpen ? circuit.openUntil - now : null,
    };
  }

  // Pending requests count and age
  let pendingRequests = 0;
  let oldestPendingMs: number | null = null;
  try {
    const { data, error } = await getDb()
      .from('zelomenu_delivery_quote_requests')
      .select('created_at')
      .eq('company_id', empresaId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (!error && data) {
      pendingRequests = data.length;
      if (data.length > 0) oldestPendingMs = now - new Date(String(data[0].created_at)).getTime();
    }
  } catch { /* use defaults */ }

  return { supabase, circuits, pendingRequests, oldestPendingMs };
}

// ─── Cleanup de solicitações expiradas ──────────────────────────────────────

export async function expireStaleQuoteRequests(empresaId: string): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await getDb()
    .from('zelomenu_delivery_quote_requests')
    .update({
      status: 'expired',
      last_error: { code: 'expired', message: 'Solicitação expirada automaticamente.' },
      updated_at: now,
    })
    .eq('company_id', empresaId)
    .eq('status', 'pending')
    .lt('expires_at', now)
    .select('id');
  if (error) throw error;
  return (data as Array<Record<string, unknown>>)?.length ?? 0;
}

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
      detail: {
        address: null,
        coordinates: null,
        distanceM: null,
        deliveryFee: 0,
        status: 'unavailable',
        cacheLayer: null,
        quoteRequestId: null,
      },
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
      status: outcome.status === 'out_of_area' ? 'out_of_area' : outcome.status === 'address_invalid' ? 'pending' : 'unavailable',
      cacheLayer: null,
      quoteRequestId: null,
    },
  };
}

// Re-export needed types
export type { DeliveryFulfillmentDetail, DeliveryStatus } from '../src/domain/zelomenuDelivery.js';
export { DELIVERY_STATUS } from '../src/domain/zelomenuDelivery.js';
