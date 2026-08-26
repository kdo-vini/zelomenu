import { useEffect } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { resolveModifierSelections } from '../../domain/zelomenuModifiers';
import type { ZeloMenuCatalogProduct } from '../../services/zelomenuApi';

function toBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function ModifierModal({
  product,
  selections,
  onClose,
  onToggle,
  onQuantityChange,
  onConfirm,
}: {
  product: ZeloMenuCatalogProduct;
  selections: Record<string, Record<string, number>>;
  onClose: () => void;
  onToggle: (groupId: string, optionId: string) => void;
  onQuantityChange: (groupId: string, optionId: string, quantity: number) => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const selectedOptions = Object.entries(selections)
    .map(([groupId, options]) => ({
      groupId,
      optionSelections: Object.entries(options).map(([optionId, quantity]) => ({ optionId, quantity })),
    }))
    .filter((sel) => sel.optionSelections.length > 0);
  const resolution = resolveModifierSelections(product.modifierGroups, selectedOptions, product.basePrice);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-t-3xl bg-[var(--color-surface)] shadow-2xl" style={{ maxHeight: '92vh' }}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
          <div>
            <h3 className="text-[17px] font-bold text-[var(--color-ink)]">{product.name}</h3>
            <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">Escolha as opções antes de adicionar</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-canvas)]"
          >
            <X className="h-4 w-4 text-[var(--color-ink-soft)]" strokeWidth={2} />
          </button>
        </div>

        {/* Options */}
        <div className="space-y-4 overflow-y-auto px-5 py-4" style={{ maxHeight: 'calc(92vh - 160px)' }}>
          {product.modifierGroups.map((group) => {
            const groupSelections = selections[group.id] ?? {};
            const selectedTotal = group.allowsQuantity
              ? Object.values(groupSelections).reduce((total, quantity) => total + quantity, 0)
              : Object.keys(groupSelections).length;
            return (
              <section key={group.id}>
                <div className="mb-2.5">
                  <p className="text-[14px] font-bold text-[var(--color-ink)]">{group.name}</p>
                  <p className="text-[12px] text-[var(--color-ink-muted)]">
                    {group.allowsQuantity && group.minTotalQuantity > 0
                      ? group.minTotalQuantity === group.maxTotalQuantity
                        ? `Escolha ${group.minTotalQuantity} itens · ${selectedTotal} de ${group.maxTotalQuantity}`
                        : `Escolha pelo menos ${group.minTotalQuantity} itens · ${selectedTotal}${group.maxTotalQuantity != null ? ` de ${group.maxTotalQuantity}` : ''}`
                      : group.minSelections > 0
                        ? `Obrigatório · mínimo ${group.minSelections}`
                        : 'Opcional'}
                    {group.allowsQuantity && group.maxSelections != null ? ` · até ${group.maxSelections} opções diferentes` : null}
                    {!group.allowsQuantity && group.maxSelections != null ? ` · máximo ${group.maxSelections}` : null}
                  </p>
                </div>
                <div className="space-y-2">
                  {group.options.filter((o) => o.active && o.linkedProduct?.available !== false).map((option) => {
                    const currentQuantity = groupSelections[option.id] ?? 0;
                    const checked = currentQuantity > 0;
                    if (group.allowsQuantity) {
                      const totalWithoutOption = selectedTotal - currentQuantity;
                      const max = group.maxPerOption == null && group.maxTotalQuantity == null
                        ? null
                        : Math.min(
                          group.maxPerOption ?? Number.MAX_SAFE_INTEGER,
                          group.maxTotalQuantity == null
                            ? Number.MAX_SAFE_INTEGER
                            : Math.max(0, group.maxTotalQuantity - totalWithoutOption),
                        );
                      return (
                        <div key={option.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] px-4 py-3">
                          <span className="text-[14px] text-[var(--color-ink)]">{option.linkedProduct ? option.linkedProduct.name : option.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-semibold text-[var(--color-ink-soft)]">
                              {(option.linkedProduct?.price ?? option.priceDelta) > 0
                                ? `+ ${toBRL((option.linkedProduct?.price ?? option.priceDelta) * Math.max(1, currentQuantity))}`
                                : 'incluso'}
                            </span>
                            <div className="inline-flex items-center rounded-lg border border-[var(--color-line)]">
                              <button type="button" onClick={() => onQuantityChange(group.id, option.id, currentQuantity - 1)} disabled={currentQuantity <= 0} className="flex h-8 w-8 items-center justify-center disabled:opacity-30" aria-label={`Diminuir quantidade de ${option.name}`}>
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <span className="min-w-7 text-center text-sm font-semibold tabular-nums" aria-live="polite">{currentQuantity}</span>
                              <button type="button" onClick={() => onQuantityChange(group.id, option.id, currentQuantity + 1)} disabled={max != null && currentQuantity >= max} className="flex h-8 w-8 items-center justify-center disabled:opacity-30" aria-label={`Aumentar quantidade de ${option.name}${max != null ? ` (limite ${max})` : ''}`}>
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3"
                        style={{
                          borderColor: checked ? 'var(--color-brand)' : 'var(--color-line)',
                          background: checked ? 'var(--color-brand-soft)' : 'var(--color-surface)',
                          transition: 'border-color 0.15s, background 0.15s',
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type={group.maxSelections === 1 ? 'radio' : 'checkbox'}
                            name={group.id}
                            checked={checked}
                            onChange={() => onToggle(group.id, option.id)}
                            className="h-4 w-4 accent-[var(--color-brand)]"
                          />
                          <span className="text-[14px] text-[var(--color-ink)]">
                            {option.linkedProduct ? option.linkedProduct.name : option.name}
                          </span>
                        </div>
                        <span className="text-[13px] font-semibold text-[var(--color-ink-soft)]">
                          {option.linkedProduct
                            ? group.pricingMode === 'substituir'
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
            );
          })}

          {resolution.ok === false ? (
            <div className="rounded-xl border border-[var(--color-alert)] bg-[var(--color-alert-soft)] px-4 py-3 text-[13px] text-[var(--color-alert)]">
              {resolution.message}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] px-5 py-4" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
          <p className="text-[14px] font-bold text-[var(--color-ink)]">
            {resolution.ok ? toBRL(resolution.finalUnitPrice) : '—'}
          </p>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!resolution.ok}
            className="inline-flex h-11 items-center gap-2 rounded-xl px-6 text-[14px] font-bold text-white disabled:opacity-40"
            style={{ background: 'var(--color-brand)' }}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Adicionar
          </button>
        </div>
      </div>
    </div>
  );
}
