import { describe, expect, it } from 'vitest';
import {
  CLOSED_DAY_LABELS,
  deriveWeeklyFromLegacy,
  formatNextOpenDay,
  hasAnyOpenWindow,
  isValidWeeklyWindow,
  isMinuteWithinDay,
  isOpenAt,
  normalizeWeeklyHours,
  normalizeWeeklyHoursForWrite,
  type WeeklyHours,
} from './businessHours';

const H = (start: string, end: string) => ({ start, end });

// Loja almoço + jantar na segunda; sábado até meia-noite; domingo fechado.
const LUNCH_DINNER: WeeklyHours = {
  sun: [],
  mon: [H('11:00', '14:00'), H('18:00', '23:00')],
  tue: [H('11:00', '14:00'), H('18:00', '23:00')],
  wed: [H('11:00', '14:00'), H('18:00', '23:00')],
  thu: [H('11:00', '14:00'), H('18:00', '23:00')],
  fri: [H('11:00', '14:00'), H('18:00', '23:00')],
  sat: [H('18:00', '00:00')],
};

describe('businessHours — normalize', () => {
  it('returns null for non-object / array input (caller falls back to legacy)', () => {
    expect(normalizeWeeklyHours(null)).toBeNull();
    expect(normalizeWeeklyHours(undefined)).toBeNull();
    expect(normalizeWeeklyHours([])).toBeNull();
    expect(normalizeWeeklyHours('x')).toBeNull();
  });

  it('tolerates a malformed day value without throwing', () => {
    expect(normalizeWeeklyHours({ mon: null })).toEqual({
      sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [],
    });
  });

  it('parses valid weekly shape and keeps empty days closed', () => {
    const weekly = normalizeWeeklyHours({
      mon: [{ start: '11:00', end: '14:00' }, { start: '18:00', end: '23:00' }],
      sun: [],
    });
    expect(weekly).not.toBeNull();
    expect(weekly!.mon).toHaveLength(2);
    expect(weekly!.sun).toHaveLength(0);
    expect(hasAnyOpenWindow(weekly!)).toBe(true);
  });
});

describe('businessHours — write validation', () => {
  it('accepts 00:00–00:00 as a 24-hour window', () => {
    expect(isValidWeeklyWindow(H('00:00', '00:00'))).toBe(true);
    expect(normalizeWeeklyHoursForWrite({
      sun: [H('00:00', '00:00')],
      mon: [], tue: [], wed: [], thu: [], fri: [], sat: [],
    })?.sun).toEqual([H('00:00', '00:00')]);
  });

  it('rejects equal non-midnight times and malformed windows instead of filtering them', () => {
    expect(isValidWeeklyWindow(H('09:00', '09:00'))).toBe(false);
    expect(normalizeWeeklyHoursForWrite({
      sun: [], mon: [{ start: 9, end: '18:00' }], tue: [], wed: [], thu: [], fri: [], sat: [],
    })).toBeNull();
    expect(normalizeWeeklyHoursForWrite({
      sun: [], mon: [H('09:00', '09:00')], tue: [], wed: [], thu: [], fri: [], sat: [],
    })).toBeNull();
  });

  it('requires all seven day lists in a write payload', () => {
    expect(normalizeWeeklyHoursForWrite({ mon: [] })).toBeNull();
  });
});

describe('businessHours — isMinuteWithinDay (scheduled pickup)', () => {
  it('accepts a minute inside either window', () => {
    expect(isMinuteWithinDay(LUNCH_DINNER, 'mon', 12 * 60)).toBe(true); // lunch
    expect(isMinuteWithinDay(LUNCH_DINNER, 'mon', 19 * 60)).toBe(true); // dinner
  });

  it('REJECTS a minute that lands in the lunch→dinner gap', () => {
    // 15:30 is between the two windows — single-window logic would wrongly allow it.
    expect(isMinuteWithinDay(LUNCH_DINNER, 'mon', 15 * 60 + 30)).toBe(false);
    expect(isMinuteWithinDay(LUNCH_DINNER, 'mon', 16 * 60)).toBe(false);
  });

  it('rejects any minute on a closed day', () => {
    expect(isMinuteWithinDay(LUNCH_DINNER, 'sun', 12 * 60)).toBe(false);
  });

  it('treats window end 00:00 as midnight/end-of-day', () => {
    expect(isMinuteWithinDay(LUNCH_DINNER, 'sat', 23 * 60 + 59)).toBe(true);
    expect(isMinuteWithinDay(LUNCH_DINNER, 'sat', 17 * 60)).toBe(false);
  });
});

describe('businessHours — isOpenAt (ASAP)', () => {
  const tz = 'America/Sao_Paulo';
  // 2026-07-20 is a Monday.
  it('open during a window', () => {
    // 12:00 local (Sao Paulo is UTC-3) → 15:00Z
    expect(isOpenAt(LUNCH_DINNER, new Date('2026-07-20T15:00:00Z'), tz).open).toBe(true);
  });
  it('closed in the gap between windows', () => {
    // 15:30 local → 18:30Z
    expect(isOpenAt(LUNCH_DINNER, new Date('2026-07-20T18:30:00Z'), tz).open).toBe(false);
  });
  it('closed on an empty day', () => {
    // Sunday 2026-07-19 12:00 local → 15:00Z
    expect(isOpenAt(LUNCH_DINNER, new Date('2026-07-19T15:00:00Z'), tz).open).toBe(false);
  });
});

describe('businessHours — next opening label', () => {
  const tz = 'America/Sao_Paulo';
  const friday = new Date('2026-07-24T15:00:00Z');

  it('uses relative labels for today and tomorrow, otherwise the weekday name', () => {
    expect(formatNextOpenDay('sexta', tz, friday)).toBe('hoje');
    expect(formatNextOpenDay('sábado', tz, friday)).toBe('amanhã');
    expect(formatNextOpenDay('domingo', tz, friday)).toBe('domingo');
  });
});

describe('businessHours — deriveWeeklyFromLegacy (single-window fidelity)', () => {
  it('produces one window per open day and marks closed days empty', () => {
    const weekly = deriveWeeklyFromLegacy('09:00', '18:00', ['Dom']);
    expect(weekly.sun).toHaveLength(0);
    expect(weekly.mon).toEqual([{ start: '09:00', end: '18:00' }]);
    // Single-window: no gap, so any minute in the window is accepted.
    expect(isMinuteWithinDay(weekly, 'mon', 12 * 60)).toBe(true);
    expect(isMinuteWithinDay(weekly, 'mon', 19 * 60)).toBe(false);
  });

  it('all days empty when there is no valid legacy window', () => {
    const weekly = deriveWeeklyFromLegacy(null, null, null);
    expect(hasAnyOpenWindow(weekly)).toBe(false);
  });

  it('uses the exact PT labels for closed days', () => {
    expect(CLOSED_DAY_LABELS).toEqual({
      sun: 'Dom', mon: 'Seg', tue: 'Ter', wed: 'Qua', thu: 'Qui', fri: 'Sex', sat: 'Sáb',
    });
  });
});
