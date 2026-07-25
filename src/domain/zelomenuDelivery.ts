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
  /** Modo de precificação aplicado (quando há regras de horário) */
  deliveryPricingMode?: 'standard' | 'custom_time';
  /** Label da regra ativa (se houver) */
  deliveryPricingRuleLabel?: string | null;
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
  /** Modo de precificação aplicado (preenchido quando há regras de horário) */
  pricingMode?: 'standard' | 'custom_time';
  /** ID da regra ativa (se houver) */
  pricingRuleId?: string | null;
  /** Label da regra ativa (se houver) */
  pricingRuleLabel?: string | null;
  /** Versão do pricing no momento da cotação */
  pricingVersion?: number;
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

export function buildBrasilApiCepUrl(cep: string): string {
  const base = process.env.BRASILAPI_CEP_BASE_URL || 'https://brasilapi.com.br';
  return `${base}/api/cep/v1/${cep}`;
}

export type DeliveryGeocodingProviderConfig = {
  kind: string;
  base: string;
};

export function buildGeocodingProviderConfigs(options: {
  primaryKind?: string;
  primaryBase?: string;
  fallbackKind?: string;
  fallbackBase?: string;
} = {}): DeliveryGeocodingProviderConfig[] {
  const providers = [
    {
      kind: options.primaryKind?.trim() || 'nominatim',
      base: options.primaryBase?.trim() || 'https://nominatim.openstreetmap.org',
    },
    {
      kind: options.fallbackKind?.trim() || 'arcgis',
      base: options.fallbackBase?.trim() || 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer',
    },
  ];
  return providers.filter((provider, index, all) => all.findIndex((candidate) => candidate.base === provider.base) === index);
}

export function buildNominatimUrl(address: DeliveryAddress, base = process.env.GEOCODING_BASE_URL || 'https://nominatim.openstreetmap.org'): string {
  const q = encodeURIComponent(`${address.street}, ${address.number} - ${address.neighborhood}, ${address.city}, ${address.state}, Brasil`);
  return `${base}/search?q=${q}&format=json&limit=1&countrycodes=br`;
}

export function buildOsrmUrl(origin: GeoCoordinates, destination: GeoCoordinates, base = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org'): string {
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

// ─── Custom time pricing ──────────────────────────────────────────────────────

export type PricingRulePriceEntry = {
  maxDistanceM: number;
  price: number;
};

export type DeliveryPricingRule = {
  id?: string;
  label: string;
  startMinute: number;
  endMinute: number;
  enabled: boolean;
  daysOfWeek: number[];
  pricesByDistance: PricingRulePriceEntry[];
};

export type DeliveryPricingResolution = {
  mode: 'standard' | 'custom_time';
  ruleId: string | null;
  ruleLabel: string | null;
  baseFee: number;
  resolvedFee: number;
  quotedAt: string;
  timezone: string;
  pricingVersion: number;
};

/**
 * Verifica se um minuto está dentro de um intervalo, suportando crossing de meia-noite.
 * Início inclusivo, fim exclusivo.
 */
export function minuteInPricingInterval(startMinute: number, endMinute: number, currentMinute: number): boolean {
  if (startMinute === endMinute) return false;
  if (startMinute < endMinute) return currentMinute >= startMinute && currentMinute < endMinute;
  return currentMinute >= startMinute || currentMinute < endMinute;
}

/**
 * Encontra a primeira regra ativa para o minuto/dia da semana informados.
 * Retorna null se nenhuma regra ativa corresponder.
 */
export function findActiveDeliveryPricingRule(
  rules: DeliveryPricingRule[],
  localMinute: number,
  dayOfWeek: number,
): DeliveryPricingRule | null {
  return rules.find(
    (rule) =>
      rule.enabled
      && rule.daysOfWeek.includes(dayOfWeek)
      && minuteInPricingInterval(rule.startMinute, rule.endMinute, localMinute),
  ) ?? null;
}

/**
 * Resolve o preço de entrega considerando regras de horário personalizado.
 * Se nenhuma regra ativa for encontrada, usa o preço padrão da faixa.
 */
export function resolveDeliveryPrice(input: {
  rules: DeliveryPricingRule[];
  ranges: DeliveryRange[];
  distanceM: number;
  localMinute: number;
  dayOfWeek: number;
  timezone: string;
  pricingVersion: number;
}): DeliveryPricingResolution {
  const { rules, ranges, distanceM, localMinute, dayOfWeek, timezone, pricingVersion } = input;
  const quotedAt = new Date().toISOString();

  const rangeMatch = matchDeliveryRange({ distanceM, ranges });
  if (!rangeMatch.matched) {
    return {
      mode: 'standard',
      ruleId: null,
      ruleLabel: null,
      baseFee: 0,
      resolvedFee: 0,
      quotedAt,
      timezone,
      pricingVersion,
    };
  }

  const baseFee = rangeMatch.fee;
  const activeRule = findActiveDeliveryPricingRule(rules, localMinute, dayOfWeek);

  if (!activeRule) {
    return {
      mode: 'standard',
      ruleId: null,
      ruleLabel: null,
      baseFee,
      resolvedFee: baseFee,
      quotedAt,
      timezone,
      pricingVersion,
    };
  }

  const rulePrice = activeRule.pricesByDistance.find(
    (entry) => entry.maxDistanceM === rangeMatch.range.maxDistanceM,
  );

  const resolvedFee = rulePrice != null ? roundCurrency(rulePrice.price) : baseFee;

  return {
    mode: rulePrice != null ? 'custom_time' : 'standard',
    ruleId: activeRule.id ?? null,
    ruleLabel: rulePrice != null ? activeRule.label : null,
    baseFee,
    resolvedFee,
    quotedAt,
    timezone,
    pricingVersion,
  };
}

const DAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Obtém o minuto local e dia da semana em um fuso horário específico.
 */
export function getLocalDateTimeParts(timezone: string, referenceDate?: Date): { localMinute: number; dayOfWeek: number } {
  const date = referenceDate ?? new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value) || 0;
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';

  return {
    localMinute: get('hour') * 60 + get('minute'),
    dayOfWeek: DAY_SHORT_NAMES.indexOf(weekday),
  };
}

/**
 * Interpreta uma data/hora civil já expressa no fuso da loja.
 *
 * Não converta este valor com `new Date('YYYY-MM-DDTHH:mm')`: esse formato
 * usa o timezone do processo Node e pode deslocar o horário quando o servidor
 * está em UTC e a loja está em outro fuso.
 */
export function getLocalDateTimePartsFromCivil(
  dateValue: string,
  timeValue: string,
): { localMinute: number; dayOfWeek: number } | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue.trim());
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;

  return {
    localMinute: hour * 60 + minute,
    dayOfWeek: date.getUTCDay(),
  };
}

const MINUTES_IN_DAY = 1440;

/**
 * Formata um intervalo de minutos como rótulo legível.
 * Ex: (1200, 120) → "20:00 às 02:00 · termina no dia seguinte"
 */
export function formatPricingWindowLabel(startMinute: number, endMinute: number): string {
  const fmt = (m: number) => {
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  };

  const crossesMidnight = startMinute >= endMinute;
  const endLabel = endMinute === MINUTES_IN_DAY ? '00:00' : fmt(endMinute);
  const suffix = crossesMidnight ? ' · termina no dia seguinte' : '';

  return `${fmt(startMinute)} às ${endLabel}${suffix}`;
}

/**
 * Retorna os segmentos visuais de um intervalo para exibição na timeline de 24h.
 * Quebra em segmentos separados se cruzar meia-noite.
 */
export function pricingIntervalSegments(startMinute: number, endMinute: number): Array<{ startMinute: number; endMinute: number }> {
  if (startMinute < endMinute) return [{ startMinute, endMinute }];
  // crosses midnight: split into two segments
  return [
    { startMinute, endMinute: MINUTES_IN_DAY },
    { startMinute: 0, endMinute },
  ];
}

/**
 * Valida um conjunto de regras de preço.
 * Retorna null se válido, ou uma mensagem de erro.
 */
export function validateDeliveryPricingRules(
  rules: DeliveryPricingRule[],
  ranges: DeliveryRange[],
): string | null {
  if (rules.length === 0) return null;

  const validDistances = new Set(ranges.map((r) => r.maxDistanceM));

  for (const rule of rules) {
    if (!rule.label.trim()) return 'Informe um nome para o horário.';

    if (!Number.isFinite(rule.startMinute) || rule.startMinute < 0 || rule.startMinute >= MINUTES_IN_DAY) {
      return 'Horário de início inválido.';
    }
    if (!Number.isFinite(rule.endMinute) || rule.endMinute < 0 || rule.endMinute > MINUTES_IN_DAY) {
      return 'Horário de fim inválido.';
    }
    if (rule.startMinute === rule.endMinute) return 'O início e fim do horário não podem ser iguais.';

    if (!rule.daysOfWeek.length) return 'Selecione pelo menos um dia da semana.';
    if (rule.daysOfWeek.some((d) => d < 0 || d > 6)) return 'Dia da semana inválido.';

    if (!rule.pricesByDistance.length) return 'Informe um preço para cada faixa.';

    for (const entry of rule.pricesByDistance) {
      if (!validDistances.has(entry.maxDistanceM)) return 'Distância inválida para uma das faixas.';
      if (!Number.isFinite(entry.price) || entry.price < 0) return 'Informe um valor de frete válido para todas as faixas.';
    }

    // Check all distances have prices
    const ruleDistances = new Set(rule.pricesByDistance.map((e) => e.maxDistanceM));
    if (![...validDistances].every((d) => ruleDistances.has(d))) {
      return 'Informe um preço para cada faixa de distância.';
    }
  }

  // Check for overlaps
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i];
      const b = rules[j];
      // Two rules overlap if either's interval contains the other's start
      // Only check enabled rules with overlapping days
      const commonDays = a.daysOfWeek.filter((d) => b.daysOfWeek.includes(d));
      if (commonDays.length === 0) continue;

      const aContainsBStart = minuteInPricingInterval(a.startMinute, a.endMinute, b.startMinute);
      const bContainsAStart = minuteInPricingInterval(b.startMinute, b.endMinute, a.startMinute);
      if (aContainsBStart || bContainsAStart) {
        return `O horário "${a.label}" não pode se sobrepor a "${b.label}".`;
      }
    }
  }

  return null;
}

/**
 * Normaliza uma regra: arredonda minutos, limpa labels, garante dias da semana.
 */
export function normalizeDeliveryPricingRule(rule: {
  label: string;
  startMinute: number;
  endMinute: number;
  enabled?: boolean;
  daysOfWeek?: number[];
  pricesByDistance: Array<{ maxDistanceM: number; price: number }>;
}): DeliveryPricingRule {
  return {
    label: rule.label.trim(),
    startMinute: Math.round(rule.startMinute),
    endMinute: Math.round(rule.endMinute),
    enabled: rule.enabled ?? true,
    daysOfWeek: rule.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6],
    pricesByDistance: rule.pricesByDistance.map((e) => ({
      maxDistanceM: e.maxDistanceM,
      price: roundCurrency(e.price),
    })),
  };
}
