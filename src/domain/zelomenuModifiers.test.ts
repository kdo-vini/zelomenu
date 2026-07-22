import { describe, it, expect } from 'vitest';
import {
  resolveModifierSelections,
  validateModifierGroupDrafts,
  type ZeloMenuModifierGroup,
  type ZeloMenuModifierOption,
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

function classicSomarGroup(): ZeloMenuModifierGroup {
  return {
    id: 'g1',
    productId: 1,
    name: 'Adicionais',
    kind: 'adicional',
    pricingMode: 'somar',
    minSelections: 0,
    maxSelections: 3,
    active: true,
    order: 0,
    options: additions(),
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
    active: true,
    order: 0,
    options,
  };
}

const BASE_PRICE = 20;

// ─── Resolve modifier selections ─────────────────────────────────────────────

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
      [{ groupId: 'g1', optionIds: ['add-1', 'add-2'] }],
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
    const r = resolveModifierSelections(
      [group],
      [{ groupId: 'g-sub', optionIds: ['add-1'] }],
      BASE_PRICE,
    );
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
    const r = resolveModifierSelections(
      [groupOverride],
      [{ groupId: 'g-sub', optionIds: ['add-1'] }],
      BASE_PRICE,
    );
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
    const r = resolveModifierSelections(
      [group],
      [{ groupId: 'g-sub', optionIds: ['opt-indisponivel'] }],
      BASE_PRICE,
    );
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
      [
        { groupId: 'g-sub', optionIds: ['sub-1'] },
        { groupId: 'g-add', optionIds: ['add-1', 'add-3'] },
      ],
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

  // ── Erros ──────────────────────────────────────────────────────────────

  it('erro quando grupo não encontrado', () => {
    const r = resolveModifierSelections(
      [classicSomarGroup()],
      [{ groupId: 'fake', optionIds: ['x'] }],
      BASE_PRICE,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('group_missing');
  });

  it('erro quando opção não encontrada', () => {
    const r = resolveModifierSelections(
      [classicSomarGroup()],
      [{ groupId: 'g1', optionIds: ['fake-opt'] }],
      BASE_PRICE,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('option_missing');
  });

  it('erro quando minSelections não atingido', () => {
    const grupoObrigatorio: ZeloMenuModifierGroup = {
      ...classicSomarGroup(),
      minSelections: 1,
      maxSelections: 2,
    };
    const r = resolveModifierSelections(
      [grupoObrigatorio],
      [{ groupId: 'g1', optionIds: [] }],
      BASE_PRICE,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('group_required');
  });

  it('erro quando maxSelections excedido', () => {
    const grupoLimitado: ZeloMenuModifierGroup = {
      ...classicSomarGroup(),
      minSelections: 0,
      maxSelections: 1,
    };
    const r = resolveModifierSelections(
      [grupoLimitado],
      [{ groupId: 'g1', optionIds: ['add-1', 'add-2'] }],
      BASE_PRICE,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('selection_bounds');
  });
});

// ─── Validate modifier group drafts ──────────────────────────────────────────

describe('validateModifierGroupDrafts', () => {
  it('grupo sem nome → erro', () => {
    const err = validateModifierGroupDrafts([
      { name: '', kind: 'adicional', pricingMode: 'somar', minSelections: 0, maxSelections: null, active: true, order: 0, options: [{ name: 'Opção', priceDelta: 0, active: true, order: 0 }] },
    ]);
    expect(err).toBe('Todo grupo precisa de um nome.');
  });

  it('grupo substituir com max !== 1 → erro', () => {
    const err = validateModifierGroupDrafts([{
      name: 'Tipo de carne',
      kind: 'variacao',
      pricingMode: 'substituir',
      minSelections: 0,
      maxSelections: 3,
      active: true,
      order: 0,
      options: [
        { name: 'Picanha', priceDelta: 0, active: true, order: 0 },
        { name: 'Maminha', priceDelta: 0, active: true, order: 1 },
      ],
    }]);
    expect(err).toBe('Grupo de substituição de preço precisa ser de escolha única (máximo = 1).');
  });

  it('grupo substituir com max = 1 → OK', () => {
    const err = validateModifierGroupDrafts([{
      name: 'Tipo de carne',
      kind: 'variacao',
      pricingMode: 'substituir',
      minSelections: 1,
      maxSelections: 1,
      active: true,
      order: 0,
      options: [
        { name: 'Picanha', priceDelta: 0, active: true, order: 0 },
        { name: 'Maminha', priceDelta: 0, active: true, order: 1 },
      ],
    }]);
    expect(err).toBeNull();
  });

  it('mais de um grupo substituir → erro', () => {
    const err = validateModifierGroupDrafts([
      {
        name: 'Tipo de carne',
        kind: 'variacao',
        pricingMode: 'substituir',
        minSelections: 1,
        maxSelections: 1,
        active: true,
        order: 0,
        options: [{ name: 'Picanha', priceDelta: 0, active: true, order: 0 }],
      },
      {
        name: 'Tamanho',
        kind: 'variacao',
        pricingMode: 'substituir',
        minSelections: 1,
        maxSelections: 1,
        active: true,
        order: 1,
        options: [{ name: 'Grande', priceDelta: 0, active: true, order: 0 }],
      },
    ]);
    expect(err).toBe('Só pode existir um grupo de substituição de preço por produto.');
  });

  it('um grupo substituir e um somar → OK', () => {
    const err = validateModifierGroupDrafts([
      {
        name: 'Tipo de carne',
        kind: 'variacao',
        pricingMode: 'substituir',
        minSelections: 1,
        maxSelections: 1,
        active: true,
        order: 0,
        options: [{ name: 'Picanha', priceDelta: 0, active: true, order: 0 }],
      },
      {
        name: 'Adicionais',
        kind: 'adicional',
        pricingMode: 'somar',
        minSelections: 0,
        maxSelections: 3,
        active: true,
        order: 1,
        options: [
          { name: 'Catupiry', priceDelta: 2, active: true, order: 0 },
          { name: 'Cheddar', priceDelta: 1.5, active: true, order: 1 },
        ],
      },
    ]);
    expect(err).toBeNull();
  });

  it('grupo clássico sem nada vinculado → OK (não-regressão)', () => {
    const err = validateModifierGroupDrafts([{
      name: 'Adicionais',
      kind: 'adicional',
      pricingMode: 'somar',
      minSelections: 0,
      maxSelections: 3,
      active: true,
      order: 0,
      options: [
        { name: 'Catupiry', priceDelta: 2, active: true, order: 0 },
        { name: 'Cheddar', priceDelta: 1.5, active: true, order: 1 },
      ],
    }]);
    expect(err).toBeNull();
  });

  it('grupo sem opções ativas suficiente → erro', () => {
    const err = validateModifierGroupDrafts([{
      name: 'Obrigatório',
      kind: 'adicional',
      pricingMode: 'somar',
      minSelections: 2,
      maxSelections: 3,
      active: true,
      order: 0,
      options: [
        { name: 'Opção 1', priceDelta: 0, active: true, order: 0 },
        { name: 'Opção 2', priceDelta: 0, active: false, order: 1 },
      ],
    }]);
    expect(err).not.toBeNull();
    expect(err).toContain('precisa de pelo menos');
  });
});
