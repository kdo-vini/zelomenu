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
  address: DeliveryAddress | null;
  ranges: DeliveryRange[];
  geocodingStatus: DeliveryGeocodingStatus;
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

export type DeliverySettingsDraft = {
  enabled: boolean;
  address: DeliveryAddress;
  ranges: DeliveryRangeDraft[];
  geocodingStatus: DeliveryGeocodingStatus;
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

export function createDeliveryDraft(settings: DeliverySettings): DeliverySettingsDraft {
  const address = settings.address ?? EMPTY_DELIVERY_ADDRESS;

  return {
    enabled: settings.enabled,
    address: { ...address },
    ranges: settings.ranges.map((range) => ({
      id: range.id,
      maxDistanceKm: formatKm(range.maxDistanceM),
      price: formatMoney(range.price),
    })),
    geocodingStatus: settings.geocodingStatus,
  };
}

export function deliveryDraftToSettings(draft: DeliverySettingsDraft): DeliverySettings {
  const address = { ...draft.address };
  const hasAddress = Object.values(address).some((value) => (
    typeof value === 'string' ? value.trim() !== '' : value != null
  ));

  return {
    enabled: draft.enabled,
    address: hasAddress ? address : null,
    ranges: draft.ranges.flatMap((range) => {
      const maxDistanceKm = parseDecimal(range.maxDistanceKm);
      const price = parseDecimal(range.price);
      if (maxDistanceKm == null || price == null) return [];
      return [{ id: range.id, maxDistanceM: Math.round(maxDistanceKm * 1000), price }];
    }),
    geocodingStatus: draft.geocodingStatus,
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
  postalCode: string | null;
  number: string | null;
  street: string | null;
  city: string | null;
  ranges: Array<string | null>;
  general: string | null;
};

export function validateDeliveryDraft(draft: DeliverySettingsDraft): DeliveryDraftValidation {
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
  else if (postalCode || number || street || city) general = 'Complete o endereço da loja antes de salvar.';

  return { postalCode, number, street, city, ranges, general };
}

export function maxDeliveryDistanceKm(ranges: DeliveryRange[]): number {
  return ranges.reduce((max, range) => Math.max(max, range.maxDistanceM / 1000), 0);
}

export function estimatedDeliveryMinutes(ranges: DeliveryRange[]): number | null {
  const maxKm = maxDeliveryDistanceKm(ranges);
  return maxKm > 0 ? Math.max(1, Math.round(maxKm * 3)) : null;
}

export function approximateDeliveryAreaKm2(ranges: DeliveryRange[]): number | null {
  const maxKm = maxDeliveryDistanceKm(ranges);
  return maxKm > 0 ? Math.round(Math.PI * maxKm * maxKm) : null;
}
