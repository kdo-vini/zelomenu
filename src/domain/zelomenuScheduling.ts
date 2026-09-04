/**
 * ZeloMenu scheduling domain logic — pure functions, no I/O.
 *
 * Resolves the earliest eligible pickup moment and validates a proposed
 * pickup date+time against the store's weekly windows, lead time, and timezone.
 */

import {
  type DayKey,
  type WeeklyHours,
  isMinuteWithinDay,
  isMinuteWithinWindow,
  minutesInTz,
  weekdayKeyInTz,
  windowStartMinutes,
  windowEndMinutes,
} from './businessHours';

export type SchedulingConfig = {
  enabled: boolean;
  leadTimeMinutes: number;
};

export type SchedulingValidation =
  | { ok: true; eligiblePickup: { date: string; time: string } }
  | { ok: false; reason: string; nextEligible: { date: string; time: string } | null };

// ─── Available slots (for constraint-based pickers) ───────────────────────

/**
 * Return the list of hours (0-23) that have at least one valid pickup minute
 * for the given day, plus the valid minutes for each such hour.
 *
 * @param minMinutes — earliest allowable minute (0-1439), typically from lead
 *        time on the current day. Pass 0 for future days.
 */
export function availablePickupSlots(
  weekly: WeeklyHours,
  dayKey: DayKey,
  minMinutes: number,
): { hours: number[]; minutesByHour: Record<number, number[]> } {
  const windows = weekly[dayKey];
  if (!windows || windows.length === 0) return { hours: [], minutesByHour: {} };

  const valid = new Set<number>();
  for (const w of windows) {
    const start = windowStartMinutes(w);
    const end = windowEndMinutes(w);
    if (start === null || end === null) continue;
    if (start <= end) {
      for (let m = Math.max(start, minMinutes); m < end; m++) valid.add(m);
    } else {
      for (let m = Math.max(start, minMinutes); m < 1440; m++) valid.add(m);
      for (let m = 0; m < end; m++) valid.add(m);
    }
  }

  const hours: number[] = [];
  const minutesByHour: Record<number, number[]> = {};
  for (const m of [...valid].sort((a, b) => a - b)) {
    const h = Math.floor(m / 60);
    if (!minutesByHour[h]) { hours.push(h); minutesByHour[h] = []; }
    minutesByHour[h].push(m % 60);
  }
  return { hours, minutesByHour };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function zonedKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

function zonedKeyFromCivil(pickupDate: string, pickupTime: string): string | null {
  const dm = pickupDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = pickupTime.match(/^(\d{2}):(\d{2})$/);
  if (!dm || !tm) return null;
  return `${dm[1]}${dm[2]}${dm[3]}${tm[1]}${tm[2]}00`;
}

function isBeforeLead(
  pickupDate: string,
  pickupTime: string,
  leadTimeMinutes: number,
  timezone: string,
  now: Date,
): boolean {
  const pickupKey = zonedKeyFromCivil(pickupDate, pickupTime);
  if (!pickupKey) return true;
  const leadDate = new Date(now.getTime() + leadTimeMinutes * 60_000);
  const leadKey = zonedKey(leadDate, timezone);
  return pickupKey < leadKey;
}

function civilDateInTz(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function civilTimeInTz(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const hourRaw = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const hour = hourRaw === 24 ? 0 : hourRaw;
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

function formatLeadTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

function portugueseDayName(dayKey: DayKey): string {
  const map: Record<DayKey, string> = {
    sun: 'aos domingos', mon: 'às segundas', tue: 'às terças',
    wed: 'às quartas', thu: 'às quintas', fri: 'às sextas', sat: 'aos sábados',
  };
  return map[dayKey] ?? 'neste dia';
}

export type PublicBusinessHoursAvailability = {
  configured?: boolean;
  openNow?: boolean;
};

/** Whether the public cart may select immediate fulfillment. */
export function canSelectAsap(
  cartOpen: boolean,
  businessHours?: PublicBusinessHoursAvailability | null,
): boolean {
  if (!cartOpen) return false;
  if (!businessHours || businessHours.configured !== true) return true;
  return businessHours.openNow === true;
}

/**
 * Derive a DayKey from a civil YYYY-MM-DD date safely.
 * Uses noon UTC so negative-offset timezones don't flip the day.
 */
function civilDayKey(pickupDate: string, timezone: string): DayKey | null {
  const m = pickupDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
  return weekdayKeyInTz(d, timezone);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve the earliest eligible pickup moment after lead time, scanning
 * forward through windows up to 14 days.
 */
export function resolveEarliestPickup(
  weekly: WeeklyHours,
  config: SchedulingConfig,
  timezone: string,
  now: Date,
): { date: string; time: string } {
  if (!config.enabled) {
    return { date: civilDateInTz(now, timezone), time: civilTimeInTz(now, timezone) };
  }

  const leadDate = new Date(now.getTime() + config.leadTimeMinutes * 60_000);

  for (let offset = 0; offset < 14; offset++) {
    const candidate = new Date(leadDate.getTime() + offset * 86_400_000);
    const cd = civilDateInTz(candidate, timezone);
    const dayKey = civilDayKey(cd, timezone);
    if (!dayKey) continue;
    const windows = weekly[dayKey];
    if (windows.length === 0) continue;

    // offset=0: use the actual wall-clock minute. offset>0: start of day,
    // because the previous day fell past its last window and the candidate
    // UTC time may still map to an hour past close on the new day too.
    const effectiveMinutes = offset === 0 ? minutesInTz(candidate, timezone) : 0;

    for (const w of windows) {
      const start = windowStartMinutes(w);
      const end = windowEndMinutes(w);
      if (start === null || end === null) continue;

      if (start <= end) {
        // Normal window
        if (effectiveMinutes < start) {
          const t = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
          return { date: cd, time: t };
        }
        if (isMinuteWithinWindow(effectiveMinutes, w)) {
          const t = `${String(Math.floor(effectiveMinutes / 60)).padStart(2, '0')}:${String(effectiveMinutes % 60).padStart(2, '0')}`;
          return { date: cd, time: t };
        }
      } else {
        // Overnight window (e.g., 22:00–02:00)
        if (isMinuteWithinWindow(effectiveMinutes, w)) {
          const t = `${String(Math.floor(effectiveMinutes / 60)).padStart(2, '0')}:${String(effectiveMinutes % 60).padStart(2, '0')}`;
          return { date: cd, time: t };
        }
        // Gap between overnight end and start → jump to start
        if (effectiveMinutes < start && (end === null || effectiveMinutes >= end)) {
          const t = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
          return { date: cd, time: t };
        }
      }
    }
  }

  return { date: civilDateInTz(leadDate, timezone), time: civilTimeInTz(leadDate, timezone) };
}

/**
 * Validate a proposed pickup date+time against the store's schedule.
 * When scheduling is disabled, rejects with a clear reason.
 */
export function validateScheduling(
  weekly: WeeklyHours,
  config: SchedulingConfig,
  timezone: string,
  pickupDate: string,
  pickupTime: string,
  now: Date,
): SchedulingValidation {
  const dm = pickupDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = pickupTime.match(/^(\d{2}):(\d{2})$/);
  if (!dm || !tm) {
    return { ok: false, reason: 'Data ou horário inválidos.', nextEligible: null };
  }

  const pickupYear = Number(dm[1]);
  const pickupMonth = Number(dm[2]);
  const pickupDay = Number(dm[3]);
  const pickupHour = Number(tm[1]);
  const pickupMinuteVal = Number(tm[2]);

  if (pickupHour > 23 || pickupMinuteVal > 59) {
    return { ok: false, reason: 'Horário inválido.', nextEligible: null };
  }

  // Validate date is real using noon UTC to avoid timezone edge cases
  const dateObj = new Date(Date.UTC(pickupYear, pickupMonth - 1, pickupDay, 12, 0, 0));
  if (dateObj.getUTCFullYear() !== pickupYear || dateObj.getUTCMonth() !== pickupMonth - 1 || dateObj.getUTCDate() !== pickupDay) {
    return { ok: false, reason: 'Data inválida.', nextEligible: null };
  }

  const pickupMinutes = pickupHour * 60 + pickupMinuteVal;
  const dayKey = civilDayKey(pickupDate, timezone);
  if (!dayKey) {
    return { ok: false, reason: 'Data inválida.', nextEligible: null };
  }

  // Scheduling disabled → reject
  if (!config.enabled) {
    return { ok: false, reason: 'Agendamento não está disponível para esta loja.', nextEligible: null };
  }

  // Lead time check
  if (isBeforeLead(pickupDate, pickupTime, config.leadTimeMinutes, timezone, now)) {
    const nextEligible = resolveEarliestPickup(weekly, config, timezone, now);
    return {
      ok: false,
      reason: `Este horário precisa ter pelo menos ${formatLeadTime(config.leadTimeMinutes)} de antecedência.`,
      nextEligible,
    };
  }

  // Day must have windows
  const windows = weekly[dayKey];
  if (!windows || windows.length === 0) {
    const nextEligible = resolveEarliestPickup(weekly, config, timezone, now);
    return {
      ok: false,
      reason: `A loja não funciona ${portugueseDayName(dayKey)}.`,
      nextEligible,
    };
  }

  // Minute must be within a window
  const inWindow = isMinuteWithinDay(weekly, dayKey, pickupMinutes);
  if (!inWindow) {
    const nextEligible = resolveEarliestPickup(weekly, config, timezone, now);
    const windowsStr = windows.map((w) => `${w.start}–${w.end}`).join(' e ');
    return {
      ok: false,
      reason: `Horário fora do funcionamento da loja neste dia (${windowsStr}).`,
      nextEligible,
    };
  }

  return { ok: true, eligiblePickup: { date: pickupDate, time: pickupTime } };
}
