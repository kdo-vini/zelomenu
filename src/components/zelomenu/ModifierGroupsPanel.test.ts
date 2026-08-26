import { describe, it, expect } from 'vitest';
import { detectModel, applyModel, GROUP_MODELS, isModelCompatible } from './ModifierGroupsPanel';
import type { ZeloMenuModifierGroupDraft } from '../../domain/zelomenuModifiers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function baseDraft(overrides: Partial<ZeloMenuModifierGroupDraft> = {}): ZeloMenuModifierGroupDraft {
  return {
    name: 'Teste',
    kind: 'adicional',
    pricingMode: 'somar',
    minSelections: 0,
    maxSelections: null,
    minTotalQuantity: 0,
    maxTotalQuantity: null,
    allowsQuantity: false,
    maxPerOption: null,
    active: true,
    order: 0,
    options: [],
    ...overrides,
  };
}

// ─── detectModel ──────────────────────────────────────────────────────────────

describe('detectModel', () => {
  it('detects price_swap (variacao + substituir)', () => {
    expect(detectModel(baseDraft({ kind: 'variacao', pricingMode: 'substituir' }))).toBe('price_swap');
  });

  it('detects quantity (allowsQuantity)', () => {
    expect(detectModel(baseDraft({ kind: 'adicional', pricingMode: 'somar', allowsQuantity: true }))).toBe('quantity');
  });

  it('detects price_add for adicional + somar without quantity', () => {
    expect(detectModel(baseDraft({ kind: 'adicional', pricingMode: 'somar' }))).toBe('price_add');
  });

  it('detects free_option when every option is included at no extra cost', () => {
    expect(detectModel(baseDraft({
      kind: 'adicional',
      pricingMode: 'somar',
      options: [{ name: 'Sem cebola', priceDelta: 0, active: true, order: 0 }],
    }))).toBe('free_option');
  });

  it('defaults to price_add for variacao + somar', () => {
    expect(detectModel(baseDraft({ kind: 'variacao', pricingMode: 'somar' }))).toBe('price_add');
  });
});

// ─── applyModel ───────────────────────────────────────────────────────────────

describe('applyModel', () => {
  const priceSwapModel = GROUP_MODELS.find((m) => m.id === 'price_swap')!;
  const priceAddModel = GROUP_MODELS.find((m) => m.id === 'price_add')!;
  const freeOptionModel = GROUP_MODELS.find((m) => m.id === 'free_option')!;
  const quantityModel = GROUP_MODELS.find((m) => m.id === 'quantity')!;

  it('price_swap sets variacao/substituir, forces max=1', () => {
    const result = applyModel(priceSwapModel, baseDraft({ minSelections: 2, maxSelections: 5 }));
    expect(result.kind).toBe('variacao');
    expect(result.pricingMode).toBe('substituir');
    expect(result.minSelections).toBe(1);
    expect(result.maxSelections).toBe(1);
    expect(result.allowsQuantity).toBe(false);
  });

  it('price_swap preserves name and options', () => {
    const draft = baseDraft({ name: 'Tamanho', options: [{ id: 'o1', name: 'P', priceDelta: 10, active: true, order: 0 }] });
    const result = applyModel(priceSwapModel, draft);
    expect(result.name).toBe('Tamanho');
    expect(result.options).toHaveLength(1);
    expect(result.options[0].id).toBe('o1');
  });

  it('price_add sets adicional/somar without quantity', () => {
    const result = applyModel(priceAddModel, baseDraft());
    expect(result.kind).toBe('adicional');
    expect(result.pricingMode).toBe('somar');
    expect(result.allowsQuantity).toBe(false);
  });

  it('free_option sets same fields as price_add', () => {
    const result = applyModel(freeOptionModel, baseDraft());
    expect(result.kind).toBe('adicional');
    expect(result.pricingMode).toBe('somar');
    expect(result.allowsQuantity).toBe(false);
  });

  it('quantity sets adicional/somar with allowsQuantity', () => {
    const result = applyModel(quantityModel, baseDraft());
    expect(result.kind).toBe('adicional');
    expect(result.pricingMode).toBe('somar');
    expect(result.allowsQuantity).toBe(true);
  });

  it('quantity preserves maxPerOption when allowsQuantity', () => {
    const result = applyModel(quantityModel, baseDraft({ maxPerOption: 5 }));
    expect(result.maxPerOption).toBe(5);
  });

  it('quantity preserves the total quantity limits', () => {
    const result = applyModel(quantityModel, baseDraft({ minTotalQuantity: 3, maxTotalQuantity: 3 }));
    expect(result.minTotalQuantity).toBe(3);
    expect(result.maxTotalQuantity).toBe(3);
  });

  it('price_add clears maxPerOption', () => {
    const result = applyModel(priceAddModel, baseDraft({ maxPerOption: 5, allowsQuantity: true }));
    expect(result.maxPerOption).toBeNull();
  });

  it('modelo sem quantidade limpa os limites totais', () => {
    const result = applyModel(priceAddModel, baseDraft({
      allowsQuantity: true,
      minTotalQuantity: 3,
      maxTotalQuantity: 3,
      maxPerOption: 2,
    }));
    expect(result.minTotalQuantity).toBe(0);
    expect(result.maxTotalQuantity).toBeNull();
    expect(result.maxPerOption).toBeNull();
  });

  it('non-price_swap preserves maxSelections', () => {
    const result = applyModel(priceAddModel, baseDraft({ maxSelections: 3 }));
    expect(result.maxSelections).toBe(3);
  });

  it('non-price_swap preserves minSelections', () => {
    const result = applyModel(priceAddModel, baseDraft({ minSelections: 2 }));
    expect(result.minSelections).toBe(2);
  });
});

describe('isModelCompatible', () => {
  it('allows an empty group to choose the free option model', () => {
    expect(isModelCompatible('free_option', baseDraft())).toBe(true);
  });

  it('rejects the free option model when an option has an extra price', () => {
    expect(isModelCompatible('free_option', baseDraft({
      options: [{ name: 'Bacon', priceDelta: 3, active: true, order: 0 }],
    }))).toBe(false);
  });
});
