import React, { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  EyeOff,
  FolderPlus,
  Globe2,
  MoreVertical,
  Pencil,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import { SortableList } from '../zelomenu/SortableList';
import { getFriendlyErrorMessage } from '../../services/errorMessages';
import { ConfirmModal } from '../ConfirmModal';
import { Modal } from '../Modal';
import type {
  Categoria,
  ProdutoRow,
  Subcategoria,
  ZeloMenuModifierGroupRow,
  ZeloMenuProductPublicationInput,
  ZeloMenuProductPublicationRow,
} from '../../hooks/useCatalog';
import { useCatalogBulkController } from '../../hooks/useCatalogBulkController';
import type { ZeloMenuModifierGroupDraft } from '../../domain/zelomenuModifiers';
import {
  getZeloMenuPublicationStatus,
  summarizeZeloMenuPublication,
  type ZeloMenuPublicationProduct,
  type ZeloMenuPublicationStatus,
} from '../../domain/zelomenuPublication';
import {
  CategoriaModal,
  ConfirmDelete,
  SubcategoriaModal,
} from './catalog/CatalogModals';
import { ProductModal, formatPrecoInput, parsePrecoInput, type ProductModalTab } from './catalog/ProductEditorModal';
import {
  getCatalogProductRole,
  isExactCatalogProductNameDuplicate,
  normalizeCatalogSearchText,
  resolveCatalogUsageAvailability,
  searchCatalogModifierOptions,
  type CatalogSearchModifierOption,
} from '../../domain/zelomenuCatalog';

interface Props {
  isAuthenticated: boolean;
  authLoading: boolean;
  canPublishToMenu: boolean;
  loading: boolean;
  error: string | null;
  categorias: Categoria[];
  subcategorias: Subcategoria[];
  produtos: ProdutoRow[];
  productPublications: Record<number, ZeloMenuProductPublicationRow>;
  productModifierGroups: Record<number, ZeloMenuModifierGroupRow[]>;
  modifierOptionProducts: Record<string, { productId: number; priceOverride: number | null }>;
  refresh: () => Promise<void>;
  createCategoria: (input: { nome: string; ordem?: number }) => Promise<Categoria>;
  updateCategoria: (id: number, patch: { nome?: string; ordem?: number }) => Promise<void>;
  reorderCategorias: (ordered: Categoria[]) => Promise<void>;
  deleteCategoria: (id: number) => Promise<void>;
  createSubcategoria: (input: { nome: string; id_categoria: number; ordem?: number }) => Promise<Subcategoria>;
  updateSubcategoria: (id: number, patch: { nome?: string; id_categoria?: number; ordem?: number }) => Promise<void>;
  deleteSubcategoria: (id: number) => Promise<void>;
  createProduto: (input: {
    nome: string;
    preco: number;
    id_categoria: number | null;
    id_subcategoria: number | null;
  }) => Promise<ProdutoRow>;
  updateProduto: (
    id: number,
    patch: {
      nome?: string;
      preco?: number;
      id_categoria?: number | null;
      id_subcategoria?: number | null;
    },
  ) => Promise<void>;
  deleteProduto: (id: number) => Promise<void>;
  upsertProductPublication: (productId: number, patch: ZeloMenuProductPublicationInput) => Promise<ZeloMenuProductPublicationRow>;
  reorderProductPublications: (orderedProductIds: number[]) => Promise<void>;
  replaceProductModifierGroups: (productId: number, groups: ZeloMenuModifierGroupDraft[]) => Promise<ZeloMenuModifierGroupRow[]>;
  uploadProductPublicationImage: (productId: number, file: File, previousUrl?: string | null) => Promise<string>;
  deleteProductPublicationImage: (url: string | null | undefined) => Promise<void>;
}

type CatModalState =
  | { kind: 'categoria'; initial: Categoria | null }
  | { kind: 'subcategoria'; initial: Subcategoria | null; defaultCategoriaId: number | null }
  | {
      kind: 'produto';
      initial: ProdutoRow | null;
      defaultCategoriaId: number | null;
      defaultSubcategoriaId: number | null;
      initialTab?: ProductModalTab;
    }
  | null;

type DeleteState =
  | { kind: 'categoria'; item: Categoria }
  | { kind: 'subcategoria'; item: Subcategoria }
  | { kind: 'produto'; item: ProdutoRow }
  | null;

type ProdutoWithPublication = ProdutoRow & ZeloMenuPublicationProduct;
type PublicationActionState = 'publish';
type ComponentUsage = { containerName: string; groupName: string; active: boolean };
type CatalogFilter = 'all' | 'standalone' | 'component' | 'paused' | 'out_of_stock' | 'draft';

const CATALOG_FILTER_LABELS: Record<CatalogFilter, string> = {
  all: 'Todos',
  standalone: 'Vendidos separadamente',
  component: 'Componentes',
  paused: 'Pausados',
  out_of_stock: 'Sem estoque',
  draft: 'Rascunhos',
};

export const CatalogView = ({
  isAuthenticated,
  authLoading,
  canPublishToMenu,
  loading,
  error,
  categorias,
  subcategorias,
  produtos,
  productPublications,
  productModifierGroups,
  modifierOptionProducts,
  refresh,
  createCategoria,
  updateCategoria,
  reorderCategorias,
  deleteCategoria,
  createSubcategoria,
  updateSubcategoria,
  deleteSubcategoria,
  createProduto,
  updateProduto,
  deleteProduto,
  upsertProductPublication,
  reorderProductPublications,
  replaceProductModifierGroups,
  uploadProductPublicationImage,
  deleteProductPublicationImage,
}: Props) => {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<CatModalState>(null);
  const [del, setDel] = useState<DeleteState>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ZeloMenuPublicationStatus | null>(null);
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>('all');
  const [undoAction, setUndoAction] = useState<{
    type: 'published' | 'paused' | 'resumed';
    changedIds: number[];
    previousStates: Record<number, { visivel_online: boolean; pausado_manualmente: boolean }>;
    message: string;
  } | null>(null);
  const actionTokenRef = useRef(0);
  const productsSectionRef = useRef<HTMLDivElement>(null);
  const [confirmCategoryAction, setConfirmCategoryAction] = useState<{
    ids: number[];
    state: PublicationActionState;
  } | null>(null);

  const normalized = normalizeCatalogSearchText(query);
  const componentUsages = useMemo(() => {
    const productsById = new Map(produtos.map((produto) => [produto.id, produto]));
    const usagesByProductId: Record<number, ComponentUsage[]> = {};

    for (const groups of Object.values(productModifierGroups)) {
      for (const group of groups) {
        const container = productsById.get(group.productId);
        if (!container) continue;
        for (const option of group.options) {
          const link = modifierOptionProducts[option.id];
          if (!link) continue;
          const linkedProduct = productsById.get(link.productId);
          if (!linkedProduct) continue;
          const active = resolveCatalogUsageAvailability({
            parent: {
              controlar_estoque: container.controlar_estoque,
              estoque_atual: container.estoque_atual,
            },
            linked: {
              controlar_estoque: linkedProduct.controlar_estoque,
              estoque_atual: linkedProduct.estoque_atual,
            },
            groupActive: group.active,
            optionActive: option.active,
          });
          const usages = usagesByProductId[link.productId] ?? [];
          usages.push({ containerName: container.nome, groupName: group.name, active });
          usagesByProductId[link.productId] = usages;
        }
      }
    }

    return usagesByProductId;
  }, [modifierOptionProducts, productModifierGroups, produtos]);
  const productUsageCounts = useMemo(
    () => Object.fromEntries(Object.entries(componentUsages).map(([productId, usages]) => [Number(productId), usages.length])),
    [componentUsages],
  );
  const filtered = useMemo(() => {
    if (!normalized) return produtos;
    const optionNamesByProductId = new Map<number, string[]>();
    for (const groups of Object.values(productModifierGroups)) {
      for (const group of groups) {
        for (const option of group.options) {
          const link = modifierOptionProducts[option.id];
          if (!link || !option.name.trim()) continue;
          const names = optionNamesByProductId.get(link.productId) ?? [];
          names.push(option.name);
          optionNamesByProductId.set(link.productId, names);
        }
      }
    }
    return produtos.filter((p) => (
      normalizeCatalogSearchText(p.nome).includes(normalized)
      || (optionNamesByProductId.get(p.id) ?? []).some((name) => normalizeCatalogSearchText(name).includes(normalized))
    ));
  }, [modifierOptionProducts, productModifierGroups, produtos, normalized]);

  const searchModifierOptions = useMemo(() => {
    const parentProductsById = new Map(produtos.map((produto) => [produto.id, produto]));
    return searchCatalogModifierOptions(produtos, productModifierGroups, modifierOptionProducts, query)
      .filter((option) => {
        const parent = parentProductsById.get(option.parentProductId);
        if (!parent) return false;
        const pub = productPublications[parent.id] ?? null;
        const role = getCatalogProductRole(Boolean(pub?.visivel_online), componentUsages[parent.id]?.length ?? 0);
        const details = getZeloMenuPublicationStatus({ ...parent, publication: pub });
        if (catalogFilter === 'standalone' && role !== 'standalone' && role !== 'standalone_and_component') return false;
        if (catalogFilter === 'component' && role !== 'component' && role !== 'standalone_and_component') return false;
        if (catalogFilter === 'paused' && details.status !== 'paused') return false;
        if (catalogFilter === 'out_of_stock' && details.status !== 'out_of_stock') return false;
        if (catalogFilter === 'draft' && role !== 'draft') return false;
        return !statusFilter || details.status === statusFilter;
      });
  }, [catalogFilter, componentUsages, modifierOptionProducts, productModifierGroups, productPublications, produtos, query, statusFilter]);

  const displayProducts = useMemo(() => {
    const roleFiltered = catalogFilter === 'all' ? filtered : filtered.filter((p) => {
      const pub = productPublications[p.id] ?? null;
      const role = getCatalogProductRole(Boolean(pub?.visivel_online), componentUsages[p.id]?.length ?? 0);
      const details = getZeloMenuPublicationStatus({ ...p, publication: pub });
      if (catalogFilter === 'standalone') return role === 'standalone' || role === 'standalone_and_component';
      if (catalogFilter === 'component') return role === 'component' || role === 'standalone_and_component';
      if (catalogFilter === 'paused') return details.status === 'paused';
      if (catalogFilter === 'out_of_stock') return details.status === 'out_of_stock';
      return role === 'draft';
    });
    if (!statusFilter) return roleFiltered;
    return roleFiltered.filter((p) => getZeloMenuPublicationStatus({ ...p, publication: productPublications[p.id] ?? null }).status === statusFilter);
  }, [catalogFilter, componentUsages, filtered, statusFilter, productPublications]);

  // Busca e filtros virtuais compartilham o mesmo resultado plano. Renderizar
  // a árvore aqui deixa categorias/subcategorias vazias ocupando a tela e
  // obriga o operador a rolar até o produto que acabou de filtrar.
  const flatResultMode = Boolean(normalized || catalogFilter !== 'all' || statusFilter);
  const flatResultHeading = normalized
    ? `Resultados para “${query.trim()}”`
    : catalogFilter !== 'all'
      ? `Produtos: ${CATALOG_FILTER_LABELS[catalogFilter]}`
      : statusFilter
        ? `Produtos: ${publicationTone(statusFilter).label}`
        : 'Produtos filtrados';

  const tree = useMemo(
    () => buildTree(categorias, subcategorias, displayProducts, productPublications),
    [categorias, subcategorias, displayProducts, productPublications],
  );
  const orphanProducts = useMemo(
    () => sortProductsForMenu(displayProducts.filter((p) => p.id_categoria == null), productPublications),
    [displayProducts, productPublications],
  );
  const visibleProducts = useMemo(
    () => [
      ...tree.flatMap((node) => [
        ...node.produtosDireto,
        ...node.subcategorias.flatMap((subNode) => subNode.produtos),
      ]),
      ...orphanProducts,
    ],
    [orphanProducts, tree],
  );
  const publicationProducts = useMemo(
    () => produtos.map((produto) => withPublication(produto, productPublications)),
    [produtos, productPublications],
  );
  const publicationSummary = useMemo(() => summarizeZeloMenuPublication(publicationProducts), [publicationProducts]);
  const editorProducts = useMemo(
    () => sortProductsForEditor(produtos, categorias, subcategorias, productPublications),
    [categorias, productPublications, produtos, subcategorias],
  );
  const publicationIssues = useMemo(
    () => publicationProducts
      .map((produto) => ({ produto, details: getZeloMenuPublicationStatus(produto) }))
      .filter((item) => item.details.issue !== null)
      .slice(0, 8),
    [publicationProducts],
  );
  const bulk = useCatalogBulkController({
    visibleProducts,
    productPublications,
    deleteProduto,
    upsertProductPublication,
  });

  const handlePublishProducts = async (productIds: Iterable<number>) => {
    setBulkFeedback(null);
    const ids = [...new Set(productIds)].filter((id) => {
      const pub = productPublications[id];
      return !pub?.visivel_online;
    });
    if (ids.length === 0) return;

    const prevStates: Record<number, { visivel_online: boolean; pausado_manualmente: boolean }> = {};
    for (const id of ids) {
      const pub = productPublications[id];
      prevStates[id] = {
        visivel_online: pub?.visivel_online ?? false,
        pausado_manualmente: pub?.pausado_manualmente ?? false,
      };
    }

    const actionToken = ++actionTokenRef.current;
    let changed = 0;
    const failed: Array<{ productId: number; reason: string }> = [];
    for (const id of ids) {
      try {
        await upsertProductPublication(id, { visivel_online: true, pausado_manualmente: false });
        changed++;
      } catch (e) {
        failed.push({ productId: id, reason: getFriendlyErrorMessage(e) || 'Não foi possível publicar.' });
      }
    }
    if (actionToken !== actionTokenRef.current) return;

    const plural = changed === 1 ? '' : 's';
    let message = `${changed} produto${plural} publicado${plural}.`;
    if (failed.length > 0) {
      message += ` ${failed.length} não ${failed.length === 1 ? 'pôde' : 'puderam'} ser publicado${failed.length === 1 ? '' : 's'}.`;
    }
    setBulkFeedback({ tone: failed.length > 0 ? 'error' : 'success', message });

    if (changed > 0 && failed.length === 0) {
      setUndoAction({
        type: 'published',
        changedIds: ids.filter((id) => !failed.some((f) => f.productId === id)),
        previousStates: prevStates,
        message,
      });
    }
    void refresh();
  };

  const handlePublicationState = async (
    productIds: Iterable<number>,
    state: PublicationActionState,
  ) => {
    if (state === 'publish') void handlePublishProducts(productIds);
  };


  const handleUndo = async () => {
    if (!undoAction) return;
    const token = ++actionTokenRef.current;
    setUndoAction(null);
    setBulkFeedback(null);

    let undoneCount = 0;
    const failed: Array<{ productId: number; reason: string }> = [];
    for (const id of undoAction.changedIds) {
      const prev = undoAction.previousStates[id];
      if (!prev) continue;
      try {
        await upsertProductPublication(id, prev);
        undoneCount++;
      } catch (e) {
        failed.push({ productId: id, reason: getFriendlyErrorMessage(e) || 'Não foi possível desfazer.' });
      }
    }
    if (token !== actionTokenRef.current) return;

    const plural = undoneCount === 1 ? '' : 's';
    let msg = `Desfeito: ${undoneCount} produto${plural} voltou${plural === '' ? '' : 'ram'} ao estado anterior.`;
    if (failed.length > 0) {
      msg += ` ${failed.length} não ${failed.length === 1 ? 'pôde' : 'puderam'} ser restaurado${failed.length === 1 ? '' : 's'}.`;
    }
    setBulkFeedback({ tone: failed.length > 0 ? 'error' : 'success', message: msg });
    void refresh();
  };

  const handleBulkPublish = async () => {
    void handlePublishProducts(bulk.selectedIds);
  };

  const toggleCat = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(categorias.map((c) => c.id)));
  const collapseAll = () => setExpanded(new Set());

  const handleCategoryReorder = async (reorderedNodes: TreeNode[]) => {
    setReorderBusy(true);
    setBulkFeedback(null);
    try {
      await reorderCategorias(reorderedNodes.map((node) => node.categoria));
    } catch {
      setBulkFeedback({ tone: 'error', message: 'Não foi possível salvar a ordem das categorias.' });
    } finally {
      setReorderBusy(false);
    }
  };

  const handleProductReorder = async (reorderedProducts: ProdutoRow[]) => {
    setReorderBusy(true);
    setBulkFeedback(null);
    try {
      await reorderProductPublications(reorderedProducts.map((produto) => produto.id));
    } catch {
      setBulkFeedback({ tone: 'error', message: 'Não foi possível salvar a ordem dos produtos.' });
    } finally {
      setReorderBusy(false);
    }
  };

  const handleStatusFilter = (status: ZeloMenuPublicationStatus | null) => {
    setStatusFilter(status);
    setBulkFeedback(null);
    if (status !== null) {
      productsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleProductPublicationToggle = async (produto: ProdutoRow) => {
    setBulkFeedback(null);
    setUndoAction(null);
    const publication = productPublications[produto.id];
    const previousState = {
      visivel_online: publication?.visivel_online ?? false,
      pausado_manualmente: publication?.pausado_manualmente ?? false,
    };
    const shouldPublish = !previousState.visivel_online;
    const shouldResume = previousState.visivel_online && previousState.pausado_manualmente;
    const nextState = shouldPublish
      ? { visivel_online: true, pausado_manualmente: false }
      : { pausado_manualmente: !shouldResume };
    const actionType = shouldPublish ? 'published' : shouldResume ? 'resumed' : 'paused';
    const message = shouldPublish
      ? `${produto.nome} publicado no cardápio.`
      : shouldResume
        ? `${produto.nome} retomado no cardápio.`
        : `${produto.nome} pausado no cardápio.`;

    try {
      await upsertProductPublication(produto.id, nextState);
      setUndoAction({
        type: actionType,
        changedIds: [produto.id],
        previousStates: { [produto.id]: previousState },
        message,
      });
      setBulkFeedback({ tone: 'success', message });
    } catch (toggleError) {
      setBulkFeedback({ tone: 'error', message: getFriendlyErrorMessage(toggleError) || 'Não foi possível atualizar a publicação.' });
    }
  };

  const createComponentProduct = async ({ nome, preco }: { nome: string; preco: number }) => {
    const duplicate = isExactCatalogProductNameDuplicate(nome, produtos);
    if (duplicate) throw new Error(`Já existe um produto chamado “${duplicate.nome}”. Selecione o existente para evitar duplicatas.`);
    const created = await createProduto({
      nome,
      preco,
      id_categoria: null,
      id_subcategoria: null,
    });
    await upsertProductPublication(created.id, { visivel_online: false });
    return created;
  };

  const requestDeleteProduct = (produto: ProdutoRow) => {
    const usageCount = componentUsages[produto.id]?.length ?? 0;
    if (usageCount > 0) {
      setBulkFeedback({
        tone: 'error',
        message: `${produto.nome} está vinculado a ${usageCount} uso${usageCount === 1 ? '' : 's'}. Remova ou substitua os vínculos antes de excluir o produto.`,
      });
      return;
    }
    setDel({ kind: 'produto', item: produto });
  };

  const requestDeleteCategory = (categoria: Categoria) => {
    const publishedCount = produtos.filter((produto) => (
      produto.id_categoria === categoria.id && productPublications[produto.id]?.visivel_online
    )).length;
    if (publishedCount > 0) {
      setBulkFeedback({
        tone: 'error',
        message: `Mova ou deixe como Somente complemento os ${publishedCount} produto${publishedCount === 1 ? '' : 's'} vendidos separadamente antes de excluir esta categoria.`,
      });
      return;
    }
    setDel({ kind: 'categoria', item: categoria });
  };

  const renderSearchProduct = (produto: ProdutoRow) => (
    <ProdutoRowItem
      key={produto.id}
      produto={produto}
      componentUsages={componentUsages[produto.id]}
      onTogglePublication={() => void handleProductPublicationToggle(produto)}
      selectionMode={bulk.selectionMode}
      selected={bulk.isSelected(produto.id)}
      onToggleSelected={() => {
        setBulkFeedback(null);
        bulk.toggle(produto.id);
      }}
      onEdit={() => setModal({ kind: 'produto', initial: produto, defaultCategoriaId: produto.id_categoria, defaultSubcategoriaId: produto.id_subcategoria })}
      onDelete={() => requestDeleteProduct(produto)}
      publication={productPublications[produto.id] ?? null}
      onConfigurePublication={() => setModal({ kind: 'produto', initial: produto, defaultCategoriaId: produto.id_categoria, defaultSubcategoriaId: produto.id_subcategoria, initialTab: 'publicacao' })}
    />
  );

  const renderSearchModifierOption = (option: CatalogSearchModifierOption) => {
    const parent = produtos.find((produto) => produto.id === option.parentProductId);
    if (!parent) return null;

    return (
      <div
        key={`modifier-option-${option.id}`}
        className="flex min-h-[44px] items-start gap-3 rounded-lg px-2 py-2 hover:bg-[var(--color-surface-muted)] sm:items-center"
      >
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium leading-5 text-[var(--color-ink)] sm:truncate">{option.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
              option.active
                ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]'
                : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]'
            }`}>
              {option.active ? 'Opção ativa' : 'Opção inativa'}
            </span>
            <span className="text-[11px] text-[var(--color-ink-muted)]">
              {option.groupName} · em {option.parentProductName}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModal({
            kind: 'produto',
            initial: parent,
            defaultCategoriaId: parent.id_categoria,
            defaultSubcategoriaId: parent.id_subcategoria,
          })}
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-2.5 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)]"
          aria-label={`Editar opções de ${option.parentProductName}`}
        >
          <Pencil className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Editar opções</span>
        </button>
      </div>
    );
  };

  return (
    <>
    <div className="flex flex-1 flex-col overflow-y-auto p-4 sm:p-6 lg:p-8">
      <div className="space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <ShoppingBag className="mt-0.5 h-6 w-6 shrink-0 text-[var(--color-brand)]" />
            <div>
              <h2 className="text-xl font-bold text-[var(--color-ink)] sm:text-2xl">Cardápio</h2>
              <p className="text-sm text-[var(--color-ink-muted)]">
                Cadastre categorias, subcategorias e produtos. A IA usa esses dados para responder clientes no WhatsApp.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void refresh()}
              disabled={authLoading || loading}
              className="flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
            <button
              onClick={() => setModal({ kind: 'categoria', initial: null })}
              className="flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-muted)]"
            >
              <FolderPlus className="h-4 w-4" /> Nova categoria
            </button>
            <button
              onClick={() => setModal({ kind: 'produto', initial: null, defaultCategoriaId: null, defaultSubcategoriaId: null })}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-brand-deep)] sm:flex-none"
            >
              <Plus className="h-4 w-4" /> Novo produto
            </button>
          </div>
        </header>

        <section className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-sm font-bold text-[var(--color-ink)]">{produtos.length} produtos cadastrados</h3>
              <p className="text-xs text-[var(--color-ink-muted)]">
                {categorias.length} categorias · {subcategorias.length} subcategorias
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={expandAll}
                className="text-xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                Expandir tudo
              </button>
              <span className="text-[var(--color-line-strong)]">·</span>
              <button
                onClick={collapseAll}
                className="text-xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                Recolher tudo
              </button>
              <span className="text-[var(--color-line-strong)]">·</span>
              {bulk.selectionMode ? (
                <button
                  onClick={() => {
                    bulk.exitSelection();
                    setBulkFeedback(null);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancelar seleção
                </button>
              ) : (
                <button
                  onClick={() => {
                    bulk.enterSelection();
                    setBulkFeedback(null);
                  }}
                  disabled={visibleProducts.length === 0}
                  className="text-xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Selecionar
                </button>
              )}
              <span className="text-[var(--color-line-strong)]">·</span>
              <button
                onClick={() => {
                  setReorderMode((current) => {
                    const next = !current;
                    if (next) {
                      setExpanded(new Set(categorias.map((categoria) => categoria.id)));
                      bulk.exitSelection();
                      setQuery('');
                    }
                    return next;
                  });
                  setBulkFeedback(null);
                }}
                disabled={reorderBusy || categorias.length + produtos.length < 2}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                  reorderMode
                    ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
                    : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                {reorderBusy ? 'Salvando ordem…' : reorderMode ? 'Concluir ordem' : 'Ordenar'}
              </button>
              <div className="flex w-full min-h-[44px] items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] px-3 py-2 md:ml-2 md:w-auto">
                <Search className="h-4 w-4 text-[var(--color-ink-faint)]" />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setBulkFeedback(null);
                  }}
                  placeholder="Buscar produto..."
                  className="w-full bg-transparent text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)] md:w-56"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2" aria-label="Filtrar produtos">
              {[
                { value: 'all' as const, label: CATALOG_FILTER_LABELS.all, count: produtos.length },
                { value: 'standalone' as const, label: CATALOG_FILTER_LABELS.standalone, count: produtos.filter((p) => ['standalone', 'standalone_and_component'].includes(getCatalogProductRole(Boolean(productPublications[p.id]?.visivel_online), componentUsages[p.id]?.length ?? 0))).length },
                { value: 'component' as const, label: CATALOG_FILTER_LABELS.component, count: produtos.filter((p) => ['component', 'standalone_and_component'].includes(getCatalogProductRole(Boolean(productPublications[p.id]?.visivel_online), componentUsages[p.id]?.length ?? 0))).length },
                { value: 'paused' as const, label: CATALOG_FILTER_LABELS.paused, count: produtos.filter((p) => getZeloMenuPublicationStatus({ ...p, publication: productPublications[p.id] ?? null }).status === 'paused').length },
                { value: 'out_of_stock' as const, label: CATALOG_FILTER_LABELS.out_of_stock, count: produtos.filter((p) => getZeloMenuPublicationStatus({ ...p, publication: productPublications[p.id] ?? null }).status === 'out_of_stock').length },
                { value: 'draft' as const, label: CATALOG_FILTER_LABELS.draft, count: produtos.filter((p) => getCatalogProductRole(Boolean(productPublications[p.id]?.visivel_online), componentUsages[p.id]?.length ?? 0) === 'draft').length },
              ].map((filter) => {
                const active = catalogFilter === filter.value;
                return (
                  <button
                    key={filter.label}
                    type="button"
                    onClick={() => setCatalogFilter(filter.value)}
                    className={`min-h-10 rounded-full border px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 ${
                      active
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
                        : 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]'
                    }`}
                  >
                    {filter.label} <span className="font-mono">{filter.count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {bulk.selectionMode && (
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-[var(--color-brand-soft)] bg-[var(--color-brand-soft)]/40 p-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <SelectionCheckbox
                  checked={bulk.allVisibleSelected}
                  indeterminate={bulk.hasSelection && !bulk.allVisibleSelected}
                  onChange={bulk.toggleVisible}
                  ariaLabel="Selecionar produtos visíveis"
                />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-brand-deep)]">
                    {bulk.selectedCount} produto{bulk.selectedCount === 1 ? '' : 's'} selecionado{bulk.selectedCount === 1 ? '' : 's'}
                  </p>
                  <p className="text-xs text-[var(--color-brand-deep)]/80">
                    A seleção acompanha a busca atual desta tela.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void bulk.toggleVisible()}
                  disabled={visibleProducts.length === 0 || bulk.busyAction !== null}
                  className="min-h-[44px] rounded-lg border border-[var(--color-brand-soft)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-brand-deep)] transition-colors hover:bg-[var(--color-brand-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bulk.allVisibleSelected ? 'Limpar visíveis' : 'Selecionar visíveis'}
                </button>
                {canPublishToMenu && (
                  <>
                    <button
                      onClick={() => void handleBulkPublish()}
                      disabled={!bulk.hasSelection || bulk.busyAction !== null}
                      className="min-h-[44px] rounded-lg bg-[var(--color-brand)] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-brand-deep)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {bulk.busyAction === 'set-publication' ? 'Publicando...' : 'Publicar no link'}
                    </button>
                  </>
                )}
                <button
                  onClick={() => setBulkDeleteConfirm(true)}
                  disabled={!bulk.hasSelection || bulk.busyAction !== null}
                  className="min-h-[44px] rounded-lg border border-[var(--color-alert-soft)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-alert)] transition-colors hover:bg-[var(--color-alert-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bulk.busyAction === 'delete' ? 'Excluindo...' : 'Excluir selecionados'}
                </button>
              </div>
            </div>
          )}

          {bulkFeedback && (
            <div
              role="status"
              aria-live="polite"
              className={`mb-4 rounded-xl border p-3 ${
              bulkFeedback.tone === 'success'
                ? 'border-[var(--color-success-soft)] bg-[var(--color-success-soft)] text-[var(--color-success)]'
                : 'border-[var(--color-warn-soft)] bg-[var(--color-warn-soft)] text-[var(--color-warn)]'
              }`}
            >
              <p className="text-xs font-medium">{bulkFeedback.message}</p>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-xl border border-[var(--color-alert-soft)] bg-[var(--color-alert-soft)] p-3">
              <p className="text-xs font-medium text-[var(--color-alert)]">{error}</p>
            </div>
          )}

          {!authLoading && !isAuthenticated && (
            <div className="rounded-xl border border-[var(--color-warn-soft)] bg-[var(--color-warn-soft)] p-3">
              <p className="text-xs font-medium text-[var(--color-warn)]">Faça login para carregar o cardápio.</p>
            </div>
          )}

          {isAuthenticated && !loading && categorias.length === 0 && produtos.length === 0 && !error && (
            <EmptyState
              onCreateCategoria={() => setModal({ kind: 'categoria', initial: null })}
              onCreateProduto={() => setModal({ kind: 'produto', initial: null, defaultCategoriaId: null, defaultSubcategoriaId: null })}
            />
          )}

          {isAuthenticated && (loading || categorias.length > 0 || produtos.length > 0) && (
            <div ref={productsSectionRef} className="space-y-3">
              {statusFilter && (
                <div className="flex items-center gap-2 rounded-lg bg-[var(--color-brand-soft)]/40 px-3 py-2">
                  <span className="text-xs font-medium text-[var(--color-brand-deep)]">
                    Filtrando: <strong>{publicationTone(statusFilter).label}</strong>
                  </span>
                  <button
                    onClick={() => setStatusFilter(null)}
                    className="ml-auto flex min-h-[36px] items-center gap-1 rounded-md px-2 text-xs font-semibold text-[var(--color-brand-deep)] hover:bg-[var(--color-brand-soft)]"
                    aria-label="Limpar filtro"
                  >
                    <X className="h-3.5 w-3.5" />
                    Todos os produtos
                  </button>
                </div>
              )}
              {flatResultMode ? (
                <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
                  <div className="mb-2 flex items-center justify-between gap-3 px-1">
                    <p className="text-sm font-bold text-[var(--color-ink)]">{flatResultHeading}</p>
                    <span className="text-xs font-medium text-[var(--color-ink-muted)]">
                      {displayProducts.length + searchModifierOptions.length} resultado{displayProducts.length + searchModifierOptions.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {displayProducts.length > 0 || searchModifierOptions.length > 0 ? (
                    <div className="divide-y divide-[var(--color-line)]">
                      {displayProducts.map(renderSearchProduct)}
                      {searchModifierOptions.map(renderSearchModifierOption)}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-[var(--color-line)] p-6 text-center text-sm text-[var(--color-ink-muted)]">
                      {normalized ? `Nenhum produto encontrado para “${query.trim()}”.` : 'Nenhum produto corresponde a este filtro.'}
                    </div>
                  )}
                </div>
              ) : reorderMode ? (
                <SortableList
                  items={tree}
                  getId={(node) => node.categoria.id}
                  onReorder={(reordered) => void handleCategoryReorder(reordered)}
                  disabled={reorderBusy}
                  rowClassName="border-0 bg-transparent"
                  renderItem={(node) => (
                    <CategoriaCard
                  key={node.categoria.id}
                  node={node}
                  expanded={expanded.has(node.categoria.id)}
                  forceExpanded={flatResultMode}
                  toggle={() => toggleCat(node.categoria.id)}
                  onEditCategoria={() => setModal({ kind: 'categoria', initial: node.categoria })}
                  onDeleteCategoria={() => requestDeleteCategory(node.categoria)}
                  onNewSubcategoria={() =>
                    setModal({ kind: 'subcategoria', initial: null, defaultCategoriaId: node.categoria.id })
                  }
                  onNewProduto={(subId) =>
                    setModal({
                      kind: 'produto',
                      initial: null,
                      defaultCategoriaId: node.categoria.id,
                      defaultSubcategoriaId: subId,
                    })
                  }
                  onEditSubcategoria={(sub) => setModal({ kind: 'subcategoria', initial: sub, defaultCategoriaId: sub.id_categoria })}
                  onDeleteSubcategoria={(sub) => setDel({ kind: 'subcategoria', item: sub })}
                  selectionMode={bulk.selectionMode}
                  selectedIds={bulk.selectedIds}
                  onToggleCategorySelection={(ids) => {
                    setBulkFeedback(null);
                    bulk.toggleMany(ids);
                  }}
                  onToggleSubcategorySelection={(ids) => {
                    setBulkFeedback(null);
                    bulk.toggleMany(ids);
                  }}
                  onToggleProdutoSelection={(id) => {
                    setBulkFeedback(null);
                    bulk.toggle(id);
                  }}
                  onEditProduto={(p) =>
                    setModal({ kind: 'produto', initial: p, defaultCategoriaId: p.id_categoria, defaultSubcategoriaId: p.id_subcategoria })
                  }
                  componentUsages={componentUsages}
                  onToggleProductPublication={handleProductPublicationToggle}
                  onDeleteProduto={requestDeleteProduct}
                  productPublications={productPublications}
                  onConfigurePublication={(p) => setModal({ kind: 'produto', initial: p, defaultCategoriaId: p.id_categoria, defaultSubcategoriaId: p.id_subcategoria, initialTab: 'publicacao' })}
                  onSetCategoryPublication={(ids, state) => {
                    setUndoAction(null);
                    setConfirmCategoryAction({ ids, state });
                  }}
                  publicationActionBusy={bulk.busyAction !== null}
                  reorderMode
                  reorderBusy={reorderBusy}
                  onReorderProducts={(products) => void handleProductReorder(products)}
                />
                  )}
                />
              ) : tree.map((node) => (
                <CategoriaCard
                  key={node.categoria.id}
                  node={node}
                  expanded={expanded.has(node.categoria.id)}
                  forceExpanded={flatResultMode}
                  toggle={() => toggleCat(node.categoria.id)}
                  onEditCategoria={() => setModal({ kind: 'categoria', initial: node.categoria })}
                  onDeleteCategoria={() => requestDeleteCategory(node.categoria)}
                  onNewSubcategoria={() =>
                    setModal({ kind: 'subcategoria', initial: null, defaultCategoriaId: node.categoria.id })
                  }
                  onNewProduto={(subId) =>
                    setModal({
                      kind: 'produto',
                      initial: null,
                      defaultCategoriaId: node.categoria.id,
                      defaultSubcategoriaId: subId,
                    })
                  }
                  onEditSubcategoria={(sub) => setModal({ kind: 'subcategoria', initial: sub, defaultCategoriaId: sub.id_categoria })}
                  onDeleteSubcategoria={(sub) => setDel({ kind: 'subcategoria', item: sub })}
                  selectionMode={bulk.selectionMode}
                  selectedIds={bulk.selectedIds}
                  onToggleCategorySelection={(ids) => {
                    setBulkFeedback(null);
                    bulk.toggleMany(ids);
                  }}
                  onToggleSubcategorySelection={(ids) => {
                    setBulkFeedback(null);
                    bulk.toggleMany(ids);
                  }}
                  onToggleProdutoSelection={(id) => {
                    setBulkFeedback(null);
                    bulk.toggle(id);
                  }}
                  onEditProduto={(p) =>
                    setModal({ kind: 'produto', initial: p, defaultCategoriaId: p.id_categoria, defaultSubcategoriaId: p.id_subcategoria })
                  }
                  componentUsages={componentUsages}
                  onToggleProductPublication={handleProductPublicationToggle}
                  onDeleteProduto={requestDeleteProduct}
                  productPublications={productPublications}
                  onConfigurePublication={(p) => setModal({ kind: 'produto', initial: p, defaultCategoriaId: p.id_categoria, defaultSubcategoriaId: p.id_subcategoria, initialTab: 'publicacao' })}
                  onSetCategoryPublication={(ids, state) => {
                    setUndoAction(null);
                    setConfirmCategoryAction({ ids, state });
                  }}
                  publicationActionBusy={bulk.busyAction !== null}
                  reorderMode={false}
                  reorderBusy={false}
                  onReorderProducts={() => undefined}
                />
              ))}

              {!flatResultMode && orphanProducts.length > 0 && (
                <div className="rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface-muted)] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    {bulk.selectionMode && (
                      <SelectionCheckbox
                        checked={getSelectionState(orphanProducts.map((product) => product.id), bulk.selectedIds) === 'all'}
                        indeterminate={getSelectionState(orphanProducts.map((product) => product.id), bulk.selectedIds) === 'some'}
                        onChange={() => {
                          setBulkFeedback(null);
                          bulk.toggleMany(orphanProducts.map((product) => product.id));
                        }}
                        ariaLabel="Selecionar produtos sem categoria"
                      />
                    )}
                    <p className="text-xs font-semibold text-[var(--color-ink-muted)]">Sem categoria ({orphanProducts.length})</p>
                  </div>
                  {reorderMode ? (
                    <SortableList
                      items={orphanProducts}
                      getId={(product) => product.id}
                      onReorder={(reordered) => void handleProductReorder(reordered)}
                      disabled={reorderBusy}
                      renderItem={(p) => (
                      <ProdutoRowItem
                        key={p.id}
                        produto={p}
                        componentUsages={componentUsages[p.id]}
                        onTogglePublication={() => void handleProductPublicationToggle(p)}
                        selectionMode={bulk.selectionMode}
                        selected={bulk.isSelected(p.id)}
                        onToggleSelected={() => {
                          setBulkFeedback(null);
                          bulk.toggle(p.id);
                        }}
                        onEdit={() =>
                          setModal({ kind: 'produto', initial: p, defaultCategoriaId: null, defaultSubcategoriaId: null })
                        }
                        onDelete={() => requestDeleteProduct(p)}
                        publication={productPublications[p.id] ?? null}
                        onConfigurePublication={() => setModal({ kind: 'produto', initial: p, defaultCategoriaId: p.id_categoria, defaultSubcategoriaId: p.id_subcategoria, initialTab: 'publicacao' })}
                      />
                      )}
                    />
                  ) : (
                    <div className="space-y-2">
                      {orphanProducts.map((p) => (
                        <ProdutoRowItem
                          key={p.id}
                          produto={p}
                          componentUsages={componentUsages[p.id]}
                          onTogglePublication={() => void handleProductPublicationToggle(p)}
                          selectionMode={bulk.selectionMode}
                          selected={bulk.isSelected(p.id)}
                          onToggleSelected={() => {
                            setBulkFeedback(null);
                            bulk.toggle(p.id);
                          }}
                          onEdit={() =>
                            setModal({ kind: 'produto', initial: p, defaultCategoriaId: null, defaultSubcategoriaId: null })
                          }
                          onDelete={() => requestDeleteProduct(p)}
                          publication={productPublications[p.id] ?? null}
                          onConfigurePublication={() => setModal({ kind: 'produto', initial: p, defaultCategoriaId: p.id_categoria, defaultSubcategoriaId: p.id_subcategoria, initialTab: 'publicacao' })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

            </div>
          )}

        </section>

        <ZeloMenuPublicationPanel
          totalProdutos={produtos.length}
          summary={publicationSummary}
          issues={publicationIssues}
          onEditProduto={(produto) =>
            setModal({ kind: 'produto', initial: produto, defaultCategoriaId: produto.id_categoria, defaultSubcategoriaId: produto.id_subcategoria })
          }
          onConfigurePublication={(produto) => setModal({ kind: 'produto', initial: produto, defaultCategoriaId: produto.id_categoria, defaultSubcategoriaId: produto.id_subcategoria, initialTab: 'publicacao' })}
          statusFilter={statusFilter}
          onSetStatusFilter={handleStatusFilter}
        />
      </div>

      {/* Modals */}
      <CategoriaModal
        open={modal?.kind === 'categoria'}
        initial={modal?.kind === 'categoria' ? modal.initial : null}
        onClose={() => setModal(null)}
        onSubmit={async (input) => {
          if (modal?.kind === 'categoria' && modal.initial) {
            await updateCategoria(modal.initial.id, input);
          } else {
            await createCategoria(input);
          }
        }}
      />

      <SubcategoriaModal
        open={modal?.kind === 'subcategoria'}
        initial={modal?.kind === 'subcategoria' ? modal.initial : null}
        defaultCategoriaId={modal?.kind === 'subcategoria' ? modal.defaultCategoriaId : null}
        categorias={categorias}
        onClose={() => setModal(null)}
        onSubmit={async (input) => {
          if (modal?.kind === 'subcategoria' && modal.initial) {
            await updateSubcategoria(modal.initial.id, input);
          } else {
            await createSubcategoria(input);
          }
        }}
      />

      <ProductModal
        open={modal?.kind === 'produto'}
        initial={modal?.kind === 'produto' ? modal.initial : null}
        initialTab={modal?.kind === 'produto' ? modal.initialTab : 'produto'}
        initialPublication={modal?.kind === 'produto' && modal.initial ? productPublications[modal.initial.id] ?? null : null}
        defaultCategoriaId={modal?.kind === 'produto' ? modal.defaultCategoriaId : null}
        defaultSubcategoriaId={modal?.kind === 'produto' ? modal.defaultSubcategoriaId : null}
        categorias={categorias}
        subcategorias={subcategorias}
        products={editorProducts}
        productUsageCounts={productUsageCounts}
        modifierGroups={
          modal?.kind === 'produto' && modal.initial
            ? productModifierGroups[modal.initial.id] ?? []
            : []
        }
        modifierOptionProducts={modifierOptionProducts}
        onCreateComponentProduct={createComponentProduct}
        onClose={() => setModal(null)}
        onSubmit={async (input) => {
          if (modal?.kind === 'produto' && modal.initial) {
            await updateProduto(modal.initial.id, input);
            return modal.initial;
          } else {
            return createProduto(input);
          }
        }}
        onSaveModifierGroups={replaceProductModifierGroups}
        uploadImage={uploadProductPublicationImage}
        deleteImage={deleteProductPublicationImage}
        onSavePublication={upsertProductPublication}
        onNavigate={(product, tab) => setModal({
          kind: 'produto',
          initial: product,
          defaultCategoriaId: product.id_categoria,
          defaultSubcategoriaId: product.id_subcategoria,
          initialTab: tab,
        })}
      />

      <ConfirmDelete
        open={del !== null}
        title={
          del?.kind === 'produto'
            ? 'Excluir produto?'
            : del?.kind === 'subcategoria'
              ? 'Excluir subcategoria?'
              : 'Excluir categoria?'
        }
        message={
          del?.kind === 'produto'
            ? `O produto "${del.item.nome}" será removido permanentemente.`
            : del?.kind === 'subcategoria'
              ? `A subcategoria "${del.item.nome}" será removida. Produtos ligados a ela ficarão sem subcategoria.`
              : del?.kind === 'categoria'
                ? `A categoria "${del.item.nome}" e suas subcategorias serão removidas. Os produtos serão preservados e componentes continuarão vinculados aos seus produtos-pai.`
                : ''
        }
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          if (del.kind === 'categoria') await deleteCategoria(del.item.id);
          else if (del.kind === 'subcategoria') await deleteSubcategoria(del.item.id);
          else if (del.kind === 'produto') await deleteProduto(del.item.id);
        }}
      />

      <ConfirmDelete
        open={bulkDeleteConfirm}
        title="Excluir produtos selecionados?"
        message={`Excluir ${bulk.selectedCount} produto${bulk.selectedCount === 1 ? '' : 's'}? Esta ação não pode ser desfeita.`}
        onClose={() => setBulkDeleteConfirm(false)}
        onConfirm={async () => {
          setBulkDeleteConfirm(false);
          const result = await bulk.run({ type: 'delete' });
          if (result.total === 0) return;
          if (result.failed.length === 0) {
            setBulkFeedback({
              tone: 'success',
              message: `${result.changed} produto${result.changed === 1 ? '' : 's'} excluído${result.changed === 1 ? '' : 's'}.`,
            });
            return;
          }
          setBulkFeedback({
            tone: 'error',
            message: `${result.changed} produto${result.changed === 1 ? '' : 's'} excluído${result.changed === 1 ? '' : 's'}, mas ${result.failed.length} falharam.`,
          });
        }}
      />

    </div>

      {confirmCategoryAction && (
        <ConfirmModal
          open
          title="Publicar produtos?"
          message={`${confirmCategoryAction.ids.length} produto${confirmCategoryAction.ids.length === 1 ? '' : 's'} será${confirmCategoryAction.ids.length === 1 ? '' : 'o'} publicado${confirmCategoryAction.ids.length === 1 ? '' : 's'} no cardápio.`}
          destructive={false}
          confirmLabel="Publicar"
          onClose={() => setConfirmCategoryAction(null)}
          onConfirm={async () => {
            const action = confirmCategoryAction;
            setConfirmCategoryAction(null);
            if (action) void handlePublicationState(action.ids, action.state);
          }}
        />
      )}

      {undoAction && (
        <div
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 shadow-lg flex items-center gap-3 max-w-[95vw]"
          role="alert"
          aria-live="polite"
        >
          <span className="text-sm text-[var(--color-ink)]">{undoAction.message}</span>
          <button
            onClick={handleUndo}
            className="min-h-[44px] shrink-0 rounded-lg bg-[var(--color-brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-brand-deep)]"
          >
            Desfazer
          </button>
          <button onClick={() => setUndoAction(null)} className="min-h-[44px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]" aria-label="Dispensar">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {bulk.selectionMode && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-[var(--color-line)] bg-[var(--color-surface)] px-4 pb-[env(safe-area-inset-bottom,8px)] pt-3 shadow-lg md:hidden">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-[var(--color-ink)]">{bulk.selectedCount} selecionado{bulk.selectedCount !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkPublish}
                disabled={bulk.busyAction !== null || bulk.selectedCount === 0}
                className="min-h-[44px] rounded-lg border border-[var(--color-brand-soft)] bg-[var(--color-brand-soft)]/50 px-3 text-xs font-semibold text-[var(--color-brand-deep)] transition-colors hover:bg-[var(--color-brand-soft)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Publicar
              </button>
              <button
                onClick={() => setBulkDeleteConfirm(true)}
                disabled={bulk.busyAction === 'delete' || bulk.selectedCount === 0}
                className="min-h-[44px] rounded-lg border border-[var(--color-alert-soft)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-alert)] transition-colors hover:bg-[var(--color-alert-soft)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ---------- Sub components ----------

type TreeNode = {
  categoria: Categoria;
  produtosDireto: ProdutoRow[];
  subcategorias: Array<{ subcategoria: Subcategoria; produtos: ProdutoRow[] }>;
};

function buildTree(
  categorias: Categoria[],
  subcategorias: Subcategoria[],
  produtos: ProdutoRow[],
  publications: Record<number, ZeloMenuProductPublicationRow>,
): TreeNode[] {
  return categorias.map((categoria) => {
    const subs = subcategorias.filter((s) => s.id_categoria === categoria.id);
    const produtosByCategoria = produtos.filter((p) => p.id_categoria === categoria.id);
    const produtosDireto = sortProductsForMenu(
      produtosByCategoria.filter((p) => p.id_subcategoria == null),
      publications,
    );
    const subNodes = subs.map((sub) => ({
      subcategoria: sub,
      produtos: sortProductsForMenu(
        produtosByCategoria.filter((p) => p.id_subcategoria === sub.id),
        publications,
      ),
    }));
    return { categoria, produtosDireto, subcategorias: subNodes };
  });
}

function sortProductsForMenu(
  products: ProdutoRow[],
  publications: Record<number, ZeloMenuProductPublicationRow>,
): ProdutoRow[] {
  return [...products].sort((a, b) => {
    const orderDiff = (publications[a.id]?.ordem ?? Number.MAX_SAFE_INTEGER)
      - (publications[b.id]?.ordem ?? Number.MAX_SAFE_INTEGER);
    return orderDiff || a.nome.localeCompare(b.nome);
  });
}

function sortProductsForEditor(
  products: ProdutoRow[],
  categories: Categoria[],
  subcategories: Subcategoria[],
  publications: Record<number, ZeloMenuProductPublicationRow>,
): ProdutoRow[] {
  const categoryOrder = new Map(categories.map((category, index) => [category.id, index]));
  const subcategoryOrder = new Map(subcategories.map((subcategory, index) => [subcategory.id, index]));
  return [...products].sort((a, b) => {
    const categoryDiff = (a.id_categoria == null ? Number.MAX_SAFE_INTEGER : categoryOrder.get(a.id_categoria) ?? Number.MAX_SAFE_INTEGER)
      - (b.id_categoria == null ? Number.MAX_SAFE_INTEGER : categoryOrder.get(b.id_categoria) ?? Number.MAX_SAFE_INTEGER);
    if (categoryDiff) return categoryDiff;
    const subcategoryDiff = (a.id_subcategoria == null ? -1 : subcategoryOrder.get(a.id_subcategoria) ?? Number.MAX_SAFE_INTEGER)
      - (b.id_subcategoria == null ? -1 : subcategoryOrder.get(b.id_subcategoria) ?? Number.MAX_SAFE_INTEGER);
    if (subcategoryDiff) return subcategoryDiff;
    const publicationDiff = (publications[a.id]?.ordem ?? Number.MAX_SAFE_INTEGER)
      - (publications[b.id]?.ordem ?? Number.MAX_SAFE_INTEGER);
    return publicationDiff || a.nome.localeCompare(b.nome);
  });
}

function withPublication(
  produto: ProdutoRow,
  productPublications: Record<number, ZeloMenuProductPublicationRow>,
): ProdutoWithPublication {
  return {
    ...produto,
    publication: productPublications[produto.id] ?? null,
  };
}

type CategoriaCardProps = {
  node: TreeNode;
  expanded: boolean;
  forceExpanded: boolean;
  toggle: () => void;
  onEditCategoria: () => void;
  onDeleteCategoria: () => void;
  onNewSubcategoria: () => void;
  onNewProduto: (subId: number | null) => void;
  onEditSubcategoria: (sub: Subcategoria) => void;
  onDeleteSubcategoria: (sub: Subcategoria) => void;
  selectionMode: boolean;
  selectedIds: ReadonlySet<number>;
  onToggleCategorySelection: (ids: number[]) => void;
  onToggleSubcategorySelection: (ids: number[]) => void;
  onToggleProdutoSelection: (id: number) => void;
  onEditProduto: (p: ProdutoRow) => void;
  componentUsages: Record<number, ComponentUsage[]>;
  onToggleProductPublication: (p: ProdutoRow) => void;
  onDeleteProduto: (p: ProdutoRow) => void;
  productPublications: Record<number, ZeloMenuProductPublicationRow>;
  onConfigurePublication: (p: ProdutoRow) => void;
  onSetCategoryPublication: (ids: number[], state: PublicationActionState) => void;
  publicationActionBusy: boolean;
  reorderMode: boolean;
  reorderBusy: boolean;
  onReorderProducts: (products: ProdutoRow[]) => void;
};

const CategoriaCard: React.FC<CategoriaCardProps> = ({
  node,
  expanded,
  forceExpanded,
  toggle,
  onEditCategoria,
  onDeleteCategoria,
  onNewSubcategoria,
  onNewProduto,
  onEditSubcategoria,
  onDeleteSubcategoria,
  selectionMode,
  selectedIds,
  onToggleCategorySelection,
  onToggleSubcategorySelection,
  onToggleProdutoSelection,
  onEditProduto,
  componentUsages,
  onToggleProductPublication,
  onDeleteProduto,
  productPublications,
  onConfigurePublication,
  onSetCategoryPublication,
  publicationActionBusy,
  reorderMode,
  reorderBusy,
  onReorderProducts,
}) => {
  const isOpen = expanded || forceExpanded;
  const totalProdutos = node.produtosDireto.length + node.subcategorias.reduce((acc, s) => acc + s.produtos.length, 0);
  const categoryIds = getCategoryProductIds(node);
  const categorySelectionState = getSelectionState(categoryIds, selectedIds);
  const categoryActions = getCategoryActions(categoryIds, productPublications);
  const allCategoryProducts = useMemo(() => [...node.produtosDireto, ...node.subcategorias.flatMap((s) => s.produtos)], [node]);
  const categorySummary = totalProdutos > 0 ? getCategorySummary(categoryIds, productPublications, allCategoryProducts) : '';

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex min-h-[44px] flex-wrap items-center gap-2 bg-[var(--color-surface-muted)] px-3 py-3">
        {selectionMode && totalProdutos > 0 && (
          <SelectionCheckbox
            checked={categorySelectionState === 'all'}
            indeterminate={categorySelectionState === 'some'}
            onChange={() => onToggleCategorySelection(categoryIds)}
            ariaLabel={`Selecionar categoria ${node.categoria.nome}`}
          />
        )}
        <button
          onClick={toggle}
          className="rounded-lg p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)]"
          aria-label={isOpen ? 'Recolher' : 'Expandir'}
        >
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <button onClick={toggle} className="min-w-0 flex-1 text-left">
          <span className="text-sm font-bold text-[var(--color-ink)]">{node.categoria.nome}</span>
          <span className="ml-2 text-xs text-[var(--color-ink-muted)]">
            {totalProdutos} {totalProdutos === 1 ? 'produto' : 'produtos'}
            {node.subcategorias.length > 0 ? ` · ${node.subcategorias.length} subcategoria${node.subcategorias.length === 1 ? '' : 's'}` : ''}
          </span>
          {categorySummary && (
            <span className="ml-2 hidden text-[11px] text-[var(--color-ink-faint)] sm:inline">{categorySummary}</span>
          )}
        </button>

        <ActionsMenu
          label={node.categoria.nome}
          actions={[
            ...categoryActions.map((action) => ({
              label: action.label,
              icon: <Globe2 className="h-4 w-4" />,
              onSelect: () => onSetCategoryPublication(categoryIds, action.state),
              disabled: publicationActionBusy,
            })),
            { label: 'Nova subcategoria', icon: <FolderPlus className="h-4 w-4" />, onSelect: onNewSubcategoria },
            { label: 'Novo produto', icon: <Plus className="h-4 w-4" />, onSelect: () => onNewProduto(null) },
            { label: 'Editar categoria', icon: <Pencil className="h-4 w-4" />, onSelect: onEditCategoria },
            { label: 'Excluir categoria', icon: <Trash2 className="h-4 w-4" />, onSelect: onDeleteCategoria, destructive: true },
          ]}
        />
      </div>

      {isOpen && (
        <div className="divide-y divide-[var(--color-line)]">
          {reorderMode && node.produtosDireto.length > 1 ? (
            <div className="px-4 py-2">
              <SortableList
                items={node.produtosDireto}
                getId={(product) => product.id}
                onReorder={onReorderProducts}
                disabled={reorderBusy}
                renderItem={(p) => (
                  <ProdutoRowItem
                    produto={p}
                    componentUsages={componentUsages[p.id]}
                    onTogglePublication={() => onToggleProductPublication(p)}
                    publication={productPublications[p.id] ?? null}
                    onEdit={() => onEditProduto(p)}
                    onDelete={() => onDeleteProduto(p)}
                    onConfigurePublication={() => onConfigurePublication(p)}
                  />
                )}
              />
            </div>
          ) : node.produtosDireto.map((p) => (
            <div key={p.id} className="px-4 py-2">
              <ProdutoRowItem
                produto={p}
                componentUsages={componentUsages[p.id]}
                onTogglePublication={() => onToggleProductPublication(p)}
                selectionMode={selectionMode}
                selected={selectedIds.has(p.id)}
                onToggleSelected={() => onToggleProdutoSelection(p.id)}
                publication={productPublications[p.id] ?? null}
                onEdit={() => onEditProduto(p)}
                onDelete={() => onDeleteProduto(p)}
                onConfigurePublication={() => onConfigurePublication(p)}
              />
            </div>
          ))}

          {node.subcategorias.map(({ subcategoria, produtos }) => {
            const subIds = produtos.map((p) => p.id);
            const subActions = getCategoryActions(subIds, productPublications);
            const subSummary = produtos.length > 0 ? getCategorySummary(subIds, productPublications, produtos) : '';
            return (
            <div key={subcategoria.id} className="px-4 py-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {selectionMode && produtos.length > 0 && (
                  <SelectionCheckbox
                    checked={getSelectionState(produtos.map((p) => p.id), selectedIds) === 'all'}
                    indeterminate={getSelectionState(produtos.map((p) => p.id), selectedIds) === 'some'}
                    onChange={() => onToggleSubcategorySelection(produtos.map((p) => p.id))}
                    ariaLabel={`Selecionar subcategoria ${subcategoria.nome}`}
                  />
                )}
                <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                  {subcategoria.nome}
                </span>
                <span className="text-[11px] text-[var(--color-ink-faint)]">
                  {produtos.length} {produtos.length === 1 ? 'produto' : 'produtos'}
                </span>
                {subSummary && !selectionMode && (
                  <span className="hidden text-[11px] text-[var(--color-ink-faint)] sm:inline">{subSummary}</span>
                )}
                <ActionsMenu
                  label={subcategoria.nome}
                  actions={[
                    ...subActions.map((action) => ({
                      label: action.label,
                      icon: <Globe2 className="h-4 w-4" />,
                      onSelect: () => onSetCategoryPublication(subIds, action.state),
                      disabled: publicationActionBusy,
                    })),
                    { label: 'Novo produto', icon: <Plus className="h-4 w-4" />, onSelect: () => onNewProduto(subcategoria.id) },
                    { label: 'Editar subcategoria', icon: <Pencil className="h-4 w-4" />, onSelect: () => onEditSubcategoria(subcategoria) },
                    { label: 'Excluir subcategoria', icon: <Trash2 className="h-4 w-4" />, onSelect: () => onDeleteSubcategoria(subcategoria), destructive: true },
                  ]}
                />
              </div>
              {reorderMode && produtos.length > 1 ? (
                <SortableList
                  items={produtos}
                  getId={(product) => product.id}
                  onReorder={onReorderProducts}
                  disabled={reorderBusy}
                  renderItem={(p) => (
                  <ProdutoRowItem
                    produto={p}
                    componentUsages={componentUsages[p.id]}
                    onTogglePublication={() => onToggleProductPublication(p)}
                    publication={productPublications[p.id] ?? null}
                    onEdit={() => onEditProduto(p)}
                    onDelete={() => onDeleteProduto(p)}
                    onConfigurePublication={() => onConfigurePublication(p)}
                  />
                  )}
                />
              ) : (
                <div className="space-y-1.5">
                  {produtos.map((p) => (
                    <ProdutoRowItem
                      key={p.id}
                      produto={p}
                      componentUsages={componentUsages[p.id]}
                      onTogglePublication={() => onToggleProductPublication(p)}
                      selectionMode={selectionMode}
                      selected={selectedIds.has(p.id)}
                      onToggleSelected={() => onToggleProdutoSelection(p.id)}
                      publication={productPublications[p.id] ?? null}
                      onEdit={() => onEditProduto(p)}
                      onDelete={() => onDeleteProduto(p)}
                      onConfigurePublication={() => onConfigurePublication(p)}
                    />
                  ))}
                </div>
              )}
                {produtos.length === 0 && (
                  <p className="py-1 text-[12px] italic text-[var(--color-ink-faint)]">
                    Nenhum produto aqui ainda.
                  </p>
                )}
            </div>
          );
        })}

          {node.produtosDireto.length === 0 && node.subcategorias.length === 0 && (
            <div className="px-4 py-5 text-center text-xs text-[var(--color-ink-muted)]">
              Nenhum produto nesta categoria.{' '}
              <button
                onClick={() => onNewProduto(null)}
                className="font-semibold text-[var(--color-brand-deep)] hover:underline"
              >
                Adicionar produto
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

type ProdutoRowItemProps = {
  produto: ProdutoRow;
  componentUsages?: ComponentUsage[];
  onTogglePublication?: () => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
  publication?: ZeloMenuProductPublicationRow | null;
  onEdit: () => void;
  onDelete: () => void;
  onConfigurePublication: () => void;
};

const ProdutoRowItem: React.FC<ProdutoRowItemProps> = ({
  produto,
  componentUsages,
  onTogglePublication,
  selectionMode = false,
  selected = false,
  onToggleSelected,
  publication,
  onEdit,
  onDelete,
  onConfigurePublication,
}) => {
  const publicationStatus = getZeloMenuPublicationStatus({ ...produto, publication: publication ?? null });
  const role = getCatalogProductRole(Boolean(publication?.visivel_online), componentUsages?.length ?? 0);
  const roleLabel = role === 'component'
    ? 'Somente complemento'
    : role === 'standalone_and_component'
      ? 'Vendido separadamente · componente'
      : role === 'standalone'
        ? 'Vendido separadamente'
        : 'Rascunho';

  return (
    <div className="group flex min-h-[44px] items-start gap-2 rounded-lg px-2 py-2 hover:bg-[var(--color-surface-muted)] sm:items-center sm:gap-3 sm:py-1.5">
      {selectionMode && (
        <SelectionCheckbox
          checked={selected}
          onChange={() => onToggleSelected?.()}
          ariaLabel={`Selecionar produto ${produto.nome}`}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium leading-5 text-[var(--color-ink)] sm:truncate">{produto.nome}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 sm:mt-0 sm:gap-2">
          <PublicationStatusPill status={publicationStatus.status} />
          <span className="rounded-full bg-[var(--color-surface-muted)] px-2 py-1 text-[11px] font-semibold text-[var(--color-ink-soft)]">
            {roleLabel}
          </span>
          <span className="font-mono text-sm text-[var(--color-ink-soft)] sm:hidden">R$ {produto.preco.toFixed(2)}</span>
          {produto.controlar_estoque && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums sm:hidden ${
                produto.estoque_atual === 0
                  ? 'bg-[var(--color-alert-soft)] text-[var(--color-alert)]'
                  : produto.estoque_atual <= 5
                    ? 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]'
                    : 'bg-[var(--color-success-soft)] text-[var(--color-success)]'
              }`}
            >
              {produto.estoque_atual === 0 ? 'Sem estoque' : `${produto.estoque_atual} em estoque`}
            </span>
          )}
        </div>
        {(publication?.nome_publico || publication?.descricao_publica) && (
          <p className="mt-0.5 line-clamp-2 text-[11.5px] text-[var(--color-ink-muted)] sm:truncate">
            {publication.nome_publico || produto.nome}
            {publication.descricao_publica ? ` · ${publication.descricao_publica}` : ''}
          </p>
        )}
        {componentUsages && componentUsages.length > 0 && (
          <div className="mt-2">
            <p className="text-[11px] font-semibold text-[var(--color-ink-soft)]">Produto em:</p>
            <div className="mt-1 divide-y divide-[var(--color-line)]" role="list" aria-label="Produtos que usam este produto">
              {componentUsages.map((usage, index) => (
                <div
                  key={`${usage.containerName}-${usage.groupName}-${index}`}
                  className={`py-2 first:pt-0 last:pb-0 ${usage.active ? '' : 'text-[var(--color-warn)]'}`}
                  role="listitem"
                >
                  <p className="break-words text-[11px] font-medium leading-snug text-[var(--color-ink)]">
                    {usage.containerName}
                  </p>
                  <p className="mt-0.5 text-[10.5px] leading-snug text-current">
                    {usage.groupName} · {usage.active ? 'disponível' : 'indisponível'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <span className="hidden font-mono text-sm text-[var(--color-ink-soft)] sm:inline">R$ {produto.preco.toFixed(2)}</span>

      {produto.controlar_estoque && (
        <span
          className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums sm:inline-flex ${
            produto.estoque_atual === 0
              ? 'bg-[var(--color-alert-soft)] text-[var(--color-alert)]'
              : produto.estoque_atual <= 5
                ? 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]'
                : 'bg-[var(--color-success-soft)] text-[var(--color-success)]'
          }`}
        >
          {produto.estoque_atual === 0 ? 'Sem estoque' : `${produto.estoque_atual} em estoque`}
        </span>
      )}

      {!selectionMode && (
        <ActionsMenu
          label={produto.nome}
          actions={[
            ...(onTogglePublication
              ? [{
                  label: publication?.visivel_online
                    ? publication.pausado_manualmente ? 'Retomar no cardápio' : 'Pausar no cardápio'
                    : 'Publicar no cardápio',
                  icon: publication?.visivel_online
                    ? publication.pausado_manualmente ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />
                    : <Globe2 className="h-4 w-4" />,
                  onSelect: onTogglePublication,
                }]
              : []),
            { label: 'Editar produto', icon: <Pencil className="h-4 w-4" />, onSelect: onEdit },
            { label: 'Configurar publicação', icon: <Globe2 className="h-4 w-4" />, onSelect: onConfigurePublication },
            { label: 'Excluir produto', icon: <Trash2 className="h-4 w-4" />, onSelect: onDelete, destructive: true },
          ]}
        />
      )}
    </div>
  );
};

type MobileAction = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

function ActionsMenu({ label, actions }: { label: string; actions: MobileAction[] }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40"
        aria-label={`Ações para ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <MoreVertical className="h-5 w-5" />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        titleId={titleId}
        containerClassName="fixed inset-0 z-50 flex items-end justify-center"
        backdropClassName="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        panelLayoutClassName="w-full"
        panelClassName="rounded-t-2xl bg-[var(--color-surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(11,29,58,0.14)]"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--color-line-strong)]" aria-hidden="true" />
        <h2 id={titleId} className="mb-3 truncate px-1 text-sm font-semibold text-[var(--color-ink)]">
          Ações para {label}
        </h2>
        <div className="space-y-1">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
              className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                action.destructive
                  ? 'text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)]'
                  : 'text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)]'
              }`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/** @deprecated Price editing lives inside Editar produto. Kept exported for one compatibility release. */
export function ProductPriceEditModal({
  product,
  onClose,
  onSave,
}: {
  product: ProdutoRow | null;
  onClose: () => void;
  onSave: (price: number) => Promise<void>;
}) {
  const titleId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!product) return;
    setValue(formatPrecoInput(product.preco));
    setError(null);
    setSaving(false);
  }, [product]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const price = parsePrecoInput(value);
    if (!Number.isFinite(price) || price < 0) {
      setError('Informe um preço válido.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(price);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o preço.');
      setSaving(false);
    }
  };

  return (
    <Modal
      open={product !== null}
      onClose={() => { if (!saving) onClose(); }}
      titleId={titleId}
      containerClassName="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      backdropClassName="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
      panelLayoutClassName="w-full max-w-md"
      panelClassName="rounded-2xl bg-[var(--color-surface)] p-5 shadow-[0_4px_8px_rgba(11,29,58,0.14)] sm:p-6"
      disableEscape={saving}
    >
      <form onSubmit={handleSubmit}>
        <h2 id={titleId} className="text-lg font-bold text-[var(--color-ink)]">Editar produto</h2>
        <p className="mt-1 text-sm leading-5 text-[var(--color-ink-muted)]">
          {product ? `Atualize o preço de ${product.nome}.` : 'Atualize o preço do produto.'}
        </p>
        <label className="mt-5 block space-y-1.5">
          <span className="text-sm font-semibold text-[var(--color-ink)]">Preço (R$)</span>
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            aria-invalid={error !== null}
            className="min-h-12 w-full rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 text-base font-mono text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/30"
          />
        </label>
        {error && <p role="alert" className="mt-2 text-sm font-medium text-[var(--color-alert)]">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-11 rounded-xl px-4 text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-brand-deep)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar preço'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type ZeloMenuPublicationPanelProps = {
  totalProdutos: number;
  summary: ReturnType<typeof summarizeZeloMenuPublication>;
  issues: Array<{ produto: ProdutoWithPublication; details: ReturnType<typeof getZeloMenuPublicationStatus> }>;
  onEditProduto: (produto: ProdutoRow) => void;
  onConfigurePublication: (produto: ProdutoRow) => void;
  statusFilter: ZeloMenuPublicationStatus | null;
  onSetStatusFilter: (status: ZeloMenuPublicationStatus | null) => void;
};

const ZeloMenuPublicationPanel: React.FC<ZeloMenuPublicationPanelProps> = ({
  totalProdutos,
  summary,
  issues,
  onEditProduto,
  onConfigurePublication,
  statusFilter,
  onSetStatusFilter,
}) => {
  const readyPercent = totalProdutos > 0 ? Math.round((summary.published / totalProdutos) * 100) : 0;

  return (
    <section className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
            <Globe2 className="h-5 w-5" strokeWidth={1.9} />
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-[var(--color-ink)]">Visibilidade no cardápio</h3>
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-[var(--color-ink-muted)]">
              Produtos prontos para o link, itens inativos e ajustes que deixam o cardápio mais claro para o cliente.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:snap-none md:grid-cols-5 md:overflow-visible md:px-0 md:pb-0">
        <PublicationMetric label="Publicados" value={summary.published} detail={`${readyPercent}% do cardápio`} tone="published" active={statusFilter === 'published'} onClick={() => onSetStatusFilter(statusFilter === 'published' ? null : 'published')} />
        <PublicationMetric label="Somente complemento" value={summary.unpublished} detail="Não vendido separadamente" tone="unpublished" active={statusFilter === 'unpublished'} onClick={() => onSetStatusFilter(statusFilter === 'unpublished' ? null : 'unpublished')} />
        <PublicationMetric label="Pausados" value={summary.paused} detail="Ocultos por agora" tone="paused" active={statusFilter === 'paused'} onClick={() => onSetStatusFilter(statusFilter === 'paused' ? null : 'paused')} />
        <PublicationMetric label="Sem estoque" value={summary.outOfStock} detail="Bloqueados pelo estoque" tone="out_of_stock" active={statusFilter === 'out_of_stock'} onClick={() => onSetStatusFilter(statusFilter === 'out_of_stock' ? null : 'out_of_stock')} />
        <PublicationMetric label="Sem categoria" value={summary.missingCategory} detail="Precisam de organização" tone="missing_category" active={statusFilter === 'missing_category'} onClick={() => onSetStatusFilter(statusFilter === 'missing_category' ? null : 'missing_category')} />
      </div>

      {issues.length > 0 ? (
        <div className="mt-5 border-t border-[var(--color-line)] pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-[var(--color-ink)]">Ajustes pendentes</p>
              <p className="text-[12px] text-[var(--color-ink-muted)]">
                Itens que ainda reduzem a clareza do cardápio no link.
              </p>
            </div>
            {summary.attention > issues.length && (
              <span className="shrink-0 text-[12px] font-medium text-[var(--color-ink-faint)]">
                +{summary.attention - issues.length} restantes
              </span>
            )}
          </div>
          <div className="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">
            {issues.map(({ produto, details }) => (
              <button
                key={produto.id}
                type="button"
                onClick={() => {
                  if (details.status === 'unpublished') {
                    onConfigurePublication(produto);
                  } else {
                    onEditProduto(produto);
                  }
                }}
                className="flex min-h-[44px] w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-muted)]"
              >
                <PublicationStatusPill status={details.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[var(--color-ink)]">{produto.nome}</p>
                  <p className="text-[12px] text-[var(--color-ink-muted)]">{details.description}</p>
                </div>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-[var(--color-brand-soft)] bg-[var(--color-brand-soft)] px-3 py-2.5 text-[13px] text-[var(--color-brand-deep)]">
          <CircleCheck className="h-4 w-4 shrink-0" />
          Produtos ativos estão prontos para aparecer no link do cardápio.
        </div>
      )}

      {totalProdutos > 0 && summary.published === 0 && (
        <div className="mt-4 rounded-xl border border-[var(--color-warn-soft)] bg-[var(--color-warn-soft)]/30 px-4 py-3">
          <p className="mb-2 text-[13px] font-semibold text-[var(--color-ink)]">Nenhum produto vendido separadamente</p>
          <ul className="space-y-2 text-[12px] text-[var(--color-ink-soft)]">
            <li className="flex items-start gap-2">
              <Globe2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warn)]" />
              <span>
                Ative <strong className="text-[var(--color-ink)]">Vender separadamente no cardápio</strong> dentro de Editar produto para disponibilizar um item no link.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <FolderPlus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warn)]" />
              <span>
                Organize os produtos em categorias para o cardápio ficar mais claro.
              </span>
            </li>
          </ul>
        </div>
      )}
    </section>
  );
};

function PublicationMetric({
  label,
  value,
  detail,
  tone,
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  detail: string;
  tone: ZeloMenuPublicationStatus;
  active?: boolean;
  onClick?: () => void;
}) {
  const Component = onClick ? 'button' : 'div';
  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[44px] w-[44vw] min-w-[140px] shrink-0 snap-start rounded-xl border px-3 py-3 text-left sm:w-[38vw] md:w-auto md:min-w-0 md:shrink ${
        active
          ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]/30 ring-1 ring-[var(--color-brand)]/30'
          : 'border-[var(--color-line)] bg-[var(--color-surface-muted)] hover:border-[var(--color-line-strong)]'
      } ${onClick ? 'cursor-pointer transition-colors hover:bg-[var(--color-surface)]' : ''}`}
      aria-label={`Filtrar por ${label.toLowerCase()}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`text-[12px] font-semibold ${active ? 'text-[var(--color-brand-deep)]' : 'text-[var(--color-ink-soft)]'}`}>{label}</span>
        <PublicationStatusIcon status={tone} />
      </div>
      <p className="text-2xl font-bold tabular-nums text-[var(--color-ink)]">{value}</p>
      <p className="mt-0.5 text-[11.5px] text-[var(--color-ink-muted)]">{detail}</p>
    </Component>
  );
}

function PublicationStatusPill({ status }: { status: ZeloMenuPublicationStatus }) {
  const details = publicationTone(status);
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold ${details.className}`}>
      <PublicationStatusIcon status={status} />
      {details.label}
    </span>
  );
}

function PublicationStatusIcon({ status }: { status: ZeloMenuPublicationStatus }) {
  if (status === 'published') return <CircleCheck className="h-3.5 w-3.5" />;
  if (status === 'unpublished') return <Globe2 className="h-3.5 w-3.5" />;
  if (status === 'paused') return <PauseCircle className="h-3.5 w-3.5" />;
  if (status === 'hidden') return <EyeOff className="h-3.5 w-3.5" />;
  return <AlertCircle className="h-3.5 w-3.5" />;
}

function publicationTone(status: ZeloMenuPublicationStatus): { label: string; className: string } {
  if (status === 'published') {
    return { label: 'Publicado', className: 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]' };
  }
  if (status === 'unpublished') {
    return { label: 'Somente complemento', className: 'bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)]' };
  }
  if (status === 'paused') {
    return { label: 'Pausado', className: 'bg-blue-50 text-blue-700' };
  }
  if (status === 'hidden') {
    return { label: 'Ocultado automaticamente', className: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]' };
  }
  if (status === 'out_of_stock') {
    return { label: 'Sem estoque', className: 'bg-[var(--color-alert-soft)] text-[var(--color-alert)]' };
  }
  return { label: 'Sem categoria', className: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]' };
}

type SelectionState = 'none' | 'some' | 'all';

function SelectionCheckbox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={ariaLabel}
      className="h-4 w-4 rounded border-[var(--color-line-strong)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]/30"
    />
  );
}

function EmptyState({
  onCreateCategoria,
  onCreateProduto,
}: {
  onCreateCategoria: () => void;
  onCreateProduto: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-brand-soft)]">
        <ShoppingBag className="h-8 w-8 text-[var(--color-brand)]" />
      </div>
      <div>
        <h3 className="text-base font-bold text-[var(--color-ink)]">Comece cadastrando seu cardápio</h3>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Categorias, subcategorias e produtos. Tudo em um só lugar.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          onClick={onCreateCategoria}
          className="flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)]"
        >
          <FolderPlus className="h-4 w-4" /> Criar categoria
        </button>
        <button
          onClick={onCreateProduto}
          className="flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-brand-deep)]"
        >
          <Plus className="h-4 w-4" /> Criar produto
        </button>
      </div>
    </div>
  );
}

function getCategoryProductIds(node: TreeNode): number[] {
  return [
    ...node.produtosDireto.map((produto) => produto.id),
    ...node.subcategorias.flatMap((subNode) => subNode.produtos.map((produto) => produto.id)),
  ];
}

function getCategoryActions(
  productIds: number[],
  productPublications: Record<number, ZeloMenuProductPublicationRow>,
): Array<{ state: PublicationActionState; label: string; publishIds?: number[] }> {
  const unpublishedIds: number[] = [];

  for (const productId of productIds) {
    const publication = productPublications[productId];
    if (!publication?.visivel_online) {
      unpublishedIds.push(productId);
      continue;
    }
  }

  const actions: { state: PublicationActionState; label: string; publishIds?: number[] }[] = [];
  if (unpublishedIds.length > 0) actions.push({ state: 'publish', label: 'Publicar', publishIds: unpublishedIds });
  return actions;
}

function getCategorySummary(
  productIds: number[],
  productPublications: Record<number, ZeloMenuProductPublicationRow>,
  produtos: ProdutoRow[],
): string {
  let published = 0, paused = 0, blocked = 0, unpublished = 0;
  for (const id of productIds) {
    const product = produtos.find((p) => p.id === id);
    if (!product) continue;
    const pub = productPublications[id] ?? null;
    const status = getZeloMenuPublicationStatus({ ...product, publication: pub }).status;
    if (status === 'published') published++;
    else if (status === 'paused') paused++;
    else if (status === 'hidden') blocked++;
    else unpublished++;
  }
  const parts: string[] = [];
  if (published > 0) parts.push(`${published} publicado${published === 1 ? '' : 's'}`);
  if (paused > 0) parts.push(`${paused} pausado${paused === 1 ? '' : 's'}`);
  if (blocked > 0) parts.push(`${blocked} ocultado automaticamente`);
  if (unpublished > 0) parts.push(`${unpublished} somente complemento`);
  return parts.join(' · ');
}

function getSelectionState(productIds: number[], selectedIds: ReadonlySet<number>): SelectionState {
  if (productIds.length === 0) return 'none';
  let selectedCount = 0;
  for (const id of productIds) {
    if (selectedIds.has(id)) selectedCount += 1;
  }
  if (selectedCount === 0) return 'none';
  if (selectedCount === productIds.length) return 'all';
  return 'some';
}
