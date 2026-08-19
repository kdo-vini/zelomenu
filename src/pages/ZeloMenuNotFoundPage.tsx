import { ArrowLeft, Home, UtensilsCrossed } from 'lucide-react';

export function ZeloMenuNotFoundPage() {
  return (
    <div className="zelomenu-theme relative flex min-h-screen overflow-hidden bg-[var(--zm-canvas)] text-[var(--zm-ink)]">
      <div className="pointer-events-none absolute -left-24 top-16 h-64 w-64 rounded-full bg-[var(--zm-brand-soft)]/70 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-28 bottom-10 h-80 w-80 rounded-full bg-[var(--zm-accent)]/20 blur-3xl" aria-hidden="true" />

      <main className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-10 sm:px-8">
        <a
          href="/"
          className="mx-auto mb-8 inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold text-[var(--zm-ink)] transition hover:bg-[var(--zm-surface)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--zm-brand-soft)] motion-reduce:transition-none"
          aria-label="Voltar para a página inicial do ZeloMenu"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--zm-brand)] text-white shadow-lg shadow-[var(--zm-brand)]/20">
            <UtensilsCrossed className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
          </span>
          ZeloMenu
        </a>

        <section
          className="overflow-hidden rounded-[2rem] border border-[var(--zm-line)] bg-[var(--zm-surface)] px-6 py-8 text-center shadow-[0_24px_80px_rgba(11,29,58,0.10)] sm:px-12 sm:py-12"
          aria-labelledby="public-store-not-found-title"
        >
          <div className="mx-auto mb-7 flex max-w-sm items-end justify-center gap-1 font-black tracking-[-0.08em] text-[var(--zm-brand)]" aria-hidden="true">
            <span className="text-7xl leading-none sm:text-8xl">4</span>
            <span className="relative flex h-24 w-24 items-center justify-center rounded-full border-[10px] border-[var(--zm-brand)] bg-[var(--zm-brand-soft)] text-6xl leading-none text-[var(--zm-ink)] sm:h-28 sm:w-28 sm:text-7xl">
              <span className="absolute inset-3 rounded-full border border-dashed border-[var(--zm-brand)]/50" />
              <UtensilsCrossed className="relative h-8 w-8 text-[var(--zm-brand)] sm:h-10 sm:w-10" strokeWidth={1.8} />
            </span>
            <span className="text-7xl leading-none sm:text-8xl">4</span>
          </div>

          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--zm-brand)]">Cardápio fora do mapa</p>
          <h1 id="public-store-not-found-title" className="mt-3 text-2xl font-bold tracking-tight text-[var(--zm-ink)] sm:text-3xl">
            Este cardápio não está disponível.
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--zm-ink-soft)] sm:text-[15px]">
            Confira o endereço ou volte para descobrir outras empresas que já estão no ZeloMenu.
          </p>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href="/"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--zm-brand)] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-[var(--zm-brand)]/20 transition hover:bg-[var(--zm-brand-deep)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--zm-brand-soft)] motion-reduce:transition-none"
            >
              <Home className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
              Voltar para o início
            </a>
            <a
              href="/conhecer-zelomenu"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--zm-line-strong)] bg-[var(--zm-surface)] px-5 py-3 text-sm font-bold text-[var(--zm-ink)] transition hover:border-[var(--zm-brand)] hover:text-[var(--zm-brand)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--zm-brand-soft)] motion-reduce:transition-none"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
              Conhecer o ZeloMenu
            </a>
          </div>
        </section>

        <p className="mt-6 text-center text-xs text-[var(--zm-ink-soft)]">
          ZeloMenu · cardápios digitais para negócios que querem vender melhor.
        </p>
      </main>
    </div>
  );
}
