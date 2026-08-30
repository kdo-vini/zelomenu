import { describe, expect, it } from 'vitest';
import {
  createDeliveryDraft,
  deliveryDraftToSettings,
  EMPTY_DELIVERY_SETTINGS,
  formatEstimatedDeliveryMinutes,
  formatPostalCode,
  isValidDeliveryEstimatedMinutes,
  validateDeliveryDraft,
} from './deliverySettings';

describe('deliverySettings', () => {
  it('normaliza quilômetros e valores para o contrato da API', () => {
    const draft = createDeliveryDraft({
      enabled: true,
      geocodingStatus: 'ready',
      address: {
        postalCode: '16370-000',
        number: '123',
        complement: null,
        street: 'Rua XV de Novembro',
        neighborhood: 'Centro',
        city: 'Promissão',
        state: 'SP',
        latitude: -21.53,
        longitude: -49.86,
        locationVersion: 'v1',
      },
      ranges: [{ id: '1', maxDistanceM: 2000, price: 5 }],
    });

    draft.ranges.push({ maxDistanceKm: '6,00', price: '12,50' });
    const settings = deliveryDraftToSettings(draft);

    expect(settings.ranges).toEqual([
      { id: '1', maxDistanceM: 2000, price: 5 },
      { id: undefined, maxDistanceM: 6000, price: 12.5 },
    ]);
    expect(settings.address?.city).toBe('Promissão');
  });

  it('valida CEP, endereço e faixas antes do salvamento', () => {
    const draft = createDeliveryDraft(EMPTY_DELIVERY_SETTINGS);
    draft.address.postalCode = '16370';
    draft.ranges = [
      { maxDistanceKm: '2,00', price: '5,00' },
      { maxDistanceKm: '2,00', price: '8,00' },
    ];

    const validation = validateDeliveryDraft(draft);

    expect(validation.postalCode).toContain('CEP válido');
    expect(validation.ranges).toEqual([null, null]);
    expect(validation.general).toContain('limites de distância');
  });

  it('formata o CEP sem aceitar caracteres além do limite', () => {
    expect(formatPostalCode('16.370-000abc')).toBe('16370-000');
  });

  it('preserva o prazo manual de entrega no contrato do formulário', () => {
    const draft = createDeliveryDraft({
      ...EMPTY_DELIVERY_SETTINGS,
      estimatedDeliveryMinutes: 50,
    });

    expect(draft.estimatedDeliveryMinutes).toBe('50');

    draft.estimatedDeliveryMinutes = '120';

    expect(deliveryDraftToSettings(draft).estimatedDeliveryMinutes).toBe(120);
  });

  it('aceita prazo vazio e rejeita minutos fora do intervalo permitido', () => {
    const draft = createDeliveryDraft(EMPTY_DELIVERY_SETTINGS);

    expect(validateDeliveryDraft(draft).estimatedDeliveryMinutes).toBeNull();

    draft.estimatedDeliveryMinutes = '0';
    expect(validateDeliveryDraft(draft).estimatedDeliveryMinutes).toContain('entre 1 e 1440');

    draft.estimatedDeliveryMinutes = '50,5';
    expect(validateDeliveryDraft(draft).estimatedDeliveryMinutes).toContain('inteiro');

    draft.estimatedDeliveryMinutes = '1441';
    expect(validateDeliveryDraft(draft).estimatedDeliveryMinutes).toContain('entre 1 e 1440');
  });

  it('formata somente a estimativa manual válida para o cliente', () => {
    expect(formatEstimatedDeliveryMinutes(50)).toBe('50 min');
    expect(formatEstimatedDeliveryMinutes(null)).toBeNull();
    expect(formatEstimatedDeliveryMinutes(0)).toBeNull();
  });

  it('centraliza os limites aceitos pelo painel e pela API', () => {
    expect(isValidDeliveryEstimatedMinutes(1)).toBe(true);
    expect(isValidDeliveryEstimatedMinutes(1440)).toBe(true);
    expect(isValidDeliveryEstimatedMinutes(0)).toBe(false);
    expect(isValidDeliveryEstimatedMinutes(1441)).toBe(false);
    expect(isValidDeliveryEstimatedMinutes('50')).toBe(false);
  });
});
