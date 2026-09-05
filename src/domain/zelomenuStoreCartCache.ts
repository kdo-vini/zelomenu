import { pizzaSelectionFromSnapshot, type PizzaSelection, type PizzaSnapshot } from './pizzaTypes';
import type { ZeloMenuModifierSelectionInput } from './zelomenuModifiers';
import { buildCartItemKey } from './zelomenuCartItemKey';

const CART_TTL_MS = 12 * 60 * 60 * 1000;

export type ZeloMenuStoreCartItem = {
  pizzaSelection?: PizzaSelection;
  key: string;
  productId: number;
  productName: string;
  quantity: number;
  selectedOptions: ZeloMenuModifierSelectionInput[];
  unitPrice: number;
  notes?: string | null;
};

export type ZeloMenuStoreCartCache = {
  items: Record<string, ZeloMenuStoreCartItem>;
};

export function zeloMenuStoreCartStorageKey(slug: string): string {
  return `zelomenu_cart_${slug}`;
}

export function loadZeloMenuStoreCartCache(slug: string): ZeloMenuStoreCartCache {
  const empty: ZeloMenuStoreCartCache = { items: {} };
  if (!slug) return empty;
  try {
    const raw = localStorage.getItem(zeloMenuStoreCartStorageKey(slug));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as { version?: number; savedAt?: number } & Partial<ZeloMenuStoreCartCache>;
    if ((parsed.version != null && parsed.version > 2) || !parsed.savedAt || Date.now() - parsed.savedAt > CART_TTL_MS) {
      localStorage.removeItem(zeloMenuStoreCartStorageKey(slug));
      return empty;
    }
    return { items: parsed.items ?? {} };
  } catch {
    return empty;
  }
}

export function persistZeloMenuStoreCartCache(
  slug: string,
  cart: ZeloMenuStoreCartCache,
): void {
  if (!slug) return;
  try {
    if (Object.keys(cart.items).length === 0) {
      localStorage.removeItem(zeloMenuStoreCartStorageKey(slug));
      return;
    }
    localStorage.setItem(
      zeloMenuStoreCartStorageKey(slug),
      JSON.stringify({ ...cart, version: 2, savedAt: Date.now() }),
    );
  } catch {
    // localStorage indisponível (modo privado/cota): o servidor segue canônico.
  }
}


export function syncZeloMenuStoreCartCache(input: {
  slug: string | null;
  state: string;
  items: Array<{
    pizza?: PizzaSnapshot | null;
    productId: number | null;
    productName: string;
    quantity: number;
    unitPrice: number;
    notes?: string | null;
    selectedModifiers: Array<{
      groupId: string;
      selectedOptions: Array<{ optionId: string; quantity?: number }>;
    }>;
  }>;
}): void {
  if (!input.slug) return;
  if (input.state !== 'cart_open') {
    persistZeloMenuStoreCartCache(input.slug, { items: {} });
    return;
  }

  const items = Object.fromEntries(
    input.items.flatMap((item) => {
      if (item.productId == null || item.quantity <= 0) return [];
      const selectedOptions = item.selectedModifiers.filter(group => !group.groupId.startsWith('__pizza_')).map((group) => ({
        groupId: group.groupId,
        optionSelections: group.selectedOptions.map((option) => ({
          optionId: option.optionId,
          quantity: option.quantity ?? 1,
        })),
      }));
      const key = buildCartItemKey(
        item.productId,
        selectedOptions,
        selectedOptions.length > 0 || item.pizza ? item.notes : null,
        pizzaSelectionFromSnapshot(item.pizza),
      );
      return [[key, {
        key,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        selectedOptions,
        pizzaSelection: pizzaSelectionFromSnapshot(item.pizza),
        unitPrice: item.unitPrice,
        notes: item.notes ?? null,
      } satisfies ZeloMenuStoreCartItem]];
    }),
  );

  persistZeloMenuStoreCartCache(input.slug, { items });
}
