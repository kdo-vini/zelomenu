import type { CSSProperties, RefObject } from 'react';
import { Clock3, Info, MapPin, Search, Truck, X } from 'lucide-react';
import type {
  ZeloMenuCatalogGroup,
  ZeloMenuPublicStoreResponse,
} from '../../services/zelomenuApi';
import type { StorefrontOperationAction, StorefrontOperationKey } from '../../domain/storefrontOperations';

type StorefrontHeaderProps = {
  business: ZeloMenuPublicStoreResponse['business'];
  operations: StorefrontOperationAction[];
  visibleCategories: ZeloMenuCatalogGroup[];
  activeCategory: string;
  searchQuery: string;
  tabsRef: RefObject<HTMLDivElement | null>;
  hasMesaBanner: boolean;
  onSearchChange: (value: string) => void;
  onCategoryClick: (name: string) => void;
  onOpenOperation: (key: StorefrontOperationKey) => void;
};

const operationIcons = {
  hours: Clock3,
  fulfillment: Truck,
  information: Info,
} as const;

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((word) => word[0] ?? '').join('').toUpperCase();
}

export function StorefrontHeader({
  business,
  operations,
  visibleCategories,
  activeCategory,
  searchQuery,
  tabsRef,
  hasMesaBanner,
  onSearchChange,
  onCategoryClick,
  onOpenOperation,
}: StorefrontHeaderProps) {
  return (
    <>
      <section className="mx-auto w-full max-w-5xl bg-[var(--zm-surface)]">
        {business.coverUrl ? (
          <img
            src={business.coverUrl}
            alt={`Capa de ${business.name || 'loja'}`}
            className="h-36 w-full object-cover sm:h-40"
            loading="eager"
          />
        ) : null}

        <div className="px-4 pb-4 pt-4">
          <div className="flex items-center gap-3">
            {business.logoUrl ? (
              <img
                src={business.logoUrl}
                alt={business.name || 'Logo'}
                className="h-12 w-12 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[16px] font-bold text-white"
                style={{ background: 'linear-gradient(135deg, var(--zm-brand), var(--zm-brand-deep))' }}
                aria-hidden="true"
              >
                {business.name ? initials(business.name) : '🍴'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[17px] font-bold leading-tight text-[var(--zm-ink)]">
                {business.name || 'Cardápio'}
              </h1>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                {business.address ? (
                  <span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-[var(--zm-ink-soft)]">
                    <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {business.address}
                  </span>
                ) : null}
                {business.pixEnabled ? (
                  <span className="shrink-0 rounded-full bg-[var(--zm-canvas)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--zm-ink-soft)]">
                    Pix
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {business.welcomeText ? (
            <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-[var(--zm-ink-soft)]">
              {business.welcomeText}
            </p>
          ) : null}

          <div className="mt-4 grid grid-cols-3 gap-2" aria-label="Informações rápidas da loja">
            {operations.map((operation) => {
              const Icon = operationIcons[operation.key];
              const toneClass = operation.tone === 'positive'
                ? 'border-[var(--zm-brand)]/30 bg-[var(--zm-brand-soft)]'
                : operation.tone === 'warning'
                  ? 'border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)]'
                  : 'border-[var(--zm-line)] bg-[var(--zm-canvas)]';
              return (
                <button
                  key={operation.key}
                  type="button"
                  data-operation={operation.key}
                  onClick={() => onOpenOperation(operation.key)}
                  className={`flex min-h-[52px] min-w-0 flex-col items-start justify-center gap-0.5 rounded-xl border px-2.5 py-2 text-left transition-colors hover:border-[var(--zm-brand)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--zm-brand)]/40 ${toneClass}`}
                  aria-label={`${operation.title}: ${operation.summary}`}
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-[var(--zm-ink)]">
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{operation.title}</span>
                  </span>
                  <span className="line-clamp-1 text-[10px] font-medium text-[var(--zm-ink-soft)]">
                    {operation.summary}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className={`sticky z-20 border-b border-[var(--zm-line)] bg-[var(--zm-surface)] ${hasMesaBanner ? 'top-10' : 'top-0'}`}>
        <div className="mx-auto max-w-5xl">
          <div className="px-4 pb-2.5 pt-2.5">
            <label htmlFor="zelomenu-search" className="sr-only">Buscar no cardápio</label>
            <div className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--zm-line)] bg-[var(--zm-canvas)] px-3 focus-within:border-[var(--zm-brand)]">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--zm-ink-soft)]" strokeWidth={2} aria-hidden="true" />
              <input
                id="zelomenu-search"
                type="search"
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Buscar no cardápio…"
                className="min-h-11 flex-1 bg-transparent text-[13px] text-[var(--zm-ink)] placeholder:text-[var(--zm-ink-soft)] outline-none"
              />
              {searchQuery ? (
                <button type="button" onClick={() => onSearchChange('')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" aria-label="Limpar busca">
                  <X className="h-3.5 w-3.5 text-[var(--zm-ink-soft)]" strokeWidth={2} />
                </button>
              ) : null}
            </div>
          </div>

          {!searchQuery && visibleCategories.length > 1 ? (
            <div className="relative">
              <div
                ref={tabsRef}
                className="flex gap-1.5 overflow-x-auto px-4 pb-2.5"
                style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as CSSProperties}
              >
                {visibleCategories.map((group) => (
                  <button
                    key={group.nome}
                    type="button"
                    data-tab={group.nome}
                    onClick={() => onCategoryClick(group.nome)}
                    className="min-h-11 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[12px] font-semibold"
                    style={{
                      background: activeCategory === group.nome ? 'var(--zm-brand)' : 'var(--zm-canvas)',
                      color: activeCategory === group.nome ? '#fff' : 'var(--zm-ink-soft)',
                    }}
                  >
                    {group.nome}
                  </button>
                ))}
              </div>
              <div className="pointer-events-none absolute inset-y-0 right-0 w-10" style={{ background: 'linear-gradient(to left, var(--zm-surface), transparent)' }} />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
