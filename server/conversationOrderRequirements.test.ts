import { describe, expect, it } from 'vitest';
import {
  assertSanitizedConversationFixture,
  bemServidoConversationCatalog,
} from './fixtures/bemServidoConversationCatalog';
import {
  deriveModifierRequirements,
  type ConversationCatalogProductDefinition,
  type ConversationRequirementLine,
} from './conversationOrderRequirements';

const massProduct = bemServidoConversationCatalog.find((product) => product.id === 1007)!;
const catalog: ConversationCatalogProductDefinition[] = [{
  ...massProduct,
  modifierGroups: massProduct.modifierGroups.slice(0, 3),
}];

const emptyMassLine: ConversationRequirementLine = {
  lineId: 'line-1',
  productId: 1007,
  selectedOptions: [],
};

const threeProteinsLine: ConversationRequirementLine = {
  ...emptyMassLine,
  selectedOptions: [{
    groupId: 'g003',
    optionSelections: [{ optionId: 'o005', quantity: 3 }],
  }],
};

describe('fixture conversacional anônima', () => {
  it('congela sete produtos artificiais e o preço mínimo completo da massa', () => {
    expect(bemServidoConversationCatalog.map((product) => product.id)).toEqual([
      1001, 1002, 1003, 1004, 1005, 1006, 1007,
    ]);
    expect(bemServidoConversationCatalog.slice(0, 6).every((product) => product.available)).toBe(true);
    expect(bemServidoConversationCatalog.slice(0, 6).every((product) => product.name.startsWith('Coca-Cola'))).toBe(true);
    expect(massProduct.modifierGroups.map((group) => group.id)).toEqual([
      'g001', 'g002', 'g003', 'g004', 'g005',
    ]);
    expect(massProduct.modifierGroups.flatMap((group) => group.options.map((option) => option.id))).toEqual([
      'o001', 'o002', 'o003', 'o004', 'o005', 'o006',
      'o007', 'o008', 'o009', 'o010', 'o011', 'o012',
    ]);
    expect(massProduct.modifierGroups[0].options[0]).toMatchObject({ currentPrice: 22, priceDelta: 22 });
    expect(massProduct.modifierGroups[2].options[0]).toMatchObject({ name: 'Bife acebolado', priceDelta: 12 });
    expect(Object.isFrozen(bemServidoConversationCatalog)).toBe(true);
    expect(Object.isFrozen(massProduct.modifierGroups[0].options)).toBe(true);
  });

  it.each([
    [{ id: '123e4567-e89b-42d3-a456-426614174000' }, 'FIXTURE_UUID_FORBIDDEN'],
    [{ contato: '(11) 99999-9999' }, 'FIXTURE_PHONE_FORBIDDEN'],
    [{ foto: 'https://example.invalid/item.png' }, 'FIXTURE_URL_FORBIDDEN'],
    [{ empresaReferencia: 'anonima' }, 'FIXTURE_KEY_FORBIDDEN'],
    [{ USUARIO_INTERNO: 'anonimo' }, 'FIXTURE_KEY_FORBIDDEN'],
    [{ pessoaId: 'anonima' }, 'FIXTURE_KEY_FORBIDDEN'],
    [{ customerName: 'anonimo' }, 'FIXTURE_KEY_FORBIDDEN'],
    [{ remoteJidOriginal: 'anonimo' }, 'FIXTURE_KEY_FORBIDDEN'],
  ])('rejeita identificadores sensíveis recursivamente em %#', (unsafeValue, code) => {
    expect(() => assertSanitizedConversationFixture({ nested: [unsafeValue] })).toThrowError(code);
  });
});

describe('deriveModifierRequirements', () => {
  it('deriva grupos obrigatórios e opcionais na ordem de exibição', () => {
    expect(deriveModifierRequirements([emptyMassLine], catalog)).toMatchObject([
      { id: 'line-1:g001', blocking: true, minSelections: 1, maxSelections: 1 },
      { id: 'line-1:g002', blocking: true, minSelections: 1, maxSelections: 1 },
      { id: 'line-1:g003', blocking: false, maxSelections: 2 },
    ]);
  });

  it('mantém limites distintos dos limites de quantidade total', () => {
    const proteinRequirement = deriveModifierRequirements([emptyMassLine], catalog)[2];

    expect(proteinRequirement).toMatchObject({
      minSelections: 0,
      maxSelections: 2,
      minTotalQuantity: 0,
      maxTotalQuantity: 2,
      allowsQuantity: true,
      maxPerOption: 2,
    });
    expect(() => deriveModifierRequirements([threeProteinsLine], catalog))
      .toThrowError('MODIFIER_TOTAL_QUANTITY_EXCEEDED:g003');
  });

  it('rejeita excesso de opções distintas sem confundir com quantidade total', () => {
    const oneDistinctProteinCatalog: ConversationCatalogProductDefinition[] = [{
      ...catalog[0],
      modifierGroups: catalog[0].modifierGroups.map((group) => group.id === 'g003'
        ? { ...group, maxSelections: 1, maxTotalQuantity: 3 }
        : group),
    }];
    const twoProteinsLine: ConversationRequirementLine = {
      ...emptyMassLine,
      selectedOptions: [{
        groupId: 'g003',
        optionSelections: [
          { optionId: 'o005', quantity: 1 },
          { optionId: 'o006', quantity: 1 },
        ],
      }],
    };

    expect(() => deriveModifierRequirements([twoProteinsLine], oneDistinctProteinCatalog))
      .toThrowError('MODIFIER_DISTINCT_SELECTIONS_EXCEEDED:g003');
  });

  it('omite opções indisponíveis sem alterar a ordem do catálogo', () => {
    const requirements = deriveModifierRequirements([emptyMassLine], [massProduct]);

    expect(requirements.map((requirement) => requirement.groupId)).toEqual([
      'g001', 'g002', 'g003', 'g004', 'g005',
    ]);
    expect(requirements[3].options.map((option) => option.id)).toEqual(['o008', 'o009']);
  });

  it('só sugere seleção automática para grupo obrigatório com uma opção disponível', () => {
    const singleRequiredChoiceCatalog: ConversationCatalogProductDefinition[] = [{
      ...catalog[0],
      modifierGroups: catalog[0].modifierGroups.map((group) => group.id === 'g002'
        ? { ...group, options: group.options.map((option, index) => ({ ...option, available: index === 0 })) }
        : group),
    }];

    const requirements = deriveModifierRequirements([emptyMassLine], singleRequiredChoiceCatalog);

    expect(requirements[0].autoSelectableOptionId).toBeUndefined();
    expect(requirements[1].autoSelectableOptionId).toBe('o003');
    expect(requirements[2].autoSelectableOptionId).toBeUndefined();
  });
});
