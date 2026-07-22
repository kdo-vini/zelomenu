import { describe, expect, it } from 'vitest';
import {
  resolveModifierSelections,
  validateModifierGroupDrafts,
  formatSelectedModifierGroups,
  type ZeloMenuModifierGroup,
  type ZeloMenuModifierGroupDraft,
  type ZeloMenuModifierSelectionInput,
} from './zelomenuModifiers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGroup(overrides: Partial<ZeloMenuModifierGroup> = {}): ZeloMenuModifierGroup {
  return {
    id: 'g1',
    productId: 1,
    name: 'Adicionais',
    kind: 'adicional',
    minSelections: 0,
    maxSelections: null,
    allowsQuantity: false,
    maxPerOption: null,
    active: true,
    order: 0,
    options: [
      { id: 'o1', name: 'Bacon', priceDelta: 3, active: true, order: 0 },
      { id: 'o2', name: 'Queijo', priceDelta: 2, active: true, order: 1 },
      { id: 'o3', name: 'Catupiry', priceDelta: 0, active: false, order: 2 },
    ],
    ...overrides,
  };
}

function makeSelection(
  overrides: Partial<ZeloMenuModifierSelectionInput> & { groupId?: string } = {},
): ZeloMenuModifierSelectionInput {
  return {
    groupId: 'g1',
    optionSelections: [{ optionId: 'o1', quantity: 1 }],
    ...overrides,
  };
}

// ─── resolveModifierSelections ────────────────────────────────────────────────

describe('resolveModifierSelections', () => {
  it('returns empty when no active groups', () => {
    const result = resolveModifierSelections([], []);
    expect(result).toEqual({ ok: true, selectedGroups: [], deltaTotal: 0 });
  });

  it('returns empty when groups is null/undefined', () => {
    expect(resolveModifierSelections(null, null)).toEqual({ ok: true, selectedGroups: [], deltaTotal: 0 });
    expect(resolveModifierSelections(undefined, [])).toEqual({ ok: true, selectedGroups: [], deltaTotal: 0 });
  });

  it('returns group_missing when selected group is not in active groups', () => {
    const result = resolveModifierSelections([makeGroup()], [makeSelection({ groupId: 'nonexistent' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('group_missing');
    }
  });

  it('returns option_missing when selected option does not exist or is inactive', () => {
    const group = makeGroup();
    const result = resolveModifierSelections(
      [group],
      [makeSelection({ optionSelections: [{ optionId: 'nonexistent', quantity: 1 }] })],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('option_missing');
    }
  });

  it('returns group_required when minSelections not met', () => {
    const group = makeGroup({ minSelections: 1 });
    const result = resolveModifierSelections([group], [makeSelection({ optionSelections: [] })]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('group_required');
    }
  });

  it('returns selection_bounds when maxSelections exceeded (distinct options)', () => {
    const group = makeGroup({
      maxSelections: 1,
      options: [
        { id: 'o1', name: 'Bacon', priceDelta: 3, active: true, order: 0 },
        { id: 'o2', name: 'Queijo', priceDelta: 2, active: true, order: 1 },
      ],
    });
    const result = resolveModifierSelections(
      [group],
      [makeSelection({
        optionSelections: [
          { optionId: 'o1', quantity: 1 },
          { optionId: 'o2', quantity: 1 },
        ],
      })],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('selection_bounds');
    }
  });

  it('resolves successfully with basic selection', () => {
    const result = resolveModifierSelections(
      [makeGroup()],
      [makeSelection({ optionSelections: [{ optionId: 'o1', quantity: 1 }] })],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deltaTotal).toBe(3);
      expect(result.selectedGroups).toHaveLength(1);
      expect(result.selectedGroups[0].selectedOptions).toHaveLength(1);
      expect(result.selectedGroups[0].selectedOptions[0].quantity).toBe(1);
    }
  });

  // ─── Quantity feature tests ────────────────────────────────────────────────

  it('multiplies priceDelta by quantity', () => {
    const group = makeGroup({ allowsQuantity: true });
    const result = resolveModifierSelections(
      [group],
      [makeSelection({ optionSelections: [{ optionId: 'o1', quantity: 3 }] })],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deltaTotal).toBe(9); // 3 * 3
      expect(result.selectedGroups[0].selectedOptions[0].quantity).toBe(3);
    }
  });

  it('returns option_quantity_exceeded when quantity > maxPerOption', () => {
    const group = makeGroup({ allowsQuantity: true, maxPerOption: 2 });
    const result = resolveModifierSelections(
      [group],
      [makeSelection({ optionSelections: [{ optionId: 'o1', quantity: 3 }] })],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('option_quantity_exceeded');
    }
  });

  it('allows quantity exactly at maxPerOption', () => {
    const group = makeGroup({ allowsQuantity: true, maxPerOption: 2 });
    const result = resolveModifierSelections(
      [group],
      [makeSelection({ optionSelections: [{ optionId: 'o1', quantity: 2 }] })],
    );
    expect(result.ok).toBe(true);
  });

  it('sanitizes quantity 0 as deselected (filtered out)', () => {
    const group = makeGroup({ minSelections: 0 });
    const result = resolveModifierSelections(
      [group],
      [makeSelection({ optionSelections: [{ optionId: 'o1', quantity: 0 }] })],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selectedGroups).toHaveLength(0);
      expect(result.deltaTotal).toBe(0);
    }
  });

  it('sanitizes negative quantity as invalid (filtered out)', () => {
    const group = makeGroup({ minSelections: 0 });
    const result = resolveModifierSelections(
      [group],
      [makeSelection({ optionSelections: [{ optionId: 'o1', quantity: -1 }] })],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selectedGroups).toHaveLength(0);
      expect(result.deltaTotal).toBe(0);
    }
  });

  it('sanitizes NaN quantity as invalid (filtered out)', () => {
    const group = makeGroup({ minSelections: 0 });
    const result = resolveModifierSelections(
      [group],
      [makeSelection({ optionSelections: [{ optionId: 'o1', quantity: NaN }] })],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selectedGroups).toHaveLength(0);
      expect(result.deltaTotal).toBe(0);
    }
  });

  it('sanitizes fractional quantity by flooring to integer', () => {
    const group = makeGroup({ allowsQuantity: true });
    const result = resolveModifierSelections(
      [group],
      [makeSelection({ optionSelections: [{ optionId: 'o1', quantity: 2.7 }] })],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selectedGroups[0].selectedOptions[0].quantity).toBe(2);
      expect(result.deltaTotal).toBe(6); // 3 * 2
    }
  });

  it('counts minSelections/maxSelections as distinct options, not sum of quantities', () => {
    const group = makeGroup({
      allowsQuantity: true,
      minSelections: 2,
      options: [
        { id: 'o1', name: 'Bacon', priceDelta: 3, active: true, order: 0 },
        { id: 'o2', name: 'Queijo', priceDelta: 2, active: true, order: 1 },
      ],
    });
    // Only 1 distinct option at qty 3 = 1 option selected, need 2 → fail
    const result = resolveModifierSelections(
      [group],
      [makeSelection({ optionSelections: [{ optionId: 'o1', quantity: 3 }] })],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('group_required');
    }

    // 2 distinct options at qty 2 each = 2 options selected → pass
    const result2 = resolveModifierSelections(
      [group],
      [makeSelection({
        optionSelections: [
          { optionId: 'o1', quantity: 2 },
          { optionId: 'o2', quantity: 2 },
        ],
      })],
    );
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.deltaTotal).toBe(10); // 3*2 + 2*2
    }
  });
});

// ─── formatSelectedModifierGroups ─────────────────────────────────────────────

describe('formatSelectedModifierGroups', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(formatSelectedModifierGroups(null)).toBe('');
    expect(formatSelectedModifierGroups(undefined)).toBe('');
    expect(formatSelectedModifierGroups([])).toBe('');
  });

  it('shows quantity prefix when quantity > 1', () => {
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

  it('does not show quantity prefix when quantity === 1', () => {
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

  it('accepts valid draft', () => {
    expect(validateModifierGroupDrafts([draft()])).toBeNull();
  });

  it('rejects allowsQuantity with maxSelections === 1', () => {
    const result = validateModifierGroupDrafts([draft({ allowsQuantity: true, maxSelections: 1 })]);
    expect(result).toBe('Grupo de escolha única não pode permitir quantidade.');
  });

  it('rejects maxPerOption < 1', () => {
    const result = validateModifierGroupDrafts([draft({ maxPerOption: 0 })]);
    expect(result).toContain('máximo por opção inválido');
  });

  it('rejects allowsQuantity with kind variacao', () => {
    const result = validateModifierGroupDrafts([draft({ allowsQuantity: true, kind: 'variacao' })]);
    expect(result).toBe('Quantidade só é permitida em grupos do tipo Adicional.');
  });

  it('rejects empty name', () => {
    const result = validateModifierGroupDrafts([draft({ name: '' })]);
    expect(result).toBe('Todo grupo precisa de um nome.');
  });

  it('rejects no options', () => {
    const result = validateModifierGroupDrafts([draft({ options: [] })]);
    expect(result).toContain('precisa ter pelo menos uma opção');
  });
});
