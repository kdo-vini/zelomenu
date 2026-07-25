import { describe, expect, it } from 'vitest';
import {
  buildGeocodingProviderConfigs,
  buildNominatimUrl,
  buildOsrmUrl,
  buildBrasilApiCepUrl,
  matchDeliveryRange,
  normalizePostalCode,
  minuteInPricingInterval,
  findActiveDeliveryPricingRule,
  resolveDeliveryPrice,
  validateDeliveryPricingRules,
  formatPricingWindowLabel,
  pricingIntervalSegments,
  normalizeDeliveryPricingRule,
  getLocalDateTimeParts,
  getLocalDateTimePartsFromCivil,
} from './zelomenuDelivery';

describe('delivery distance domain', () => {
  it('normalizes postal codes and matches the first covering range', () => {
    expect(normalizePostalCode('16370-000')).toBe('16370000');
    expect(matchDeliveryRange({
      distanceM: 3_500,
      ranges: [{ maxDistanceM: 2_000, price: 5 }, { maxDistanceM: 4_000, price: 8 }],
    })).toMatchObject({ matched: true, fee: 8 });
  });

  it('matches the first range when the route distance is zero', () => {
    expect(matchDeliveryRange({
      distanceM: 0,
      ranges: [{ maxDistanceM: 1_000, price: 3 }],
    })).toMatchObject({ matched: true, fee: 3 });
  });

  it('builds BrasilAPI CEP URL correctly', () => {
    expect(buildBrasilApiCepUrl('16370000')).toBe('https://brasilapi.com.br/api/cep/v1/16370000');
  });

  it('keeps ArcGIS as the default geocoding fallback', () => {
    expect(buildGeocodingProviderConfigs()).toEqual([
      { kind: 'nominatim', base: 'https://nominatim.openstreetmap.org' },
      { kind: 'arcgis', base: 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer' },
    ]);
  });

  it('allows deployments to override the geocoding fallback', () => {
    expect(buildGeocodingProviderConfigs({
      fallbackKind: 'internal',
      fallbackBase: 'https://geo.internal',
    })[1]).toEqual({ kind: 'internal', base: 'https://geo.internal' });
  });

  it('supports provider fallback bases without changing the query contract', () => {
    const address = {
      postalCode: '16370000', number: '123', complement: null,
      street: 'Rua XV de Novembro', neighborhood: 'Centro', city: 'Promissão', state: 'SP',
    };
    expect(buildNominatimUrl(address, 'https://geo.internal')).toContain('https://geo.internal/search?');
    expect(buildOsrmUrl({ latitude: -21.5, longitude: -49.8 }, { latitude: -21.6, longitude: -49.9 }, 'https://route.internal'))
      .toContain('https://route.internal/route/v1/driving/');
  });
});

describe('minuteInPricingInterval', () => {
  it('returns true for minutes inside a normal interval', () => {
    expect(minuteInPricingInterval(480, 1080, 840)).toBe(true);
  });

  it('returns false for minutes outside a normal interval', () => {
    expect(minuteInPricingInterval(480, 1080, 1200)).toBe(false);
  });

  it('includes the start minute', () => {
    expect(minuteInPricingInterval(480, 1080, 480)).toBe(true);
  });

  it('excludes the end minute', () => {
    expect(minuteInPricingInterval(480, 1080, 1080)).toBe(false);
  });

  it('handles midnight crossing intervals (20:00-02:00)', () => {
    // 20:00 = 1200 inside, 02:00 = 120 outside
    expect(minuteInPricingInterval(1200, 120, 1200)).toBe(true);
    expect(minuteInPricingInterval(1200, 120, 1250)).toBe(true);
    expect(minuteInPricingInterval(1200, 120, 60)).toBe(true);
    expect(minuteInPricingInterval(1200, 120, 120)).toBe(false);
    expect(minuteInPricingInterval(1200, 120, 480)).toBe(false);
  });

  it('returns false when start equals end', () => {
    expect(minuteInPricingInterval(600, 600, 600)).toBe(false);
  });

  it('handles full day 00:00-24:00', () => {
    expect(minuteInPricingInterval(0, 1440, 0)).toBe(true);
    expect(minuteInPricingInterval(0, 1440, 1439)).toBe(true);
    expect(minuteInPricingInterval(0, 1440, 1440)).toBe(false);
  });
});

describe('findActiveDeliveryPricingRule', () => {
  const rule = (overrides = {}): Parameters<typeof findActiveDeliveryPricingRule>[0][number] => ({
    label: 'Horário Comercial',
    startMinute: 480,
    endMinute: 1080,
    enabled: true,
    daysOfWeek: [1, 2, 3, 4, 5],
    pricesByDistance: [{ maxDistanceM: 5000, price: 10 }],
    ...overrides,
  });

  it('returns null when no rules are provided', () => {
    expect(findActiveDeliveryPricingRule([], 600, 1)).toBeNull();
  });

  it('finds a matching rule by day and minute', () => {
    const r = rule();
    expect(findActiveDeliveryPricingRule([r], 600, 1)).toEqual(r);
  });

  it('returns null when the rule is on a different day', () => {
    expect(findActiveDeliveryPricingRule([rule()], 600, 6)).toBeNull();
  });

  it('returns null when the rule is disabled', () => {
    expect(findActiveDeliveryPricingRule([rule({ enabled: false })], 600, 1)).toBeNull();
  });

  it('returns the first matching rule when multiple exist', () => {
    const r1 = rule({ label: 'Primeiro', startMinute: 0, endMinute: 600 });
    const r2 = rule({ label: 'Segundo', startMinute: 600, endMinute: 1080 });
    expect(findActiveDeliveryPricingRule([r1, r2], 300, 1)?.label).toBe('Primeiro');
  });

  it('handles midnight crossing rules', () => {
    const r = rule({ startMinute: 1200, endMinute: 120, daysOfWeek: [1, 2, 3, 4, 5] });
    expect(findActiveDeliveryPricingRule([r], 60, 1)).toEqual(r);
    expect(findActiveDeliveryPricingRule([r], 480, 1)).toBeNull();
  });
});

describe('resolveDeliveryPrice', () => {
  const base = {
    rules: [],
    ranges: [{ maxDistanceM: 5000, price: 15 }],
    distanceM: 3000,
    localMinute: 600,
    dayOfWeek: 1,
    timezone: 'America/Sao_Paulo',
    pricingVersion: 1,
  };

  it('uses standard mode with base fee when no active rule', () => {
    const result = resolveDeliveryPrice(base);
    expect(result).toMatchObject({
      mode: 'standard',
      ruleId: null,
      ruleLabel: null,
      baseFee: 15,
      resolvedFee: 15,
      pricingVersion: 1,
    });
    expect(result.quotedAt).toBeDefined();
  });

  it('uses custom_time mode when an active rule with matching distance exists', () => {
    const result = resolveDeliveryPrice({
      ...base,
      rules: [{
        label: 'Noturno',
        startMinute: 600,
        endMinute: 1200,
        enabled: true,
        daysOfWeek: [1],
        pricesByDistance: [{ maxDistanceM: 5000, price: 25 }],
      }],
    });
    expect(result).toMatchObject({
      mode: 'custom_time',
      resolvedFee: 25,
      baseFee: 15,
    });
  });

  it('falls back to standard mode when active rule has no price for this distance', () => {
    const result = resolveDeliveryPrice({
      ...base,
      rules: [{
        label: 'Noturno',
        startMinute: 600,
        endMinute: 1200,
        enabled: true,
        daysOfWeek: [1],
        pricesByDistance: [{ maxDistanceM: 2000, price: 20 }],
      }],
    });
    expect(result).toMatchObject({
      mode: 'standard',
      resolvedFee: 15,
      baseFee: 15,
      ruleLabel: null,
    });
  });

  it('returns fee 0 when out of area', () => {
    const result = resolveDeliveryPrice({
      ...base,
      distanceM: 99999,
    });
    expect(result).toMatchObject({
      mode: 'standard',
      resolvedFee: 0,
      baseFee: 0,
      ruleId: null,
      ruleLabel: null,
    });
  });

  it('returns base fee when rules array is empty', () => {
    const result = resolveDeliveryPrice({
      ...base,
      rules: [],
    });
    expect(result).toMatchObject({
      mode: 'standard',
      resolvedFee: 15,
      baseFee: 15,
    });
  });
});

describe('validateDeliveryPricingRules', () => {
  const ranges = [{ maxDistanceM: 2000, price: 5 }, { maxDistanceM: 5000, price: 10 }];
  const validRule = {
    label: 'Horário Comercial',
    startMinute: 480,
    endMinute: 1080,
    enabled: true,
    daysOfWeek: [1, 2, 3, 4, 5],
    pricesByDistance: [{ maxDistanceM: 2000, price: 5 }, { maxDistanceM: 5000, price: 10 }],
  };

  it('returns null for valid rules', () => {
    expect(validateDeliveryPricingRules([validRule], ranges)).toBeNull();
  });

  it('returns error for empty label', () => {
    expect(validateDeliveryPricingRules([{ ...validRule, label: '  ' }], ranges)).toContain('nome');
  });

  it('returns error for invalid start minute', () => {
    expect(validateDeliveryPricingRules([{ ...validRule, startMinute: -1 }], ranges)).toContain('início');
  });

  it('returns error for start === end', () => {
    expect(validateDeliveryPricingRules([{ ...validRule, startMinute: 600, endMinute: 600 }], ranges)).toContain('iguais');
  });

  it('returns error for missing price for a range', () => {
    expect(validateDeliveryPricingRules([{ ...validRule, pricesByDistance: [{ maxDistanceM: 2000, price: 5 }] }], ranges)).toContain('cada faixa');
  });

  it('returns error for overlapping intervals', () => {
    const a = { ...validRule, label: 'Manhã', startMinute: 480, endMinute: 720 };
    const b = { ...validRule, label: 'Tarde', startMinute: 600, endMinute: 1080 };
    expect(validateDeliveryPricingRules([a, b], ranges)).toContain('sobrepor');
  });

  it('returns null for non-overlapping intervals', () => {
    const a = { ...validRule, label: 'Manhã', startMinute: 480, endMinute: 720 };
    const b = { ...validRule, label: 'Tarde', startMinute: 720, endMinute: 1080 };
    expect(validateDeliveryPricingRules([a, b], ranges)).toBeNull();
  });

  it('returns null for empty rules list', () => {
    expect(validateDeliveryPricingRules([], ranges)).toBeNull();
  });
});

describe('formatPricingWindowLabel', () => {
  it('formats a normal interval', () => {
    expect(formatPricingWindowLabel(480, 1080)).toBe('08:00 às 18:00');
  });

  it('adds suffix for midnight crossing', () => {
    expect(formatPricingWindowLabel(1200, 120)).toBe('20:00 às 02:00 · termina no dia seguinte');
  });

  it('does not add crossing suffix when end is 24:00 (1440)', () => {
    expect(formatPricingWindowLabel(1200, 1440)).toBe('20:00 às 00:00');
  });

  it('pads single-digit hours and minutes', () => {
    expect(formatPricingWindowLabel(5, 485)).toBe('00:05 às 08:05');
  });
});

describe('pricingIntervalSegments', () => {
  it('returns a single segment for normal intervals', () => {
    expect(pricingIntervalSegments(480, 1080)).toEqual([{ startMinute: 480, endMinute: 1080 }]);
  });

  it('splits into two segments for midnight crossing intervals', () => {
    expect(pricingIntervalSegments(1200, 120)).toEqual([
      { startMinute: 1200, endMinute: 1440 },
      { startMinute: 0, endMinute: 120 },
    ]);
  });
});

describe('normalizeDeliveryPricingRule', () => {
  it('trims the label', () => {
    const result = normalizeDeliveryPricingRule({
      label: '  Horário Comercial  ',
      startMinute: 480,
      endMinute: 1080,
      pricesByDistance: [{ maxDistanceM: 5000, price: 10 }],
    });
    expect(result.label).toBe('Horário Comercial');
  });

  it('rounds minutes to integers', () => {
    const result = normalizeDeliveryPricingRule({
      label: 'Teste',
      startMinute: 479.7,
      endMinute: 1080.3,
      pricesByDistance: [{ maxDistanceM: 5000, price: 10 }],
    });
    expect(result.startMinute).toBe(480);
    expect(result.endMinute).toBe(1080);
  });

  it('rounds prices to 2 decimal places', () => {
    const result = normalizeDeliveryPricingRule({
      label: 'Teste',
      startMinute: 480,
      endMinute: 1080,
      pricesByDistance: [{ maxDistanceM: 5000, price: 10.456 }],
    });
    expect(result.pricesByDistance[0].price).toBe(10.46);
  });

  it('defaults enabled to true', () => {
    const result = normalizeDeliveryPricingRule({
      label: 'Teste',
      startMinute: 480,
      endMinute: 1080,
      pricesByDistance: [{ maxDistanceM: 5000, price: 10 }],
    });
    expect(result.enabled).toBe(true);
  });

  it('defaults daysOfWeek to all 7 days', () => {
    const result = normalizeDeliveryPricingRule({
      label: 'Teste',
      startMinute: 480,
      endMinute: 1080,
      pricesByDistance: [{ maxDistanceM: 5000, price: 10 }],
    });
    expect(result.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('getLocalDateTimeParts', () => {
  it('returns correct local minute and day for a known UTC datetime in America/Sao_Paulo', () => {
    // 2024-07-15T15:30:00Z = 12:30 BRT (UTC-3) on a Monday
    const date = new Date('2024-07-15T15:30:00Z');
    const result = getLocalDateTimeParts('America/Sao_Paulo', date);
    expect(result.localMinute).toBe(750); // 12*60 + 30
    expect(result.dayOfWeek).toBe(1); // Monday
  });

  it('handles timezone offset that crosses to previous day', () => {
    // 2024-01-16T01:00:00Z = 2024-01-15 22:00 BRT (UTC-3) on a Monday
    const date = new Date('2024-01-16T01:00:00Z');
    const result = getLocalDateTimeParts('America/Sao_Paulo', date);
    expect(result.localMinute).toBe(1320); // 22*60
    expect(result.dayOfWeek).toBe(1); // Monday
  });

  it('handles timezone offset that crosses to next day', () => {
    // 2024-07-15T21:00:00Z = 2024-07-15 18:00 BRT (UTC-3) on a Monday
    const date = new Date('2024-07-15T21:00:00Z');
    const result = getLocalDateTimeParts('America/Sao_Paulo', date);
    expect(result.localMinute).toBe(1080); // 18*60
    expect(result.dayOfWeek).toBe(1);
  });
});

describe('getLocalDateTimePartsFromCivil', () => {
  it('keeps a scheduled store-local time independent of the Node process timezone', () => {
    // Saturday in the store timezone; the value must remain 20:00, not be
    // converted to UTC before pricing is resolved.
    expect(getLocalDateTimePartsFromCivil('2026-07-25', '20:00')).toEqual({
      localMinute: 1200,
      dayOfWeek: 6,
    });
  });

  it('rejects malformed or impossible civil date/time values', () => {
    expect(getLocalDateTimePartsFromCivil('2026-02-30', '20:00')).toBeNull();
    expect(getLocalDateTimePartsFromCivil('2026-07-25', '24:00')).toBeNull();
    expect(getLocalDateTimePartsFromCivil('2026/07/25', '20:00')).toBeNull();
  });
});
