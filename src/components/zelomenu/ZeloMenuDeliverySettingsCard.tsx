import { Building2, Info, Loader2, Plus, Ruler, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  DeliveryDraftValidation,
  DeliveryRangeDraft,
  DeliverySettingsDraft,
} from '../../domain/deliverySettings';

type DeliverySettingsCardProps = {
  draft: DeliverySettingsDraft;
  validation: DeliveryDraftValidation;
  cepLoading: boolean;
  onLookupCep: () => void;
  onAddressChange: (field: 'postalCode' | 'number' | 'complement', value: string) => void;
  onRangeChange: (index: number, field: keyof Pick<DeliveryRangeDraft, 'maxDistanceKm' | 'price'>, value: string) => void;
  onAddRange: () => void;
  onRemoveRange: (index: number) => void;
};

export function ZeloMenuDeliverySettingsCard({
  draft,
  validation,
  cepLoading,
  onLookupCep,
  onAddressChange,
  onRangeChange,
  onAddRange,
  onRemoveRange,
}: DeliverySettingsCardProps) {
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_12px_30px_rgba(36,31,54,0.05)]">
        <CardHeading icon={Building2} title="Endereço da loja" description="Informe o endereço usado como referência para calcular as distâncias." />

        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field label="CEP" error={validation.postalCode}>
              <input
                value={draft.address.postalCode}
                onChange={(event) => onAddressChange('postalCode', event.target.value)}
                inputMode="numeric"
                autoComplete="postal-code"
                placeholder="00000-000"
                aria-invalid={!!validation.postalCode}
                className={inputClass(!!validation.postalCode)}
              />
            </Field>
            <button
              type="button"
              onClick={onLookupCep}
              disabled={cepLoading}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--color-brand)] px-4 text-sm font-bold text-[var(--color-brand-deep)] transition-colors hover:bg-[var(--color-brand-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cepLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {cepLoading ? 'Buscando…' : 'Buscar CEP'}
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
            <Field label="Rua" error={validation.street}>
              <input
                value={draft.address.street}
                readOnly
                placeholder="Preenchida pelo CEP"
                className={`${inputClass(!!validation.street)} read-only:bg-[var(--color-canvas)] read-only:text-[var(--color-ink-soft)]`}
                aria-describedby="delivery-derived-fields-help"
              />
            </Field>
            <Field label="Número" error={validation.number}>
              <input
                value={draft.address.number}
                onChange={(event) => onAddressChange('number', event.target.value)}
                inputMode="numeric"
                autoComplete="street-address"
                placeholder="123"
                aria-invalid={!!validation.number}
                className={inputClass(!!validation.number)}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bairro">
              <input value={draft.address.neighborhood} readOnly placeholder="Preenchido pelo CEP" className={`${inputClass(false)} read-only:bg-[var(--color-canvas)] read-only:text-[var(--color-ink-soft)]`} />
            </Field>
            <Field label="Cidade" error={validation.city}>
              <input value={draft.address.city} readOnly placeholder="Preenchida pelo CEP" className={`${inputClass(!!validation.city)} read-only:bg-[var(--color-canvas)] read-only:text-[var(--color-ink-soft)]`} />
            </Field>
          </div>

          <Field label="Estado">
            <input value={draft.address.state} readOnly placeholder="UF" className={`${inputClass(false)} max-w-[180px] read-only:bg-[var(--color-canvas)] read-only:text-[var(--color-ink-soft)]`} />
          </Field>

          <p id="delivery-derived-fields-help" className="flex items-start gap-2 rounded-xl border border-[var(--color-brand-soft)] bg-[var(--color-brand-soft)]/45 px-3 py-3 text-xs leading-relaxed text-[var(--color-brand-deep)]">
            <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            Este endereço será usado como referência para calcular as distâncias de entrega.
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_12px_30px_rgba(36,31,54,0.05)]">
        <CardHeading icon={Ruler} title="Faixas de entrega" description="Adicione as faixas de distância e os valores do frete." />

        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] gap-2 px-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
            <span>Até (km)</span>
            <span>Valor</span>
            <span className="sr-only">Ações</span>
          </div>

          <div className="space-y-2">
            {draft.ranges.map((range, index) => (
              <div key={range.id ?? `new-${index}`}>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] items-start gap-2">
                  <input
                    value={range.maxDistanceKm}
                    onChange={(event) => onRangeChange(index, 'maxDistanceKm', event.target.value)}
                    inputMode="decimal"
                    placeholder="2,00"
                    aria-label={`Distância máxima da faixa ${index + 1} em quilômetros`}
                    aria-invalid={!!validation.ranges[index]}
                    className={inputClass(!!validation.ranges[index])}
                  />
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-semibold text-[var(--color-ink-muted)]">R$</span>
                    <input
                      value={range.price}
                      onChange={(event) => onRangeChange(index, 'price', event.target.value)}
                      inputMode="decimal"
                      placeholder="5,00"
                      aria-label={`Valor da faixa ${index + 1} em reais`}
                      aria-invalid={!!validation.ranges[index]}
                      className={`${inputClass(!!validation.ranges[index])} pl-10`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveRange(index)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-line)] text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-alert-soft)] hover:bg-[var(--color-alert-soft)] hover:text-[var(--color-alert)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label={`Remover faixa ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </div>
                {validation.ranges[index] && <p className="mt-1 px-1 text-[11px] text-[var(--color-alert)]" role="alert">{validation.ranges[index]}</p>}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={onAddRange}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-brand-deep)] transition-colors hover:bg-[var(--color-brand-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Adicionar faixa
          </button>

          <p className="flex items-start gap-2 rounded-xl border border-[var(--color-brand-soft)] bg-[var(--color-brand-soft)]/45 px-3 py-3 text-xs leading-relaxed text-[var(--color-brand-deep)]">
            <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            A última faixa define a distância máxima de entrega. Pedidos acima dessa distância não poderão ser finalizados.
          </p>
        </div>
      </section>
    </div>
  );
}

function CardHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Building2;
  title: string;
  description: string;
}) {
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

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[11px] font-bold text-[var(--color-ink-soft)]">{label}</span>
      {children}
      {error && <span className="mt-1 block text-[11px] leading-relaxed text-[var(--color-alert)]">{error}</span>}
    </label>
  );
}

function inputClass(invalid: boolean): string {
  return `h-11 w-full rounded-xl border bg-[var(--color-surface)] px-3 text-base text-[var(--color-ink)] outline-none transition-colors placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/10 sm:text-[13px] ${invalid ? 'border-[var(--color-alert)]' : 'border-[var(--color-line)]'}`;
}
