import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearZeloMenuCustomerCache,
  hasZeloMenuCustomerCacheConsent,
  loadZeloMenuCustomerCache,
  saveZeloMenuCustomerCache,
  setZeloMenuCustomerCacheConsent,
} from './zelomenuCustomerCache';

function installMemoryStorage(): Storage {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  return storage;
}

const customer = {
  name: 'Ana',
  phone: '11999999999',
  deliveryAddress: 'Rua A, 10',
  deliveryNeighborhood: 'Centro',
  deliveryPostalCode: '16370000',
  deliveryNumber: '10',
  deliveryComplement: '',
  deliveryStreet: 'Rua A',
  deliveryCity: 'Promissão',
  deliveryState: 'SP',
};

describe('zelomenuCustomerCache', () => {
  beforeEach(() => {
    installMemoryStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not persist or hydrate customer data without explicit consent', () => {
    saveZeloMenuCustomerCache('loja-a', customer);

    expect(hasZeloMenuCustomerCacheConsent('loja-a')).toBe(false);
    expect(loadZeloMenuCustomerCache('loja-a')).toBeNull();
  });

  it('removes legacy cache data that has no consent marker', () => {
    localStorage.setItem('zelomenu_customer_loja-a', JSON.stringify({ ...customer, savedAt: Date.now() }));

    expect(loadZeloMenuCustomerCache('loja-a')).toBeNull();
    expect(localStorage.getItem('zelomenu_customer_loja-a')).toBeNull();
  });

  it('round-trips autofill data only after consent is granted', () => {
    setZeloMenuCustomerCacheConsent('loja-a', true);
    saveZeloMenuCustomerCache('loja-a', customer);

    expect(loadZeloMenuCustomerCache('loja-a')).toEqual(customer);
  });

  it('expires saved data after seven days', () => {
    setZeloMenuCustomerCacheConsent('loja-a', true);
    saveZeloMenuCustomerCache('loja-a', customer);

    vi.setSystemTime(new Date('2026-08-08T12:00:01.000Z'));

    expect(loadZeloMenuCustomerCache('loja-a')).toBeNull();
  });

  it('clears both saved data and consent explicitly', () => {
    setZeloMenuCustomerCacheConsent('loja-a', true);
    saveZeloMenuCustomerCache('loja-a', customer);

    clearZeloMenuCustomerCache('loja-a');

    expect(hasZeloMenuCustomerCacheConsent('loja-a')).toBe(false);
    expect(loadZeloMenuCustomerCache('loja-a')).toBeNull();
  });
});
