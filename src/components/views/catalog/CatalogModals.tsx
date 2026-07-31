import { useEffect, useState, useId, type FormEvent, type ReactNode } from 'react';
import { Check, Globe2, Loader2, X } from 'lucide-react';
import { ConfirmModal } from '../../ConfirmModal';
import { Modal } from '../../Modal';
import type {
  Categoria,
  Subcategoria,
  ProdutoRow,
  ZeloMenuModifierGroupRow,
  CategoriaInput,
  SubcategoriaInput,
} from '../../../hooks/useCatalog';
import type { ZeloMenuModifierGroupDraft } from '../../../domain/zelomenuModifiers';

type ModalShellProps = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
};

export function ModalShell({ title, subtitle, onClose, children, wide = false }: ModalShellProps) {
  const titleId = useId();

  return (
    <Modal
      open
      onClose={onClose}
      titleId={titleId}
      // Mobile-first: full-width bottom sheet pinned to the bottom edge,
      // capped at 92dvh and scrollable. On sm+ it becomes a centered dialog.
      containerClassName="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      backdropClassName="zm-backdrop absolute inset-0 bg-black/45 backdrop-blur-[1px]"
      panelLayoutClassName={`w-full ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'}`}
      panelClassName="zm-sheet flex max-h-[92dvh] flex-col overflow-hidden rounded-t-2xl bg-[var(--color-surface)] shadow-xl sm:max-h-[88vh] sm:rounded-2xl"
    >
      {/* Grab handle — affordance that this is a draggable-feeling sheet (mobile only) */}
      <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
        <span className="h-1.5 w-10 rounded-full bg-[var(--color-line-strong)]" />
      </div>

      {/* Sticky header */}
      <div className="relative z-30 flex shrink-0 items-start justify-between gap-4 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-5 pb-4 pt-3 sm:pt-4">
        <div className="min-w-0">
          <h3 id={titleId} className="text-[17px] font-bold leading-tight text-[var(--color-ink)] sm:text-base">
            {title}
          </h3>
          {subtitle && <p className="mt-1 text-[13px] leading-snug text-[var(--color-ink-muted)] sm:text-xs">{subtitle}</p>}
        </div>
        <button
          onClick={onClose}
          className="-mr-1 -mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink-soft)]"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Scrollable body. Children that use <ActionBar> render their own
       * pinned footer via the `sticky` class inside ActionBar. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 [padding-bottom:env(safe-area-inset-bottom)]">
        {children}
      </div>
    </Modal>
  );
}

type ActionBarProps = {
  onCancel: () => void;
  submitLabel: string;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  dirty?: boolean;
};

export function ActionBar({ onCancel, submitLabel, loading, disabled, destructive, saveStatus, dirty = false }: ActionBarProps) {
  return (
    // Pinned to the bottom of the scroll area: on mobile the primary action is
    // always reachable with the thumb. Full-width buttons on mobile, right-
    // aligned auto-width on sm+. Reversed DOM order so primary sits on the
    // right on desktop while staying first (bottom-most = easiest reach) on mobile.
    <div className="sticky bottom-0 -mx-5 -mb-5 mt-6 flex flex-col-reverse gap-2 border-t border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-4 sm:flex-row sm:justify-end sm:py-3">
      {(saveStatus && (dirty || saveStatus !== 'idle')) ? (
        <div className="flex min-h-[44px] items-center sm:mr-auto">
          <SaveIndicator status={saveStatus} dirty={dirty} />
        </div>
      ) : <span className="hidden sm:block sm:mr-auto" />}
      <button
        type="button"
        onClick={onCancel}
        className="min-h-[44px] rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-muted)] sm:min-h-0 sm:py-2"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={loading || disabled}
        className={`min-h-[44px] rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-[var(--color-line-strong)] sm:min-h-0 sm:py-2 ${
          destructive
            ? 'bg-[var(--color-alert)] hover:brightness-95'
            : 'bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)]'
        }`}
      >
        {loading ? 'Salvando…' : submitLabel}
      </button>
    </div>
  );
}

export const LABEL_CLS = 'block text-[13px] font-semibold text-[var(--color-ink-soft)] mb-1.5';
// 16px on mobile prevents iOS Safari from zooming the viewport on focus.
export const INPUT_CLS =
  'w-full rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3.5 py-2.5 text-base text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] transition-colors focus:border-[var(--color-brand)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 sm:text-sm';

// ---------- Categoria ----------
type CategoriaModalProps = {
  open: boolean;
  initial?: Categoria | null;
  onClose: () => void;
  onSubmit: (patch: CategoriaInput) => Promise<void>;
};

export function CategoriaModal({ open, initial, onClose, onSubmit }: CategoriaModalProps) {
  const [nome, setNome] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNome(initial?.nome ?? '');
      setErr(null);
    }
  }, [open, initial]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = nome.trim();
    if (!trimmed) {
      setErr('Informe o nome da categoria.');
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      await onSubmit({ nome: trimmed });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      title={initial ? 'Editar categoria' : 'Nova categoria'}
      subtitle="Categorias ajudam a IA a organizar seu cardápio."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <label className={LABEL_CLS}>Nome</label>
        <input
          autoFocus
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex: Bebidas, Lanches, Sobremesas"
          className={INPUT_CLS}
        />
        {err && <p className="mt-2 text-xs text-[var(--color-alert)]">{err}</p>}
        <ActionBar onCancel={onClose} submitLabel={initial ? 'Salvar' : 'Criar categoria'} loading={loading} />
      </form>
    </ModalShell>
  );
}

// ---------- Subcategoria ----------
type SubcategoriaModalProps = {
  open: boolean;
  initial?: Subcategoria | null;
  defaultCategoriaId?: number | null;
  categorias: Categoria[];
  onClose: () => void;
  onSubmit: (patch: SubcategoriaInput) => Promise<void>;
};

export function SubcategoriaModal({
  open,
  initial,
  defaultCategoriaId,
  categorias,
  onClose,
  onSubmit,
}: SubcategoriaModalProps) {
  const [nome, setNome] = useState('');
  const [idCategoria, setIdCategoria] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNome(initial?.nome ?? '');
      setIdCategoria(initial?.id_categoria ?? defaultCategoriaId ?? (categorias[0]?.id ?? ''));
      setErr(null);
    }
  }, [open, initial, defaultCategoriaId, categorias]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = nome.trim();
    if (!trimmed) {
      setErr('Informe o nome da subcategoria.');
      return;
    }
    if (!idCategoria) {
      setErr('Selecione uma categoria.');
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      await onSubmit({ nome: trimmed, id_categoria: Number(idCategoria) });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      title={initial ? 'Editar subcategoria' : 'Nova subcategoria'}
      subtitle="Subcategorias dividem uma categoria em seções (ex: Pizzas Doces, Pizzas Salgadas)."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={LABEL_CLS}>Nome</label>
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex: Refrigerantes, Sucos"
            className={INPUT_CLS}
          />
        </div>

        <div>
          <label className={LABEL_CLS}>Categoria</label>
          <select
            value={idCategoria}
            onChange={(e) => setIdCategoria(e.target.value === '' ? '' : Number(e.target.value))}
            className={INPUT_CLS}
          >
            <option value="">Selecione...</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>

        {err && <p className="text-xs text-[var(--color-alert)]">{err}</p>}
        <ActionBar onCancel={onClose} submitLabel={initial ? 'Salvar' : 'Criar subcategoria'} loading={loading} />
      </form>
    </ModalShell>
  );
}

export function toModifierDrafts(
  groups: ZeloMenuModifierGroupRow[],
  optionProducts: Record<string, { productId: number; priceOverride: number | null }>,
): ZeloMenuModifierGroupDraft[] {
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    kind: group.kind,
    pricingMode: group.pricingMode,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    allowsQuantity: group.allowsQuantity,
    maxPerOption: group.maxPerOption,
    active: group.active,
    order: group.order,
    options: group.options.map((option) => {
      const link = optionProducts[option.id];
      return {
        id: option.id,
        name: option.name,
        priceDelta: option.priceDelta,
        active: option.active,
        order: option.order,
        linkedProductId: link?.productId ?? null,
        priceOverride: link?.priceOverride ?? null,
      };
    }),
  }));
}

export function SaveIndicator({ status, dirty }: { status: 'idle' | 'saving' | 'saved' | 'error'; dirty: boolean }) {
  if (status === 'saving') {
    return <span aria-live="polite" className="inline-flex whitespace-nowrap items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" />{'Salvando\u2026'}</span>;
  }
  if (status === 'error') {
    return <span aria-live="polite" className="whitespace-nowrap text-xs font-semibold text-[var(--color-alert)]">{'N\u00e3o salvo'}</span>;
  }
  if (dirty) {
    return <span aria-live="polite" className="whitespace-nowrap text-xs font-semibold text-[var(--color-ink-soft)]">{'Altera\u00e7\u00f5es n\u00e3o salvas'}</span>;
  }
  if (status === 'saved') {
    return <span aria-live="polite" className="inline-flex whitespace-nowrap items-center gap-1.5 text-xs font-semibold text-[var(--color-brand-deep)]"><Check className="h-3.5 w-3.5" /> Salvo</span>;
  }
  return null;
}

export function ToggleCard({
  checked,
  disabled = false,
  title,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex min-h-[72px] items-start gap-3 rounded-xl border p-3 ${checked ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]/40' : 'border-[var(--color-line)] bg-[var(--color-surface)]'} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <span>
        <span className="block text-sm font-semibold text-[var(--color-ink)]">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-[var(--color-ink-muted)]">{description}</span>
      </span>
    </label>
  );
}

export function ProductCardPreview({
  product,
  name,
  description,
  photoUrl,
}: {
  product: ProdutoRow;
  name: string;
  description: string;
  photoUrl: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex aspect-square items-center justify-center bg-[var(--color-canvas)] p-3">
        {photoUrl ? (
          <img src={photoUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <Globe2 className="h-8 w-8 text-[var(--color-line-strong)]" />
        )}
      </div>
      <div className="flex min-h-[108px] flex-col gap-1 p-3">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-[var(--color-ink)]">{name}</p>
        {description ? <p className="line-clamp-2 text-[11px] leading-snug text-[var(--color-ink-muted)]">{description}</p> : null}
        <p className="mt-auto pt-2 text-[13px] font-bold text-[var(--color-brand-deep)]">
          {product.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
        </p>
      </div>
    </div>
  );
}


export function createEmptyModifierGroup(order: number): ZeloMenuModifierGroupDraft {
  return {
    name: '',
    kind: 'adicional',
    pricingMode: 'somar',
    minSelections: 0,
    maxSelections: null,
    allowsQuantity: false,
    maxPerOption: null,
    active: true,
    order,
    options: [{ name: '', priceDelta: 0, active: true, order, linkedProductId: null, priceOverride: null }],
  };
}

// ---------- Confirm Delete ----------
type ConfirmDeleteProps = {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function ConfirmDelete({ open, title, message, onClose, onConfirm }: ConfirmDeleteProps) {
  return (
    <ConfirmModal
      open={open}
      title={title}
      message={message}
      onClose={onClose}
      onConfirm={onConfirm}
      confirmLabel="Excluir"
      confirmLoadingLabel="Excluindo..."
    />
  );
}
