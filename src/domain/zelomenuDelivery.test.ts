import { describe, expect, it } from 'vitest';
import { buildGeocodingProviderConfigs, buildNominatimUrl, buildOsrmUrl, buildBrasilApiCepUrl, matchDeliveryRange, normalizePostalCode } from './zelomenuDelivery';

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
