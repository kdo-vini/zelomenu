import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Loader2, RefreshCw } from 'lucide-react';
import { getZeloMenuOperationalMetrics, type ZeloMenuOperationalMetrics } from '../../services/zelomenuAdminApi';

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function ZeloMenuMetricsCard() {
  const [metrics, setMetrics] = useState<ZeloMenuOperationalMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setMetrics(await getZeloMenuOperationalMetrics());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4 sm:px-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
            <BarChart3 className="h-5 w-5" strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--color-ink)]">Indicadores do cardápio</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-muted)]">Uma leitura simples dos últimos 7 dias para orientar os próximos ajustes.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {loading && !metrics ? (
        <div className="flex min-h-28 items-center justify-center gap-2 px-5 py-6 text-sm text-[var(--color-ink-muted)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-brand)]" />
          Carregando indicadores…
        </div>
      ) : error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-6 sm:px-6">
          <p className="text-sm text-[var(--color-ink-muted)]">Não consegui carregar os indicadores agora.</p>
          <button type="button" onClick={() => void load()} className="min-h-11 rounded-xl border border-[var(--color-line-strong)] px-3 text-sm font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)]">
            Tentar novamente
          </button>
        </div>
      ) : metrics ? (
        <dl className="grid divide-y divide-[var(--color-line)] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <Metric label="Carrinhos iniciados" value={String(metrics.cartsStarted)} />
          <Metric label="Pedidos enviados" value={String(metrics.ordersCreated)} />
          <Metric label="Conversão" value={`${metrics.conversionRate.toLocaleString('pt-BR')}%`} />
          <Metric label="Total dos pedidos" value={formatCurrency(metrics.revenue)} />
        </dl>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4 sm:px-4">
      <dt className="text-xs font-medium text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="mt-1 text-lg font-bold tracking-[-0.01em] text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}
