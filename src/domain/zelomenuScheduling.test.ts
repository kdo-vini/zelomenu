import { describe, expect, it } from 'vitest';
import {
  resolveEarliestPickup,
  validateScheduling,
  availablePickupSlots,
  type SchedulingConfig,
} from './zelomenuScheduling';
import type { WeeklyHours } from './businessHours';

// A store open Mon–Fri 08:00–12:00 and 14:00–18:00, Sat 08:00–12:00, Sun closed
const STORE_TZ = 'America/Sao_Paulo';
const WEEKLY: WeeklyHours = {
  sun: [],
  mon: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
  tue: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
  wed: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
  thu: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
  fri: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
  sat: [{ start: '08:00', end: '12:00' }],
};

function cfg(overrides?: Partial<SchedulingConfig>): SchedulingConfig {
  return { enabled: true, leadTimeMinutes: 60, ...overrides };
}

describe('zelomenuScheduling', () => {
  describe('resolveEarliestPickup', () => {
    it('returns current time when scheduling is disabled', () => {
      const now = new Date('2026-07-15T10:30:00.000Z'); // Wed 07:30 BRT
      const result = resolveEarliestPickup(WEEKLY, cfg({ enabled: false }), STORE_TZ, now);
      expect(result).toEqual({ date: '2026-07-15', time: '07:30' });
    });

    it('returns earliest after lead time when within a window', () => {
      // Wed 2026-07-15 09:00 BRT, lead 60min → eligible at 10:00 which is inside 08-12 window
      const now = new Date('2026-07-15T12:00:00.000Z'); // 09:00 BRT
      const result = resolveEarliestPickup(WEEKLY, cfg(), STORE_TZ, now);
      // 09:00 + 60min = 10:00 BRT, inside 08-12 window
      expect(result.date).toBe('2026-07-15');
      expect(result.time).toBe('10:00');
    });

    it('advances to next window when lead time crosses the lunch gap', () => {
      // Wed 2026-07-15 at 11:30 BRT = 14:30Z, lead 60min → eligible 12:30 which falls in gap (12-14)
      // So next eligible is 14:00 (afternoon window opens)
      const now = new Date('2026-07-15T14:30:00.000Z'); // 11:30 BRT
      const result = resolveEarliestPickup(WEEKLY, cfg(), STORE_TZ, now);
      expect(result.date).toBe('2026-07-15');
      expect(result.time).toBe('14:00');
    });

    it('advances to next day when lead time falls after close', () => {
      // Wed 2026-07-15 at 17:30 BRT = 20:30Z, lead 60min → 18:30, after 18:00 close
      // Next day Thu opens at 08:00
      const now = new Date('2026-07-15T20:30:00.000Z'); // 17:30 BRT
      const result = resolveEarliestPickup(WEEKLY, cfg(), STORE_TZ, now);
      expect(result.date).toBe('2026-07-16');
      expect(result.time).toBe('08:00');
    });

    it('skips closed days (Sunday)', () => {
      // Sat 2026-07-18 at 11:00 BRT, lead 60min → 12:00, Sat closes at 12:00 but may be exactly 12:00
      // Actually Sat 08-12, eligible at 12:00 which is exactly close → allowed (inclusive)
      // But let's test: Sat 11:59, lead 60 → 12:59, past Sat close → next Mon 08:00
      const now = new Date('2026-07-18T14:59:00.000Z'); // Sat 11:59 BRT
      const result = resolveEarliestPickup(WEEKLY, cfg(), STORE_TZ, now);
      expect(result.date).toBe('2026-07-20'); // Monday
      expect(result.time).toBe('08:00');
    });

    it('returns current moment with 0 lead time', () => {
      const now = new Date('2026-07-15T13:00:00.000Z'); // Wed 10:00 BRT
      const result = resolveEarliestPickup(WEEKLY, cfg({ leadTimeMinutes: 0 }), STORE_TZ, now);
      expect(result.date).toBe('2026-07-15');
      expect(result.time).toBe('10:00');
    });

    it('handles exact minute at 00:00 window edge', () => {
      // A window starting at 00:00 (24h)
      const allDay: WeeklyHours = {
        sun: [{ start: '00:00', end: '00:00' }],
        mon: [{ start: '00:00', end: '00:00' }],
        tue: [{ start: '00:00', end: '00:00' }],
        wed: [{ start: '00:00', end: '00:00' }],
        thu: [{ start: '00:00', end: '00:00' }],
        fri: [{ start: '00:00', end: '00:00' }],
        sat: [{ start: '00:00', end: '00:00' }],
      };
      const now = new Date('2026-07-15T10:00:00.000Z'); // 07:00 BRT
      const result = resolveEarliestPickup(allDay, cfg({ leadTimeMinutes: 0 }), STORE_TZ, now);
      expect(result.date).toBe('2026-07-15');
      expect(result.time).toBe('07:00');
    });
  });

  describe('validateScheduling', () => {
    it('rejects when scheduling is disabled', () => {
      const result = validateScheduling(WEEKLY, cfg({ enabled: false }), STORE_TZ, '2026-07-15', '10:00', new Date());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('não está disponível');
    });

    it('validates a valid pickup inside window with lead time met', () => {
      // Wed 2026-07-15 at 10:00 BRT = 13:00Z, lead 60min → eligible 11:00, given 11:30 is fine
      const now = new Date('2026-07-15T13:00:00.000Z');
      const result = validateScheduling(WEEKLY, cfg(), STORE_TZ, '2026-07-15', '11:30', now);
      expect(result.ok).toBe(true);
    });

    it('rejects when lead time is not met', () => {
      // Wed 2026-07-15 at 10:45 BRT = 13:45Z, lead 60min → eligible 11:45, given 11:00 is too soon
      const now = new Date('2026-07-15T13:45:00.000Z');
      const result = validateScheduling(WEEKLY, cfg(), STORE_TZ, '2026-07-15', '11:00', now);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain('antecedência');
        expect(result.nextEligible).not.toBeNull();
      }
    });

    it('rejects when day is closed', () => {
      const now = new Date('2026-07-15T10:00:00.000Z'); // Wed, any time
      const result = validateScheduling(WEEKLY, cfg(), STORE_TZ, '2026-07-19', '10:00', now); // Sunday
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain('domingos');
        expect(result.nextEligible).not.toBeNull();
      }
    });

    it('rejects time outside windows (lunch gap)', () => {
      const now = new Date('2026-07-15T10:00:00.000Z'); // Wed 07:00 BRT
      const result = validateScheduling(WEEKLY, cfg({ leadTimeMinutes: 0 }), STORE_TZ, '2026-07-15', '13:00', now); // lunch gap
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain('fora do funcionamento');
      }
    });

    it('rejects invalid date format', () => {
      const result = validateScheduling(WEEKLY, cfg(), STORE_TZ, 'not-a-date', '10:00', new Date());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('inválido');
    });

    it('rejects invalid time format', () => {
      const result = validateScheduling(WEEKLY, cfg(), STORE_TZ, '2026-07-15', '25:00', new Date());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('inválido');
    });

    it('accepts pickup with sufficient lead time before window close', () => {
      // Wed 2026-07-15 at 16:00 BRT, lead 60min → eligible 17:00
      // 17:30 is 90min later → lead time met, inside 14-18 window → accept
      const now = new Date('2026-07-15T19:00:00.000Z'); // 16:00 BRT
      const result = validateScheduling(WEEKLY, cfg(), STORE_TZ, '2026-07-15', '17:30', now);
      expect(result.ok).toBe(true);
    });

    it('accepts exact midnight edge (00:00)', () => {
      const midnight: WeeklyHours = {
        sun: [{ start: '00:00', end: '00:00' }],
        mon: [{ start: '00:00', end: '00:00' }],
        tue: [{ start: '00:00', end: '00:00' }],
        wed: [{ start: '00:00', end: '00:00' }],
        thu: [{ start: '00:00', end: '00:00' }],
        fri: [{ start: '00:00', end: '00:00' }],
        sat: [{ start: '00:00', end: '00:00' }],
      };
      const now = new Date('2026-07-15T02:00:00.000Z'); // 2026-07-14 23:00 BRT
      const result = validateScheduling(midnight, cfg({ leadTimeMinutes: 0 }), STORE_TZ, '2026-07-15', '00:00', now);
      expect(result.ok).toBe(true);
    });

    it('rejects date before earliest eligible (closed today, future day but before lead)', () => {
      // Saturday 2026-07-18 at 11:59 BRT, lead 60 → eligible 12:59 which is past Sat close
      // Mon 08:00 is the first eligible. Trying Sun (closed) or Sat (past close) must reject.
      const now = new Date('2026-07-18T14:59:00.000Z'); // Sat 11:59 BRT
      const r1 = validateScheduling(WEEKLY, cfg(), STORE_TZ, '2026-07-19', '10:00', now); // Sunday
      expect(r1.ok).toBe(false);
      if (!r1.ok) {
        expect(r1.reason).toContain('domingos');
        expect(r1.nextEligible).toEqual({ date: '2026-07-20', time: '08:00' });
      }
    });

    it('resolves earliest across multiple closed days', () => {
      // Saturday 2026-07-18 at 23:00 BRT, lead 60 → Sun 00:00 (closed), Mon 08:00
      const now = new Date('2026-07-19T02:00:00.000Z'); // Sat 23:00 BRT
      const result = resolveEarliestPickup(WEEKLY, cfg(), STORE_TZ, now);
      expect(result.date).toBe('2026-07-20');
      expect(result.time).toBe('08:00');
    });

    it('rejects time before lead on a future open day', () => {
      // Mon 2026-07-20 at 07:30 BRT, lead 60 → eligible 08:30
      // Pick Mon 08:00 → within window (08-12) but only 30min lead → reject
      const now = new Date('2026-07-20T10:30:00.000Z'); // Mon 07:30 BRT
      const result = validateScheduling(WEEKLY, cfg(), STORE_TZ, '2026-07-20', '08:00', now);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain('antecedência');
        expect(result.nextEligible).toEqual({ date: '2026-07-20', time: '08:30' });
      }
    });
  });

  describe('availablePickupSlots', () => {
    it('returns hours and minutes for a single window', () => {
      const r = availablePickupSlots(WEEKLY, 'mon', 0);
      expect(r.hours).toEqual([8, 9, 10, 11, 14, 15, 16, 17]);
      // Hour 8 has minutes 0-59
      expect(r.minutesByHour[8]).toHaveLength(60);
      expect(r.minutesByHour[8]![0]).toBe(0);
      expect(r.minutesByHour[8]![59]).toBe(59);
      // Hour 11 has minutes 0-59 (12:00 = 720, end of window, exclusive)
      expect(r.minutesByHour[11]).toHaveLength(60);
      // Hour 14 has minutes 0-59
      expect(r.minutesByHour[14]).toHaveLength(60);
      // Hour 17 has minutes 0-59 (18:00 = 1080, exclusive)
      expect(r.minutesByHour[17]).toHaveLength(60);
      // No hour 12 or 18
      expect(r.minutesByHour[12]).toBeUndefined();
      expect(r.minutesByHour[18]).toBeUndefined();
    });

    it('respects minMinutes cutoff within a window', () => {
      // minMinutes = 570 = 09:30, so 08:00-09:29 excluded
      const r = availablePickupSlots(WEEKLY, 'mon', 570);
      expect(r.hours).toEqual([9, 10, 11, 14, 15, 16, 17]);
      // Hour 9 starts from minute 30
      expect(r.minutesByHour[9]![0]).toBe(30);
      expect(r.minutesByHour[9]).toHaveLength(30);
    });

    it('returns empty for a closed day', () => {
      const r = availablePickupSlots(WEEKLY, 'sun', 0);
      expect(r.hours).toEqual([]);
      expect(r.minutesByHour).toEqual({});
    });

    it('handles overnight window', () => {
      const overnight: WeeklyHours = {
        sun: [], mon: [{ start: '22:00', end: '02:00' }], tue: [], wed: [],
        thu: [], fri: [], sat: [],
      };
      const r = availablePickupSlots(overnight, 'mon', 0);
      expect(r.hours).toEqual([0, 1, 22, 23]);
      expect(r.minutesByHour[0]).toHaveLength(60); // 00:00-00:59
      expect(r.minutesByHour[1]).toHaveLength(60); // 01:00-01:59
      expect(r.minutesByHour[22]).toHaveLength(60); // 22:00-22:59
      expect(r.minutesByHour[23]).toHaveLength(60); // 23:00-23:59
    });
  });
});
