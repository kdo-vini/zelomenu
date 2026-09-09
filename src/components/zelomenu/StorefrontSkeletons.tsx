// Layout skeletons shown while the storefront catalog or the cart are
// loading, replacing a blank full-screen spinner with a hint of the real
// structure (product grid / list rows). Not pixel-perfect on purpose — the
// goal is to signal "content is coming" quickly, not to mirror the final
// layout exactly.

function Block({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[var(--zm-surface-muted)] ${className}`} />;
}

export function CatalogSkeleton() {
  return (
    <div className="zelomenu-theme flex min-h-screen flex-col bg-[var(--zm-canvas)]" aria-hidden="true">
      {/* Header bar */}
      <div className="border-b border-[var(--zm-line)] bg-[var(--zm-surface)] px-4 py-3">
        <Block className="h-11 w-full rounded-xl" />
        <div className="mt-3 flex gap-1.5">
          <Block className="h-8 w-20 rounded-full" />
          <Block className="h-8 w-24 rounded-full" />
          <Block className="h-8 w-16 rounded-full" />
        </div>
      </div>

      {/* Catalog body */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-28 pt-5">
        <div className="space-y-8">
          {[0, 1].map((section) => (
            <div key={section}>
              <Block className="mb-3 h-4 w-32" />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {[0, 1, 2, 3].map((card) => (
                  <div
                    key={card}
                    className="flex items-center gap-3 rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-surface)] p-3"
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <Block className="h-3.5 w-3/4" />
                      <Block className="h-3 w-full" />
                      <Block className="h-3 w-1/3" />
                    </div>
                    <Block className="h-14 w-14 shrink-0 rounded-xl" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export function CartSkeleton() {
  return (
    <div className="zelomenu-theme min-h-screen bg-[var(--zm-canvas)] text-[var(--zm-ink)]" aria-hidden="true">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6 sm:max-w-[480px]">
        <Block className="mb-6 h-6 w-40" />
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex items-center gap-3 rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-surface)] p-3"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <Block className="h-3.5 w-2/3" />
                <Block className="h-3 w-1/3" />
              </div>
              <Block className="h-8 w-24 rounded-lg" />
            </div>
          ))}
        </div>
        <div className="mt-8 space-y-2">
          <Block className="h-11 w-full rounded-lg" />
          <Block className="h-11 w-full rounded-lg" />
          <Block className="h-11 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
