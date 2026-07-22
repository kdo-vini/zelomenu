import { describe, it, expect } from 'vitest';
import {
  resolveModifierSelections,
  validateModifierGroupDrafts,
  formatSelectedModifierGroups,
  type ZeloMenuModifierGroup,
  type ZeloMenuModifierGroupDraft,
  type ZeloMenuModifierOption,
  type ZeloMenuModifierSelectionInput,
  type ZeloMenuLinkedModifierProduct,
} from './zelomenuModifiers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function additions(): ZeloMenuModifierOption[] {
  return [
    { id: 'add-1', name: 'Catupiry', priceDelta: 2, active: true, order: 0 },
    { id: 'add-2', name: 'Cheddar', priceDelta: 1.5, active: true, order: 1 },
    { id: 'add-3', name: 'Bacon', priceDelta: 3, active: true, order: 2 },
  ];
}

function classicSomarGroup(overrides: Partial<ZeloMenuModifierGroup> = {}): ZeloMenuModifierGroup {
  return {
    id: 'g1',
    productId: 1,
    name: 'Adicionais',
    kind: 'adicional',
    pricingMode: 'somar',
    minSelections: 0,
    maxSelections: 3,
    allowsQuantity: false,
    maxPerOption: null,
    active: true,
    order: 0,
    options: additions(),
    ...overrides,
  };
}

function linkedProduct(price: number, available = true): ZeloMenuLinkedModifierProduct {
  return {
    productId: 100,
    name: 'Carne Angus 200g',
    photoUrl: null,
    price,
    available,
  };
}

function substituirGroup(options: ZeloMenuModifierOption[]): ZeloMenuModifierGroup {
  return {
    id: 'g-sub',
    productId: 1,
    name: 'Tipo de carne',
    kind: 'variacao',
    pricingMode: 'substituir',
    minSelections: 1,
    maxSelections: 1,
    allowsQuantity: false,
    maxPerOption: null,
    active: true,
    order: 0,
    options,
  };
}

function sel(groupId: string, optionSelections: Array<{ optionId: string; quantity: number }>): ZeloMenuModifierSelectionInput {
  return { groupId, optionSelections };
}

function one(groupId: string, optionIds: string[]): ZeloMenuModifierSelectionInput {
  return { groupId, optionSelections: optionIds.map((optionId) => ({ optionId, quantity: 1 })) };
}

const BASE_PRICE = 20;

// ─── resolveModifierSelections ────────────────────────────────────────────────

describe('resolveModifierSelections', () => {
  it('retorna ok com groups vazios', () => {
    const r = resolveModifierSelections([], [], BASE_PRICE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.selectedGroups).toEqual([]);
      expect(r.deltaTotal).toBe(0);
      expect(r.finalUnitPrice).toBe(BASE_PRICE);
    }
  });

  it('retorna ok com groups null/undefined', () => {
    expect(resolveModifierSelections(null, null, BASE_PRICE).ok).toBe(true);
    expect(resolveModifierSelections(undefined, undefined, BASE_PRICE).ok).toBe(true);
  });

  // ── Cenário 1: grupo clássico 'somar' (não-regressão) ──────────────────

  it('grupo clássico somar: finalUnitPrice = base + deltaTotal', () => {
    const r = resolveModifierSelections(
      [classicSomarGroup()],
      [one('g1', ['add-1', 'add-2'])],
      BASE_PRICE,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.deltaTotal).toBe(3.5); // 2 + 1.5
      expect(r.finalUnitPrice).toBe(23.5); // 20 + 3.5
    }
  });

  // ── Cenário 2: grupo 'substituir' com produto vinculado ─────────────────

  it('grupo substituir: finalUnitPrice = preço do linkedProduct (substitui o base)', () => {
    const group = substituirGroup([
      {
        ...additions()[0],
        name: 'Picanha',
        priceDelta: 0,
        linkedProduct: linkedProduct(35),
      },
    ]);
    const r = resolveModifierSelections([group], [one('g-sub', ['add-1'])], BASE_PRICE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.deltaTotal).toBe(15); // 35 - 20 = 15
      expect(r.finalUnitPrice).toBe(35); // substitui o base
    }
  });

  // ── Cenário 3: priceOverride no linkedProduct ──────────────────────────

  it('grupo substituir com priceOverride: usa o override ao invés do preço do produto', () => {
    // Simulamos priceOverride via linkedProduct com preço = override (R$22)
    const groupOverride = substituirGroup([
      {
        ...additions()[0],
        name: 'Picanha',
        priceDelta: 0,
        linkedProduct: { ...linkedProduct(35), price: 22 },
      },
    ]);
    const r = resolveModifierSelections([groupOverride], [one('g-sub', ['add-1'])], BASE_PRICE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.deltaTotal).toBe(2); // 22 - 20 = 2
      expect(r.finalUnitPrice).toBe(22);
    }
  });

  // ── Cenário 4: produto vinculado indisponível ──────────────────────────

  it('opção com linkedProduct unavailable é filtrada → erro option_missing', () => {
    const group = substituirGroup([
      {
        id: 'opt-indisponivel',
        name: 'Picanha',
        priceDelta: 0,
        active: true,
        order: 0,
        linkedProduct: linkedProduct(35, false),
      },
    ]);
    const r = resolveModifierSelections([group], [one('g-sub', ['opt-indisponivel'])], BASE_PRICE);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('option_missing');
    }
  });

  // ── Cenário 5: grupo substituir + grupo somar combinados ──────────────

  it('grupo substituir + grupo somar: finalUnitPrice = baseOverride + addDeltaTotal', () => {
    const subGroup = substituirGroup([
      {
        id: 'sub-1',
        name: 'Picanha',
        priceDelta: 0,
        active: true,
        order: 0,
        linkedProduct: linkedProduct(35),
      },
    ]);
    const addGroup: ZeloMenuModifierGroup = {
      ...classicSomarGroup(),
      id: 'g-add',
    };
    const r = resolveModifierSelections(
      [subGroup, addGroup],
      [one('g-sub', ['sub-1']), one('g-add', ['add-1', 'add-3'])],
      BASE_PRICE,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // baseOverride = 35 (picanha), addDeltaTotal = 2 + 3 = 5
      // finalUnitPrice = 35 + 5 = 40
      expect(r.finalUnitPrice).toBe(40);
      expect(r.deltaTotal).toBe(20); // 40 - 20 = 20
    }
  });

  // ── Erros básicos ────────────────────────────────────────────────────────

  it('erro quando grupo não encontrado', () => {
    const r = resolveModifierSelections([classicSomarGroup()], [one('fake', ['x'])], BASE_PRICE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('group_missing');
  });

  it('erro quando opção não encontrada', () => {
    const r = resolveModifierSelections([classicSomarGroup()], [one('g1', ['fake-opt'])], BASE_PRICE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('option_missing');
  });

  it('erro quando minSelections não atingido', () => {
    const grupoObrigatorio = classicSomarGroup({ minSelections: 1, maxSelections: 2 });
    const r = resolveModifierSelections([grupoObrigatorio], [one('g1', [])], BASE_PRICE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('group_required');
  });

  it('erro quando maxSelections excedido (opções distintas)', () => {
    const grupoLimitado = classicSomarGroup({ minSelections: 0, maxSelections: 1 });
    const r = resolveModifierSelections([grupoLimitado], [one('g1', ['add-1', 'add-2'])], BASE_PRICE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('selection_bounds');
  });

  // ── Quantidade por opção ─────────────────────────────────────────────────

  it('multiplica priceDelta pela quantidade', () => {
    const group = classicSomarGroup({ allowsQuantity: true });
    const r = resolveModifierSelections([group], [sel('g1', [{ optionId: 'add-3', quantity: 3 }])], BASE_PRICE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.deltaTotal).toBe(9); // 3 * 3
      expect(r.finalUnitPrice).toBe(29);
      expect(r.selectedGroups[0].selectedOptions[0].quantity).toBe(3);
    }
  });

  it('retorna option_quantity_exceeded quando quantidade > maxPerOption', () => {
    const group = classicSomarGroup({ allowsQuantity: true, maxPerOption: 2 });
    const r = resolveModifierSelections([group], [sel('g1', [{ optionId: 'add-3', quantity: 3 }])], BASE_PRICE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('option_quantity_exceeded');
  });

  it('permite quantidade exatamente no maxPerOption', () => {
    const group = classicSomarGroup({ allowsQuantity: true, maxPerOption: 2 });
    const r = resolveModifierSelections([group], [sel('g1', [{ optionId: 'add-3', quantity: 2 }])], BASE_PRICE);
    expect(r.ok).toBe(true);
  });

  it('sanitiza quantidade 0 como não selecionado (filtrado)', () => {
    const group = classicSomarGroup({ minSelections: 0 });
    const r = resolveModifierSelections([group], [sel('g1', [{ optionId: 'add-1', quantity: 0 }])], BASE_PRICE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.selectedGroups).toHaveLength(0);
      expect(r.finalUnitPrice).toBe(BASE_PRICE);
    }
  });

  it('sanitiza quantidade negativa como inválida (filtrada)', () => {
    const group = classicSomarGroup({ minSelections: 0 });
    const r = resolveModifierSelections([group], [sel('g1', [{ optionId: 'add-1', quantity: -1 }])], BASE_PRICE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.selectedGroups).toHaveLength(0);
  });

  it('sanitiza quantidade NaN como inválida (filtrada)', () => {
    const group = classicSomarGroup({ minSelections: 0 });
    const r = resolveModifierSelections([group], [sel('g1', [{ optionId: 'add-1', quantity: NaN }])], BASE_PRICE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.selectedGroups).toHaveLength(0);
  });

  it('sanitiza quantidade fracionária arredondando para baixo', () => {
    const group = classicSomarGroup({ allowsQuantity: true });
    const r = resolveModifierSelections([group], [sel('g1', [{ optionId: 'add-3', quantity: 2.7 }])], BASE_PRICE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.selectedGroups[0].selectedOptions[0].quantity).toBe(2);
      expect(r.deltaTotal).toBe(6); // 3 * 2
    }
  });

  it('minSelections/maxSelections contam opções distintas, não soma de quantidades', () => {
    const group = classicSomarGroup({
      allowsQuantity: true,
      minSelections: 2,
      maxSelections: 3,
      options: [additions()[0], additions()[2]],
    });
    // Só 1 opção distinta com qty 3 → precisa de 2 → falha
    const r1 = resolveModifierSelections([group], [sel('g1', [{ optionId: 'add-3', quantity: 3 }])], BASE_PRICE);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe('group_required');

    // 2 opções distintas com qty 2 cada → passa
    const r2 = resolveModifierSelections(
      [group],
      [sel('g1', [{ optionId: 'add-1', quantity: 2 }, { optionId: 'add-3', quantity: 2 }])],
      BASE_PRICE,
    );
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.deltaTotal).toBe(10); // 2*2 + 3*2
  });
});

// ─── formatSelectedModifierGroups ─────────────────────────────────────────────

describe('formatSelectedModifierGroups', () => {
  it('retorna string vazia para null/undefined/vazio', () => {
    expect(formatSelectedModifierGroups(null)).toBe('');
    expect(formatSelectedModifierGroups(undefined)).toBe('');
    expect(formatSelectedModifierGroups([])).toBe('');
  });

  it('mostra prefixo de quantidade quando quantity > 1', () => {
    const formatted = formatSelectedModifierGroups([{
      groupId: 'g1',
      groupName: 'Adicionais',
      kind: 'adicional',
      selectedOptions: [
        { optionId: 'o1', optionName: 'Bacon', priceDelta: 3, quantity: 2 },
      ],
    }]);
    expect(formatted).toBe('Adicionais: 2x Bacon');
  });

  it('não mostra prefixo de quantidade quando quantity === 1', () => {
    const formatted = formatSelectedModifierGroups([{
      groupId: 'g1',
      groupName: 'Adicionais',
      kind: 'adicional',
      selectedOptions: [
        { optionId: 'o1', optionName: 'Bacon', priceDelta: 3, quantity: 1 },
      ],
    }]);
    expect(formatted).toBe('Adicionais: Bacon');
  });
});

// ─── validateModifierGroupDrafts ──────────────────────────────────────────────

describe('validateModifierGroupDrafts', () => {
  function draft(overrides: Partial<ZeloMenuModifierGroupDraft> = {}): ZeloMenuModifierGroupDraft {
    return {
      name: 'Teste',
      kind: 'adicional',
      pricingMode: 'somar',
      minSelections: 0,
      maxSelections: null,
      allowsQuantity: false,
      maxPerOption: null,
      active: true,
      order: 0,
      options: [{ name: 'Opção 1', priceDelta: 0, active: true, order: 0 }],
      ...overrides,
    };
  }

  it('aceita draft válido', () => {
    expect(validateModifierGroupDrafts([draft()])).toBeNull();
  });

  it('rejeita grupo sem nome', () => {
    expect(validateModifierGroupDrafts([draft({ name: '' })])).toBe('Todo grupo precisa de um nome.');
  });

  it('rejeita grupo sem opções', () => {
    const result = validateModifierGroupDrafts([draft({ options: [] })]);
    expect(result).toContain('precisa ter pelo menos uma opção');
  });

  it('rejeita grupo sem opções ativas suficientes', () => {
    const result = validateModifierGroupDrafts([draft({
      minSelections: 2,
      maxSelections: 3,
      options: [
        { name: 'Opção 1', priceDelta: 0, active: true, order: 0 },
        { name: 'Opção 2', priceDelta: 0, active: false, order: 1 },
      ],
    })]);
    expect(result).not.toBeNull();
    expect(result).toContain('precisa de pelo menos');
  });

  // ── Quantidade por opção ─────────────────────────────────────────────────

  it('rejeita allowsQuantity com maxSelections === 1', () => {
    const result = validateModifierGroupDrafts([draft({ allowsQuantity: true, maxSelections: 1 })]);
    expect(result).toBe('Grupo de escolha única não pode permitir quantidade.');
  });

  it('rejeita maxPerOption < 1', () => {
    const result = validateModifierGroupDrafts([draft({ maxPerOption: 0 })]);
    expect(result).toContain('máximo por opção inválido');
  });

  it('rejeita allowsQuantity com kind variacao', () => {
    const result = validateModifierGroupDrafts([draft({ allowsQuantity: true, kind: 'variacao' })]);
    expect(result).toBe('Quantidade só é permitida em grupos do tipo Adicional.');
  });

  // ── Substituição de preço ────────────────────────────────────────────────

  it('rejeita grupo substituir com max !== 1', () => {
    const result = validateModifierGroupDrafts([draft({
      name: 'Tipo de carne',
      kind: 'variacao',
      pricingMode: 'substituir',
      maxSelections: 3,
      options: [
        { name: 'Picanha', priceDelta: 0, active: true, order: 0 },
        { name: 'Maminha', priceDelta: 0, active: true, order: 1 },
      ],
    })]);
    expect(result).toBe('Grupo de substituição de preço precisa ser de escolha única (máximo = 1).');
  });

  it('aceita grupo substituir com max = 1', () => {
    const result = validateModifierGroupDrafts([draft({
      name: 'Tipo de carne',
      kind: 'variacao',
      pricingMode: 'substituir',
      minSelections: 1,
      maxSelections: 1,
      options: [
        { name: 'Picanha', priceDelta: 0, active: true, order: 0 },
        { name: 'Maminha', priceDelta: 0, active: true, order: 1 },
      ],
    })]);
    expect(result).toBeNull();
  });

  it('rejeita mais de um grupo substituir no mesmo produto', () => {
    const base = {
      kind: 'variacao' as const,
      pricingMode: 'substituir' as const,
      minSelections: 1,
      maxSelections: 1,
      allowsQuantity: false,
      maxPerOption: null,
      active: true,
      options: [{ name: 'Opção', priceDelta: 0, active: true, order: 0 }],
    };
    const result = validateModifierGroupDrafts([
      { ...base, name: 'Tipo de carne', order: 0 },
      { ...base, name: 'Tamanho', order: 1 },
    ]);
    expect(result).toBe('Só pode existir um grupo de substituição de preço por produto.');
  });

  it('aceita um grupo substituir e um somar juntos', () => {
    const result = validateModifierGroupDrafts([
      draft({
        name: 'Tipo de carne',
        kind: 'variacao',
        pricingMode: 'substituir',
        minSelections: 1,
        maxSelections: 1,
        options: [{ name: 'Picanha', priceDelta: 0, active: true, order: 0 }],
      }),
      draft({
        name: 'Adicionais',
        order: 1,
        maxSelections: 3,
        options: [
          { name: 'Catupiry', priceDelta: 2, active: true, order: 0 },
          { name: 'Cheddar', priceDelta: 1.5, active: true, order: 1 },
        ],
      }),
    ]);
    expect(result).toBeNull();
  });
});
