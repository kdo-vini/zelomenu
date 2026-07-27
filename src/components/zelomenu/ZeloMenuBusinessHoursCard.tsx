import { useEffect, useMemo, useState } from 'react';
import { Check, Clock3, Loader2 } from 'lucide-react';
import {
  CLOSED_DAY_LABELS,
  DAY_KEYS,
  isValidWeeklyWindow,
  type WeeklyHours,
} from '../../domain/businessHours';
import {
  getZeloMenuSettings,
  updateZeloMenuSettings,
  type ZeloMenuStoreSettings,
} from '../../services/zelomenuAdminApi';
import { BusinessHoursEditor } from './BusinessHoursEditor';

function validateWeeklyHours(weekly: WeeklyHours): string | null {
  for (const day of DAY_KEYS) {
    for (const window of weekly[day]) {
      if (!isValidWeeklyWindow(window)) {
        return `Confira os horários de ${CLOSED_DAY_LABELS[day]}: o início precisa ser antes do fim (00:00–00:00 significa 24 horas).`;
      }
    }
  }
  return null;
}

export function ZeloMenuBusinessHoursCard() {
  const [settings, setSettings] = useState<ZeloMenuStoreSettings | null>(null);
  const [draft, setDraft] = useState<WeeklyHours | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getZeloMenuSettings()
      .then((next) => {
        if (!active) return;
        setSettings(next);
        setDraft(next.weeklyHours);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os horários.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const validationError = useMemo(
    () => (draft ? validateWeeklyHours(draft) : null),
    [draft],
  );
  const isDirty = Boolean(draft && settings && JSON.stringify(draft) !== JSON.stringify(settings.weeklyHours));

  async function save() {
    if (!draft || !isDirty || validationError) return;
    setSaving(true);
    setSaveState('idle');
    setError(null);
    try {
      await updateZeloMenuSettings({ weeklyHours: draft });
      setSettings((current) => current ? { ...current, weeklyHours: draft } : current);
      setSaveState('saved');
      window.setTimeout(() => setSaveState('idle'), 2200);
    } catch (reason) {
      setSaveState('error');
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar os horários.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_12px_30px_rgba(36,31,54,0.05)]">
      <div className="flex items-start gap-3 border-b border-[var(--color-line)] px-5 py-4 sm:px-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
          <Clock3 className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--color-ink)]">Horários de funcionamento</h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-[var(--color-ink-muted)]">
            O ZeloMenu usa estes horários para mostrar se a loja está aberta e validar pedidos agendados.
          </p>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-6">
        {loading || !draft ? (
          <div className="flex min-h-24 items-center justify-center text-sm text-[var(--color-ink-muted)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando horários…
          </div>
        ) : (
          <>
            <p className="max-w-2xl text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              Configure uma ou mais faixas por dia, como almoço e jantar. Deixe como fechado quando a loja não atender.
            </p>

            <BusinessHoursEditor value={draft} onChange={setDraft} disabled={saving} />

            {validationError ? <p role="alert" className="text-[13px] font-medium text-[var(--color-alert)]">{validationError}</p> : null}
            {error ? <p role="alert" className="text-[13px] text-[var(--color-alert)]">{error}</p> : null}

            {isDirty ? (
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || Boolean(validationError)}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-brand-deep)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {saving ? 'Salvando…' : 'Salvar horários'}
              </button>
            ) : null}

            {saveState === 'saved' ? (
              <p className="flex items-center justify-center gap-1.5 text-[13px] font-medium text-[var(--color-success)]" aria-live="polite">
                <Check className="h-4 w-4" /> Horários salvos
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
