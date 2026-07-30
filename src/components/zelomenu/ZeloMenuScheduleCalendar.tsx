/**
 * ZeloMenu monthly schedule calendar — self-contained, no external calendar libs.
 *
 * Renders a month grid (Dom..Sáb) with:
 *  - Navigation limited to first eligible date and 90 days ahead
 *  - Past dates blocked (disabled)
 *  - Days with no store windows shown as × and not selectable
 *  - Today / selected / focus states with Zelo brand tokens
 *  - Touch targets ≥44px, aria labels
 *
 * ponytail: all-in-one file, no calendar lib import. Swap if localization
 * or date-picker scope grows beyond a single view.
 */

import { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

type Props = {
  /** YYYY-MM-DD currently selected, or '' for none */
  value: string;
  /** Called when user taps a valid day */
  onChange: (date: string) => void;
  /** YYYY-MM-DD — min allowed (typically today) */
  minDate: string;
  /** Max date offset in days from today */
  maxDaysAhead: number;
  /** Callback: given a YYYY-MM-DD, return true if store has windows open that day */
  isDayOpen: (date: string) => boolean;
  /** Store's timezone (for determining today's civil date) */
  timezone: string;
  /** ID for aria-labelledby / describedby */
  id?: string;
};

/**
 * Civil date (YYYY-MM-DD) for "now" in the given timezone.
 */
function civilToday(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parseDate(iso: string): { y: number; m: number; d: number } | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function isoDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function firstWeekday(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

function compareIso(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function ZeloMenuScheduleCalendar({
  value,
  onChange,
  minDate,
  maxDaysAhead,
  isDayOpen,
  timezone,
  id,
}: Props) {
  const today = useMemo(() => civilToday(timezone), [timezone]);

  const maxDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + maxDaysAhead);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }, [maxDaysAhead, timezone]);

  // Derive min month to navigate to: the month of minDate
  const minMonth = useMemo(() => {
    const p = parseDate(minDate);
    return p ? { y: p.y, m: p.m } : { y: 2024, m: 1 };
  }, [minDate]);

  const maxMonth = useMemo(() => {
    const p = parseDate(maxDate);
    return p ? { y: p.y, m: p.m } : { y: 2027, m: 1 };
  }, [maxDate]);

  const [viewMonth, setViewMonth] = useState(() => {
    const p = parseDate(value) || parseDate(today) || { y: 2024, m: 1 };
    return { y: p.y, m: p.m };
  });

  const goPrev = useCallback(() => {
    setViewMonth((prev) => {
      const m = prev.m === 1 ? 12 : prev.m - 1;
      const y = prev.m === 1 ? prev.y - 1 : prev.y;
      // Block navigation before minMonth
      if (y < minMonth.y || (y === minMonth.y && m < minMonth.m)) return prev;
      return { y, m };
    });
  }, [minMonth]);

  const goNext = useCallback(() => {
    setViewMonth((prev) => {
      const m = prev.m === 12 ? 1 : prev.m + 1;
      const y = prev.m === 12 ? prev.y + 1 : prev.y;
      if (y > maxMonth.y || (y === maxMonth.y && m > maxMonth.m)) return prev;
      return { y, m };
    });
  }, [maxMonth]);

  const days = useMemo(() => {
    const total = daysInMonth(viewMonth.y, viewMonth.m);
    const startDay = firstWeekday(viewMonth.y, viewMonth.m);
    const cells: Array<{ date: string; day: number; disabled: boolean; closed: boolean; isToday: boolean; isSelected: boolean; isOtherMonth: boolean }> = [];
    // Pad previous month
    const prevTotal = daysInMonth(viewMonth.m === 1 ? viewMonth.y - 1 : viewMonth.y, viewMonth.m === 1 ? 12 : viewMonth.m - 1);
    for (let i = startDay - 1; i >= 0; i--) {
      const d = prevTotal - i;
      const m = viewMonth.m === 1 ? 12 : viewMonth.m - 1;
      const y = viewMonth.m === 1 ? viewMonth.y - 1 : viewMonth.y;
      const date = isoDate(y, m, d);
      cells.push({ date, day: d, disabled: true, closed: false, isToday: false, isSelected: false, isOtherMonth: true });
    }
    for (let d = 1; d <= total; d++) {
      const date = isoDate(viewMonth.y, viewMonth.m, d);
      const isPast = compareIso(date, minDate) < 0;
      const isBeyond = compareIso(date, maxDate) > 0;
      const open = isDayOpen(date);
      const disabled = isPast || isBeyond || !open;
      const closed = !open && !isPast && !isBeyond;
      cells.push({
        date,
        day: d,
        disabled,
        closed,
        isToday: date === today,
        isSelected: date === value,
        isOtherMonth: false,
      });
    }
    // Pad next month to fill grid (always 6 rows = 42 cells)
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const m = viewMonth.m === 12 ? 1 : viewMonth.m + 1;
      const y = viewMonth.m === 12 ? viewMonth.y + 1 : viewMonth.y;
      const date = isoDate(y, m, d);
      cells.push({ date, day: d, disabled: true, closed: false, isToday: false, isSelected: false, isOtherMonth: true });
    }
    return cells;
  }, [viewMonth, minDate, maxDate, today, value, isDayOpen]);

  const canGoPrev = viewMonth.y > minMonth.y || (viewMonth.y === minMonth.y && viewMonth.m > minMonth.m);
  const canGoNext = viewMonth.y < maxMonth.y || (viewMonth.y === maxMonth.y && viewMonth.m < maxMonth.m);

  return (
    <div id={id} className="w-full" role="group" aria-label="Calendário de agendamento">
      {/* Month navigation */}
      <div className="flex items-center justify-between px-1 pb-2">
        <button
          type="button"
          onClick={goPrev}
          disabled={!canGoPrev}
          aria-label="Mês anterior"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--zm-ink-soft)] transition-colors hover:bg-[var(--zm-brand-soft)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
        </button>
        <span className="text-[14px] font-semibold text-[var(--zm-ink)]">
          {new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(viewMonth.y, viewMonth.m - 1, 1)))}
          {' '}
          {viewMonth.y}
        </span>
        <button
          type="button"
          onClick={goNext}
          disabled={!canGoNext}
          aria-label="Próximo mês"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--zm-ink-soft)] transition-colors hover:bg-[var(--zm-brand-soft)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" strokeWidth={1.8} />
        </button>
      </div>

      {/* Day headers */}
      <div className="mb-1 grid grid-cols-7">
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="flex h-9 items-center justify-center text-[11px] font-semibold uppercase tracking-wide text-[var(--zm-ink-soft)]">
            {wd}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {days.map((cell) => (
          <button
            key={cell.date}
            type="button"
            disabled={cell.disabled || cell.isOtherMonth}
            onClick={() => { if (!cell.disabled) onChange(cell.date); }}
            aria-label={
              cell.closed
                ? `${cell.day} — fechado`
                : cell.isSelected
                  ? `${cell.day} — selecionado`
                  : String(cell.day)
            }
            aria-selected={cell.isSelected}
            aria-disabled={cell.disabled}
            className={`
              relative flex h-11 w-full items-center justify-center text-[13px] font-medium transition-colors
              ${cell.isOtherMonth ? 'text-transparent' : ''}
              ${cell.disabled && !cell.isOtherMonth ? 'cursor-not-allowed' : ''}
              ${cell.isSelected
                ? 'bg-[var(--zm-brand)] text-white font-bold'
                : cell.isToday && !cell.closed
                  ? 'text-[var(--zm-brand)]'
                  : cell.closed
                    ? 'text-[var(--zm-line-strong)]'
                    : cell.disabled
                      ? 'text-[var(--zm-line-strong)]'
                      : 'text-[var(--zm-ink)] hover:bg-[var(--zm-brand-soft)]'
              }
              focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-[var(--zm-brand)] focus-visible:ring-inset
              ${cell.isSelected ? 'rounded-lg' : cell.isToday ? 'font-bold' : ''}
            `}
          >
            {cell.closed ? (
              <span className="text-[15px]" aria-hidden="true">×</span>
            ) : (
              cell.day
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
