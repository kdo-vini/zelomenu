import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Loader2, Minus, Plus, RefreshCw, Search, ShoppingBag, X } from 'lucide-react';
import {
  getPublicStore,
  isPublicStoreNotFoundError,
  type TableOrderContext,
  type ZeloMenuCatalogGroup,
  type ZeloMenuCatalogProduct,
  type ZeloMenuPublicStoreResponse,
} from '../services/zelomenuApi';

import { type ZeloMenuStoreCartItem } from '../domain/zelomenuStoreCartCache';
import { buildStorefrontOperations, type StorefrontOperationKey } from '../domain/storefrontOperations';
import { useStoreCart } from '../hooks/useStoreCart';
import { ToastProvider } from '../contexts/ToastContext';
import { PublicFooter } from '../components/zelomenu/PublicFooter';
import { ProductAddModal } from '../components/zelomenu/ZeloMenuProductAddModal';
import { StorefrontHeader } from '../components/zelomenu/StorefrontHeader';
import { CatalogSkeleton } from '../components/zelomenu/StorefrontSkeletons';
import { StorefrontOperationSheet } from '../components/zelomenu/StorefrontOperationSheet';
import { ZeloMenuNotFoundPage } from './ZeloMenuNotFoundPage';
import { filterPublicCatalogByQuery } from '../domain/zelomenuCatalog';

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

function getProductPriceLabel(product: ZeloMenuCatalogProduct): string {
  if (product.productType === 'pizza') return `A partir de ${toBRL(product.price)}`;
  if (product.basePrice > 0) return toBRL(product.basePrice);

  const substituteGroup = product.modifierGroups
    .filter((group) => group.active && group.pricingMode === 'substituir')
    .sort((a, b) => a.order - b.order)[0];
  const optionPrices = substituteGroup?.options
    .filter((option) => option.active && option.linkedProduct?.available !== false)
    .map((option) => option.linkedProduct?.price ?? option.priceDelta)
    .filter((price) => Number.isFinite(price) && price >= 0) ?? [];

  if (optionPrices.length === 0) return toBRL(product.basePrice);
  return `A partir de ${toBRL(Math.min(...optionPrices))}`;
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

function getProductQty(productId: number, items: Record<string, SelectedItem>): number {
  return Object.values(items)
    .filter((it) => it.productId === productId)
    .reduce((s, it) => s + it.quantity, 0);
}

function getProductLineCount(productId: number, items: Record<string, SelectedItem>): number {
  return Object.values(items).filter((it) => it.productId === productId).length;
}

// ─── Page ────────────────────────────────────────────────────────────────────

function ZeloMenuStorePageContent({
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
  const [notFound, setNotFound] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [openOperation, setOpenOperation] = useState<StorefrontOperationKey | null>(null);

  const cart = useStoreCart(slug, tableOrderContext, store?.business.deliveryEnabled === true);

  const tabsRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const handledHighlightRef = useRef<string | null>(null);
  const featuredRailRef = useRef<HTMLDivElement>(null);
  const featuredInteractionPausedRef = useRef(false);
  const featuredResumeTimerRef = useRef<number | null>(null);
  const featuredDraggingRef = useRef(false);
  const featuredDragStartXRef = useRef(0);
  const featuredDragStartScrollLeftRef = useRef(0);
  const featuredDragMovedRef = useRef(false);
  const featuredDragFrameRef = useRef<number | null>(null);
  const featuredDragDeltaRef = useRef(0);
  const featuredSuppressClickRef = useRef(false);
  const featuredActiveIndexRef = useRef(0);
  const [featuredActiveIndex, setFeaturedActiveIndex] = useState(0);

  // ── Load store ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        setNotFound(false);
        setStore(null);
        setActiveCategory('');
        const data = await getPublicStore(slug);
        if (!active) return;
        setStore(data);
        document.title = data.business.name ? `${data.business.name} | Cardápio` : 'Cardápio';
        if (data.catalog.length > 0) setActiveCategory(data.catalog[0].nome);
      } catch (err) {
        if (!active) return;
        if (isPublicStoreNotFoundError(err)) {
          setNotFound(true);
          document.title = 'Cardápio não encontrado | ZeloMenu';
        } else {
          setError(err instanceof Error ? err.message : 'Não consegui carregar o cardápio.');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      document.title = 'ZeloMenu';
    };
  }, [slug, loadAttempt]);

  // Highlights on the public home carry the product id in the URL. Once the
  // store is ready, reuse the same cart cache and add the product immediately.
  // Products with required customizations open the existing product sheet so
  // the order cannot be created with an invalid modifier selection.
  useEffect(() => {
    if (!store) return;
    const productId = Number(new URLSearchParams(window.location.search).get('destaque'));
    if (!Number.isSafeInteger(productId) || productId <= 0) return;
    const intentKey = `${slug}:${productId}`;
    if (handledHighlightRef.current === intentKey) return;

    const product = getFeaturedProducts(store.catalog, [productId])[0];
    if (!product) return;

    handledHighlightRef.current = intentKey;
    const cleanUrl = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', cleanUrl);
    const hasRequiredModifiers = product.modifierGroups.some((group) =>
      group.active && (group.minSelections > 0 || (group.allowsQuantity && group.minTotalQuantity > 0)),
    );
    if (hasRequiredModifiers) {
      cart.onAddProduct(product);
    } else {
      cart.quickAddProduct(product);
    }
  }, [store, slug]);

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
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    for (const btn of tabs.querySelectorAll('[data-tab]')) {
      if ((btn as HTMLElement).dataset.tab === activeCategory) {
        btn.scrollIntoView({ behavior, block: 'nearest', inline: 'center' });
        break;
      }
    }
  }, [activeCategory]);

  function scrollToCategory(name: string) {
    const el = sectionRefs.current[name];
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 148;
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      window.scrollTo({ top, behavior });
    }
    setActiveCategory(name);
  }

  const filteredCatalog = useMemo(() => {
    if (!store) return [];
    return filterPublicCatalogByQuery(store.catalog, searchQuery);
  }, [store, searchQuery]);

  const featuredProducts = useMemo(() => {
    if (!store || searchQuery || !store.business.featuredEnabled) return [];
    return getFeaturedProducts(store.catalog, store.business.featuredProductIds ?? []);
  }, [store, searchQuery]);

  function clearFeaturedResumeTimer() {
    if (featuredResumeTimerRef.current != null) {
      window.clearTimeout(featuredResumeTimerRef.current);
      featuredResumeTimerRef.current = null;
    }
  }

  function pauseFeaturedInteraction() {
    clearFeaturedResumeTimer();
    featuredInteractionPausedRef.current = true;
  }

  function resumeFeaturedInteractionSoon() {
    clearFeaturedResumeTimer();
    featuredResumeTimerRef.current = window.setTimeout(() => {
      featuredInteractionPausedRef.current = false;
      featuredResumeTimerRef.current = null;
    }, 1400);
  }

  function getFeaturedScrollTarget(index: number, rail = featuredRailRef.current): number | null {
    const slide = rail?.children[index] as HTMLElement | undefined;
    if (!rail || !slide) return null;
    const maxScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
    const centeredLeft = slide.offsetLeft - Math.max(0, (rail.clientWidth - slide.offsetWidth) / 2);
    return Math.min(maxScrollLeft, Math.max(0, centeredLeft));
  }

  function snapFeaturedToNearest() {
    const rail = featuredRailRef.current;
    if (!rail || rail.children.length === 0) return;

    const viewportCenter = rail.scrollLeft + rail.clientWidth / 2;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    Array.from(rail.children).forEach((child, index) => {
      const slide = child as HTMLElement;
      const slideCenter = slide.offsetLeft + slide.offsetWidth / 2;
      const distance = Math.abs(slideCenter - viewportCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    const target = getFeaturedScrollTarget(nearestIndex, rail);
    if (target == null) return;
    featuredActiveIndexRef.current = nearestIndex;
    setFeaturedActiveIndex(nearestIndex);
    rail.scrollTo({
      left: target,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }

  function updateFeaturedActiveIndexFromScroll() {
    const rail = featuredRailRef.current;
    if (!rail || rail.children.length === 0) return;

    const viewportCenter = rail.scrollLeft + rail.clientWidth / 2;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    Array.from(rail.children).forEach((child, index) => {
      const slide = child as HTMLElement;
      const slideCenter = slide.offsetLeft + slide.offsetWidth / 2;
      const distance = Math.abs(slideCenter - viewportCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    if (featuredActiveIndexRef.current === nearestIndex) return;
    featuredActiveIndexRef.current = nearestIndex;
    setFeaturedActiveIndex(nearestIndex);
  }

  function handleFeaturedPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input, textarea, select')) return;
    pauseFeaturedInteraction();
    if (event.pointerType !== 'mouse') return;
    const rail = featuredRailRef.current;
    if (!rail) return;
    featuredDraggingRef.current = true;
    featuredDragMovedRef.current = false;
    featuredDragStartXRef.current = event.clientX;
    featuredDragStartScrollLeftRef.current = rail.scrollLeft;
    rail.style.scrollSnapType = 'none';
    rail.setPointerCapture(event.pointerId);
  }

  function handleFeaturedPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!featuredDraggingRef.current) return;
    const rail = featuredRailRef.current;
    if (!rail) return;
    const delta = event.clientX - featuredDragStartXRef.current;
    if (Math.abs(delta) > 8) featuredDragMovedRef.current = true;
    if (!featuredDragMovedRef.current) return;
    event.preventDefault();
    featuredDragDeltaRef.current = delta;
    if (featuredDragFrameRef.current != null) return;
    featuredDragFrameRef.current = window.requestAnimationFrame(() => {
      rail.scrollLeft = featuredDragStartScrollLeftRef.current - featuredDragDeltaRef.current;
      featuredDragFrameRef.current = null;
    });
  }

  function handleFeaturedPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (!featuredDraggingRef.current) {
      updateFeaturedActiveIndexFromScroll();
      resumeFeaturedInteractionSoon();
      return;
    }
    featuredDraggingRef.current = false;
    const rail = featuredRailRef.current;
    if (featuredDragFrameRef.current != null) {
      window.cancelAnimationFrame(featuredDragFrameRef.current);
      featuredDragFrameRef.current = null;
      if (rail) rail.scrollLeft = featuredDragStartScrollLeftRef.current - featuredDragDeltaRef.current;
    }
    if (rail?.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
    if (featuredDragMovedRef.current) featuredSuppressClickRef.current = true;
    if (rail) rail.style.scrollSnapType = '';
    window.requestAnimationFrame(() => snapFeaturedToNearest());
    resumeFeaturedInteractionSoon();
  }

  useEffect(() => {
    featuredActiveIndexRef.current = 0;
    setFeaturedActiveIndex(0);
    clearFeaturedResumeTimer();
    featuredInteractionPausedRef.current = false;
    featuredRailRef.current?.scrollTo({ left: 0, behavior: 'auto' });
  }, [featuredProducts.length]);

  useEffect(() => () => clearFeaturedResumeTimer(), []);

  useEffect(() => {
    const rail = featuredRailRef.current;
    if (!rail || featuredProducts.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const intervalId = window.setInterval(() => {
      const currentRail = featuredRailRef.current;
      if (!currentRail || document.hidden || featuredInteractionPausedRef.current) return;

      setFeaturedActiveIndex((current) => {
        const next = (current + 1) % featuredProducts.length;
        const target = getFeaturedScrollTarget(next, currentRail);
        if (target == null) return next;
        featuredActiveIndexRef.current = next;
        currentRail.scrollTo({
          left: target,
          behavior: 'smooth',
        });
        return next;
      });
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [featuredProducts.length]);

  // ── Loading / error states ──────────────────────────────────────────────────
  if (loading) {
    return <CatalogSkeleton />;
  }

  if (notFound) {
    return <ZeloMenuNotFoundPage />;
  }

  if (error && !store) {
    return (
      <div className="zelomenu-theme flex min-h-screen items-center justify-center bg-[var(--zm-canvas)] px-6">
        <div className="max-w-sm rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-surface)] p-6 text-center" role="alert">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-alert-soft)]">
            <AlertTriangle className="h-6 w-6 text-[var(--color-alert)]" strokeWidth={1.8} />
          </div>
          <h2 className="text-[16px] font-semibold text-[var(--zm-ink)]">Cardápio indisponível</h2>
          <p className="mt-1 text-[14px] text-[var(--zm-ink-soft)]">{error}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--zm-brand)] px-4 py-2.5 text-[13px] font-semibold text-white"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Tentar novamente
            </button>
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-xl border border-[var(--zm-line)] px-4 py-2.5 text-[13px] font-semibold text-[var(--zm-ink)]"
            >
              Ir para o início
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!store) return null;

  const visibleCategories = store.catalog.filter((g) => allGroupProducts(g).length > 0);
  return (
    <div className="zelomenu-theme flex min-h-screen flex-col bg-[var(--zm-canvas)]">

      {/* ── Mesa banner ────────────────────────────────────────────────────── */}
      {mesaBanner ? (
        <div className="sticky top-0 z-30 bg-gray-900 px-4 py-2 text-center text-sm font-semibold text-white">
          {mesaBanner} — Peça pelo app
        </div>
      ) : null}

      <StorefrontHeader
        business={store.business}
        operations={buildStorefrontOperations(store.business)}
        visibleCategories={visibleCategories}
        activeCategory={activeCategory}
        searchQuery={searchQuery}
        tabsRef={tabsRef}
        hasMesaBanner={Boolean(mesaBanner)}
        onSearchChange={setSearchQuery}
        onCategoryClick={scrollToCategory}
        onOpenOperation={setOpenOperation}
      />

      {/* ── Catalog body ──────────────────────────────────────────────────── */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-28 pt-4">

        {/* Mesa unavailability notice */}
        {mesaUnavailableMessage ? (
          <div className="mb-5 rounded-xl bg-amber-50 p-4 text-center text-sm text-amber-800">
            {mesaUnavailableMessage}
          </div>
        ) : null}

        {/* Featured section */}
        {featuredProducts.length > 0 ? (
            <div className="mb-6">
              <div className="mb-2 flex items-center justify-between gap-4">
                <h2 className="text-[22px] font-bold tracking-[-0.02em] text-[var(--zm-ink)]">Destaques</h2>
                <div className="flex items-center gap-1">
                  {visibleCategories[0] ? (
                    <button
                      type="button"
                      onClick={() => scrollToCategory(visibleCategories[0].nome)}
                      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg text-[14px] font-semibold text-[var(--zm-brand)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--zm-brand)]"
                    >
                      Ver todos
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
              <div
                ref={featuredRailRef}
                role="region"
                aria-roledescription="carrossel"
                aria-label="Destaques"
                className="-mx-4 flex snap-x snap-proximity select-none gap-3 overflow-x-auto overscroll-x-contain px-4 cursor-grab active:cursor-grabbing"
                onPointerDown={handleFeaturedPointerDown}
                onPointerMove={handleFeaturedPointerMove}
                onPointerUp={handleFeaturedPointerEnd}
                onPointerCancel={handleFeaturedPointerEnd}
                onScroll={() => {
                  pauseFeaturedInteraction();
                  updateFeaturedActiveIndexFromScroll();
                  resumeFeaturedInteractionSoon();
                }}
                onFocusCapture={pauseFeaturedInteraction}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    resumeFeaturedInteractionSoon();
                  }
                }}
                onClickCapture={(event) => {
                  if (!featuredSuppressClickRef.current) return;
                  event.preventDefault();
                  event.stopPropagation();
                  featuredSuppressClickRef.current = false;
                }}
                style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as CSSProperties}
              >
                {featuredProducts.map((p, index) => (
                  <div
                    key={`featured-${p.id}`}
                    className="shrink-0 snap-center"
                    role="group"
                    aria-roledescription="slide"
                    aria-label={`${index + 1} de ${featuredProducts.length}`}
                    aria-current={index === featuredActiveIndex ? 'true' : undefined}
                  >
                    <FeaturedCard product={p} items={cart.items} onAdd={() => cart.onAddProduct(p)} onChangeQty={cart.changeQty} onSetQty={cart.setQty} />
                  </div>
                ))}
              </div>
            </div>
        ) : null}

        {filteredCatalog.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <Search className="mb-3 h-10 w-10 text-[var(--zm-line-strong)]" strokeWidth={1.5} />
            <p className="text-[15px] font-semibold text-[var(--zm-ink-soft)]">Nenhum item encontrado</p>
            <p className="mt-1 text-[13px] text-[var(--zm-ink-soft)]">Tente um termo diferente</p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredCatalog.map((group) => {
              const hasPhotos = groupHasPhotos(group);
              if (allGroupProducts(group).length === 0) return null;
              return (
                <section
                  key={group.nome}
                  data-category={group.nome}
                  ref={(el) => { sectionRefs.current[group.nome] = el; }}
                >
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <h2 className="text-[22px] font-bold tracking-[-0.02em] text-[var(--zm-ink)]">{group.nome}</h2>
                    <button
                      type="button"
                      onClick={() => scrollToCategory(group.nome)}
                      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg text-[14px] font-semibold text-[var(--zm-brand)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--zm-brand)]"
                    >
                      Ver todos
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

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
                      <div key={sub.nome} className="mt-3">
                        <p className="mb-1.5 text-[12px] font-semibold text-[var(--zm-ink-soft)]">
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

      <StorefrontOperationSheet
        operation={openOperation}
        business={store.business}
        onClose={() => setOpenOperation(null)}
      />

      {/* ── Floating cart bar ────────────────────────────────────────────── */}
      {cart.lines.length > 0 ? (
        <div
          className="fixed inset-x-0 bottom-0 z-30 px-3"
          style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto max-w-lg">
            {cart.submitError ? (
              <div className="mb-2 rounded-xl border border-[var(--color-alert)] bg-[var(--color-alert-soft)] px-3 py-2 text-[12px] font-medium text-[var(--color-alert)]" role="alert">
                {cart.submitError}
              </div>
            ) : null}
            <div className="flex items-center gap-3 rounded-[22px] border border-[var(--zm-line)] bg-[var(--zm-surface)] p-3 shadow-[0_-4px_12px_rgba(11,29,58,0.08)]">
              <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--zm-canvas)] text-[var(--zm-ink)]">
                <ShoppingBag className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
                <span
                  className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white"
                  style={{ background: 'var(--zm-brand)' }}
                >
                  {cart.totalQty}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[18px] font-bold leading-tight text-[var(--zm-ink)]">{toBRL(cart.subtotal)}</p>
                <p className="mt-0.5 truncate text-[13px] text-[var(--zm-ink-soft)]">
                  {cart.totalQty} {cart.totalQty === 1 ? 'item' : 'itens'} no pedido
                </p>
              </div>
              <button
                type="button"
                onClick={() => void cart.continueToCart()}
                disabled={cart.submitting || !!mesaUnavailableMessage}
                className="flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[var(--zm-brand)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--zm-brand-deep)] disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
              >
                {cart.submitting ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} /> : null}
                {cart.submitting ? 'Abrindo pedido…' : 'Continuar pedido'}
                {!cart.submitting ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : null}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Card de produto (foto, observação, quantidade e complementos) ── */}
      {cart.sheetProduct ? (() => {
        const product = cart.sheetProduct;
        const hasActiveModifiers = product.productType === 'pizza' || product.modifierGroups.some((group) => group.active);
        const existing = hasActiveModifiers
          ? undefined
          : Object.values(cart.items).find((item) => item.productId === product.id && item.selectedOptions.length === 0);
        const categoryName = findCategoryName(store.catalog, product.id);
        const cartProductIds = Object.values(cart.items).map((i) => i.productId).filter((id): id is number => id != null);
        const existingLineCount = getProductLineCount(product.id, cart.items);
        return (
          <ProductAddModal
            product={product}
            initialQuantity={existing?.quantity ?? 0}
            initialNotes={existing?.notes ?? ''}
            onClose={() => cart.setSheetProduct(null)}
            onConfirm={(quantity, notes, selections, pizzaSelection) => cart.confirmSheet(product, quantity, notes, selections, pizzaSelection)}
            categoryName={categoryName}
            categorySuggestions={store.business.categorySuggestions}
            catalog={store.catalog}
            cartProductIds={cartProductIds}
            existingLineCount={existingLineCount}
            onQuickAdd={(p) => cart.quickAddProduct(p)}
          />
        );
      })() : null}
    </div>
  );
}

export function ZeloMenuStorePage(props: ZeloMenuStorePageProps = {}) {
  return (
    <ToastProvider>
      <ZeloMenuStorePageContent {...props} />
    </ToastProvider>
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
      <div className={`grid grid-cols-1 gap-3 ${products.some(p=>p.productType==='pizza')?'':'md:grid-cols-2'}`}>
        {products.map((p) => (
          <PhotoRow key={p.id} product={p} items={items} onAdd={() => onAdd(p)} onChangeQty={onChangeQty} onSetQty={onSetQty} />
        ))}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-surface)]">
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
  const stepBtn = size === 'sm' ? 'h-7 w-7 min-h-11 min-w-11' : 'h-8 w-8 min-h-11 min-w-11';
  const stepIcon = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const addBtn = size === 'sm' ? 'h-8 w-8 min-h-11 min-w-11' : 'h-9 w-9 min-h-11 min-w-11';
  const addIcon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  if (qty > 0 && !hasModifiers) {
    if (isUnit) {
      return (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSetQty(plainKey, 0); }}
            className={`flex ${stepBtn} items-center justify-center rounded-full border border-[var(--zm-line)]`}
            aria-label="Remover"
          >
            <X className={stepIcon} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdd(); }}
            className={`flex ${stepBtn} min-w-fit items-center justify-center rounded-full px-2.5 text-[13px] font-bold text-[var(--zm-brand)]`}
            style={{ background: 'var(--zm-brand-soft)' }}
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
          onClick={(e) => { e.stopPropagation(); onChangeQty(plainKey, -1); }}
          className={`flex ${stepBtn} items-center justify-center rounded-full border border-[var(--zm-line)]`}
          aria-label="Diminuir"
        >
          <Minus className={stepIcon} strokeWidth={2.5} />
        </button>
        <span className="w-5 text-center text-[13px] font-bold tabular-nums">{qty}</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChangeQty(plainKey, 1); }}
          className={`flex ${stepBtn} items-center justify-center rounded-full text-[var(--zm-brand)]`}
          style={{ background: 'var(--zm-brand-soft)' }}
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
      onClick={(e) => { e.stopPropagation(); onAdd(); }}
      className={`flex ${hasModifiers && qty > 0 && size === 'md' ? 'h-8 min-h-11 min-w-11 gap-1 rounded-full px-2.5' : addBtn} items-center justify-center rounded-full text-[var(--zm-brand)]`}
      style={{ background: 'var(--zm-brand-soft)', transition: 'transform 0.1s', WebkitTapHighlightColor: 'transparent' } as CSSProperties}
      onMouseDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.92)'; }}
      onMouseUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
      aria-label={hasModifiers && qty > 0 ? `Adicionar outra montagem de ${product.name}` : `Adicionar ${product.name}`}
    >
      <Plus className={addIcon} strokeWidth={2.5} />
      {hasModifiers && qty > 0 && size === 'md' ? <span className="text-[11px] font-semibold">Outra</span> : null}
    </button>
  );
}

// ─── PhotoRow ─────────────────────────────────────────────────────────────────
// Horizontal card: a fixed-size thumbnail on the left, with name,
// description, price and the add control kept in a compact reading order.

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
  const hasModifiers = product.productType === 'pizza' || product.modifierGroups.some((group) => group.active);
  const isUnit = product.unitBased === true;

  return (
    <div
      className="flex min-h-[112px] cursor-pointer gap-3 rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-surface)] p-3 transition-transform active:scale-[0.99]"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input, textarea, select')) return;
        onAdd();
      }}
      role="group"
      aria-label={`Abrir ${product.name}`}
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-[var(--zm-canvas)] sm:h-24 sm:w-24">
        {product.photoUrl ? (
          <img
            src={product.photoUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ShoppingBag className="h-6 w-6 text-[var(--zm-line-strong)]" strokeWidth={1.5} />
          </div>
        )}
        {qty > 0 ? (
          <span
            className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ background: 'var(--zm-brand)' }}
          >
            {qty}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--zm-ink)]">
          {product.name}
        </p>
        {product.description ? (
          <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-[var(--zm-ink-soft)]">
            {product.description}
          </p>
        ) : null}
        <p className="mt-auto pt-2 text-[14px] font-bold" style={{ color: 'var(--zm-brand-deep)' }}>
            {getProductPriceLabel(product)}
        </p>
      </div>

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
  const hasModifiers = product.productType === 'pizza' || product.modifierGroups.some((group) => group.active);
  const isUnit = product.unitBased === true;

  return (
    <div
      className="flex h-full w-[min(180px,calc((100vw-44px)/2))] cursor-pointer flex-col overflow-hidden rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-surface)] sm:w-[190px]"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input, textarea, select')) return;
        onAdd();
      }}
      role="group"
      aria-label={`Abrir ${product.name}`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--zm-canvas)]">
        {product.photoUrl ? (
          <img
            src={product.photoUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ShoppingBag className="h-7 w-7 text-[var(--zm-line-strong)]" strokeWidth={1.5} />
          </div>
        )}
        {qty > 0 ? (
          <span
            className="absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ background: 'var(--zm-brand)' }}
          >
            {qty}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--zm-ink)]">
          {product.name}
        </p>
        {product.description ? (
          <p className="line-clamp-2 text-[13px] leading-snug text-[var(--zm-ink-soft)]">
            {product.description}
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-1 pt-1.5">
          <p className="text-[14px] font-bold" style={{ color: 'var(--zm-brand-deep)' }}>
            {getProductPriceLabel(product)}
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
  const hasModifiers = product.productType === 'pizza' || product.modifierGroups.some((group) => group.active);
  const isUnit = product.unitBased === true;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${divider ? 'border-b border-[var(--zm-line)]' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input, textarea, select')) return;
        onAdd();
      }}
      role="group"
      aria-label={`Abrir ${product.name}`}
    >
      {product.photoUrl ? (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--zm-canvas)] p-1.5">
          <img
            src={product.photoUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-contain"
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-[var(--zm-ink)]">{product.name}</p>
        {product.description ? (
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--zm-ink-soft)]">
            {product.description}
          </p>
        ) : null}
        <p className="mt-1 text-[13px] font-bold" style={{ color: 'var(--zm-brand-deep)' }}>
          {getProductPriceLabel(product)}
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


