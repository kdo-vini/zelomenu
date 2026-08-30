export type DeliveryGeocodingStatus = 'not_configured' | 'ready' | 'error' | 'stale';

export type DeliveryAddress = {
  postalCode: string;
  number: string;
  complement: string | null;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  locationVersion: string | null;
};

export type DeliveryRange = {
  id?: string;
  maxDistanceM: number;
  price: number;
};

export type DeliverySettings = {
  enabled: boolean;
  estimatedDeliveryMinutes?: number | null;
  address: DeliveryAddress | null;
  ranges: DeliveryRange[];
  geocodingStatus: DeliveryGeocodingStatus;
  pricingRules?: Array<{
    id?: string;
    label: string;
    startMinute: number;
    endMinute: number;
    enabled: boolean;
    daysOfWeek: number[];
    pricesByDistance: Array<{ maxDistanceM: number; price: number }>;
  }>;
  pricingVersion?: number;
  timezone?: string;
};

export type DeliveryCepLookup = {
  postalCode: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type DeliveryGeocodeResult = {
  latitude: number;
  longitude: number;
  locationVersion: string;
};

export type DeliveryRangeDraft = {
  id?: string;
  maxDistanceKm: string;
  price: string;
};

export type DeliveryPricingRuleDraft = {
  label: string;
  startMinute: string;
  endMinute: string;
  enabled: boolean;
  prices: Record<string, string>; // key: maxDistanceM as string
};

export type DeliverySettingsDraft = {
  enabled: boolean;
  estimatedDeliveryMinutes: string;
  address: DeliveryAddress;
  ranges: DeliveryRangeDraft[];
  geocodingStatus: DeliveryGeocodingStatus;
  pricingRules: DeliveryPricingRuleDraft[];
};

export const EMPTY_DELIVERY_ADDRESS: DeliveryAddress = {
  postalCode: '',
  number: '',
  complement: null,
  street: '',
  neighborhood: '',
  city: '',
  state: '',
  latitude: null,
  longitude: null,
  locationVersion: null,
};

export const EMPTY_DELIVERY_SETTINGS: DeliverySettings = {
  enabled: false,
  address: null,
  ranges: [],
  geocodingStatus: 'not_configured',
};

export const EMPTY_PRICING_RULE_DRAFT: DeliveryPricingRuleDraft = {
  label: '',
  startMinute: '',
  endMinute: '',
  enabled: true,
  prices: {},
};

export function createDeliveryDraft(settings: DeliverySettings): DeliverySettingsDraft {
  const address = settings.address ?? EMPTY_DELIVERY_ADDRESS;

  return {
    enabled: settings.enabled,
    estimatedDeliveryMinutes: settings.estimatedDeliveryMinutes == null ? '' : String(settings.estimatedDeliveryMinutes),
    address: { ...address },
    ranges: settings.ranges.map((range) => ({
      id: range.id,
      maxDistanceKm: formatKm(range.maxDistanceM),
      price: formatMoney(range.price),
    })),
    geocodingStatus: settings.geocodingStatus,
    pricingRules: (settings.pricingRules ?? []).map((rule) => ({
      label: rule.label,
      startMinute: String(rule.startMinute),
      endMinute: String(rule.endMinute),
      enabled: rule.enabled,
      prices: Object.fromEntries(
        rule.pricesByDistance.map((p) => [String(p.maxDistanceM), formatMoney(p.price)]),
      ),
    })),
  };
}

export function deliveryDraftToSettings(draft: DeliverySettingsDraft): DeliverySettings {
  const address = { ...draft.address };
  const hasAddress = Object.values(address).some((value) => (
    typeof value === 'string' ? value.trim() !== '' : value != null
  ));

  return {
    enabled: draft.enabled,
    estimatedDeliveryMinutes: parseEstimatedDeliveryMinutes(draft.estimatedDeliveryMinutes),
    address: hasAddress ? address : null,
    ranges: draft.ranges.flatMap((range) => {
      const maxDistanceKm = parseDecimal(range.maxDistanceKm);
      const price = parseDecimal(range.price);
      if (maxDistanceKm == null || price == null) return [];
      return [{ id: range.id, maxDistanceM: Math.round(maxDistanceKm * 1000), price }];
    }),
    geocodingStatus: draft.geocodingStatus,
    pricingRules: draft.pricingRules.length > 0
      ? draft.pricingRules.map((rule) => {
          const startMinute = parseInt(rule.startMinute, 10);
          const endMinute = parseInt(rule.endMinute, 10);
          return {
            label: rule.label,
            startMinute: Number.isFinite(startMinute) ? Math.max(0, Math.min(1439, startMinute)) : 0,
            endMinute: Number.isFinite(endMinute) ? Math.max(0, Math.min(1440, endMinute)) : 1440,
            enabled: rule.enabled,
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
            pricesByDistance: Object.entries(rule.prices).flatMap(([key, value]) => {
              const maxDistanceM = parseInt(key, 10);
              const price = parseDecimal(value);
              if (!Number.isFinite(maxDistanceM) || price == null) return [];
              return [{ maxDistanceM, price }];
            }),
          };
        })
      : undefined,
  };
}

export function parseDecimal(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatKm(meters: number): string {
  return (meters / 1000).toFixed(2).replace('.', ',');
}

export function formatMoney(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

export function formatPostalCode(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

export type DeliveryDraftValidation = {
  estimatedDeliveryMinutes: string | null;
  postalCode: string | null;
  number: string | null;
  street: string | null;
  city: string | null;
  ranges: Array<string | null>;
  general: string | null;
};

export const DELIVERY_ESTIMATED_MINUTES_RANGE = {
  min: 1,
  max: 1440,
} as const;

export function validateDeliveryDraft(draft: DeliverySettingsDraft): DeliveryDraftValidation {
  const estimatedDeliveryMinutes = validateEstimatedDeliveryMinutes(draft.estimatedDeliveryMinutes);
  const postalCode = draft.address.postalCode.replace(/\D/g, '').length === 8
    ? null
    : 'Informe um CEP válido com 8 dígitos.';
  const number = draft.address.number.trim() ? null : 'Informe o número da loja.';
  const street = draft.address.street.trim() ? null : 'Busque um CEP válido para preencher a rua.';
  const city = draft.address.city.trim() ? null : 'Busque um CEP válido para preencher a cidade.';

  const ranges: Array<string | null> = draft.ranges.map((range) => {
    const distance = parseDecimal(range.maxDistanceKm);
    const price = parseDecimal(range.price);
    if (distance == null || distance <= 0) return 'Informe uma distância maior que zero.';
    if (price == null || price < 0) return 'Informe um valor de frete válido.';
    return null;
  });

  const duplicateDistance = draft.ranges
    .map((range) => parseDecimal(range.maxDistanceKm))
    .filter((value): value is number => value != null)
    .some((value, index, values) => values.indexOf(value) !== index);

  let general: string | null = null;
  if (draft.ranges.length === 0) general = 'Adicione pelo menos uma faixa de entrega.';
  else if (duplicateDistance) general = 'Use limites de distância diferentes em cada faixa.';
  else if (ranges.some((error) => error != null)) general = 'Corrija as faixas destacadas antes de salvar.';
  else if (estimatedDeliveryMinutes) general = 'Corrija o tempo estimado de entrega antes de salvar.';
  else if (postalCode || number || street || city) general = 'Complete o endereço da loja antes de salvar.';

  return { estimatedDeliveryMinutes, postalCode, number, street, city, ranges, general };
}

function validateEstimatedDeliveryMinutes(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;

  const minutes = Number(normalized);
  if (!Number.isInteger(minutes)) return 'Informe um número inteiro de minutos.';
  if (!isValidDeliveryEstimatedMinutes(minutes)) {
    return `Informe um valor entre ${DELIVERY_ESTIMATED_MINUTES_RANGE.min} e ${DELIVERY_ESTIMATED_MINUTES_RANGE.max} minutos.`;
  }
  return null;
}

function parseEstimatedDeliveryMinutes(value: string): number | null {
  return validateEstimatedDeliveryMinutes(value) === null && value.trim()
    ? Number(value.trim())
    : null;
}

export function maxDeliveryDistanceKm(ranges: DeliveryRange[]): number {
  return ranges.reduce((max, range) => Math.max(max, range.maxDistanceM / 1000), 0);
}

export function isValidDeliveryEstimatedMinutes(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= DELIVERY_ESTIMATED_MINUTES_RANGE.min
    && value <= DELIVERY_ESTIMATED_MINUTES_RANGE.max;
}

export function formatEstimatedDeliveryMinutes(minutes: number | null | undefined): string | null {
  return isValidDeliveryEstimatedMinutes(minutes)
    ? `${minutes} min`
    : null;
}

export function approximateDeliveryAreaKm2(ranges: DeliveryRange[]): number | null {
  const maxKm = maxDeliveryDistanceKm(ranges);
  return maxKm > 0 ? Math.round(Math.PI * maxKm * maxKm) : null;
}
