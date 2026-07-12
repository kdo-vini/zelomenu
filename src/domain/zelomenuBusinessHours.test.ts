import { describe, expect, it } from 'vitest';
import {
  businessDayLabel,
  isBusinessWindowOpen,
  isPickupInPast,
  parseBusinessTime,
} from './zelomenuBusinessHours';

describe('zelomenuBusinessHours', () => {
  it('parses valid times and rejects invalid values', () => {
    expect(parseBusinessTime('9:05')).toBe(545);
    expect(parseBusinessTime('23:59')).toBe(1439);
    expect(parseBusinessTime('24:00')).toBeNull();
    expect(parseBusinessTime('10:60')).toBeNull();
  });

  it('supports regular and overnight windows', () => {
    expect(isBusinessWindowOpen(12 * 60, 9 * 60, 18 * 60)).toBe(true);
    expect(isBusinessWindowOpen(21 * 60, 22 * 60, 2 * 60)).toBe(false);
    expect(isBusinessWindowOpen(23 * 60, 22 * 60, 2 * 60)).toBe(true);
    expect(isBusinessWindowOpen(60, 22 * 60, 2 * 60)).toBe(true);
  });

  it('compares civil pickup time in the store timezone', () => {
    const now = new Date('2026-07-13T14:00:00.000Z');
    expect(isPickupInPast('2026-07-13', '12:00', 'America/Sao_Paulo', now)).toBe(false);
    expect(isPickupInPast('2026-07-13', '10:00', 'America/Sao_Paulo', now)).toBe(true);
    expect(isPickupInPast('2026-07-13', '11:00', 'America/Sao_Paulo', new Date('2026-07-13T14:00:01.000Z'))).toBe(true);
    expect(isPickupInPast('2026-07-13', '10:30', 'America/Manaus', now)).toBe(false);
    expect(isPickupInPast('2026-07-12', '23:59', 'America/Sao_Paulo', now)).toBe(true);
  });

  it('derives weekday from the selected civil date', () => {
    expect(businessDayLabel('2026-07-12')).toBe('Dom');
    expect(businessDayLabel('2026-07-13')).toBe('Seg');
    expect(businessDayLabel('2026-02-30')).toBeNull();
  });
});
