import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveModifierSelections } from '../domain/zelomenuModifiers';
import { buildCartItemKey } from '../domain/zelomenuCartItemKey';
import {
  loadZeloMenuStoreCartCache,
  persistZeloMenuStoreCartCache,
  type ZeloMenuStoreCartItem,
} from '../domain/zelomenuStoreCartCache';
import { startPublicOrder, ZeloMenuApiError, type TableOrderContext, type ZeloMenuCatalogProduct } from '../services/zelomenuApi';
import { useToast } from '../contexts/ToastContext';

type SelectedItem = ZeloMenuStoreCartItem;

export function useStoreCart(slug: string, tableOrderContext?: TableOrderContext, deliveryEnabled = false) {
  const navigate = useNavigate();
  const toast = useToast();

  const restored = useMemo(() => loadZeloMenuStoreCartCache(slug), [slug]);
  const [items, setItems] = useState<Record<string, SelectedItem>>(restored.items);
  const [hydratedSlug, setHydratedSlug] = useState(slug);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sheetProduct, setSheetProduct] = useState<ZeloMenuCatalogProduct | null>(null);

  useEffect(() => {
    // Avoid persisting the previous store's cart under the new slug while an
    // SPA navigation is rehydrating the cart namespace.
    setHydratedSlug(slug);
    setItems(loadZeloMenuStoreCartCache(slug).items);
    setSheetProduct(null);
    setSubmitError(null);
  }, [slug]);

  useEffect(() => {
    if (hydratedSlug !== slug) return;
    persistZeloMenuStoreCartCache(slug, { items });
  }, [hydratedSlug, slug, items]);

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
    setSheetProduct(product);
  }

  function quickAddProduct(product: ZeloMenuCatalogProduct) {
    const key = `${product.id}::plain`;
    setItems((prev) => {
      const existing = prev[key];
      return {
        ...prev,
        [key]: {
          key,
          productId: product.id,
          productName: product.name,
          quantity: (existing?.quantity ?? 0) + 1,
          selectedOptions: [],
          unitPrice: product.basePrice,
          notes: null,
        },
      };
    });
    toast.success('Adicionado ao carrinho');
  }

  function confirmSheet(
    product: ZeloMenuCatalogProduct,
    quantity: number,
    notes: string,
    selections: Record<string, Array<{ optionId: string; quantity: number }>>,
  ) {
    if (quantity <= 0) return;
    const selectedOptions = Object.keys(selections)
      .map((groupId) => ({
        groupId,
        optionSelections: (selections[groupId] ?? []).filter((s) => s.quantity > 0),
      }))
      .filter((sel) => sel.optionSelections.length > 0);
    const resolved = resolveModifierSelections(product.modifierGroups, selectedOptions, product.basePrice);
    if (!resolved.ok) return;
    const trimmedNotes = notes.trim();
    const hasActiveModifiers = product.modifierGroups.some((group) => group.active);
    const key = hasActiveModifiers
      ? buildCartItemKey(product.id, selectedOptions, trimmedNotes)
      : `${product.id}::plain`;
    setItems((prev) => {
      const existingEntry = hasActiveModifiers
        ? ([key, prev[key]] as const)
        : Object.entries(prev).find(([, item]) => item.productId === product.id && item.selectedOptions.length === 0);
      const existing = existingEntry?.[1];
      const nextQuantity = existing && hasActiveModifiers
        ? existing.quantity + quantity
        : quantity;
      const next = { ...prev };
      if (!hasActiveModifiers && existingEntry && existingEntry[0] !== key) {
        delete next[existingEntry[0]];
      }
      next[key] = {
        key,
        productId: product.id,
        productName: product.name,
        quantity: nextQuantity,
        selectedOptions,
        unitPrice: Number(resolved.finalUnitPrice.toFixed(2)),
        notes: trimmedNotes ? trimmedNotes : null,
      };
      return next;
    });
    setSheetProduct(null);
  }

  async function continueToCart() {
    setSubmitError(null);
    try {
      setSubmitting(true);
      const result = await startPublicOrder(slug, {
        items: lines.map((line) => ({
          productId: line.productId,
          productName: line.productName,
          quantity: line.quantity,
          selectedOptions: line.selectedOptions,
          notes: line.notes ?? null,
        })),
        fulfillment: {
          type: !tableOrderContext && deliveryEnabled ? 'delivery' : 'pickup',
        },
        tableOrderContext,
      });
      navigate(result.path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const errorCode = err instanceof ZeloMenuApiError ? err.code : msg;
      const friendlyMessage = errorCode === 'TABLE_TAKEN_BY_OTHER_GROUP'
        ? 'Esta mesa já tem um pedido em aberto por outro grupo. Peça ao garçom para liberar a comanda.'
        : errorCode === 'COMANDA_CLOSED'
          ? 'Esta comanda já foi encerrada. Peça ao garçom para abrir uma nova comanda.'
          : errorCode === 'REQUEST_TIMEOUT'
            ? 'A conexão demorou demais. Verifique a internet e tente novamente.'
            : msg || 'Não consegui iniciar o pedido. Tente novamente.';
      setSubmitError(friendlyMessage);
      if (errorCode === 'TABLE_TAKEN_BY_OTHER_GROUP') {
        toast.error(friendlyMessage);
      } else if (errorCode === 'COMANDA_CLOSED') {
        toast.error(friendlyMessage);
      } else if (errorCode === 'REQUEST_TIMEOUT') {
        toast.error(friendlyMessage);
      } else {
        toast.error(friendlyMessage);
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
    submitError,
    sheetProduct,
    setSheetProduct,
    changeQty,
    setQty,
    onAddProduct,
    quickAddProduct,
    confirmSheet,
    continueToCart,
    lines,
    subtotal,
    totalQty,
  };
}
