import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, ExternalLink, Globe2, Loader2, Sparkles, X } from 'lucide-react';
import { motion, useMotionValue, useTransform } from 'motion/react';
import { ConfirmModal } from '../../ConfirmModal';
import { Modal, useModalTitleId } from '../../Modal';
import { ImageCropField } from '../../zelomenu/ImageCropField';
import type {
  Categoria,
  Subcategoria,
  ProdutoRow,
  ZeloMenuModifierGroupRow,
  ZeloMenuProductPublicationInput,
  ZeloMenuProductPublicationRow,
  CategoriaInput,
  SubcategoriaInput,
  ProdutoInput,
} from '../../../hooks/useCatalog';
import {
  validateModifierGroupDrafts,
  type ZeloMenuModifierGroupDraft,
  type ZeloMenuModifierGroupKind,
} from '../../../domain/zelomenuModifiers';

type ModalShellProps = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
};

function ModalShell({ title, subtitle, onClose, children, wide = false }: ModalShellProps) {
  const titleId = useModalTitleId();

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
      <div className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-5 pb-4 pt-3 sm:pt-4">
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
};

function ActionBar({ onCancel, submitLabel, loading, disabled, destructive }: ActionBarProps) {
  return (
    // Pinned to the bottom of the scroll area: on mobile the primary action is
    // always reachable with the thumb. Full-width buttons on mobile, right-
    // aligned auto-width on sm+. Reversed DOM order so primary sits on the
    // right on desktop while staying first (bottom-most = easiest reach) on mobile.
    <div className="sticky bottom-0 -mx-5 -mb-5 mt-6 flex flex-col-reverse gap-2 border-t border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-4 sm:flex-row sm:justify-end sm:py-3">
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

const LABEL_CLS = 'block text-[13px] font-semibold text-[var(--color-ink-soft)] mb-1.5';
// 16px on mobile prevents iOS Safari from zooming the viewport on focus.
const INPUT_CLS =
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

// ---------- Produto ----------
type ProductModalProps = {
  open: boolean;
  initial?: ProdutoRow | null;
  defaultCategoriaId?: number | null;
  defaultSubcategoriaId?: number | null;
  categorias: Categoria[];
  subcategorias: Subcategoria[];
  onClose: () => void;
  onSubmit: (patch: ProdutoInput) => Promise<void>;
};

export function ProductModal({
  open,
  initial,
  defaultCategoriaId,
  defaultSubcategoriaId,
  categorias,
  subcategorias,
  onClose,
  onSubmit,
}: ProductModalProps) {
  const [nome, setNome] = useState('');
  const [precoStr, setPrecoStr] = useState('');
  const [idCategoria, setIdCategoria] = useState<number | ''>('');
  const [idSubcategoria, setIdSubcategoria] = useState<number | ''>('');
  const [ocultar, setOcultar] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNome(initial?.nome ?? '');
      setPrecoStr(initial ? formatPrecoInput(initial.preco) : '');
      setIdCategoria(initial?.id_categoria ?? defaultCategoriaId ?? '');
      setIdSubcategoria(initial?.id_subcategoria ?? defaultSubcategoriaId ?? '');
      setOcultar(initial?.ocultar_no_pdv ?? false);
      setErr(null);
    }
  }, [open, initial, defaultCategoriaId, defaultSubcategoriaId]);

  if (!open) return null;

  const subcategoriasFiltered = subcategorias.filter((s) => (idCategoria ? s.id_categoria === Number(idCategoria) : true));

  const handleCategoriaChange = (v: string) => {
    const newId = v === '' ? '' : Number(v);
    setIdCategoria(newId);
    // Reset subcategoria if it no longer belongs
    if (idSubcategoria && newId) {
      const stillValid = subcategorias.some((s) => s.id === idSubcategoria && s.id_categoria === newId);
      if (!stillValid) setIdSubcategoria('');
    } else if (!newId) {
      setIdSubcategoria('');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = nome.trim();
    if (!trimmed) {
      setErr('Informe o nome do produto.');
      return;
    }
    const preco = parsePrecoInput(precoStr);
    if (Number.isNaN(preco) || preco < 0) {
      setErr('Informe um preço válido.');
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      await onSubmit({
        nome: trimmed,
        preco,
        id_categoria: idCategoria ? Number(idCategoria) : null,
        id_subcategoria: idSubcategoria ? Number(idSubcategoria) : null,
        ocultar_no_pdv: ocultar,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      title={initial ? 'Editar produto' : 'Novo produto'}
      subtitle="Cadastro rápido — a IA usa esses dados para responder clientes."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={LABEL_CLS}>Nome</label>
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex: X-Tudo, Coca-Cola 2L"
            className={INPUT_CLS}
          />
        </div>

        <div>
          <label className={LABEL_CLS}>Preço (R$)</label>
          <input
            value={precoStr}
            onChange={(e) => setPrecoStr(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            className={INPUT_CLS}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Categoria</label>
            <select
              value={idCategoria}
              onChange={(e) => handleCategoriaChange(e.target.value)}
              className={INPUT_CLS}
            >
              <option value="">Sem categoria</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_CLS}>Subcategoria</label>
            <select
              value={idSubcategoria}
              onChange={(e) => setIdSubcategoria(e.target.value === '' ? '' : Number(e.target.value))}
              disabled={!idCategoria || subcategoriasFiltered.length === 0}
              className={`${INPUT_CLS} disabled:cursor-not-allowed disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-ink-faint)]`}
            >
              <option value="">Nenhuma</option>
              {subcategoriasFiltered.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={ocultar}
            onChange={(e) => setOcultar(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--color-line-strong)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]/30"
          />
          Ocultar nos cardápios (produto fica inativo)
        </label>

        <div className="rounded-lg bg-[#F2F3F8] p-3 text-[12px] text-[var(--color-ink-soft)]">
          Para detalhes avançados de estoque e imagens próprias, acesse o{' '}
          <a
            href="https://zelopdv.com.br"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-[var(--color-brand-deep)] hover:underline"
          >
            ZeloPDV <ExternalLink className="h-3 w-3" />
          </a>
          .
        </div>

        {err && <p className="text-xs text-[var(--color-alert)]">{err}</p>}
        <ActionBar onCancel={onClose} submitLabel={initial ? 'Salvar' : 'Criar produto'} loading={loading} />
      </form>
    </ModalShell>
  );
}

// ---------- Publicação ZeloMenu ----------
type ProductPublicationModalProps = {
  open: boolean;
  product: ProdutoRow | null;
  products: ProdutoRow[];
  initial?: ZeloMenuProductPublicationRow | null;
  modifierGroups: ZeloMenuModifierGroupRow[];
  uploadImage: (productId: number, file: File, previousUrl?: string | null) => Promise<string>;
  deleteImage: (url: string | null | undefined) => Promise<void>;
  onClose: () => void;
  onNavigate: (product: ProdutoRow) => void;
  onSavePublication: (
    productId: number,
    patch: ZeloMenuProductPublicationInput,
  ) => Promise<ZeloMenuProductPublicationRow>;
  onSaveModifierGroups: (
    productId: number,
    modifierGroups: ZeloMenuModifierGroupDraft[],
  ) => Promise<ZeloMenuModifierGroupRow[]>;
};

export function ProductPublicationModal({
  open,
  product,
  products,
  initial,
  modifierGroups,
  uploadImage,
  deleteImage,
  onClose,
  onNavigate,
  onSavePublication,
  onSaveModifierGroups,
}: ProductPublicationModalProps) {
  const [visivelOnline, setVisivelOnline] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [nomePublico, setNomePublico] = useState('');
  const [descricaoPublica, setDescricaoPublica] = useState('');
  const [fotoUrl, setFotoUrl] = useState('');
  const [ordem, setOrdem] = useState('0');
  const [groupsDraft, setGroupsDraft] = useState<ZeloMenuModifierGroupDraft[]>([]);
  const [groupsDirty, setGroupsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [aiLoadingDesc, setAiLoadingDesc] = useState(false);
  const hydratedProductRef = useRef<number | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveTokenRef = useRef(0);
  const swipeRef = useRef({ startX: 0, startY: 0, dragging: false, suppressed: false });

  // Tinder card animation state
  const cardX = useMotionValue(0);
  const cardRotate = useTransform(cardX, [-300, 0, 300], [-6, 0, 6]);
  const cardScale = useTransform(cardX, [-300, 0, 300], [0.94, 1, 0.94]);
  const cardOpacity = useTransform(cardX, [-250, 0, 250], [0.85, 1, 0.85]);

  useEffect(() => {
    if (!open) {
      hydratedProductRef.current = null;
      return;
    }
    if (!product || hydratedProductRef.current === product.id) return;
    hydratedProductRef.current = product.id;
    setVisivelOnline(initial?.visivel_online ?? false);
    setPausado(initial?.pausado_manualmente ?? false);
    setNomePublico(initial?.nome_publico ?? '');
    setDescricaoPublica(initial?.descricao_publica ?? '');
    setFotoUrl(initial?.foto_url ?? '');
    setOrdem(String(initial?.ordem ?? 0));
    setGroupsDraft(toModifierDrafts(modifierGroups));
    setGroupsDirty(false);
    setSaveStatus('idle');
    setErr(null);
    setAiLoadingDesc(false);
    cardX.set(0);
  }, [open, product, initial, modifierGroups, cardX]);

  const enqueueSave = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    const token = ++saveTokenRef.current;
    setSaveStatus('saving');
    setErr(null);
    const next = queueRef.current.catch(() => undefined).then(operation);
    queueRef.current = next;
    try {
      const result = await next;
      if (saveTokenRef.current === token) setSaveStatus('saved');
      return result;
    } catch (error) {
      if (saveTokenRef.current === token) setSaveStatus('error');
      setErr(error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.');
      throw error;
    }
  }, []);

  const savePublication = useCallback((patch: ZeloMenuProductPublicationInput) => {
    if (!product) return Promise.resolve(null);
    return enqueueSave(() => onSavePublication(product.id, patch));
  }, [enqueueSave, onSavePublication, product]);

  useEffect(() => {
    if (!open || !product || hydratedProductRef.current !== product.id) return;
    const timer = window.setTimeout(() => {
      void savePublication({
        nome_publico: nomePublico,
        descricao_publica: descricaoPublica,
      }).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [descricaoPublica, nomePublico, open, product, savePublication]);

  if (!open || !product) return null;

  const productId = product.id;
  const productIndex = products.findIndex((entry) => entry.id === product.id);
  const previousProduct = productIndex > 0 ? products[productIndex - 1] : null;
  const nextProduct = productIndex >= 0 && productIndex < products.length - 1 ? products[productIndex + 1] : null;
  const currentPhotoUrl = fotoUrl.trim() || null;

  async function flushAll(): Promise<boolean> {
    const parsedOrder = Number.parseInt(ordem, 10);
    if (!Number.isFinite(parsedOrder) || parsedOrder < 0) {
      setErr('Informe uma ordem válida.');
      return false;
    }
    const trimmedFoto = fotoUrl.trim();
    if (trimmedFoto && !/^https:\/\//i.test(trimmedFoto)) {
      setErr('Use um link de foto começando com https://.');
      return false;
    }
    const draftError = validateModifierGroupDrafts(groupsDraft);
    if (draftError) {
      setErr(draftError);
      return false;
    }
    try {
      await savePublication({
          visivel_online: visivelOnline,
          pausado_manualmente: visivelOnline ? pausado : false,
          nome_publico: nomePublico,
          descricao_publica: descricaoPublica,
          foto_url: trimmedFoto || null,
          ordem: parsedOrder,
      });
      if (groupsDirty) {
        await enqueueSave(() => onSaveModifierGroups(productId, groupsDraft));
        setGroupsDirty(false);
      }
      return true;
    } catch {
      return false;
    }
  }

  async function finish(action: () => void) {
    if (await flushAll()) action();
  }

  async function navigateTo(target: ProdutoRow | null) {
    if (!target) return;
    await finish(() => onNavigate(target));
  }

  return (
    <ModalShell
      title={product.nome}
      subtitle={products.length > 1 ? `Produto ${productIndex + 1} de ${products.length} · deslize para navegar` : 'Publicação no ZeloMenu'}
      onClose={() => void finish(onClose)}
      wide
    >
      <div
        className="space-y-5"
        onPointerDown={(event) => {
          swipeRef.current.startX = event.clientX;
          swipeRef.current.startY = event.clientY;
          swipeRef.current.dragging = true;
          swipeRef.current.suppressed = false;
        }}
        onPointerMove={(event) => {
          if (!swipeRef.current.dragging) return;
          if (!swipeRef.current.suppressed) {
            const target = event.target as HTMLElement;
            const tag = target.tagName.toLowerCase();
            if (['input', 'textarea', 'select', 'button', 'label'].includes(tag) || target.closest('label, button, [role="slider"]')) {
              swipeRef.current.suppressed = true;
              swipeRef.current.dragging = false;
              cardX.set(0);
              return;
            }
            // only start after 10px to avoid accidental triggers
            if (Math.abs(event.clientX - swipeRef.current.startX) > 10) {
              swipeRef.current.suppressed = true;
            }
          }
          const deltaX = event.clientX - swipeRef.current.startX;
          const deltaY = event.clientY - swipeRef.current.startY;
          if (Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
            cardX.set(0);
            return;
          }
          cardX.set(deltaX);
        }}
        onPointerUp={(event) => {
          swipeRef.current.dragging = false;
          const deltaX = event.clientX - swipeRef.current.startX;
          const velocity = Math.abs(event.movementX);
          if (Math.abs(deltaX) > 70 || velocity > 400) {
            void navigateTo(deltaX > 0 ? previousProduct : nextProduct);
          } else {
            cardX.set(0);
          }
        }}
        onPointerLeave={() => {
          if (swipeRef.current.dragging) {
            swipeRef.current.dragging = false;
            cardX.set(0);
          }
        }}
      >
        <motion.div
          style={{ x: cardX, rotate: cardRotate, scale: cardScale, opacity: cardOpacity }}
          transition={{ type: 'spring', stiffness: 300, damping: 30, mass: 0.8 }}
        >
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--color-surface-muted)] p-2">
          <button
            type="button"
            onClick={() => void navigateTo(previousProduct)}
            disabled={!previousProduct || saveStatus === 'saving'}
            className="flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-sm font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-surface)] disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Anterior</span>
          </button>
          <SaveIndicator status={saveStatus} />
          <button
            type="button"
            onClick={() => void navigateTo(nextProduct)}
            disabled={!nextProduct || saveStatus === 'saving'}
            className="flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-sm font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-surface)] disabled:opacity-35"
          >
            <span className="hidden sm:inline">Próximo</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleCard
                checked={visivelOnline}
                title="Publicado no ZeloMenu"
                description="Aparece no link quando estiver disponível."
                onChange={(checked) => {
                  setVisivelOnline(checked);
                  if (!checked) setPausado(false);
                  void savePublication({
                    visivel_online: checked,
                    pausado_manualmente: checked ? pausado : false,
                  }).catch(() => undefined);
                }}
              />
              <ToggleCard
                checked={pausado}
                disabled={!visivelOnline}
                title="Pausar temporariamente"
                description="Mantém configurado, mas esconde por enquanto."
                onChange={(checked) => {
                  setPausado(checked);
                  void savePublication({ pausado_manualmente: checked }).catch(() => undefined);
                }}
              />
            </div>

            <div>
              <label className={LABEL_CLS}>Nome público</label>
              <input
                value={nomePublico}
                onChange={(event) => setNomePublico(event.target.value)}
                placeholder={product.nome}
                className={INPUT_CLS}
              />
            </div>
            <div className="group relative">
              <div className="flex items-center justify-between">
                <label className={LABEL_CLS}>Descrição pública</label>
                <button
                  type="button"
                  disabled={aiLoadingDesc}
                  onClick={() => {
                    const name = nomePublico.trim() || product.nome;
                    setAiLoadingDesc(true);
                    import('../../../services/zelomenuAdminApi').then((m) =>
                      m.generateZeloMenuProductDescription(name).then((t) => {
                        setDescricaoPublica(t);
                        setAiLoadingDesc(false);
                      }).catch(() => setAiLoadingDesc(false)),
                    );
                  }}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--color-ink-faint)] opacity-0 transition-all hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-brand)] group-hover:opacity-100"
                  aria-label="Gerar descrição com IA"
                >
                  {aiLoadingDesc ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  IA
                </button>
              </div>
              <textarea
                value={descricaoPublica}
                onChange={(event) => setDescricaoPublica(event.target.value)}
                placeholder="Ingredientes, tamanho ou detalhe importante para o cliente."
                rows={3}
                className={`${INPUT_CLS} min-h-24 resize-y`}
              />
            </div>

            <div>
              <label className={LABEL_CLS}>Foto do produto</label>
              <ImageCropField
                value={currentPhotoUrl}
                busy={saveStatus === 'saving'}
                onError={setErr}
                onChange={async (file) => {
                  const uploadedUrl = await enqueueSave(() => uploadImage(product.id, file, currentPhotoUrl));
                  setFotoUrl(uploadedUrl);
                  await savePublication({ foto_url: uploadedUrl });
                }}
                onRemove={async () => {
                  const previous = currentPhotoUrl;
                  setFotoUrl('');
                  await savePublication({ foto_url: null });
                  if (previous) await deleteImage(previous).catch(() => undefined);
                }}
              />
              <p className="mt-2 text-[11px] text-[var(--color-ink-muted)]">
                O recorte quadrado preenche melhor o card. “Imagem inteira” preserva o enquadramento original.
              </p>
            </div>

            <div>
              <label className={LABEL_CLS}>Link externo da foto</label>
              <input
                value={fotoUrl}
                onChange={(event) => setFotoUrl(event.target.value)}
                onBlur={() => {
                  const trimmed = fotoUrl.trim();
                  if (!trimmed || /^https:\/\//i.test(trimmed)) {
                    void savePublication({ foto_url: trimmed || null }).catch(() => undefined);
                  } else {
                    setErr('Use um link de foto começando com https://.');
                  }
                }}
                placeholder="https://..."
                className={INPUT_CLS}
              />
            </div>

            <div className="max-w-32">
              <label className={LABEL_CLS}>Ordem</label>
              <input
                type="number"
                min={0}
                step={1}
                value={ordem}
                onChange={(event) => setOrdem(event.target.value)}
                onBlur={() => {
                  const parsed = Number.parseInt(ordem, 10);
                  if (Number.isFinite(parsed) && parsed >= 0) {
                    void savePublication({ ordem: parsed }).catch(() => undefined);
                  }
                }}
                className={INPUT_CLS}
              />
            </div>
          </div>

          <aside className="md:sticky md:top-0 md:self-start">
            <p className="mb-2 text-xs font-semibold text-[var(--color-ink-muted)]">Prévia no cardápio</p>
            <ProductCardPreview
              product={product}
              name={nomePublico.trim() || product.nome}
              description={descricaoPublica.trim()}
              photoUrl={currentPhotoUrl}
            />
          </aside>
        </div>

        <div className="space-y-3 rounded-xl bg-[var(--color-surface-muted)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-ink)]">Adicionais e variações</p>
              <p className="text-xs text-[var(--color-ink-muted)]">Salvos ao concluir ou trocar de produto.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setGroupsDraft((prev) => [...prev, createEmptyModifierGroup(prev.length)]);
                setGroupsDirty(true);
              }}
              className="min-h-[44px] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-white"
            >
              Novo grupo
            </button>
          </div>
          {groupsDraft.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-4 text-center text-xs text-[var(--color-ink-muted)]">
              Nenhum adicional ou variação configurado.
            </p>
          ) : groupsDraft.map((group, groupIndex) => (
            <ModifierGroupEditor
              key={group.id ?? `group-${groupIndex}`}
              group={group}
              onChange={(nextGroup) => {
                setGroupsDirty(true);
                setGroupsDraft((prev) => prev.map((entry, index) => index === groupIndex ? nextGroup : entry));
              }}
              onDelete={() => {
                setGroupsDirty(true);
                setGroupsDraft((prev) => prev.filter((_, index) => index !== groupIndex));
              }}
            />
          ))}
        </div>

        {err && <p className="text-xs text-[var(--color-alert)]">{err}</p>}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center justify-between gap-3 border-t border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-4">
          <SaveIndicator status={saveStatus} />
          <button
            type="button"
            onClick={() => void finish(onClose)}
            disabled={saveStatus === 'saving'}
            className="min-h-[44px] rounded-xl bg-[var(--color-brand)] px-6 text-sm font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-50"
          >
            Concluir
          </button>
        </div>
      </motion.div>
      </div>
    </ModalShell>
  );
}

function toModifierDrafts(groups: ZeloMenuModifierGroupRow[]): ZeloMenuModifierGroupDraft[] {
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    kind: group.kind,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    active: group.active,
    order: group.order,
    options: group.options.map((option) => ({
      id: option.id,
      name: option.name,
      priceDelta: option.priceDelta,
      active: option.active,
      order: option.order,
    })),
  }));
}

function SaveIndicator({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'saving') {
    return <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Salvando…</span>;
  }
  if (status === 'saved') {
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-brand-deep)]"><Check className="h-3.5 w-3.5" /> Salvo</span>;
  }
  if (status === 'error') {
    return <span className="text-xs font-semibold text-[var(--color-alert)]">Não salvo</span>;
  }
  return <span className="text-xs text-[var(--color-ink-faint)]">Salvamento automático</span>;
}

function ToggleCard({
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

function ProductCardPreview({
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

function ModifierGroupEditor({
  group,
  onChange,
  onDelete,
}: {
  group: ZeloMenuModifierGroupDraft;
  onChange: (group: ZeloMenuModifierGroupDraft) => void;
  onDelete: () => void;
}) {
  const updateGroup = (patch: Partial<ZeloMenuModifierGroupDraft>) => {
    onChange({ ...group, ...patch });
  };

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-white p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className={LABEL_CLS}>Nome do grupo</span>
          <input
            value={group.name}
            onChange={(event) => updateGroup({ name: event.target.value })}
            placeholder="Ex.: Escolha o recheio"
            className={INPUT_CLS}
          />
        </label>

        <label className="space-y-1.5">
          <span className={LABEL_CLS}>Tipo</span>
          <select
            value={group.kind}
            onChange={(event) => updateGroup({ kind: event.target.value as ZeloMenuModifierGroupKind })}
            className={INPUT_CLS}
          >
            <option value="adicional">Adicional</option>
            <option value="variacao">Variação</option>
          </select>
        </label>

        <label className="space-y-1.5">
          <span className={LABEL_CLS}>Mínimo</span>
          <input
            type="number"
            min={0}
            value={String(group.minSelections)}
            onChange={(event) => updateGroup({ minSelections: Number(event.target.value || 0) })}
            className={INPUT_CLS}
          />
        </label>

        <label className="space-y-1.5">
          <span className={LABEL_CLS}>Máximo</span>
          <input
            type="number"
            min={1}
            value={group.maxSelections == null ? '' : String(group.maxSelections)}
            onChange={(event) => updateGroup({
              maxSelections: event.target.value === '' ? null : Number(event.target.value || 1),
            })}
            className={INPUT_CLS}
            placeholder="Sem limite"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={group.active}
            onChange={(event) => updateGroup({ active: event.target.checked })}
            className="h-4 w-4 rounded border-[var(--color-line-strong)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]/30"
          />
          Grupo ativo no link
        </label>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)]"
        >
          Remover grupo
        </button>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Opções</p>
          <button
            type="button"
            onClick={() => onChange({
              ...group,
              options: [...group.options, createEmptyModifierOption(group.options.length)],
            })}
            className="rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)]"
          >
            Nova opção
          </button>
        </div>

        {group.options.map((option, optionIndex) => (
          <div key={option.id ?? `option-${optionIndex}`} className="grid gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-muted)] p-3 md:grid-cols-[minmax(0,1fr)_140px_auto]">
            <label className="space-y-1">
              <span className="text-[11px] font-semibold text-[var(--color-ink-muted)]">Nome</span>
              <input
                value={option.name}
                onChange={(event) => onChange({
                  ...group,
                  options: group.options.map((entry, index) => index === optionIndex ? { ...entry, name: event.target.value } : entry),
                })}
                placeholder="Ex.: Catupiry"
                className={INPUT_CLS}
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] font-semibold text-[var(--color-ink-muted)]">Adicional (R$)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={String(option.priceDelta)}
                onChange={(event) => onChange({
                  ...group,
                  options: group.options.map((entry, index) => index === optionIndex ? { ...entry, priceDelta: Number(event.target.value || 0) } : entry),
                })}
                className={INPUT_CLS}
              />
            </label>

            <div className="flex items-end justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-[var(--color-ink-soft)]">
                <input
                  type="checkbox"
                  checked={option.active}
                  onChange={(event) => onChange({
                    ...group,
                    options: group.options.map((entry, index) => index === optionIndex ? { ...entry, active: event.target.checked } : entry),
                  })}
                  className="h-4 w-4 rounded border-[var(--color-line-strong)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]/30"
                />
                Ativa
              </label>
              <button
                type="button"
                onClick={() => onChange({
                  ...group,
                  options: group.options.filter((_, index) => index !== optionIndex),
                })}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)]"
              >
                Remover
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function createEmptyModifierGroup(order: number): ZeloMenuModifierGroupDraft {
  return {
    name: '',
    kind: 'adicional',
    minSelections: 0,
    maxSelections: null,
    active: true,
    order,
    options: [createEmptyModifierOption(0)],
  };
}

function createEmptyModifierOption(order: number) {
  return {
    name: '',
    priceDelta: 0,
    active: true,
    order,
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

// ---------- utils ----------
function formatPrecoInput(preco: number): string {
  if (!Number.isFinite(preco)) return '';
  return preco.toFixed(2).replace('.', ',');
}

function parsePrecoInput(v: string): number {
  const cleaned = v.replace(/\./g, '').replace(',', '.').trim();
  if (!cleaned) return 0;
  return Number(cleaned);
}
