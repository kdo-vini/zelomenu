import { describe, expect, it } from 'vitest';
import { buildCartItemKey } from './zelomenuCartItemKey';

describe('buildCartItemKey', () => {
  it('mantém montagens diferentes em linhas diferentes', () => {
    const carne = [{ groupId: 'sabores', optionSelections: [{ optionId: 'carne', quantity: 1 }] }];
    const frango = [{ groupId: 'sabores', optionSelections: [{ optionId: 'frango', quantity: 1 }] }];

    expect(buildCartItemKey(10, carne)).not.toBe(buildCartItemKey(10, frango));
  });

  it('não depende da ordem dos grupos ou das opções', () => {
    const first = [
      { groupId: 'acompanhamento', optionSelections: [{ optionId: 'salada', quantity: 1 }] },
      { groupId: 'sabor', optionSelections: [{ optionId: 'carne', quantity: 1 }, { optionId: 'arroz', quantity: 1 }] },
    ];
    const reordered = [
      { groupId: 'sabor', optionSelections: [{ optionId: 'arroz', quantity: 1 }, { optionId: 'carne', quantity: 1 }] },
      { groupId: 'acompanhamento', optionSelections: [{ optionId: 'salada', quantity: 1 }] },
    ];

    expect(buildCartItemKey(10, first)).toBe(buildCartItemKey(10, reordered));
  });

  it('separa a mesma montagem quando a observação é diferente', () => {
    const selections = [{ groupId: 'sabor', optionSelections: [{ optionId: 'carne', quantity: 1 }] }];

    expect(buildCartItemKey(10, selections, 'sem cebola'))
      .not.toBe(buildCartItemKey(10, selections, 'com cebola'));
    expect(buildCartItemKey(10, selections, ' sem cebola '))
      .toBe(buildCartItemKey(10, selections, 'sem cebola'));
  });
});
