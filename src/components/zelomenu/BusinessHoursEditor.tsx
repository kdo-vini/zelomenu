import { CalendarDays, CopyPlus, Plus, X } from 'lucide-react';
import {
  DAY_KEYS,
  type DayKey,
  type HoursWindow,
  type WeeklyHours,
} from '../../domain/businessHours';

const DISPLAY_ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const LABELS: Record<DayKey, string> = {
  sun: 'Domingo',
  mon: 'Segunda',
  tue: 'Terça',
  wed: 'Quarta',
  thu: 'Quinta',
  fri: 'Sexta',
  sat: 'Sábado',
};
const DAY_SHORT_LABELS: Record<DayKey, string> = {
  sun: 'Dom',
  mon: 'Seg',
  tue: 'Ter',
  wed: 'Qua',
  thu: 'Qui',
  fri: 'Sex',
  sat: 'Sáb',
};
const DEFAULT_WINDOW: HoursWindow = { start: '09:00', end: '18:00' };

function withDay(value: WeeklyHours, day: DayKey, windows: HoursWindow[]): WeeklyHours {
  const next = {} as WeeklyHours;
  for (const key of DAY_KEYS) next[key] = key === day ? windows : value[key];
  return next;
}

function cloneWindows(windows: HoursWindow[]): HoursWindow[] {
  return windows.map((window) => ({ ...window }));
}

function InlineTime({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-11 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-[16px] text-[var(--color-ink)] outline-none transition-colors focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20 disabled:opacity-50"
    />
  );
}

export function BusinessHoursEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: WeeklyHours;
  onChange: (value: WeeklyHours) => void;
  disabled?: boolean;
}) {
  function setDay(day: DayKey, windows: HoursWindow[]) {
    onChange(withDay(value, day, windows));
  }

  function setOpen(day: DayKey, open: boolean) {
    setDay(day, open ? (value[day].length > 0 ? value[day] : [{ ...DEFAULT_WINDOW }]) : []);
  }

  function updateWindow(day: DayKey, index: number, patch: Partial<HoursWindow>) {
    setDay(day, value[day].map((window, windowIndex) => (
      windowIndex === index ? { ...window, ...patch } : window
    )));
  }

  function applyToAll(day: DayKey) {
    const source = cloneWindows(value[day]);
    const next = {} as WeeklyHours;
    for (const key of DAY_KEYS) next[key] = cloneWindows(source);
    onChange(next);
  }

  function applyToWeekdays(day: DayKey) {
    const source = cloneWindows(value[day]);
    const next = {} as WeeklyHours;
    for (const key of DAY_KEYS) next[key] = WEEKDAY_KEYS.includes(key) ? cloneWindows(source) : value[key];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {DISPLAY_ORDER.map((day) => {
        const windows = value[day];
        const isOpen = windows.length > 0;
        return (
          <div key={day} className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-canvas)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--color-ink)]">{LABELS[day]}</p>
                <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{DAY_SHORT_LABELS[day]}</p>
              </div>
              <div className="inline-flex self-start overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setOpen(day, true)}
                  className={`min-h-11 px-4 text-xs font-semibold transition-colors ${isOpen ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)]'}`}
                >
                  Aberto
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setOpen(day, false)}
                  className={`min-h-11 px-4 text-xs font-semibold transition-colors ${!isOpen ? 'bg-[var(--color-alert)] text-white' : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)]'}`}
                >
                  Fechado
                </button>
              </div>
            </div>

            {!isOpen ? (
              <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-muted)]">Fechado o dia inteiro.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {windows.map((window, index) => (
                  <div key={`${day}-${index}`} className="flex flex-wrap items-center gap-2">
                    <InlineTime
                      value={window.start}
                      disabled={disabled}
                      label={`Início da faixa ${index + 1} de ${LABELS[day]}`}
                      onChange={(start) => updateWindow(day, index, { start })}
                    />
                    <span className="text-xs text-[var(--color-ink-muted)]">até</span>
                    <InlineTime
                      value={window.end}
                      disabled={disabled}
                      label={`Fim da faixa ${index + 1} de ${LABELS[day]}`}
                      onChange={(end) => updateWindow(day, index, { end })}
                    />
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setDay(day, windows.filter((_, windowIndex) => windowIndex !== index))}
                      aria-label={`Remover faixa ${index + 1} de ${LABELS[day]}`}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-alert)] disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setDay(day, [...windows, { ...DEFAULT_WINDOW }])}
                    className="inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-[var(--color-brand-deep)] hover:text-[var(--color-brand)] disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Adicionar faixa
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => applyToAll(day)}
                    className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-50"
                  >
                    <CopyPlus className="h-4 w-4" />
                    Aplicar a todos
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => applyToWeekdays(day)}
                    className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-50"
                  >
                    <CalendarDays className="h-4 w-4" />
                    Aplicar a seg–sex
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
