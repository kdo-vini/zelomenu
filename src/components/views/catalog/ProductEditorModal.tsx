import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { ImageCropField } from '../../zelomenu/ImageCropField';
import { ModifierGroupsPanel } from '../../zelomenu/ModifierGroupsPanel';
import type {
  Categoria,
  ProdutoInput,
  ProdutoRow,
  Subcategoria,
  ZeloMenuModifierGroupRow,
  ZeloMenuProductPublicationInput,
  ZeloMenuProductPublicationRow,
} from '../../../hooks/useCatalog';
import {
  ActionBar,
  createEmptyModifierGroup,
  INPUT_CLS,
  LABEL_CLS,
  ModalShell,
  ProductCardPreview,
  SaveIndicator,
  ToggleCard,
  toModifierDrafts,
} from './CatalogModals';
import { validateModifierGroupDrafts, type ZeloMenuModifierGroupDraft } from '../../../domain/zelomenuModifiers';

export type ProductModalTab = 'produto' | 'publicacao';

type ProductEditorModalProps = {
  open: boolean;
  initial?: ProdutoRow | null;
  initialTab?: ProductModalTab;
  initialPublication?: ZeloMenuProductPublicationRow | null;
  defaultCategoriaId?: number | null;
  defaultSubcategoriaId?: number | null;
  categorias: Categoria[];
  subcategorias: Subcategoria[];
  products: ProdutoRow[];
  productUsageCounts?: Record<number, number>;
  modifierGroups: ZeloMenuModifierGroupRow[];
  modifierOptionProducts: Record<string, { productId: number; priceOverride: number | null }>;
  onCreateComponentProduct?: (input: { nome: string; preco: number }) => Promise<ProdutoRow>;
  uploadImage: (productId: number, file: File, previousUrl?: string | null) => Promise<string>;
  deleteImage: (url: string | null | undefined) => Promise<void>;
  onClose: () => void;
  onNavigate?: (product: ProdutoRow, tab: ProductModalTab) => void;
  onSubmit: (patch: ProdutoInput) => Promise<ProdutoRow | void>;
  onSaveModifierGroups: (
    productId: number,
    modifierGroups: ZeloMenuModifierGroupDraft[],
  ) => Promise<ZeloMenuModifierGroupRow[]>;
  onSavePublication: (
    productId: number,
    patch: ZeloMenuProductPublicationInput,
  ) => Promise<ZeloMenuProductPublicationRow>;
};

export function ProductModal({
  open,
  initial,
  initialTab = 'produto',
  initialPublication,
  defaultCategoriaId,
  defaultSubcategoriaId,
  categorias,
  subcategorias,
  products,
  productUsageCounts,
  modifierGroups,
  modifierOptionProducts,
  onCreateComponentProduct,
  uploadImage,
  deleteImage,
  onClose,
  onNavigate,
  onSubmit,
  onSaveModifierGroups,
  onSavePublication,
}: ProductEditorModalProps) {
  const [tab, setTab] = useState<ProductModalTab>(initialTab);
  const [nome, setNome] = useState('');
  const [precoStr, setPrecoStr] = useState('');
  const [idCategoria, setIdCategoria] = useState<number | ''>('');
  const [idSubcategoria, setIdSubcategoria] = useState<number | ''>('');
  const [groupsDraft, setGroupsDraft] = useState<ZeloMenuModifierGroupDraft[]>([]);
  const [visivelOnline, setVisivelOnline] = useState(false);
  const [nomePublico, setNomePublico] = useState('');
  const [descricaoPublica, setDescricaoPublica] = useState('');
  const [fotoUrl, setFotoUrl] = useState('');
  const [ordem, setOrdem] = useState('0');
  const [productDirty, setProductDirty] = useState(false);
  const [groupsDirty, setGroupsDirty] = useState(false);
  const [publicationDirty, setPublicationDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [aiLoadingDesc, setAiLoadingDesc] = useState(false);
  const hydratedProductRef = useRef<number | 'new' | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveTokenRef = useRef(0);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) {
      hydratedProductRef.current = null;
      return;
    }

    const productKey = initial?.id ?? 'new';
    if (hydratedProductRef.current === productKey) return;
    hydratedProductRef.current = productKey;

    setNome(initial?.nome ?? '');
    setPrecoStr(initial ? formatPrecoInput(initial.preco) : '');
    setIdCategoria(initial?.id_categoria ?? defaultCategoriaId ?? '');
    setIdSubcategoria(initial?.id_subcategoria ?? defaultSubcategoriaId ?? '');
    setGroupsDraft(toModifierDrafts(modifierGroups, modifierOptionProducts));
    setVisivelOnline(initialPublication?.visivel_online ?? false);
    setNomePublico(initialPublication?.nome_publico ?? '');
    setDescricaoPublica(initialPublication?.descricao_publica ?? '');
    setFotoUrl(initialPublication?.foto_url ?? '');
    setOrdem(String(initialPublication?.ordem ?? 0));
    setProductDirty(false);
    setGroupsDirty(false);
    setPublicationDirty(false);
    setLoading(false);
    setSaveStatus('idle');
    setErr(null);
    setAiLoadingDesc(false);
  }, [
    open,
    initial,
    defaultCategoriaId,
    defaultSubcategoriaId,
    initialPublication,
    modifierGroups,
    modifierOptionProducts,
  ]);

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

  if (!open) return null;

  const productIndex = initial ? products.findIndex((entry) => entry.id === initial.id) : -1;
  const previousProduct = productIndex > 0 ? products[productIndex - 1] : null;
  const nextProduct = productIndex >= 0 && productIndex < products.length - 1 ? products[productIndex + 1] : null;
  const currentPhotoUrl = fotoUrl.trim() || null;
  const isDirty = productDirty || groupsDirty || publicationDirty;

  const subcategoriasFiltered = subcategorias.filter((s) => (
    idCategoria ? s.id_categoria === Number(idCategoria) : true
  ));

  const handleCategoriaChange = (value: string) => {
    const nextId = value === '' ? '' : Number(value);
    setIdCategoria(nextId);
    setProductDirty(true);
    if (idSubcategoria && nextId) {
      const stillValid = subcategorias.some((s) => s.id === idSubcategoria && s.id_categoria === nextId);
      if (!stillValid) setIdSubcategoria('');
    } else if (!nextId) {
      setIdSubcategoria('');
    }
  };

  async function flushAll(): Promise<boolean> {
    const trimmedName = nome.trim();
    if (!trimmedName) {
      setErr('Informe o nome do produto.');
      setTab('produto');
      return false;
    }

    const preco = parsePrecoInput(precoStr);
    if (Number.isNaN(preco) || preco < 0) {
      setErr('Informe um preço válido.');
      setTab('produto');
      return false;
    }

    if (visivelOnline && !idCategoria) {
      setErr('Escolha uma categoria antes de vender este produto separadamente.');
      setTab('produto');
      return false;
    }

    const groupsError = validateModifierGroupDrafts(groupsDraft);
    if (groupsError) {
      setErr(groupsError);
      setTab('produto');
      return false;
    }

    const parsedOrder = Number.parseInt(ordem, 10);
    if (!Number.isFinite(parsedOrder) || parsedOrder < 0) {
      setErr('Informe uma ordem válida.');
      setTab('publicacao');
      return false;
    }

    const trimmedPhoto = fotoUrl.trim();
    if (trimmedPhoto && !/^https:\/\//i.test(trimmedPhoto)) {
      setErr('Use um link de foto começando com https://.');
      setTab('publicacao');
      return false;
    }

    const shouldSaveProduct = initial == null || productDirty;
    const shouldSaveAnything = shouldSaveProduct || groupsDirty || publicationDirty;
    if (!shouldSaveAnything) return true;

    setLoading(true);
    setSaveStatus('saving');
    setErr(null);

    try {
      const savedProduct = shouldSaveProduct
        ? await onSubmit({
            nome: trimmedName,
            preco,
            id_categoria: idCategoria ? Number(idCategoria) : null,
            id_subcategoria: idSubcategoria ? Number(idSubcategoria) : null,
          })
        : initial;
      const productId = savedProduct?.id ?? initial?.id;

      if (productId == null) throw new Error('Não foi possível identificar o produto salvo.');

      if (groupsDirty) {
        await onSaveModifierGroups(productId, groupsDraft);
      }

      if (publicationDirty) {
        await onSavePublication(productId, {
          visivel_online: visivelOnline,
          nome_publico: nomePublico.trim(),
          descricao_publica: descricaoPublica.trim(),
          foto_url: trimmedPhoto || null,
          ordem: parsedOrder,
        });
      }

      setProductDirty(false);
      setGroupsDirty(false);
      setPublicationDirty(false);
      setSaveStatus('saved');
      return true;
    } catch (error) {
      setSaveStatus('error');
      setErr(error instanceof Error ? error.message : 'Erro ao salvar.');
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (await flushAll()) onClose();
  }

  async function navigateTo(target: ProdutoRow | null) {
    if (!target || !onNavigate) return;
    if (await flushAll()) onNavigate(target, tab);
  }

  return (
    <ModalShell
      title={initial?.nome ?? 'Novo produto'}
      subtitle={initial && productIndex >= 0 ? `Produto ${productIndex + 1} de ${products.length}` : 'Produto, complementos e publicação em um só lugar.'}
      onClose={onClose}
      wide
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {initial && products.length > 1 && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--color-surface-muted)] p-2">
            <button
              type="button"
              onClick={() => void navigateTo(previousProduct)}
              disabled={!previousProduct || loading || saveStatus === 'saving'}
              className="flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface)] disabled:opacity-35"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Anterior</span>
            </button>
            <SaveIndicator status={saveStatus} dirty={isDirty} />
            <button
              type="button"
              onClick={() => void navigateTo(nextProduct)}
              disabled={!nextProduct || loading || saveStatus === 'saving'}
              className="flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface)] disabled:opacity-35"
            >
              <span className="hidden sm:inline">Próximo</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        <div role="tablist" aria-label="Configurações do produto" className="sticky -top-5 z-20 -mx-5 -mt-5 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-5">
          <div className="flex">
            <ProductTabButton active={tab === 'produto'} onClick={() => setTab('produto')}>
              Produto
            </ProductTabButton>
            <ProductTabButton active={tab === 'publicacao'} onClick={() => setTab('publicacao')}>
              Publicação
            </ProductTabButton>
          </div>
        </div>

        {tab === 'produto' ? (
          <div role="tabpanel" aria-label="Configurações do produto" className="space-y-7">
            <section className="space-y-4">
              <SectionHeading title="Dados básicos" description="As informações usadas no catálogo e no preço do produto." />
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                <label className="space-y-1.5">
                  <span className={LABEL_CLS}>Nome do produto</span>
                  <input
                    autoFocus
                    value={nome}
                    onChange={(event) => {
                      setNome(event.target.value);
                      setProductDirty(true);
                    }}
                    placeholder="Ex.: X-Tudo, Coca-Cola 2L"
                    className={INPUT_CLS}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className={LABEL_CLS}>Preço (R$)</span>
                  <input
                    value={precoStr}
                    onChange={(event) => {
                      setPrecoStr(event.target.value);
                      setProductDirty(true);
                    }}
                    inputMode="decimal"
                    placeholder="0,00"
                    className={INPUT_CLS}
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className={LABEL_CLS}>Categoria</span>
                  <select value={idCategoria} onChange={(event) => handleCategoriaChange(event.target.value)} className={INPUT_CLS}>
                    <option value="">Sem categoria</option>
                    {categorias.map((category) => <option key={category.id} value={category.id}>{category.nome}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className={LABEL_CLS}>Subcategoria</span>
                  <select
                    value={idSubcategoria}
                    onChange={(event) => {
                      setIdSubcategoria(event.target.value === '' ? '' : Number(event.target.value));
                      setProductDirty(true);
                    }}
                    disabled={!idCategoria || subcategoriasFiltered.length === 0}
                    className={`${INPUT_CLS} disabled:cursor-not-allowed disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-ink-faint)]`}
                  >
                    <option value="">Nenhuma</option>
                    {subcategoriasFiltered.map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.nome}</option>)}
                  </select>
                </label>
              </div>

            </section>

            <section className="space-y-4 border-t border-[var(--color-line)] pt-6">
              <SectionHeading title="Complementos e variações" description="Monte as escolhas que o cliente poderá fazer ao pedir este produto." />
              <ModifierGroupsPanel
                key={initial?.id ?? 'novo-produto'}
                groups={groupsDraft}
                products={products}
                productUsageCounts={productUsageCounts}
                onCreateProduct={onCreateComponentProduct}
                excludeProductId={initial?.id}
                productName={nome.trim() || initial?.nome || 'seu produto'}
                onChange={(index, group) => {
                  setGroupsDirty(true);
                  setGroupsDraft((prev) => prev.map((entry, i) => i === index ? group : entry));
                }}
                onAdd={() => {
                  setGroupsDirty(true);
                  setGroupsDraft((prev) => [...prev, createEmptyModifierGroup(prev.length)]);
                }}
                onDuplicate={(index) => {
                  setGroupsDirty(true);
                  setGroupsDraft((prev) => {
                    const source = prev[index];
                    if (!source) return prev;
                    const duplicate: ZeloMenuModifierGroupDraft = {
                      ...source,
                      id: undefined,
                      name: source.name.trim() ? `${source.name.trim()} (cópia)` : '',
                      order: prev.length,
                      options: source.options.map((option, optionIndex) => ({
                        ...option,
                        id: undefined,
                        order: optionIndex,
                      })),
                    };
                    return [...prev, duplicate];
                  });
                }}
                onDelete={(index) => {
                  setGroupsDirty(true);
                  setGroupsDraft((prev) => prev.filter((_, i) => i !== index));
                }}
              />
            </section>

            <p className="border-t border-[var(--color-line)] pt-4 text-xs leading-relaxed text-[var(--color-ink-muted)]">
              Estoque avançado e integrações operacionais continuam no{' '}
              <a href="https://zelopdv.com.br" target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--color-brand-deep)] hover:underline">
                ZeloPDV <ExternalLink className="inline h-3 w-3" />
              </a>
              .
            </p>
          </div>
        ) : (
          <div role="tabpanel" aria-label="Configurações de publicação" className="space-y-7">
            <section className="space-y-4">
              <SectionHeading title="Status no cardápio" description="Controle se o produto aparece no link e pause sem perder a configuração." />
              <div className="grid gap-3 sm:grid-cols-2">
                <ToggleCard
                  checked={visivelOnline}
                  title="Vender separadamente no cardápio"
                  description="Desligue quando este produto existir apenas como complemento."
                  onChange={(checked) => {
                    setVisivelOnline(checked);
                    setPublicationDirty(true);
                  }}
                />
              </div>
            </section>

            <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_240px]">
              <div className="space-y-7">
                <section className="space-y-4 border-t border-[var(--color-line)] pt-6">
                  <SectionHeading title="Conteúdo público" description="O que o cliente verá no cardápio digital." />
                  <label className="space-y-1.5">
                    <span className={LABEL_CLS}>Nome no cardápio</span>
                    <input
                      value={nomePublico}
                      onChange={(event) => {
                        setNomePublico(event.target.value);
                        setPublicationDirty(true);
                      }}
                      placeholder={nome || 'Usar nome do produto'}
                      className={INPUT_CLS}
                    />
                  </label>
                  <div className="group relative">
                    <div className="flex items-center justify-between">
                      <label className={LABEL_CLS}>Descrição pública</label>
                      <button
                        type="button"
                        disabled={aiLoadingDesc}
                        onClick={() => {
                          setAiLoadingDesc(true);
                          import('../../../services/zelomenuAdminApi').then((module) => module.generateZeloMenuProductDescription(nomePublico.trim() || nome.trim() || initial?.nome || 'produto'))
                            .then((text) => {
                              setDescricaoPublica(text);
                              setPublicationDirty(true);
                            })
                            .catch(() => undefined)
                            .finally(() => setAiLoadingDesc(false));
                        }}
                        className="flex min-h-[32px] items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-[var(--color-ink-faint)] opacity-0 transition-all hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-brand)] group-focus-within:opacity-100 group-hover:opacity-100"
                        aria-label="Gerar descrição com IA"
                      >
                        {aiLoadingDesc ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        IA
                      </button>
                    </div>
                    <textarea
                      value={descricaoPublica}
                      onChange={(event) => {
                        setDescricaoPublica(event.target.value);
                        setPublicationDirty(true);
                      }}
                      placeholder="Ingredientes, tamanho ou detalhe importante para o cliente."
                      rows={4}
                      className={`${INPUT_CLS} min-h-28 resize-y`}
                    />
                  </div>
                </section>

                <section className="space-y-4 border-t border-[var(--color-line)] pt-6">
                  <SectionHeading title="Imagem do produto" description="Use uma foto quadrada para preencher melhor o card." />
                  {initial ? (
                    <ImageCropField
                      value={currentPhotoUrl}
                      busy={loading || saveStatus === 'saving'}
                      onError={setErr}
                      onChange={async (file) => {
                        const uploadedUrl = await enqueueSave(() => uploadImage(initial.id, file, currentPhotoUrl));
                        setFotoUrl(uploadedUrl);
                        setPublicationDirty(true);
                      }}
                      onRemove={async () => {
                        const previous = currentPhotoUrl;
                        setFotoUrl('');
                        setPublicationDirty(true);
                        if (previous) await enqueueSave(() => deleteImage(previous));
                      }}
                    />
                  ) : (
                    <p className="rounded-xl border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-muted)] px-4 py-3 text-xs leading-relaxed text-[var(--color-ink-muted)]">
                      Salve o produto primeiro para enviar uma imagem do seu dispositivo.
                    </p>
                  )}
                  <label className="space-y-1.5">
                    <span className={LABEL_CLS}>Link externo da foto</span>
                    <input
                      value={fotoUrl}
                      onChange={(event) => {
                        setFotoUrl(event.target.value);
                        setPublicationDirty(true);
                      }}
                      placeholder="https://..."
                      className={INPUT_CLS}
                    />
                  </label>
                </section>

                <section className="space-y-4 border-t border-[var(--color-line)] pt-6">
                  <SectionHeading title="Organização" description="Defina a ordem em que o produto aparece dentro da categoria." />
                  <label className="block max-w-40 space-y-1.5">
                    <span className={LABEL_CLS}>Ordem</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={ordem}
                      onChange={(event) => {
                        setOrdem(event.target.value);
                        setPublicationDirty(true);
                      }}
                      className={INPUT_CLS}
                    />
                  </label>
                </section>
              </div>

              <aside className="lg:sticky lg:top-14 lg:self-start">
                <p className="mb-2 text-xs font-semibold text-[var(--color-ink-muted)]">Prévia no cardápio</p>
                {initial ? (
                  <ProductCardPreview
                    product={initial}
                    name={nomePublico.trim() || nome.trim() || initial.nome}
                    description={descricaoPublica.trim()}
                    photoUrl={currentPhotoUrl}
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-muted)] p-4 text-xs leading-relaxed text-[var(--color-ink-muted)]">
                    A prévia aparece depois que o produto for criado.
                  </div>
                )}
              </aside>
            </div>
          </div>
        )}

        {err && <p role="alert" className="text-xs font-medium text-[var(--color-alert)]">{err}</p>}
        <ActionBar
          onCancel={onClose}
          submitLabel={initial ? 'Salvar alterações' : 'Criar produto'}
          loading={loading}
          disabled={saveStatus === 'saving'}
          saveStatus={saveStatus}
          dirty={isDirty}
        />
      </form>
    </ModalShell>
  );
}

function ProductTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-[48px] flex-1 border-b-2 px-3 text-sm font-semibold transition-colors sm:flex-none sm:min-w-36 ${
        active
          ? 'border-[var(--color-brand)] text-[var(--color-brand)]'
          : 'border-transparent text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink-soft)]'
      }`}
    >
      {children}
    </button>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h4 className="text-[15px] font-bold text-[var(--color-ink)]">{title}</h4>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--color-ink-muted)]">{description}</p>
    </div>
  );
}

export function formatPrecoInput(preco: number): string {
  if (!Number.isFinite(preco)) return '';
  return preco.toFixed(2).replace('.', ',');
}

export function parsePrecoInput(value: string): number {
  const cleaned = value.replace(/\./g, '').replace(',', '.').trim();
  if (!cleaned) return 0;
  return Number(cleaned);
}
