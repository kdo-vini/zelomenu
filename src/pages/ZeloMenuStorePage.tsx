import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Loader2, Minus, Plus, Search, ShoppingBag, X } from 'lucide-react';
import {
  getPublicStore,
  type TableOrderContext,
  type ZeloMenuCatalogGroup,
  type ZeloMenuCatalogProduct,
  type ZeloMenuPublicStoreResponse,
} from '../services/zelomenuApi';

import { type ZeloMenuStoreCartItem } from '../domain/zelomenuStoreCartCache';
import { useStoreCart } from '../hooks/useStoreCart';
import { PublicFooter } from '../components/zelomenu/PublicFooter';
import { ProductAddModal } from '../components/zelomenu/ZeloMenuProductAddModal';

type SelectedItem = ZeloMenuStoreCartItem;

interface ZeloMenuStorePageProps {
  slug?: string;
  mesaBanner?: string;
  mesaUnavailableMessage?: string;
  tableOrderContext?: TableOrderContext;
}

function toBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}


function allGroupProducts(group: ZeloMenuCatalogGroup): ZeloMenuCatalogProduct[] {
  return [...group.produtosDireto, ...group.subcategorias.flatMap((s) => s.produtos)];
}

function groupHasPhotos(group: ZeloMenuCatalogGroup): boolean {
  return allGroupProducts(group).some((p) => p.photoUrl);
}

function getFeaturedProducts(catalog: ZeloMenuCatalogGroup[], ids: number[]): ZeloMenuCatalogProduct[] {
  const all = catalog.flatMap((g) => [...g.produtosDireto, ...g.subcategorias.flatMap((s) => s.produtos)]);
  const byId = new Map(all.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is ZeloMenuCatalogProduct => p != null && p.available !== false);
}

function findCategoryName(catalog: ZeloMenuCatalogGroup[], productId: number): string {
  for (const group of catalog) {
    for (const p of group.produtosDireto) if (p.id === productId) return group.nome;
    for (const sub of group.subcategorias) for (const p of sub.produtos) if (p.id === productId) return group.nome;
  }
  return '';
}

function storeInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

function getProductQty(productId: number, items: Record<string, SelectedItem>): number {
  return Object.values(items)
    .filter((it) => it.productId === productId)
    .reduce((s, it) => s + it.quantity, 0);
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function ZeloMenuStorePage({
  slug: slugProp,
  mesaBanner,
  mesaUnavailableMessage,
  tableOrderContext,
}: ZeloMenuStorePageProps = {}) {
  const { slug: slugParam = '' } = useParams();
  const slug = slugProp ?? slugParam;

  const [store, setStore] = useState<ZeloMenuPublicStoreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('');

  const cart = useStoreCart(slug, tableOrderContext);

  const tabsRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // ── Load store ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getPublicStore(slug);
        if (!active) return;
        setStore(data);
        document.title = data.business.name ? `${data.business.name} | Cardápio` : 'Cardápio';
        if (data.catalog.length > 0) setActiveCategory(data.catalog[0].nome);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Não consegui carregar o cardápio.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      document.title = 'ZeloMenu';
    };
  }, [slug]);

  // ── Category tracking via IntersectionObserver ──────────────────────────────
  useEffect(() => {
    if (!store) return;
    const refs = sectionRefs.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const cat = (visible[0].target as HTMLElement).dataset.category ?? '';
          if (cat) setActiveCategory(cat);
        }
      },
      { threshold: 0.15, rootMargin: '-100px 0px -45% 0px' },
    );
    for (const el of Object.values(refs) as Array<HTMLElement | null>) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [store]);

  // ── Scroll active tab into view ─────────────────────────────────────────────
  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs || !activeCategory) return;
    for (const btn of tabs.querySelectorAll('[data-tab]')) {
      if ((btn as HTMLElement).dataset.tab === activeCategory) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        break;
      }
    }
  }, [activeCategory]);

  function scrollToCategory(name: string) {
    const el = sectionRefs.current[name];
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 148;
      window.scrollTo({ top, behavior: 'smooth' });
    }
    setActiveCategory(name);
  }

  const filteredCatalog = useMemo(() => {
    if (!store) return [];
    if (!searchQuery.trim()) return store.catalog;
    const q = searchQuery
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    const filterProds = (prods: ZeloMenuCatalogProduct[]) =>
      prods.filter((p) => {
        const n = p.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const d = (p.description ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return n.includes(q) || d.includes(q);
      });
    return store.catalog
      .map((group) => ({
        ...group,
        produtosDireto: filterProds(group.produtosDireto),
        subcategorias: group.subcategorias
          .map((sub) => ({ ...sub, produtos: filterProds(sub.produtos) }))
          .filter((sub) => sub.produtos.length > 0),
      }))
      .filter((g) => g.produtosDireto.length > 0 || g.subcategorias.length > 0);
  }, [store, searchQuery]);

  // ── Loading / error states ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--color-canvas)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-brand)]" strokeWidth={1.8} />
        <p className="text-[13px] text-[var(--color-ink-muted)]">Carregando cardápio…</p>
      </div>
    );
  }

  if (error && !store) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] px-6">
        <div className="max-w-sm rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-alert-soft)]">
            <AlertTriangle className="h-6 w-6 text-[var(--color-alert)]" strokeWidth={1.8} />
          </div>
          <h2 className="text-[16px] font-semibold text-[var(--color-ink)]">Cardápio indisponível</h2>
          <p className="mt-1 text-[14px] text-[var(--color-ink-muted)]">{error}</p>
        </div>
      </div>
    );
  }

  if (!store) return null;

  const visibleCategories = store.catalog.filter((g) => allGroupProducts(g).length > 0);
  const businessHours = store.business.businessHours;
  const outsideBusinessHours = businessHours?.configured === true && businessHours.openNow === false;

  return (
    <div className="min-h-screen bg-[var(--color-canvas)]" style={{ paddingBottom: 'max(7rem, calc(7rem + env(safe-area-inset-bottom)))' }}>

      {/* ── Mesa banner ────────────────────────────────────────────────────── */}
      {mesaBanner ? (
        <div className="sticky top-0 z-30 bg-gray-900 px-4 py-2 text-center text-sm font-semibold text-white">
          {mesaBanner} — Peça pelo app
        </div>
      ) : null}

      {/* ── Sticky header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto max-w-5xl">

          {/* Store identity row */}
          <div className="flex items-center gap-3 px-4 pt-4 pb-3">
            {store.business.logoUrl ? (
              <img
                src={store.business.logoUrl}
                alt={store.business.name || 'Logo'}
                className="h-12 w-12 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[16px] font-bold text-white"
                style={{ background: 'linear-gradient(135deg, #0b9778, #07745c)' }}
                aria-hidden="true"
              >
                {store.business.name ? storeInitials(store.business.name) : '🍴'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[17px] font-bold leading-tight text-[var(--color-ink)]">
                {store.business.name || 'Cardápio'}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {store.business.address ? (
                  <p className="truncate text-[11px] text-[var(--color-ink-muted)]">{store.business.address}</p>
                ) : null}
                {store.business.deliveryEnabled ? (
                  <span className="shrink-0 rounded-full bg-[var(--color-brand-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-brand-deep)]">
                    Entrega
                  </span>
                ) : null}
                {store.business.pixEnabled ? (
                  <span className="shrink-0 rounded-full bg-[var(--color-canvas)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                    Pix
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Search bar */}
          <div className="px-4 pb-2.5">
            <div className="flex h-10 items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 focus-within:border-[var(--color-brand)]" style={{ transition: 'border-color 0.15s' }}>
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)]" strokeWidth={2} />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar no cardápio…"
                className="flex-1 bg-transparent text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] outline-none"
              />
              {searchQuery ? (
                <button type="button" onClick={() => setSearchQuery('')} className="shrink-0 rounded p-0.5">
                  <X className="h-3.5 w-3.5 text-[var(--color-ink-muted)]" strokeWidth={2} />
                </button>
              ) : null}
            </div>
          </div>

          {/* Category pill tabs */}
          {!searchQuery && visibleCategories.length > 1 ? (
            <div
              ref={tabsRef}
              className="flex gap-1.5 overflow-x-auto px-4 pb-3"
              style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as CSSProperties}
            >
              {visibleCategories.map((group) => (
                <button
                  key={group.nome}
                  type="button"
                  data-tab={group.nome}
                  onClick={() => scrollToCategory(group.nome)}
                  className="shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12px] font-semibold"
                  style={{
                    background: activeCategory === group.nome ? 'var(--color-brand)' : 'var(--color-canvas)',
                    color: activeCategory === group.nome ? '#fff' : 'var(--color-ink-soft)',
                    transition: 'background 0.2s, color 0.2s',
                  }}
                >
                  {group.nome}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {/* ── Catalog body ──────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-5xl px-4 py-5">

        {/* Mesa unavailability notice */}
        {mesaUnavailableMessage ? (
          <div className="mb-5 rounded-xl bg-amber-50 p-4 text-center text-sm text-amber-800">
            {mesaUnavailableMessage}
          </div>
        ) : null}

        {outsideBusinessHours ? (
          <section className="mb-5 rounded-2xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warn)]" strokeWidth={2} />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[var(--color-ink)]">
                  Fora do horário de atendimento
                </p>
                <p className="mt-0.5 text-[12px] leading-5 text-[var(--color-ink-soft)]">
                  {businessHours?.nextOpen
                    ? `Próximo horário: ${businessHours.nextOpen.day} às ${businessHours.nextOpen.start}. Você pode montar o pedido e agendar.`
                    : `Você pode montar o pedido agora e agendar para um horário disponível${businessHours?.label ? ` (${businessHours.label}).` : '.'}`}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {/* Welcome text */}
        {!searchQuery && store.business.welcomeText ? (
          <p className="mb-5 text-[14px] leading-relaxed text-[var(--color-ink-soft)]">
            {store.business.welcomeText}
          </p>
        ) : null}

        {/* Featured section */}
        {!searchQuery && store.business.featuredEnabled && (store.business.featuredProductIds ?? []).length > 0 ? (() => {
          const featured = getFeaturedProducts(store.catalog, store.business.featuredProductIds ?? []);
          if (featured.length === 0) return null;
          return (
            <div className="mb-8">
              <h2 className="mb-3 text-[15px] font-bold text-[var(--color-ink)]">Destaques</h2>
              <div
                className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1"
                style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as CSSProperties}
              >
                {featured.map((p) => (
                  <div key={`featured-${p.id}`} className="shrink-0">
                    <FeaturedCard product={p} items={cart.items} onAdd={() => cart.onAddProduct(p)} onChangeQty={cart.changeQty} onSetQty={cart.setQty} />
                  </div>
                ))}
              </div>
            </div>
          );
        })() : null}

        {filteredCatalog.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <Search className="mb-3 h-10 w-10 text-[var(--color-line-strong)]" strokeWidth={1.5} />
            <p className="text-[15px] font-semibold text-[var(--color-ink-soft)]">Nenhum item encontrado</p>
            <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Tente um termo diferente</p>
          </div>
        ) : (
          <div className="space-y-8">
            {filteredCatalog.map((group) => {
              const hasPhotos = groupHasPhotos(group);
              if (allGroupProducts(group).length === 0) return null;
              return (
                <section
                  key={group.nome}
                  data-category={group.nome}
                  ref={(el) => { sectionRefs.current[group.nome] = el; }}
                >
                  <h2 className="mb-3 text-[15px] font-bold text-[var(--color-ink)]">{group.nome}</h2>

                  {group.produtosDireto.length > 0 ? (
                    <ProductGrid
                      products={group.produtosDireto}
                      hasPhotos={hasPhotos}
                      items={cart.items}
                      onAdd={cart.onAddProduct}
                      onChangeQty={cart.changeQty}
                      onSetQty={cart.setQty}
                    />
                  ) : null}

                  {group.subcategorias.map((sub) =>
                    sub.produtos.length > 0 ? (
                      <div key={sub.nome} className="mt-4">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                          {sub.nome}
                        </p>
                        <ProductGrid
                          products={sub.produtos}
                          hasPhotos={hasPhotos}
                          items={cart.items}
                          onAdd={cart.onAddProduct}
                          onChangeQty={cart.changeQty}
                          onSetQty={cart.setQty}
                        />
                      </div>
                    ) : null,
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>

      <PublicFooter />

      {/* ── Floating cart bar ────────────────────────────────────────────── */}
      {cart.lines.length > 0 ? (
        <div
          className="fixed inset-x-0 bottom-0 z-30 px-4"
          style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto max-w-md">
            <button
              type="button"
              onClick={() => void cart.continueToCart()}
              disabled={cart.submitting || !!mesaUnavailableMessage}
              className="flex w-full items-center justify-between rounded-2xl px-5 py-4 text-white shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'var(--color-brand)' }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-bold"
                  style={{ background: 'rgba(255,255,255,0.22)' }}
                >
                  {cart.totalQty}
                </span>
                <span className="flex items-center gap-2 text-[14px] font-semibold">
                  {cart.submitting ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} /> : null}
                  {cart.submitting ? 'Abrindo pedido…' : 'Continuar pedido'}
                </span>
              </div>
              <span className="text-[15px] font-bold">{toBRL(cart.subtotal)}</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Card de produto (foto, observação, quantidade e complementos) ── */}
      {cart.sheetProduct ? (() => {
        const product = cart.sheetProduct;
        const plainKey = `${product.id}::plain`;
        const existing = product.modifierGroups.length === 0 ? cart.items[plainKey] : undefined;
        const categoryName = findCategoryName(store.catalog, product.id);
        const cartProductIds = Object.values(cart.items).map((i) => i.productId).filter((id): id is number => id != null);
        return (
          <ProductAddModal
            product={product}
            initialQuantity={existing?.quantity ?? 0}
            initialNotes={existing?.notes ?? ''}
            onClose={() => cart.setSheetProduct(null)}
            onConfirm={(quantity, notes, selections) => cart.confirmSheet(product, quantity, notes, selections)}
            categoryName={categoryName}
            categorySuggestions={store.business.categorySuggestions}
            catalog={store.catalog}
            cartProductIds={cartProductIds}
            onQuickAdd={(p) => cart.quickAddProduct(p)}
          />
        );
      })() : null}
    </div>
  );
}

export default ZeloMenuStorePage;

// ─── ProductGrid ──────────────────────────────────────────────────────────────

function ProductGrid({
  products,
  hasPhotos,
  items,
  onAdd,
  onChangeQty,
  onSetQty,
}: {
  products: ZeloMenuCatalogProduct[];
  hasPhotos: boolean;
  items: Record<string, SelectedItem>;
  onAdd: (p: ZeloMenuCatalogProduct) => void;
  onChangeQty: (key: string, delta: number) => void;
  onSetQty: (key: string, qty: number) => void;
}) {
  if (hasPhotos) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {products.map((p) => (
          <PhotoRow key={p.id} product={p} items={items} onAdd={() => onAdd(p)} onChangeQty={onChangeQty} onSetQty={onSetQty} />
        ))}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      {products.map((p, i) => (
        <div key={p.id}>
          <ListRow
            product={p}
            items={items}
            onAdd={() => onAdd(p)}
            onChangeQty={onChangeQty}
            onSetQty={onSetQty}
            divider={i < products.length - 1}
          />
        </div>
      ))}
    </div>
  );
}

// ─── QtyControl ───────────────────────────────────────────────────────────────
// Shared add/stepper control used by every card variant below.

function QtyControl({
  product,
  qty,
  hasModifiers,
  isUnit,
  onAdd,
  onChangeQty,
  onSetQty,
  size = 'md',
}: {
  product: ZeloMenuCatalogProduct;
  qty: number;
  hasModifiers: boolean;
  isUnit: boolean;
  onAdd: () => void;
  onChangeQty: (key: string, delta: number) => void;
  onSetQty: (key: string, qty: number) => void;
  size?: 'sm' | 'md';
}) {
  const plainKey = `${product.id}::plain`;
  const stepBtn = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  const stepIcon = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const addBtn = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  const addIcon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  if (qty > 0 && !hasModifiers) {
    if (isUnit) {
      return (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSetQty(plainKey, 0)}
            className={`flex ${stepBtn} items-center justify-center rounded-full border border-[var(--color-line)]`}
            aria-label="Remover"
          >
            <X className={stepIcon} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={onAdd}
            className={`flex ${stepBtn} min-w-fit items-center justify-center rounded-full px-2.5 text-[13px] font-bold text-white`}
            style={{ background: 'var(--color-brand)' }}
            aria-label={`Editar quantidade de ${product.name}`}
          >
            {qty}
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChangeQty(plainKey, -1)}
          className={`flex ${stepBtn} items-center justify-center rounded-full border border-[var(--color-line)]`}
          aria-label="Diminuir"
        >
          <Minus className={stepIcon} strokeWidth={2.5} />
        </button>
        <span className="w-5 text-center text-[13px] font-bold tabular-nums">{qty}</span>
        <button
          type="button"
          onClick={() => onChangeQty(plainKey, 1)}
          className={`flex ${stepBtn} items-center justify-center rounded-full text-white`}
          style={{ background: 'var(--color-brand)' }}
          aria-label="Aumentar"
        >
          <Plus className={stepIcon} strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onAdd}
      className={`flex ${addBtn} items-center justify-center rounded-full text-white`}
      style={{ background: 'var(--color-brand)', transition: 'transform 0.1s', WebkitTapHighlightColor: 'transparent' } as CSSProperties}
      onMouseDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.92)'; }}
      onMouseUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
      aria-label={`Adicionar ${product.name}`}
    >
      <Plus className={addIcon} strokeWidth={2.5} />
    </button>
  );
}

// ─── PhotoRow ─────────────────────────────────────────────────────────────────
// Horizontal card: name/description/price on the left, a fixed-size thumbnail
// on the right so photos stay a supporting detail instead of the dominant
// element (previously a full-bleed square that scaled with the grid column).

function PhotoRow({
  product,
  items,
  onAdd,
  onChangeQty,
  onSetQty,
}: {
  product: ZeloMenuCatalogProduct;
  items: Record<string, SelectedItem>;
  onAdd: () => void;
  onChangeQty: (key: string, delta: number) => void;
  onSetQty: (key: string, qty: number) => void;
}) {
  const qty = getProductQty(product.id, items);
  const hasModifiers = product.modifierGroups.length > 0;
  const isUnit = product.unitBased === true;

  return (
    <div className="flex gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-[var(--color-ink)]">
          {product.name}
        </p>
        {product.description ? (
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-[var(--color-ink-muted)]">
            {product.description}
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <p className="text-[13px] font-bold" style={{ color: 'var(--color-brand-deep)' }}>
            {toBRL(product.basePrice)}
          </p>
          <QtyControl
            product={product}
            qty={qty}
            hasModifiers={hasModifiers}
            isUnit={isUnit}
            onAdd={onAdd}
            onChangeQty={onChangeQty}
            onSetQty={onSetQty}
            size="sm"
          />
        </div>
      </div>

      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-[var(--color-canvas)]">
        {product.photoUrl ? (
          <img
            src={product.photoUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ShoppingBag className="h-6 w-6 text-[var(--color-line-strong)]" strokeWidth={1.5} />
          </div>
        )}
        {qty > 0 ? (
          <span
            className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ background: 'var(--color-brand)' }}
          >
            {qty}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ─── FeaturedCard ─────────────────────────────────────────────────────────────
// Compact vertical card for the "Destaques" horizontal-scroll rail — fixed
// width so the photo never grows past a small, appetizing preview.

function FeaturedCard({
  product,
  items,
  onAdd,
  onChangeQty,
  onSetQty,
}: {
  product: ZeloMenuCatalogProduct;
  items: Record<string, SelectedItem>;
  onAdd: () => void;
  onChangeQty: (key: string, delta: number) => void;
  onSetQty: (key: string, qty: number) => void;
}) {
  const qty = getProductQty(product.id, items);
  const hasModifiers = product.modifierGroups.length > 0;
  const isUnit = product.unitBased === true;

  return (
    <div className="flex h-full w-[148px] flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="relative h-[110px] w-full overflow-hidden bg-[var(--color-canvas)]">
        {product.photoUrl ? (
          <img
            src={product.photoUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ShoppingBag className="h-7 w-7 text-[var(--color-line-strong)]" strokeWidth={1.5} />
          </div>
        )}
        {qty > 0 ? (
          <span
            className="absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ background: 'var(--color-brand)' }}
          >
            {qty}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <p className="line-clamp-2 text-[12.5px] font-semibold leading-snug text-[var(--color-ink)]">
          {product.name}
        </p>
        <div className="mt-auto flex items-center justify-between gap-1 pt-1.5">
          <p className="text-[12.5px] font-bold" style={{ color: 'var(--color-brand-deep)' }}>
            {toBRL(product.basePrice)}
          </p>
          <QtyControl
            product={product}
            qty={qty}
            hasModifiers={hasModifiers}
            isUnit={isUnit}
            onAdd={onAdd}
            onChangeQty={onChangeQty}
            onSetQty={onSetQty}
            size="sm"
          />
        </div>
      </div>
    </div>
  );
}

// ─── ListRow ──────────────────────────────────────────────────────────────────

function ListRow({
  product,
  items,
  onAdd,
  onChangeQty,
  onSetQty,
  divider,
}: {
  product: ZeloMenuCatalogProduct;
  items: Record<string, SelectedItem>;
  onAdd: () => void;
  onChangeQty: (key: string, delta: number) => void;
  onSetQty: (key: string, qty: number) => void;
  divider: boolean;
}) {
  const qty = getProductQty(product.id, items);
  const hasModifiers = product.modifierGroups.length > 0;
  const isUnit = product.unitBased === true;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 ${divider ? 'border-b border-[var(--color-line)]' : ''}`}
    >
      {product.photoUrl ? (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--color-canvas)] p-1.5">
          <img
            src={product.photoUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-contain"
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-[var(--color-ink)]">{product.name}</p>
        {product.description ? (
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--color-ink-muted)]">
            {product.description}
          </p>
        ) : null}
        <p className="mt-1 text-[13px] font-bold" style={{ color: 'var(--color-brand-deep)' }}>
          {toBRL(product.basePrice)}
        </p>
      </div>
      <div className="shrink-0">
        <QtyControl
          product={product}
          qty={qty}
          hasModifiers={hasModifiers}
          isUnit={isUnit}
          onAdd={onAdd}
          onChangeQty={onChangeQty}
          onSetQty={onSetQty}
          size="md"
        />
      </div>
    </div>
  );
}


