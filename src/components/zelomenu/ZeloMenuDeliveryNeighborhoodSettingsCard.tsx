import { Clock3, Info, MapPin, Plus, ToggleLeft, Trash2 } from 'lucide-react';
import type { DeliveryDraftValidation, DeliverySettingsDraft } from '../../domain/deliverySettings';

type Props = {
  draft: DeliverySettingsDraft;
  validation: DeliveryDraftValidation;
  onNeighborhoodChange: (index: number, field: 'name' | 'price', value: string) => void;
  onToggleNeighborhood: (index: number) => void;
  onAddNeighborhood: () => void;
  onRemoveNeighborhood: (index: number) => void;
  onEstimatedDeliveryMinutesChange: (value: string) => void;
};

export function ZeloMenuDeliveryNeighborhoodSettingsCard({
  draft,
  validation,
  onNeighborhoodChange,
  onToggleNeighborhood,
  onAddNeighborhood,
  onRemoveNeighborhood,
  onEstimatedDeliveryMinutesChange,
}: Props) {
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_8px_18px_rgba(36,31,54,0.04)]">
        <CardHeading icon={MapPin} title="Bairros atendidos" description="Cadastre os bairros e o valor da entrega para cada um." />
        <div className="space-y-4 p-4 sm:p-5">
          <p className="flex items-start gap-2 rounded-xl border border-[var(--color-brand-soft)] bg-[var(--color-brand-soft)]/45 px-3 py-3 text-xs leading-relaxed text-[var(--color-brand-deep)]">
            <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            O cliente escolherá um destes bairros no pedido. Somente bairros ativos aparecem para ele.
          </p>

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(100px,0.42fr)_44px] gap-2 px-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
            <span>Bairro</span>
            <span>Valor</span>
            <span className="sr-only">Ações</span>
          </div>

          <div className="space-y-2">
            {draft.neighborhoods.map((neighborhood, index) => (
              <div key={neighborhood.id ?? `new-${index}`}>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(100px,0.42fr)_44px] items-center gap-2">
                  <input
                    value={neighborhood.name}
                    onChange={(event) => onNeighborhoodChange(index, 'name', event.target.value)}
                    aria-label={`Nome do bairro ${index + 1}`}
                    aria-invalid={Boolean(validation.neighborhoods[index])}
                    placeholder="Ex.: Centro"
                    className={inputClass(Boolean(validation.neighborhoods[index]))}
                  />
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-semibold text-[var(--color-ink-muted)]">R$</span>
                    <input
                      value={neighborhood.price}
                      onChange={(event) => onNeighborhoodChange(index, 'price', event.target.value)}
                      inputMode="decimal"
                      aria-label={`Valor de entrega do bairro ${index + 1}`}
                      aria-invalid={Boolean(validation.neighborhoods[index])}
                      placeholder="5,00"
                      className={`${inputClass(Boolean(validation.neighborhoods[index]))} pl-10`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveNeighborhood(index)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-line)] text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-alert-soft)] hover:bg-[var(--color-alert-soft)] hover:text-[var(--color-alert)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40"
                    aria-label={`Remover bairro ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 px-1">
                  {validation.neighborhoods[index] ? <p className="text-[11px] text-[var(--color-alert)]" role="alert">{validation.neighborhoods[index]}</p> : <span />}
                  <button
                    type="button"
                    onClick={() => onToggleNeighborhood(index)}
                    className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 ${neighborhood.active ? 'text-[var(--color-success)] hover:bg-[var(--color-success-soft)]' : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]'}`}
                    aria-pressed={neighborhood.active}
                  >
                    <ToggleLeft className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                    {neighborhood.active ? 'Ativo para clientes' : 'Inativo'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {draft.neighborhoods.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--color-line)] px-3 py-4 text-sm text-[var(--color-ink-muted)]">
              Nenhum bairro cadastrado ainda.
            </p>
          ) : null}

          <button
            type="button"
            onClick={onAddNeighborhood}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-brand-deep)] transition-colors hover:bg-[var(--color-brand-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Adicionar bairro
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_8px_18px_rgba(36,31,54,0.04)]">
        <CardHeading icon={Clock3} title="Tempo de entrega" description="Defina o prazo único que será mostrado aos clientes." />
        <div className="space-y-3 p-4 sm:p-5">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[11px] font-bold text-[var(--color-ink-soft)]">Tempo estimado de entrega (minutos)</span>
            <input
              type="number"
              min="1"
              max="1440"
              step="1"
              value={draft.estimatedDeliveryMinutes}
              onChange={(event) => onEstimatedDeliveryMinutesChange(event.target.value)}
              inputMode="numeric"
              placeholder="Ex.: 50"
              aria-invalid={Boolean(validation.estimatedDeliveryMinutes)}
              className={inputClass(Boolean(validation.estimatedDeliveryMinutes))}
            />
            {validation.estimatedDeliveryMinutes ? <span className="mt-1 block text-[11px] text-[var(--color-alert)]" role="alert">{validation.estimatedDeliveryMinutes}</span> : null}
          </label>
          <p className="flex items-start gap-2 rounded-xl border border-[var(--color-brand-soft)] bg-[var(--color-brand-soft)]/45 px-3 py-3 text-xs leading-relaxed text-[var(--color-brand-deep)]">
            <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            O prazo é apenas informativo. Deixe em branco se não quiser mostrá-lo no cardápio.
          </p>
        </div>
      </section>
    </div>
  );
}

function CardHeading({ icon: Icon, title, description }: { icon: typeof MapPin; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-[var(--color-line)] px-5 py-4 sm:px-6">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
        <Icon className="h-5 w-5" strokeWidth={1.8} />
      </div>
      <div>
        <h2 className="text-[15px] font-semibold text-[var(--color-ink)]">{title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-muted)]">{description}</p>
      </div>
    </div>
  );
}

function inputClass(invalid: boolean): string {
  return `h-11 w-full rounded-xl border bg-[var(--color-surface)] px-3 text-base text-[var(--color-ink)] outline-none transition-colors placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/10 sm:text-[13px] ${invalid ? 'border-[var(--color-alert)]' : 'border-[var(--color-line)]'}`;
}
