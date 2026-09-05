import { resolvePizza } from '../../domain/pizza.js';
import type { PizzaSelection } from '../../domain/pizzaTypes';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Check, ImageIcon, Minus, Plus, Search, X } from 'lucide-react';
import { previewModifierPrice, resolveModifierSelections, sortModifierGroups } from '../../domain/zelomenuModifiers';
import { normalizeCatalogSearchText } from '../../domain/zelomenuCatalog';
import { resolveCategorySuggestions } from '../../domain/zelomenuCategorySuggestions';
import type { ZeloMenuCatalogGroup, ZeloMenuCatalogProduct } from '../../services/zelomenuApi';

const NOTES_MAX_LENGTH = 200;

function toBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function requiredActionLabel(groupName: string): string {
  const subject = groupName
    .trim()
    .replace(/^escolha\s+/i, '')
    .replace(/^(?:o|a|um|uma)\s+/i, '')
    .trim();
  if (!subject) return 'Escolher opção';
  const conciseSubject = subject.length > 22 ? 'opção' : subject;
  return `Escolher ${conciseSubject.charAt(0).toLocaleLowerCase('pt-BR')}${conciseSubject.slice(1)}`;
}

function quantityTotal(selections: Record<string, number>): number {
  return Object.values(selections).reduce((total, quantity) => total + quantity, 0);
}

function groupSelectedCount(
  group: { allowsQuantity: boolean },
  selections: Record<string, number>,
): number {
  return group.allowsQuantity ? quantityTotal(selections) : Object.keys(selections).length;
}

function groupCounterLabel(
  group: {
    allowsQuantity: boolean;
    minSelections: number;
    maxSelections: number | null;
    minTotalQuantity: number;
    maxTotalQuantity: number | null;
  },
  selectedCount: number,
): string {
  if (group.allowsQuantity) {
    const min = Math.max(group.minTotalQuantity, group.minSelections);
    const max = group.maxTotalQuantity;
    const choiceLabel = min > 0 && max != null && min === max
      ? `Escolha ${min} ${min === 1 ? 'item' : 'itens'}`
      : min > 0 && max != null
        ? `Escolha de ${min} a ${max} itens`
        : min > 0
          ? `Escolha pelo menos ${min} ${min === 1 ? 'item' : 'itens'}`
          : max != null
            ? `Escolha até ${max} ${max === 1 ? 'item' : 'itens'}`
            : 'Escolha os itens';
    const countLabel = max != null ? `${selectedCount} de ${max}` : `${selectedCount} selecionado${selectedCount === 1 ? '' : 's'}`;
    const distinctLabel = group.maxSelections != null ? ` · até ${group.maxSelections} opções diferentes` : '';
    return `${choiceLabel} · ${countLabel}${distinctLabel}`;
  }

  const minimum = group.minSelections > 0 ? `Obrigatório · mínimo ${group.minSelections}` : 'Opcional';
  const maximum = group.maxSelections != null ? ` · máximo ${group.maxSelections}` : '';
  return `${minimum}${maximum} · ${selectedCount} selecionada${selectedCount === 1 ? '' : 's'}`;
}

/** Mini-stepper para opções com quantidade (visualmente menor que o stepper do produto). */
function MiniStepper({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number | null;
  label?: string;
  onChange: (v: number) => void;
}) {
  const atMin = value <= min;
  const atMax = max != null && value >= max;
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--color-line)]">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={atMin}
        className="flex h-7 w-7 items-center justify-center rounded-l-lg text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-30"
        aria-label={label ? `Diminuir quantidade de ${label}${max != null ? ` (limite ${max})` : ''}` : 'Diminuir quantidade'}
      >
        <Minus className="h-3 w-3" strokeWidth={2.5} />
      </button>
      <span
        className="flex h-7 min-w-[1.5rem] items-center justify-center text-[13px] font-semibold tabular-nums text-[var(--color-ink)]"
        aria-live="polite"
        aria-label={label ? `${label}: ${value}${max != null ? ` de ${max}` : ''}` : `Quantidade: ${value}`}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={atMax}
        className="flex h-7 w-7 items-center justify-center rounded-r-lg text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-30"
        aria-label={label ? `Aumentar quantidade de ${label}${max != null ? ` (limite ${max})` : ''}` : 'Aumentar quantidade'}
      >
        <Plus className="h-3 w-3" strokeWidth={2.5} />
      </button>
    </div>
  );
}

/**
 * Card de produto exibido sempre que o cliente toca em "adicionar" — com ou
 * sem grupos de complemento — pra que ele veja foto/descrição e possa deixar
 * uma observação antes de confirmar (padrão iFood/WhatsMenu).
 */
export function ProductAddModal({
  product,
  initialQuantity,
  initialNotes,
  initialPizzaSelection,
  initialOptions,
  onClose,
  onConfirm,
  categoryName,
  categorySuggestions,
  catalog,
  cartProductIds,
  existingLineCount = 0,
  onQuickAdd,
}: {
  product: ZeloMenuCatalogProduct;
  initialQuantity: number;
  initialNotes: string;
  initialPizzaSelection?: PizzaSelection;
  initialOptions?: import('../../domain/zelomenuModifiers').ZeloMenuModifierSelectionInput[];
  onClose: () => void;
  onConfirm: (quantity: number, notes: string, selections: Record<string, Array<{ optionId: string; quantity: number }>>, pizzaSelection?: PizzaSelection) => void;
  categoryName?: string;
  categorySuggestions?: Record<string, number[]>;
  catalog?: ZeloMenuCatalogGroup[];
  cartProductIds?: number[];
  existingLineCount?: number;
  onQuickAdd?: (product: ZeloMenuCatalogProduct) => void;
}) {
  const [selections, setSelections] = useState<Record<string, Record<string, number>>>(()=>Object.fromEntries((initialOptions??[]).map(g=>[g.groupId,Object.fromEntries(g.optionSelections.map(o=>[o.optionId,o.quantity]))])));
  const [qtyDraft, setQtyDraft] = useState(String(Math.max(1, initialQuantity)));
  const [notes, setNotes] = useState(initialNotes);
  const [pizzaSize, setPizzaSize] = useState(initialPizzaSelection?.sizeId ?? '');
  const [flavorCount, setFlavorCount] = useState(initialPizzaSelection?.flavorIds.length ?? 1);
  const [flavorIds, setFlavorIds] = useState<string[]>(initialPizzaSelection?.flavorIds ?? []);
  const [flavorSearch, setFlavorSearch] = useState('');
  const [pizzaNotice,setPizzaNotice] = useState('');
  const pizzaSelection = {revision: product.pizza?.revision ?? '', sizeId:pizzaSize, flavorIds};
  const pizzaResult = product.productType === 'pizza' ? resolvePizza(product.pizza, pizzaSelection) : null;
  const pizzaBase = pizzaResult?.ok ? pizzaResult.baseUnitPrice : product.basePrice;
  const isEditing = initialQuantity > 0;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pizzaSectionRef = useRef<HTMLElement>(null);
  const groupRefs = useRef<Record<string, HTMLElement | null>>({});
  const onCloseRef = useRef(onClose);
  const activePizzaSizes = product.pizza?.sizes.filter((size) => size.active !== false) ?? [];
  const selectedPizzaSize = activePizzaSizes.find((size) => size.id === pizzaSize);
  const availablePizzaFlavors = product.pizza?.flavors.filter((flavor) => (
    flavor.active !== false && flavor.prices[pizzaSize] != null
  )) ?? [];
  const normalizedFlavorSearch = normalizeCatalogSearchText(flavorSearch);
  const visiblePizzaFlavors = availablePizzaFlavors.filter((flavor) => (
    normalizeCatalogSearchText(`${flavor.name} ${flavor.description ?? ''}`).includes(normalizedFlavorSearch)
  ));

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousActiveElement = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previousActiveElement?.focus();
    };
  }, []);

  function selectPizzaSize(sizeId: string) {
    const size = activePizzaSizes.find((candidate) => candidate.id === sizeId);
    if (!size) return;
    const compatibleFlavorIds = flavorIds
      .filter((flavorId) => product.pizza?.flavors.some((flavor) => (
        flavor.id === flavorId && flavor.active !== false && flavor.prices[sizeId] != null
      )))
      .slice(0, size.maxFlavors);
    const nextFlavorCount = Math.min(flavorCount, size.maxFlavors);
    setPizzaSize(sizeId);
    setFlavorIds(compatibleFlavorIds.slice(0, nextFlavorCount));
    setFlavorCount(nextFlavorCount);
    setPizzaNotice(compatibleFlavorIds.length !== flavorIds.length
      ? 'Ajustamos os sabores porque nem todos estão disponíveis neste tamanho.'
      : '');
  }

  function selectFlavorCount(count: number) {
    setFlavorCount(count);
    setFlavorIds([]);
    setPizzaNotice('');
  }

  function togglePizzaFlavor(flavorId: string) {
    setFlavorIds((current) => {
      if (current.includes(flavorId)) return current.filter((id) => id !== flavorId);
      if (current.length >= flavorCount) return current;
      return [...current, flavorId];
    });
    setPizzaNotice('');
  }

  function setOptionQuantity(groupId: string, optionId: string, quantity: number) {
    setSelections((prev) => {
      const group = product.modifierGroups.find((g) => g.id === groupId);
      if (!group) return prev;
      const groupSelections = { ...(prev[groupId] ?? {}) };
      if (quantity <= 0) {
        delete groupSelections[optionId];
      } else {
        const currentQuantity = groupSelections[optionId] ?? 0;
        const currentTotal = quantityTotal(groupSelections);
        const totalRemaining = group.maxTotalQuantity == null
          ? Number.MAX_SAFE_INTEGER
          : Math.max(0, group.maxTotalQuantity - currentTotal + currentQuantity);
        const individualLimit = group.maxPerOption == null
          ? Number.MAX_SAFE_INTEGER
          : group.maxPerOption;
        const nextQuantity = Math.min(quantity, individualLimit, totalRemaining);
        if (nextQuantity <= 0) return prev;
        groupSelections[optionId] = nextQuantity;
      }
      return { ...prev, [groupId]: groupSelections };
    });
  }

  function toggleOption(groupId: string, optionId: string) {
    setSelections((prev) => {
      const group = product.modifierGroups.find((g) => g.id === groupId);
      if (!group) return prev;
      if (group.allowsQuantity) {
        // Use stepper instead — this shouldn't be called
        return prev;
      }
      const groupSelections = { ...(prev[groupId] ?? {}) };
      if (groupSelections[optionId]) {
        delete groupSelections[optionId];
      } else if (group.maxSelections === 1) {
        // Single-selection: replace with just this one
        return { ...prev, [groupId]: { [optionId]: 1 } };
      } else {
        // Não deixa marcar além do máximo do grupo — precisa desmarcar uma
        // opção antes de escolher outra.
        if (group.maxSelections != null && Object.keys(groupSelections).length >= group.maxSelections) {
          return prev;
        }
        groupSelections[optionId] = 1;
      }
      return { ...prev, [groupId]: groupSelections };
    });
  }

  const selectedOptions = Object.entries(selections)
    .map(([groupId, options]) => ({
      groupId,
      optionSelections: Object.entries(options).map(([optionId, quantity]) => ({ optionId, quantity })),
    }))
    .filter((sel) => sel.optionSelections.length > 0);
  const resolution = resolveModifierSelections(product.modifierGroups, selectedOptions, pizzaBase);
  const activeGroups = sortModifierGroups(product.modifierGroups.filter((group) => group.active));
  const nextRequiredGroup = activeGroups.find((group) => (
    (group.minSelections > 0 && Object.keys(selections[group.id] ?? {}).length < group.minSelections)
    || (group.allowsQuantity
      && group.minTotalQuantity > 0
      && quantityTotal(selections[group.id] ?? {}) < group.minTotalQuantity)
  ));
  const pricePreview = previewModifierPrice(product.modifierGroups, selectedOptions, pizzaBase);
  const displayedUnitPrice = resolution.ok ? resolution.finalUnitPrice : pricePreview.unitPrice;
  const awaitingPizzaSelection = product.productType === 'pizza' && (!pizzaSize || flavorIds.length !== flavorCount);
  const displayedPriceLabel = awaitingPizzaSelection
    ? `A partir de ${toBRL(product.basePrice)}`
    : !resolution.ok && pricePreview.hasRequiredGroup && !pricePreview.hasSelectedRequiredOption
      ? `A partir de ${toBRL(displayedUnitPrice)}`
      : toBRL(displayedUnitPrice);
  const hasActiveModifiers = activeGroups.length > 0;
  const quantity = parseInt(qtyDraft, 10);
  const validQuantity = !isNaN(quantity) && quantity > 0;
  const canConfirm = resolution.ok && validQuantity && (!pizzaResult || (pizzaResult.ok && flavorIds.length === flavorCount));
  const pizzaActionLabel = product.productType !== 'pizza' || (pizzaResult?.ok && flavorIds.length === flavorCount)
    ? null
    : !pizzaSize
      ? 'Escolha o tamanho'
      : flavorIds.length < flavorCount
        ? `Escolha mais ${flavorCount - flavorIds.length} ${flavorCount - flavorIds.length === 1 ? 'sabor' : 'sabores'}`
        : 'Revise a montagem';
  const canGuideToSelection = Boolean((pizzaActionLabel || nextRequiredGroup) && validQuantity);
  const primaryActionLabel = pizzaActionLabel ?? (nextRequiredGroup
    ? nextRequiredGroup.allowsQuantity && nextRequiredGroup.minTotalQuantity > quantityTotal(selections[nextRequiredGroup.id] ?? {})
      ? `Escolha mais ${nextRequiredGroup.minTotalQuantity - quantityTotal(selections[nextRequiredGroup.id] ?? {})} ${nextRequiredGroup.minTotalQuantity - quantityTotal(selections[nextRequiredGroup.id] ?? {}) === 1 ? 'item' : 'itens'}`
      : requiredActionLabel(nextRequiredGroup.name)
    : canConfirm
      ? (isEditing ? 'Atualizar' : 'Adicionar')
      : 'Corrija a seleção');

  function confirm() {
    if (!canConfirm) return;
    const selectionsArray = Object.entries(selections).reduce<
      Record<string, Array<{ optionId: string; quantity: number }>>
    >((acc, [groupId, opts]) => {
      const entries = Object.entries(opts).map(([optionId, qty]) => ({ optionId, quantity: qty }));
      if (entries.length > 0) acc[groupId] = entries;
      return acc;
    }, {});
    onConfirm(quantity, notes.trim(), selectionsArray, product.productType === 'pizza' ? pizzaSelection : undefined);
  }

  function handlePrimaryAction() {
    if (canConfirm) {
      confirm();
      return;
    }
    const groupElement = pizzaActionLabel
      ? pizzaSectionRef.current
      : nextRequiredGroup
        ? groupRefs.current[nextRequiredGroup.id]
        : null;
    if (!groupElement) return;
    groupElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      groupElement?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')?.focus({ preventScroll: true });
    }, 250);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="flex w-full max-w-md flex-col rounded-t-3xl bg-[var(--color-surface)] shadow-2xl"
        style={{ maxHeight: '92vh' }}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-add-title"
        aria-describedby="product-add-description"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            Detalhes do produto
          </p>
          <button
            type="button"
            onClick={onClose}
            ref={closeButtonRef}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-canvas)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4 text-[var(--color-ink-soft)]" strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {product.photoUrl ? (
            <img
              src={product.photoUrl}
              alt={product.name}
              className="h-44 w-full object-cover"
            />
          ) : null}

          <div className="space-y-5 px-5 py-4">
            <div>
              <h3 id="product-add-title" className="text-[17px] font-bold leading-snug text-[var(--color-ink)]">{product.name}</h3>
              {product.description ? (
                <p id="product-add-description" className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                  {product.description}
                </p>
              ) : <span id="product-add-description" className="sr-only">Escolha os complementos e a quantidade do produto.</span>}
              <p className="mt-2 text-[15px] font-bold" style={{ color: 'var(--color-brand-deep)' }}>
                {displayedPriceLabel}
              </p>
              {existingLineCount > 0 && product.modifierGroups.some((group) => group.active) ? (
                <p className="mt-2 rounded-lg bg-[var(--color-brand-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-brand-deep)]">
                  Você já adicionou {existingLineCount === 1 ? 'uma montagem' : `${existingLineCount} montagens`} deste produto. Escolha outra combinação para adicionar {product.productType === 'pizza' ? 'outra pizza' : 'um produto diferente'}.
                </p>
              ) : null}
            </div>

            {product.productType === 'pizza' && (
              <section
                ref={pizzaSectionRef}
                className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-canvas)]"
                aria-label="Monte sua pizza"
                tabIndex={-1}
              >
                <div className="border-b border-[var(--color-line)] bg-[var(--color-brand-soft)] px-4 py-3.5">
                  <h3 className="text-base font-bold text-[var(--color-ink)]">Monte sua pizza</h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-muted)]">Escolha o tamanho, quantos sabores e depois as suas opções.</p>
                </div>

                <div className="space-y-5 p-4">
                  <div>
                    <div className="mb-2.5 flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-brand)] text-xs font-bold text-white">1</span>
                      <p className="text-sm font-bold text-[var(--color-ink)]">Escolha o tamanho</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {activePizzaSizes.map((size) => {
                        const selected = pizzaSize === size.id;
                        return (
                          <button
                            key={size.id}
                            type="button"
                            onClick={() => selectPizzaSize(size.id)}
                            aria-pressed={selected}
                            aria-label={`${size.name} · até ${size.maxFlavors} ${size.maxFlavors === 1 ? 'sabor' : 'sabores'}`}
                            className="min-h-14 rounded-xl border px-3 py-2.5 text-left transition-colors"
                            style={{
                              borderColor: selected ? 'var(--color-brand)' : 'var(--color-line)',
                              background: selected ? 'var(--color-brand-soft)' : 'var(--color-surface)',
                            }}
                          >
                            <span className="flex items-center justify-between gap-2 text-sm font-bold text-[var(--color-ink)]">
                              {size.name}
                              {selected ? <Check className="h-4 w-4 text-[var(--color-brand-deep)]" aria-hidden="true" /> : null}
                            </span>
                            <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">Até {size.maxFlavors} {size.maxFlavors === 1 ? 'sabor' : 'sabores'}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {pizzaNotice ? <p className="rounded-lg bg-[var(--color-alert-soft)] px-3 py-2 text-xs text-[var(--color-alert)]" role="status">{pizzaNotice}</p> : null}

                  {selectedPizzaSize ? (
                    <>
                      <div>
                        <div className="mb-2.5 flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-brand)] text-xs font-bold text-white">2</span>
                          <p className="text-sm font-bold text-[var(--color-ink)]">Quantos sabores?</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {Array.from({ length: selectedPizzaSize.maxFlavors }, (_, index) => index + 1).map((count) => {
                            const selected = flavorCount === count;
                            const label = count === 1 ? 'Um sabor inteiro' : `${count} sabores · partes iguais`;
                            return (
                              <button
                                key={count}
                                type="button"
                                onClick={() => selectFlavorCount(count)}
                                aria-pressed={selected}
                                aria-label={label}
                                className="min-h-12 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors"
                                style={{
                                  borderColor: selected ? 'var(--color-brand)' : 'var(--color-line)',
                                  background: selected ? 'var(--color-brand-soft)' : 'var(--color-surface)',
                                  color: selected ? 'var(--color-brand-deep)' : 'var(--color-ink)',
                                }}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <div className="mb-2.5 flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-brand)] text-xs font-bold text-white">3</span>
                            <div>
                              <p className="text-sm font-bold text-[var(--color-ink)]">Escolha os sabores</p>
                              <p className="text-xs text-[var(--color-ink-muted)]">{flavorIds.length} de {flavorCount} selecionado{flavorIds.length === 1 ? '' : 's'}</p>
                            </div>
                          </div>
                          {flavorIds.length === flavorCount ? (
                            <span className="rounded-full bg-[var(--color-brand-soft)] px-2 py-1 text-xs font-bold text-[var(--color-brand-deep)]">Pronto</span>
                          ) : null}
                        </div>

                        {availablePizzaFlavors.length > 5 ? (
                          <label className="relative mb-2.5 block">
                            <span className="sr-only">Buscar sabor</span>
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-muted)]" aria-hidden="true" />
                            <input
                              className="h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] pl-9 pr-3 text-base text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand)]"
                              aria-label="Buscar sabor"
                              placeholder="Buscar sabor"
                              value={flavorSearch}
                              onChange={(event) => setFlavorSearch(event.target.value)}
                            />
                          </label>
                        ) : null}

                        <div className="space-y-2">
                          {visiblePizzaFlavors.map((flavor) => {
                            const selected = flavorIds.includes(flavor.id);
                            const unavailableAtLimit = !selected && flavorIds.length >= flavorCount;
                            const fraction = flavorCount === 1 ? 'Inteira' : flavorCount === 2 ? '½' : flavorCount === 3 ? '⅓' : '¼';
                            return (
                              <button
                                key={flavor.id}
                                type="button"
                                onClick={() => togglePizzaFlavor(flavor.id)}
                                disabled={unavailableAtLimit}
                                aria-pressed={selected}
                                aria-label={`${flavor.name} · ${fraction} · ${toBRL(flavor.prices[pizzaSize])}`}
                                className="flex min-h-14 w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                                style={{
                                  borderColor: selected ? 'var(--color-brand)' : 'var(--color-line)',
                                  background: selected ? 'var(--color-brand-soft)' : 'var(--color-surface)',
                                }}
                              >
                                {flavor.photoUrl ? (
                                  <img src={flavor.photoUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" loading="lazy" />
                                ) : (
                                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-muted)] text-xs font-bold text-[var(--color-ink-muted)]">{fraction}</span>
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold text-[var(--color-ink)]">{flavor.name}</span>
                                  {flavor.description ? <span className="mt-0.5 line-clamp-2 block text-xs text-[var(--color-ink-muted)]">{flavor.description}</span> : null}
                                </span>
                                <span className="shrink-0 text-right">
                                  <span className="block text-xs text-[var(--color-ink-muted)]">{fraction}</span>
                                  <span className="block text-xs font-bold text-[var(--color-ink)]">{toBRL(flavor.prices[pizzaSize])}</span>
                                </span>
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: selected ? 'var(--color-brand)' : 'var(--color-line-strong)', background: selected ? 'var(--color-brand)' : 'transparent' }}>
                                  {selected ? <Check className="h-3 w-3 text-white" strokeWidth={3} aria-hidden="true" /> : null}
                                </span>
                              </button>
                            );
                          })}
                          {visiblePizzaFlavors.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-[var(--color-line)] px-3 py-5 text-center text-xs text-[var(--color-ink-muted)]">Nenhum sabor encontrado.</p>
                          ) : null}
                        </div>
                      </div>

                      <p className="rounded-xl bg-[var(--color-surface-muted)] px-3 py-2.5 text-xs leading-relaxed text-[var(--color-ink-muted)]">
                        {product.pizza?.pricingMode === 'average' ? 'O preço é proporcional aos sabores escolhidos.' : 'O preço da pizza será o do sabor de maior valor.'} Bordas, massas e adicionais entram depois.
                      </p>
                    </>
                  ) : null}
                </div>
              </section>
            )}
          {activeGroups.map((group) => (
              <section
                key={group.id}
                ref={(element) => {
                  groupRefs.current[group.id] = element;
                }}
              >
                <div className="mb-2.5">
                  <p className="text-[14px] font-bold text-[var(--color-ink)]">{group.name}</p>
                  <p className="text-[12px] text-[var(--color-ink-muted)]">
                    {groupCounterLabel(group, groupSelectedCount(group, selections[group.id] ?? {}))}
                  </p>
                  {nextRequiredGroup?.id === group.id && group.allowsQuantity && group.minTotalQuantity > quantityTotal(selections[group.id] ?? {}) ? (
                    <p className="mt-1 text-[12px] font-semibold text-[var(--color-alert)]" role="alert">
                      Escolha mais {group.minTotalQuantity - quantityTotal(selections[group.id] ?? {})} {group.minTotalQuantity - quantityTotal(selections[group.id] ?? {}) === 1 ? 'item' : 'itens'}.
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {group.options.filter((o) => o.active && o.linkedProduct?.available !== false).map((option) => {
                    const isSubstituir = group.pricingMode === 'substituir';
                    if (group.allowsQuantity) {
                      const groupSelections = selections[group.id] ?? {};
                      const currentQty = groupSelections[option.id] ?? 0;
                      const checked = currentQty > 0;
                      const unitPrice = option.linkedProduct ? option.linkedProduct.price : option.priceDelta;
                      const optionMax = group.maxPerOption == null && group.maxTotalQuantity == null
                        ? null
                        : Math.min(
                          group.maxPerOption ?? Number.MAX_SAFE_INTEGER,
                          group.maxTotalQuantity == null
                            ? Number.MAX_SAFE_INTEGER
                            : Math.max(0, group.maxTotalQuantity - quantityTotal(groupSelections) + currentQty),
                        );
                      return (
                        <div
                          key={option.id}
                          className="flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5"
                          style={{
                            borderColor: checked ? 'var(--color-brand)' : 'var(--color-line)',
                            background: checked ? 'var(--color-brand-soft)' : 'var(--color-surface)',
                            transition: 'border-color 0.15s, background 0.15s',
                          }}
                        >
                          <div className="flex items-center gap-2.5">
                            {option.linkedProduct?.photoUrl ? (
                              <img
                                src={option.linkedProduct.photoUrl}
                                alt={option.linkedProduct.name}
                                className="h-8 w-8 shrink-0 rounded-lg object-cover"
                              />
                            ) : null}
                            <span className="text-[14px] text-[var(--color-ink)]">
                              {option.linkedProduct ? option.linkedProduct.name : option.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <span className="text-[12px] font-semibold text-[var(--color-ink-soft)]">
                              {unitPrice > 0
                                ? checked
                                  ? `+ ${toBRL(unitPrice * currentQty)}`
                                  : `+ ${toBRL(unitPrice)}`
                                : 'incluso'}
                            </span>
                            <MiniStepper
                              value={currentQty}
                              min={0}
                              max={optionMax}
                              label={option.linkedProduct?.name ?? option.name}
                              onChange={(v) => setOptionQuantity(group.id, option.id, v)}
                            />
                          </div>
                        </div>
                      );
                    }
                    const groupSelections = selections[group.id] ?? {};
                    const checked = groupSelections[option.id] > 0;
                    // Grupo de escolha única (máximo 1): marcar uma opção troca
                    // direto pra outra (não trava as demais) — só grupos com
                    // máximo > 1 bloqueiam opções não marcadas ao bater o teto.
                    const atMax = group.maxSelections != null
                      && group.maxSelections !== 1
                      && !checked
                      && Object.keys(groupSelections).length >= group.maxSelections;
                    return (
                      <label
                        key={option.id}
                        className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${atMax ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
                        style={{
                          borderColor: checked ? 'var(--color-brand)' : 'var(--color-line)',
                          background: checked ? 'var(--color-brand-soft)' : 'var(--color-surface)',
                          transition: 'border-color 0.15s, background 0.15s',
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                            <input
                              type="checkbox"
                              name={group.id}
                              checked={checked}
                              disabled={atMax}
                              onChange={() => toggleOption(group.id, option.id)}
                              className="sr-only"
                            />
                            {group.maxSelections === 1 ? (
                              <span
                                className="flex h-4 w-4 items-center justify-center rounded-full border-2"
                                style={{ borderColor: checked ? 'var(--color-brand)' : 'var(--color-line-strong)' }}
                              >
                                {checked ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-brand)' }} /> : null}
                              </span>
                            ) : (
                              <span
                                className="flex h-4 w-4 items-center justify-center rounded"
                                style={{
                                  border: checked ? 'none' : '2px solid var(--color-line-strong)',
                                  background: checked ? 'var(--color-brand)' : 'transparent',
                                }}
                              >
                                {checked ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
                              </span>
                            )}
                          </span>
                          {option.linkedProduct ? (
                            <div className="flex items-center gap-2.5">
                              {option.linkedProduct.photoUrl ? (
                                <img
                                  src={option.linkedProduct.photoUrl}
                                  alt={option.linkedProduct.name}
                                  className="h-8 w-8 shrink-0 rounded-lg object-cover"
                                />
                              ) : null}
                              <span className="text-[14px] text-[var(--color-ink)]">
                                {option.linkedProduct.name}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[14px] text-[var(--color-ink)]">{option.name}</span>
                          )}
                        </div>
                        <span className="text-[13px] font-semibold text-[var(--color-ink-soft)]">
                          {option.linkedProduct
                            ? isSubstituir
                              ? toBRL(option.linkedProduct.price)
                              : option.linkedProduct.price > 0
                                ? `+ ${toBRL(option.linkedProduct.price)}`
                                : 'incluso'
                            : option.priceDelta > 0
                              ? `+ ${toBRL(option.priceDelta)}`
                              : 'incluso'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}

            {resolution.ok === false ? (
              <div className="rounded-xl border border-[var(--color-alert)] bg-[var(--color-alert-soft)] px-4 py-3 text-[13px] text-[var(--color-alert)]">
                {resolution.message}
              </div>
            ) : null}

            {/* ── Sugestões por categoria ── */}
            {categoryName && categorySuggestions && catalog && cartProductIds && onQuickAdd
              ? (() => {
                  const catSuggestions = resolveCategorySuggestions(catalog, cartProductIds, categoryName, categorySuggestions);
                  if (catSuggestions.length === 0) return null;
                  return (
                    <div>
                      <p className="mb-2 text-[13px] font-semibold text-[var(--color-ink)]">Adicional pra sua {categoryName.toLowerCase()}</p>
                      <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pb-1" style={{ scrollSnapType: 'x mandatory' }}>
                        {catSuggestions.map((p) => (
                          <div
                            key={p.id}
                            className="flex w-[130px] shrink-0 flex-col rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)]"
                            style={{ scrollSnapAlign: 'start' }}
                          >
                            <div className="flex h-[80px] items-center justify-center overflow-hidden rounded-t-xl bg-[var(--color-surface)]">
                              {p.photoUrl ? (
                                <img src={p.photoUrl} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                              ) : (
                                <ImageIcon className="h-6 w-6 text-[var(--color-ink-soft)]" strokeWidth={1.4} />
                              )}
                            </div>
                            <div className="flex flex-1 flex-col justify-between gap-1 p-2">
                              <p className="text-[11px] font-medium leading-tight text-[var(--color-ink)] line-clamp-2">{p.name}</p>
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[12px] font-semibold text-[var(--color-ink)]">{toBRL(p.basePrice)}</span>
                                <button
                                  type="button"
                                  onClick={() => onQuickAdd(p)}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-brand)] text-white transition-transform active:scale-90"
                                  aria-label={`Adicionar ${p.name}`}
                                >
                                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()
              : null}

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor="product-add-notes" className="text-[13px] font-semibold text-[var(--color-ink)]">
                  Alguma observação?
                </label>
                <span className="text-[11px] text-[var(--color-ink-faint)]">
                  {notes.length}/{NOTES_MAX_LENGTH}
                </span>
              </div>
              <textarea
                id="product-add-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX_LENGTH))}
                placeholder="Ex.: sem cebola, ponto da carne…"
                rows={2}
                className="w-full resize-none rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2.5 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand)]"
                style={{ transition: 'border-color 0.15s' }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex shrink-0 items-center gap-3 border-t border-[var(--color-line)] px-5 py-4"
          style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
        >
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setQtyDraft((v) => String(Math.max(1, (parseInt(v, 10) || 0) - 1)))}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-line)]"
              aria-label="Diminuir quantidade"
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={qtyDraft}
              onChange={(e) => setQtyDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              className="h-10 w-12 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] text-center text-[15px] font-bold tabular-nums outline-none focus:border-[var(--color-brand)]"
              aria-label={hasActiveModifiers ? 'Quantidade desta montagem' : 'Quantidade'}
            />
            <button
              type="button"
              onClick={() => setQtyDraft((v) => String((parseInt(v, 10) || 0) + 1))}
              className="flex h-10 w-10 items-center justify-center rounded-full text-white"
              style={{ background: 'var(--color-brand)' }}
              aria-label="Aumentar quantidade"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </div>
          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={!canConfirm && !canGuideToSelection}
            aria-label={primaryActionLabel}
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-[14px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 sm:px-4"
            style={{ background: 'var(--color-brand)' }}
          >
            {pizzaActionLabel || nextRequiredGroup ? (
              <ArrowDown className="h-4 w-4" strokeWidth={2.5} />
            ) : (
              <Plus className="h-4 w-4" strokeWidth={2.5} />
            )}
            <span className="min-w-0 truncate whitespace-nowrap">
              {primaryActionLabel}
              {canConfirm ? ` · ${toBRL(resolution.finalUnitPrice * quantity)}` : ''}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
