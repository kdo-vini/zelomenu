import type { CSSProperties, RefObject } from 'react';
import { Bike, ChevronRight, Clock3, Info, MapPin, Search, X } from 'lucide-react';
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
  fulfillment: Bike,
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
  const companyDescription = business.description?.trim() || business.welcomeText?.trim();

  return (
    <>
      <section className="mx-auto w-full max-w-5xl bg-[var(--zm-surface)]">
        {business.coverUrl ? (
          <img
            src={business.coverUrl}
            alt={`Capa de ${business.name || 'loja'}`}
            className="h-24 w-full object-cover sm:h-32"
            loading="eager"
          />
        ) : null}

        <div className="px-4 pb-3 pt-3">
          <div className="flex items-center gap-3">
            {business.logoUrl ? (
              <img
                src={business.logoUrl}
                alt={business.name || 'Logo'}
                className="h-16 w-16 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-[16px] font-bold text-white"
                style={{ background: 'linear-gradient(135deg, var(--zm-brand), var(--zm-brand-deep))' }}
                aria-hidden="true"
              >
                {business.name ? initials(business.name) : '🍴'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[24px] font-bold leading-tight tracking-[-0.02em] text-[var(--zm-ink)]">
                {business.name || 'Cardápio'}
              </h1>
              <div className="mt-0.5 flex min-w-0 items-center">
                {business.address ? (
                  <button
                    type="button"
                    onClick={() => onOpenOperation('information')}
                    className="flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-lg text-left text-[13.5px] text-[var(--zm-ink-soft)] hover:text-[var(--zm-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--zm-brand)]"
                    aria-label={`Abrir informações de ${business.name || 'loja'}`}
                  >
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{business.address}</span>
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {companyDescription ? (
            <p className="mt-1.5 line-clamp-2 text-[14px] leading-snug text-[var(--zm-ink-soft)]">
              {companyDescription}
            </p>
          ) : null}

          <div className="-mx-4 mt-2 flex divide-x divide-[var(--zm-line)] border-t border-[var(--zm-line)] px-1 pt-2 sm:px-2" aria-label="Informações rápidas da loja">
            {operations.map((operation) => {
              const Icon = operationIcons[operation.key];
              const isStatic = operation.key === 'fulfillment';
              const content = (
                <span className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1 px-1 text-center sm:gap-1.5 sm:px-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--zm-canvas)] text-[var(--zm-ink-soft)] sm:h-7 sm:w-7">
                    <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className={`whitespace-nowrap text-[11px] font-bold leading-tight sm:text-[11.5px] ${operation.tone === 'warning' ? 'text-[var(--color-alert)]' : 'text-[var(--zm-ink)]'}`}>{operation.title}</span>
                    <span className="mt-0.5 line-clamp-2 break-words text-[11.5px] font-medium leading-tight text-[var(--zm-ink-soft)]">{operation.summary}</span>
                  </span>
                  {operation.key === 'information' ? <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-[var(--zm-ink-soft)] sm:block" aria-hidden="true" /> : null}
                </span>
              );

              if (isStatic) {
                return (
                  <div key={operation.key} data-operation={operation.key} aria-label={`${operation.title}: ${operation.summary}`} className="flex min-w-0 flex-1">
                    {content}
                  </div>
                );
              }

              return (
                <button
                  key={operation.key}
                  type="button"
                  data-operation={operation.key}
                  onClick={() => onOpenOperation(operation.key)}
                  className="flex min-w-0 flex-1 rounded-lg text-center transition-colors hover:bg-[var(--zm-canvas)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--zm-brand)]"
                  aria-label={`${operation.title}: ${operation.summary}`}
                >
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className={`sticky z-20 border-b border-[var(--zm-line)] bg-[var(--zm-surface)] ${hasMesaBanner ? 'top-10' : 'top-0'}`}>
        <div className="mx-auto max-w-5xl">
          <div className="px-4 pb-2 pt-2">
            <label htmlFor="zelomenu-search" className="sr-only">Buscar no cardápio</label>
            <div className="flex min-h-12 items-center gap-2.5 rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-canvas)] px-3.5 focus-within:border-[var(--zm-brand)]">
              <Search className="h-[18px] w-[18px] shrink-0 text-[var(--zm-ink-soft)]" strokeWidth={2} aria-hidden="true" />
              <input
                id="zelomenu-search"
                type="search"
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Buscar no cardápio…"
                className="min-h-11 flex-1 bg-transparent text-[16px] text-[var(--zm-ink)] placeholder:text-[var(--zm-ink-soft)] outline-none"
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
                className="flex gap-1.5 overflow-x-auto px-4 pb-2"
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
                      background: activeCategory === group.nome ? 'var(--zm-brand)' : 'var(--zm-surface-muted)',
                      color: activeCategory === group.nome ? 'var(--zm-surface)' : 'var(--zm-ink-soft)',
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
