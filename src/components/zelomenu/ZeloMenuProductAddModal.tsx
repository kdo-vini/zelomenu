import { useEffect, useState } from 'react';
import { Check, ImageIcon, Minus, Plus, X } from 'lucide-react';
import { resolveModifierSelections } from '../../domain/zelomenuModifiers';
import { resolveCategorySuggestions } from '../../domain/zelomenuCategorySuggestions';
import type { ZeloMenuCatalogGroup, ZeloMenuCatalogProduct } from '../../services/zelomenuApi';

const NOTES_MAX_LENGTH = 200;

function toBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Mini-stepper para opções com quantidade (visualmente menor que o stepper do produto). */
function MiniStepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number | null;
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
        aria-label="Diminuir"
      >
        <Minus className="h-3 w-3" strokeWidth={2.5} />
      </button>
      <span className="flex h-7 min-w-[1.5rem] items-center justify-center text-[13px] font-semibold tabular-nums text-[var(--color-ink)]">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={atMax}
        className="flex h-7 w-7 items-center justify-center rounded-r-lg text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="Aumentar"
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
  onClose,
  onConfirm,
  categoryName,
  categorySuggestions,
  catalog,
  cartProductIds,
  onQuickAdd,
}: {
  product: ZeloMenuCatalogProduct;
  initialQuantity: number;
  initialNotes: string;
  onClose: () => void;
  onConfirm: (quantity: number, notes: string, selections: Record<string, Array<{ optionId: string; quantity: number }>>) => void;
  categoryName?: string;
  categorySuggestions?: Record<string, number[]>;
  catalog?: ZeloMenuCatalogGroup[];
  cartProductIds?: number[];
  onQuickAdd?: (product: ZeloMenuCatalogProduct) => void;
}) {
  const [selections, setSelections] = useState<Record<string, Record<string, number>>>({});
  const [qtyDraft, setQtyDraft] = useState(String(Math.max(1, initialQuantity)));
  const [notes, setNotes] = useState(initialNotes);
  const isEditing = initialQuantity > 0;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  function setOptionQuantity(groupId: string, optionId: string, quantity: number) {
    setSelections((prev) => {
      const group = product.modifierGroups.find((g) => g.id === groupId);
      if (!group) return prev;
      const groupSelections = { ...(prev[groupId] ?? {}) };
      if (quantity <= 0) {
        delete groupSelections[optionId];
      } else {
        groupSelections[optionId] = quantity;
      }
      if (group.allowsQuantity) return { ...prev, [groupId]: groupSelections };
      // Legacy toggle behavior (no quantity)
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
  const resolution = resolveModifierSelections(product.modifierGroups, selectedOptions, product.basePrice);
  const quantity = parseInt(qtyDraft, 10);
  const validQuantity = !isNaN(quantity) && quantity > 0;
  const canConfirm = resolution.ok && validQuantity;

  function confirm() {
    if (!canConfirm) return;
    const selectionsArray = Object.entries(selections).reduce<
      Record<string, Array<{ optionId: string; quantity: number }>>
    >((acc, [groupId, opts]) => {
      const entries = Object.entries(opts).map(([optionId, qty]) => ({ optionId, quantity: qty }));
      if (entries.length > 0) acc[groupId] = entries;
      return acc;
    }, {});
    onConfirm(quantity, notes.trim(), selectionsArray);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div
        className="flex w-full max-w-md flex-col rounded-t-3xl bg-[var(--color-surface)] shadow-2xl"
        style={{ maxHeight: '92vh' }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            Detalhes do produto
          </p>
          <button
            type="button"
            onClick={onClose}
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
              <h3 className="text-[17px] font-bold leading-snug text-[var(--color-ink)]">{product.name}</h3>
              {product.description ? (
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                  {product.description}
                </p>
              ) : null}
              <p className="mt-2 text-[15px] font-bold" style={{ color: 'var(--color-brand-deep)' }}>
                {resolution.ok ? toBRL(resolution.finalUnitPrice) : toBRL(product.basePrice)}
              </p>
            </div>

            {product.modifierGroups.filter((g) => g.active).map((group) => (
              <section key={group.id}>
                <div className="mb-2.5">
                  <p className="text-[14px] font-bold text-[var(--color-ink)]">{group.name}</p>
                  <p className="text-[12px] text-[var(--color-ink-muted)]">
                    {group.minSelections > 0
                      ? `Obrigatório · mínimo ${group.minSelections}`
                      : 'Opcional'}
                    {group.maxSelections != null ? ` · máximo ${group.maxSelections}` : ''}
                  </p>
                </div>
                <div className="space-y-2">
                  {group.options.filter((o) => o.active && o.linkedProduct?.available !== false).map((option) => {
                    const isSubstituir = group.pricingMode === 'substituir';
                    if (group.allowsQuantity) {
                      const groupSelections = selections[group.id] ?? {};
                      const currentQty = groupSelections[option.id] ?? 0;
                      const checked = currentQty > 0;
                      const unitPrice = option.linkedProduct ? option.linkedProduct.price : option.priceDelta;
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
                              max={group.maxPerOption ?? null}
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
              aria-label="Quantidade"
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
            onClick={confirm}
            disabled={!canConfirm}
            aria-label="Adicionar ao pedido"
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--color-brand)' }}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            {isEditing ? 'Atualizar' : 'Adicionar'}
            {validQuantity && resolution.ok ? ` · ${toBRL(resolution.finalUnitPrice * quantity)}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
