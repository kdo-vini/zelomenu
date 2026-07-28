import { describe, expect, it } from 'vitest';
import type { Business } from '../data/types.ts';
import { distanceInKm, filterBusinessesByLocation, isBusinessAvailableAtLocation } from './businessDeliveryRegion.ts';

function business(overrides: Partial<Business> = {}): Business {
  return {
    id: 'business-1',
    slug: 'business-1',
    name: 'Empresa teste',
    categoryId: 'all',
    categoryLabel: 'Cardápio digital',
    city: 'Promissão',
    state: 'SP',
    coverUrl: '',
    logoUrl: '',
    description: '',
    latitude: -21.53378,
    longitude: -49.8592,
    maxDeliveryDistanceM: 3000,
    rating: null,
    ratingCount: 0,
    highlights: [],
    featured: false,
    sponsored: false,
    menuUrl: '/business-1',
    ...overrides,
  };
}

describe('business delivery region', () => {
  it('calculates distance in kilometers', () => {
    expect(distanceInKm(
      { latitude: -21.53378, longitude: -49.8592 },
      { latitude: -21.54951, longitude: -49.85852 },
    )).toBeGreaterThan(1.7);
  });

  it('includes businesses inside their configured maximum distance', () => {
    expect(isBusinessAvailableAtLocation(
      business(),
      { latitude: -21.54951, longitude: -49.85852 },
    )).toBe(true);
  });

  it('excludes businesses without coverage or outside the configured distance', () => {
    const location = { latitude: -21.54951, longitude: -49.85852 };
    expect(isBusinessAvailableAtLocation(business({ maxDeliveryDistanceM: 100 }), location)).toBe(false);
    expect(isBusinessAvailableAtLocation(business({ maxDeliveryDistanceM: null }), location)).toBe(false);
    expect(filterBusinessesByLocation([
      business(),
      business({ id: 'business-2', maxDeliveryDistanceM: 100 }),
    ], location).map((item) => item.id)).toEqual(['business-1']);
  });
});
