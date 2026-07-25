import { Clock3, MapPin, Maximize2, Ruler } from 'lucide-react';
import {
  approximateDeliveryAreaKm2,
  estimatedDeliveryMinutes,
  maxDeliveryDistanceKm,
  type DeliveryAddress,
  type DeliveryRange,
} from '../../domain/deliverySettings';

type PreviewVariant = 'summary' | 'detail';

type DeliveryCoveragePreviewProps = {
  ranges: DeliveryRange[];
  address?: DeliveryAddress | null;
  variant?: PreviewVariant;
  loading?: boolean;
  showHeader?: boolean;
};

function formatDistance(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

function metricValue(value: number | null, suffix: string): string {
  return value == null ? '—' : `${suffix === 'km' ? formatDistance(value) : value} ${suffix}`;
}

export function DeliveryCoveragePreview({
  ranges,
  address,
  variant = 'detail',
  loading = false,
  showHeader = true,
}: DeliveryCoveragePreviewProps) {
  const maxDistanceKm = maxDeliveryDistanceKm(ranges);
  const estimatedMinutes = estimatedDeliveryMinutes(ranges);
  const areaKm2 = approximateDeliveryAreaKm2(ranges);
  const sortedRanges = [...ranges].sort((a, b) => a.maxDistanceM - b.maxDistanceM);
  const compact = variant === 'summary';
  const cityLabel = address?.city && address.state ? `${address.city} · ${address.state}` : 'Endereço ainda não definido';

  return (
    <section
      className={`${showHeader ? 'overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_12px_30px_rgba(36,31,54,0.05)]' : ''} ${compact ? '' : 'h-full'}`}
      aria-labelledby={showHeader ? `delivery-preview-title-${variant}` : undefined}
      aria-label={showHeader ? undefined : 'Visualização aproximada da área de entrega'}
    >
      {showHeader && (
        <div className="flex items-start gap-3 border-b border-[var(--color-line)] px-5 py-4 sm:px-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
            <MapPin className="h-5 w-5" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h2 id={`delivery-preview-title-${variant}`} className="text-[15px] font-semibold text-[var(--color-ink)]">
              {compact ? 'Entrega' : 'Visualização da área'}
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-muted)]">
              {compact ? 'Veja o alcance configurado para sua loja.' : 'As áreas circulares representam as faixas de distância.'}
            </p>
          </div>
        </div>
      )}

      <div className={`${showHeader ? 'p-4 sm:p-5' : 'p-0'} ${compact ? 'space-y-4' : 'space-y-5'}`}>
        <div
          className={`relative isolate overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] ${compact ? 'h-44' : 'h-64 sm:h-72'}`}
          role="img"
          aria-label={`Visualização aproximada da área de entrega. ${cityLabel}. Distância máxima ${maxDistanceKm > 0 ? `${formatDistance(maxDistanceKm)} quilômetros` : 'não configurada'}.`}
        >
          <div
            className="absolute inset-0 opacity-80"
            style={{
              backgroundImage: 'linear-gradient(28deg, transparent 46%, var(--color-surface) 47%, transparent 49%), linear-gradient(116deg, transparent 44%, var(--color-surface) 45%, transparent 47%), linear-gradient(90deg, transparent 49%, var(--color-line) 50%, transparent 51%), linear-gradient(0deg, transparent 49%, var(--color-line) 50%, transparent 51%)',
              backgroundSize: '150px 110px, 190px 150px, 90px 90px, 110px 110px',
            }}
          />
          <div className="absolute inset-0 bg-[var(--color-brand-soft)]/20" />

          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-[var(--color-ink-muted)]">
              Carregando área…
            </div>
          ) : sortedRanges.length > 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              {sortedRanges.map((range, index) => {
                const ratio = maxDistanceKm > 0 ? (range.maxDistanceM / 1000 / maxDistanceKm) : 0;
                const size = compact ? 38 + ratio * 48 : 34 + ratio * 56;
                return (
                  <div
                    key={range.id ?? `${range.maxDistanceM}-${index}`}
                    className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--color-brand)]/35 bg-[var(--color-brand)]/10"
                    style={{ width: `${Math.min(size, 94)}%`, left: '50%', top: '50%' }}
                  >
                    <span className="absolute left-1/2 top-1 -translate-x-1/2 rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-brand-deep)] shadow-sm">
                      {formatDistance(range.maxDistanceM / 1000)} km
                    </span>
                  </div>
                );
              })}
              <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-brand)] text-white shadow-[0_8px_20px_rgba(90,46,234,0.3)] ring-4 ring-[var(--color-surface)]/80">
                <MapPin className="h-5 w-5 fill-current" strokeWidth={1.5} />
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
                <MapPin className="h-5 w-5" />
              </div>
              <p className="text-xs font-semibold text-[var(--color-ink-soft)]">Adicione uma faixa para visualizar o alcance.</p>
            </div>
          )}

          <span className="absolute bottom-3 left-3 rounded-full bg-[var(--color-surface)]/90 px-2.5 py-1 text-[10px] font-semibold text-[var(--color-ink-muted)] shadow-sm">
            Visualização aproximada
          </span>
        </div>

        <div className="grid grid-cols-1 divide-y divide-[var(--color-line)] sm:grid-cols-3 sm:divide-x sm:divide-y-0" aria-label="Resumo da área de entrega">
          <Metric icon={Ruler} label="Distância máxima" value={metricValue(maxDistanceKm || null, 'km')} />
          <Metric icon={Clock3} label="Tempo estimado (máx.)" value={estimatedMinutes == null ? '—' : `~ ${estimatedMinutes} min`} />
          <Metric icon={Maximize2} label="Área aproximada" value={metricValue(areaKm2, 'km²')} />
        </div>
      </div>
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Ruler;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 sm:flex-col sm:items-start sm:px-4 sm:py-0 sm:first:pl-0 sm:last:pr-0">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1 sm:w-full">
        <p className="text-[11px] font-medium text-[var(--color-ink-muted)]">{label}</p>
        <p className="mt-0.5 text-sm font-bold text-[var(--color-ink)]">{value}</p>
      </div>
    </div>
  );
}
