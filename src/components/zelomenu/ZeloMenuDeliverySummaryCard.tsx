import { ArrowRight, Loader2, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  EMPTY_DELIVERY_SETTINGS,
  type DeliverySettings,
} from '../../domain/deliverySettings';
import { getDeliverySettings } from '../../services/zelomenuAdminApi';
import { DeliveryCoveragePreview } from './DeliveryCoveragePreview';

export function ZeloMenuDeliverySummaryCard({ onConfigure }: { onConfigure: () => void }) {
  const [settings, setSettings] = useState<DeliverySettings>(EMPTY_DELIVERY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getDeliverySettings()
      .then((nextSettings) => {
        if (!active) return;
        setSettings(nextSettings);
      })
      .catch(() => {
        if (!active) return;
        setLoadError('A configuração de entrega ainda não está disponível.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_12px_30px_rgba(36,31,54,0.05)]">
      <div className="flex items-start gap-3 border-b border-[var(--color-line)] px-5 py-4 sm:px-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
          <Truck className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-[var(--color-ink)]">Entrega</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-muted)]">
            Defina sua área de entrega e as faixas de distância.
          </p>
        </div>
        {settings.enabled && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-success-soft)] px-2.5 py-1 text-[10px] font-bold text-[var(--color-success)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" aria-hidden="true" />
            Ativa
          </span>
        )}
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <DeliveryCoveragePreview
          ranges={settings.ranges}
          address={settings.address}
          variant="summary"
          loading={loading}
          showHeader={false}
        />

        {loadError && (
          <p className="rounded-xl border border-[var(--color-warn-soft)] bg-[var(--color-warn-soft)] px-3 py-2.5 text-xs leading-relaxed text-[var(--color-warn)]" role="status">
            {loadError} Você pode abrir a configuração para tentar novamente.
          </p>
        )}

        <button
          type="button"
          onClick={onConfigure}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-bold text-white transition-colors hover:bg-[var(--color-brand-deep)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 focus-visible:ring-offset-2"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Configurar entrega
          <ArrowRight className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
