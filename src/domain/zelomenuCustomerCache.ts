const CUSTOMER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ZeloMenuCustomerCache = {
  name: string;
  phone: string;
  deliveryAddress: string;
  deliveryNeighborhood: string;
};

function zeloMenuCustomerStorageKey(slug: string): string {
  return `zelomenu_customer_${slug}`;
}

export function loadZeloMenuCustomerCache(slug: string): ZeloMenuCustomerCache | null {
  if (!slug) return null;
  try {
    const raw = localStorage.getItem(zeloMenuCustomerStorageKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number } & Partial<ZeloMenuCustomerCache>;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > CUSTOMER_CACHE_TTL_MS) {
      localStorage.removeItem(zeloMenuCustomerStorageKey(slug));
      return null;
    }
    if (!parsed.name && !parsed.phone && !parsed.deliveryAddress) return null;
    return {
      name: parsed.name ?? '',
      phone: parsed.phone ?? '',
      deliveryAddress: parsed.deliveryAddress ?? '',
      deliveryNeighborhood: parsed.deliveryNeighborhood ?? '',
    };
  } catch {
    return null;
  }
}

export function saveZeloMenuCustomerCache(slug: string, data: ZeloMenuCustomerCache): void {
  if (!slug) return;
  try {
    localStorage.setItem(zeloMenuCustomerStorageKey(slug), JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {
    // localStorage indisponível — autofill é um extra, não crítico.
  }
}
