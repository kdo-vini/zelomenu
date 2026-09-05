const CUSTOMER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CUSTOMER_CACHE_CONSENT_VALUE = 'granted';

export type ZeloMenuCustomerCache = {
  name: string;
  phone: string;
  deliveryAddress: string;
  deliveryNeighborhood: string;
  deliveryNeighborhoodId?: string;
  deliveryPostalCode?: string;
  deliveryNumber?: string;
  deliveryComplement?: string;
  deliveryStreet?: string;
  deliveryCity?: string;
  deliveryState?: string;
};

export function zeloMenuCustomerStorageKey(slug: string): string {
  return `zelomenu_customer_${slug}`;
}

export function zeloMenuCustomerConsentStorageKey(slug: string): string {
  return `zelomenu_customer_consent_${slug}`;
}

export function hasZeloMenuCustomerCacheConsent(slug: string): boolean {
  if (!slug) return false;
  try {
    return localStorage.getItem(zeloMenuCustomerConsentStorageKey(slug)) === CUSTOMER_CACHE_CONSENT_VALUE;
  } catch {
    return false;
  }
}

export function setZeloMenuCustomerCacheConsent(slug: string, granted: boolean): void {
  if (!slug) return;
  try {
    if (granted) {
      localStorage.setItem(zeloMenuCustomerConsentStorageKey(slug), CUSTOMER_CACHE_CONSENT_VALUE);
      return;
    }
    localStorage.removeItem(zeloMenuCustomerConsentStorageKey(slug));
    localStorage.removeItem(zeloMenuCustomerStorageKey(slug));
  } catch {
    // localStorage indisponível: o autofill continua opcional e não crítico.
  }
}

export function clearZeloMenuCustomerCache(slug: string): void {
  if (!slug) return;
  try {
    localStorage.removeItem(zeloMenuCustomerStorageKey(slug));
    localStorage.removeItem(zeloMenuCustomerConsentStorageKey(slug));
  } catch {
    // localStorage indisponível.
  }
}

export function loadZeloMenuCustomerCache(slug: string): ZeloMenuCustomerCache | null {
  if (!slug) return null;
  if (!hasZeloMenuCustomerCacheConsent(slug)) {
    // Data written by older versions had no consent marker. Remove it on the
    // next visit instead of silently reviving it as autofill data.
    try {
      localStorage.removeItem(zeloMenuCustomerStorageKey(slug));
    } catch {
      // localStorage indisponível.
    }
    return null;
  }
  try {
    const raw = localStorage.getItem(zeloMenuCustomerStorageKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number } & Partial<ZeloMenuCustomerCache>;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > CUSTOMER_CACHE_TTL_MS) {
      localStorage.removeItem(zeloMenuCustomerStorageKey(slug));
      return null;
    }
    if (!parsed.name && !parsed.phone && !parsed.deliveryAddress && !parsed.deliveryPostalCode) return null;
    const customer: ZeloMenuCustomerCache = {
      name: parsed.name ?? '',
      phone: parsed.phone ?? '',
      deliveryAddress: parsed.deliveryAddress ?? '',
      deliveryNeighborhood: parsed.deliveryNeighborhood ?? '',
      deliveryPostalCode: parsed.deliveryPostalCode ?? '',
      deliveryNumber: parsed.deliveryNumber ?? '',
      deliveryComplement: parsed.deliveryComplement ?? '',
      deliveryStreet: parsed.deliveryStreet ?? '',
      deliveryCity: parsed.deliveryCity ?? '',
      deliveryState: parsed.deliveryState ?? '',
    };
    if (parsed.deliveryNeighborhoodId) customer.deliveryNeighborhoodId = parsed.deliveryNeighborhoodId;
    return customer;
  } catch {
    return null;
  }
}

export function saveZeloMenuCustomerCache(slug: string, data: ZeloMenuCustomerCache): void {
  if (!slug || !hasZeloMenuCustomerCacheConsent(slug)) return;
  try {
    localStorage.setItem(zeloMenuCustomerStorageKey(slug), JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {
    // localStorage indisponível — autofill é um extra, não crítico.
  }
}
