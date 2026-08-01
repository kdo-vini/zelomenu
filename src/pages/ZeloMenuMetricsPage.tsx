import { BarChart3 } from 'lucide-react';
import { ZeloMenuMetricsCard } from '../components/zelomenu/ZeloMenuMetricsCard';

export function ZeloMenuMetricsPage() {
  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-6 px-4 pb-8 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pt-9">
      <header className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
          <BarChart3 className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-ink)]">Indicadores</h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--color-ink-muted)]">
            Acompanhe o movimento recente do seu cardápio para decidir os próximos ajustes.
          </p>
        </div>
      </header>

      <ZeloMenuMetricsCard />
    </div>
  );
}
