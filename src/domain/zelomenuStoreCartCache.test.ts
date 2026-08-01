import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadZeloMenuStoreCartCache,
  persistZeloMenuStoreCartCache,
  type ZeloMenuStoreCartItem,
} from './zelomenuStoreCartCache';

function installMemoryStorage(): void {
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
}

const item: ZeloMenuStoreCartItem = {
  key: '1::plain',
  productId: 1,
  productName: 'Produto',
  quantity: 1,
  selectedOptions: [],
  unitPrice: 12,
  notes: null,
};

describe('zelomenuStoreCartCache', () => {
  beforeEach(() => installMemoryStorage());

  it('keeps cart data isolated by store slug', () => {
    persistZeloMenuStoreCartCache('loja-a', { items: { [item.key]: item } });

    expect(loadZeloMenuStoreCartCache('loja-a').items).toEqual({ [item.key]: item });
    expect(loadZeloMenuStoreCartCache('loja-b').items).toEqual({});
  });

  it('removes the store cache when its cart is emptied', () => {
    persistZeloMenuStoreCartCache('loja-a', { items: { [item.key]: item } });
    persistZeloMenuStoreCartCache('loja-a', { items: {} });

    expect(loadZeloMenuStoreCartCache('loja-a').items).toEqual({});
  });
});
