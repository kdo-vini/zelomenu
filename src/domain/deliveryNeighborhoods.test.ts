import { describe, expect, it } from 'vitest';
import {
  normalizeDeliveryNeighborhoodName,
  resolveDeliveryNeighborhoodFee,
  validateDeliveryNeighborhoods,
  type DeliveryNeighborhood,
} from './deliveryNeighborhoods';

describe('deliveryNeighborhoods', () => {
  const neighborhoods: DeliveryNeighborhood[] = [
    { id: 'bairro-1', name: 'Centro', normalizedName: 'centro', price: 5, active: true, sortOrder: 0 },
    { id: 'bairro-2', name: 'Jardim São José', normalizedName: 'jardim sao jose', price: 8.5, active: true, sortOrder: 1 },
    { id: 'bairro-3', name: 'Zona Rural', normalizedName: 'zona rural', price: 12, active: false, sortOrder: 2 },
  ];

  it('normalizes accents, case and whitespace for exact matching', () => {
    expect(normalizeDeliveryNeighborhoodName('  JARDIM   São José ')).toBe('jardim sao jose');
  });

  it('resolves the server fee only for an active registered neighborhood', () => {
    expect(resolveDeliveryNeighborhoodFee(neighborhoods, 'bairro-2')).toEqual({
      id: 'bairro-2',
      name: 'Jardim São José',
      fee: 8.5,
    });
    expect(resolveDeliveryNeighborhoodFee(neighborhoods, 'bairro-3')).toBeNull();
    expect(resolveDeliveryNeighborhoodFee(neighborhoods, 'unknown')).toBeNull();
  });

  it('rejects duplicate normalized names and negative prices', () => {
    const errors = validateDeliveryNeighborhoods([
      { name: 'Centro', price: '5,00', active: true },
      { name: ' centro ', price: '7,00', active: true },
      { name: 'Zona Rural', price: '-1', active: true },
    ]);

    expect(errors).toEqual([
      null,
      'Não use o mesmo bairro mais de uma vez.',
      'Informe um valor de frete válido.',
    ]);
  });
});
