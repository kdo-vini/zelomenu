import { describe, expect, it } from 'vitest';
import { buildReadinessItems } from './ZeloMenuReadinessCard';
import type { ZeloMenuStoreSettings } from '../../services/zelomenuAdminApi';
import type { DeliverySettings } from '../../domain/deliverySettings';

const settings: ZeloMenuStoreSettings = {
  logoUrl: 'https://cdn.test/logo.png',
  coverUrl: 'https://cdn.test/cover.png',
  description: 'Salgados artesanais',
  companyName: 'Casa dos Salgados',
  companySpecialty: 'Salgados',
  welcomeText: null,
  featuredEnabled: false,
  featuredProductIds: [],
  recommendationsEnabled: false,
  recommendationProductIds: [],
  categorySuggestions: {},
  categoryOrder: [],
  availableProducts: [
    { id: 1, name: 'Coxinha', categoryName: 'Salgados', price: 12, photoUrl: 'https://cdn.test/1.png' },
    { id: 2, name: 'Kibe', categoryName: 'Salgados', price: 10, photoUrl: 'https://cdn.test/2.png' },
    { id: 3, name: 'Esfiha', categoryName: 'Salgados', price: 9, photoUrl: 'https://cdn.test/3.png' },
  ],
  availableCategories: ['Salgados'],
  pixKey: null,
  pixKeyType: null,
  autoAcceptOrders: false,
  pixReceiptVerificationEnabled: false,
  weeklyHours: { sun: [{ start: '17:00', end: '23:00' }], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] },
  timezone: 'America/Sao_Paulo',
  schedulingEnabled: false,
  schedulingLeadTimeMinutes: 0,
  publicationSummary: { total: 3, published: 3, unpublished: 0, paused: 0, hidden: 0, outOfStock: 0, missingCategory: 0, attention: 0 },
};

const delivery: DeliverySettings = {
  enabled: true,
  estimatedDeliveryMinutes: 45,
  address: {
    postalCode: '18000000', number: '10', complement: null, street: 'Rua A', neighborhood: 'Centro', city: 'Sorocaba', state: 'SP', latitude: -23, longitude: -47, locationVersion: 'v1',
  },
  ranges: [{ maxDistanceM: 3000, price: 8 }],
  geocodingStatus: 'ready',
};

describe('buildReadinessItems', () => {
  it('marca visual, fotos e entrega completa como prontas', () => {
    const items = buildReadinessItems(settings, 'casa-dos-salgados', delivery);
    expect(items.filter((item) => item.ready).map((item) => item.id)).toEqual([
      'link', 'products', 'catalog', 'logo', 'cover', 'hours', 'photos', 'delivery',
    ]);
  });

  it('mantém a publicação orientada quando entrega está incompleta', () => {
    const incomplete = { ...delivery, estimatedDeliveryMinutes: null, ranges: [], address: null, geocodingStatus: 'not_configured' as const };
    const deliveryItem = buildReadinessItems(settings, 'casa-dos-salgados', incomplete).find((item) => item.id === 'delivery');
    expect(deliveryItem?.ready).toBe(false);
    expect(deliveryItem?.description).toMatch(/prazo|endereço|faixa/i);
  });

  it('trata retirada como modo de atendimento pronto sem exigir dados de delivery', () => {
    const pickupItem = buildReadinessItems(settings, 'casa-dos-salgados', { ...delivery, enabled: false, address: null, ranges: [] }).find((item) => item.id === 'delivery');
    expect(pickupItem).toEqual(expect.objectContaining({ ready: true, description: expect.stringMatching(/retirada/i) }));
  });
});
