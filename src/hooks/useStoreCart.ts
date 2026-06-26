import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveModifierSelections } from '../domain/zelomenuModifiers';
import { buildCartItemKey } from '../domain/zelomenuCartItemKey';
import {
  loadZeloMenuStoreCartCache,
  persistZeloMenuStoreCartCache,
  type ZeloMenuStoreCartItem,
} from '../domain/zelomenuStoreCartCache';
import { startPublicOrder, type TableOrderContext, type ZeloMenuCatalogProduct } from '../services/zelomenuApi';
import { useToast } from '../contexts/ToastContext';

type SelectedItem = ZeloMenuStoreCartItem;

export type StoreCartPicker = {
  product: ZeloMenuCatalogProduct;
  selections: Record<string, string[]>;
};

export function useStoreCart(slug: string, tableOrderContext?: TableOrderContext) {
  const navigate = useNavigate();
  const toast = useToast();

  const restored = useMemo(() => loadZeloMenuStoreCartCache(slug), [slug]);
  const [items, setItems] = useState<Record<string, SelectedItem>>(restored.items);
  const [submitting, setSubmitting] = useState(false);
  const [unitPicker, setUnitPicker] = useState<ZeloMenuCatalogProduct | null>(null);
  const [picker, setPicker] = useState<StoreCartPicker | null>(null);

  useEffect(() => {
    persistZeloMenuStoreCartCache(slug, { items });
  }, [slug, items]);

  function addPlainProduct(product: ZeloMenuCatalogProduct, qty = 1) {
    const key = `${product.id}::plain`;
    setItems((prev) => ({
      ...prev,
      [key]: {
        key,
        productId: product.id,
        productName: product.name,
        quantity: qty,
        selectedOptions: [],
        unitPrice: product.basePrice,
      },
    }));
  }

  function changeQty(key: string, delta: number) {
    setItems((prev) => {
      const existing = prev[key];
      if (!existing) return prev;
      const nextQty = existing.quantity + delta;
      if (nextQty <= 0) {
        const { [key]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: { ...existing, quantity: nextQty } };
    });
  }

  function setQty(key: string, qty: number) {
    setItems((prev) => {
      const existing = prev[key];
      if (!existing) return prev;
      if (qty <= 0) {
        const { [key]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: { ...existing, quantity: qty } };
    });
  }

  function onAddProduct(product: ZeloMenuCatalogProduct) {
    if (product.modifierGroups.length > 0) {
      setPicker({ product, selections: {} });
    } else if (product.unitBased) {
      setUnitPicker(product);
    } else {
      addPlainProduct(product);
    }
  }

  function confirmPicker() {
    if (!picker) return;
    const selectedOptions = Object.keys(picker.selections)
      .map((groupId) => ({ groupId, optionIds: picker.selections[groupId] ?? [] }))
      .filter((sel) => sel.optionIds.length > 0);
    const resolved = resolveModifierSelections(picker.product.modifierGroups, selectedOptions);
    if (!resolved.ok) return;
    const key = buildCartItemKey(picker.product.id, selectedOptions);
    setItems((prev) => ({
      ...prev,
      [key]: {
        key,
        productId: picker.product.id,
        productName: picker.product.name,
        quantity: (prev[key]?.quantity ?? 0) + 1,
        selectedOptions,
        unitPrice: Number((picker.product.basePrice + resolved.deltaTotal).toFixed(2)),
      },
    }));
    setPicker(null);
  }

  async function continueToCart() {
    try {
      setSubmitting(true);
      const result = await startPublicOrder(slug, {
        items: lines.map((line) => ({
          productId: line.productId,
          productName: line.productName,
          quantity: line.quantity,
          selectedOptions: line.selectedOptions,
        })),
        tableOrderContext,
      });
      navigate(result.path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'TABLE_TAKEN_BY_OTHER_GROUP') {
        toast.error('Esta mesa já tem um pedido em aberto por outro grupo. Peça ao garçom para liberar a comanda.');
      } else if (msg === 'COMANDA_CLOSED') {
        toast.error('Esta comanda já foi encerrada. Peça ao garçom para abrir uma nova comanda.');
      } else {
        toast.error(msg || 'Não consegui iniciar o pedido. Tente de novo.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const lines = useMemo(() => Object.values(items), [items]);
  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0), [lines]);
  const totalQty = useMemo(() => lines.reduce((s, l) => s + l.quantity, 0), [lines]);

  return {
    items,
    submitting,
    unitPicker,
    setUnitPicker,
    picker,
    setPicker,
    addPlainProduct,
    changeQty,
    setQty,
    onAddProduct,
    confirmPicker,
    continueToCart,
    lines,
    subtotal,
    totalQty,
  };
}
