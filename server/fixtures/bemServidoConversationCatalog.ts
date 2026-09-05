import type { ConversationCatalogProductDefinition } from '../conversationOrderRequirements';

const UUID_SHAPED = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const PHONE_SHAPED = /(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]?\d{4}/;
const URL_SHAPED = /(?:https?:\/\/|www\.)/i;
const FORBIDDEN_KEY = /(empresa|usuario|pessoa|customer|remotejid)/i;

export function assertSanitizedConversationFixture(value: unknown, path = 'fixture'): void {
  if (typeof value === 'string') {
    if (UUID_SHAPED.test(value)) throw new Error(`FIXTURE_UUID_FORBIDDEN:${path}`);
    if (PHONE_SHAPED.test(value)) throw new Error(`FIXTURE_PHONE_FORBIDDEN:${path}`);
    if (URL_SHAPED.test(value)) throw new Error(`FIXTURE_URL_FORBIDDEN:${path}`);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSanitizedConversationFixture(child, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) throw new Error(`FIXTURE_KEY_FORBIDDEN:${path}.${key}`);
      assertSanitizedConversationFixture(child, `${path}.${key}`);
    }
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
}

const catalog: ConversationCatalogProductDefinition[] = [
  { id: 1001, name: 'Coca-Cola Original 350 ml', basePrice: 6, available: true, modifierGroups: [] },
  { id: 1002, name: 'Coca-Cola Sem Açúcar 350 ml', basePrice: 6, available: true, modifierGroups: [] },
  { id: 1003, name: 'Coca-Cola Original 600 ml', basePrice: 9, available: true, modifierGroups: [] },
  { id: 1004, name: 'Coca-Cola Sem Açúcar 600 ml', basePrice: 9, available: true, modifierGroups: [] },
  { id: 1005, name: 'Coca-Cola Original 1 L', basePrice: 12, available: true, modifierGroups: [] },
  { id: 1006, name: 'Coca-Cola Sem Açúcar 1 L', basePrice: 12, available: true, modifierGroups: [] },
  {
    id: 1007,
    name: 'Monte Sua Massa',
    basePrice: 0,
    available: true,
    modifierGroups: [
      {
        id: 'g001',
        name: 'Escolha a massa',
        kind: 'variacao',
        pricingMode: 'substituir',
        minSelections: 1,
        maxSelections: 1,
        minTotalQuantity: 1,
        maxTotalQuantity: 1,
        allowsQuantity: false,
        maxPerOption: 1,
        order: 1,
        options: [
          { id: 'o001', name: 'Espaguete', currentPrice: 22, priceDelta: 22, available: true, order: 1 },
          { id: 'o002', name: 'Talharim', currentPrice: 25, priceDelta: 25, available: true, order: 2 },
        ],
      },
      {
        id: 'g002',
        name: 'Escolha o molho',
        kind: 'adicional',
        pricingMode: 'somar',
        minSelections: 1,
        maxSelections: 1,
        minTotalQuantity: 1,
        maxTotalQuantity: 1,
        allowsQuantity: false,
        maxPerOption: 1,
        order: 2,
        options: [
          { id: 'o003', name: 'Molho ao sugo', currentPrice: 0, priceDelta: 0, available: true, order: 1 },
          { id: 'o004', name: 'Molho branco', currentPrice: 0, priceDelta: 0, available: true, order: 2 },
        ],
      },
      {
        id: 'g003',
        name: 'Proteínas',
        kind: 'adicional',
        pricingMode: 'somar',
        minSelections: 0,
        maxSelections: 2,
        minTotalQuantity: 0,
        maxTotalQuantity: 2,
        allowsQuantity: true,
        maxPerOption: 2,
        order: 3,
        options: [
          { id: 'o005', name: 'Bife acebolado', currentPrice: 12, priceDelta: 12, available: true, order: 1 },
          { id: 'o006', name: 'Frango grelhado', currentPrice: 10, priceDelta: 10, available: true, order: 2 },
          { id: 'o007', name: 'Calabresa acebolada', currentPrice: 9, priceDelta: 9, available: true, order: 3 },
        ],
      },
      {
        id: 'g004',
        name: 'Acompanhamentos',
        kind: 'adicional',
        pricingMode: 'somar',
        minSelections: 0,
        maxSelections: 2,
        minTotalQuantity: 0,
        maxTotalQuantity: 2,
        allowsQuantity: false,
        maxPerOption: 1,
        order: 4,
        options: [
          { id: 'o008', name: 'Salada', currentPrice: 0, priceDelta: 0, available: true, order: 1 },
          { id: 'o009', name: 'Batata palha', currentPrice: 0, priceDelta: 0, available: true, order: 2 },
          { id: 'o010', name: 'Legumes', currentPrice: 0, priceDelta: 0, available: false, order: 3 },
        ],
      },
      {
        id: 'g005',
        name: 'Extra pago',
        kind: 'adicional',
        pricingMode: 'somar',
        minSelections: 0,
        maxSelections: 2,
        minTotalQuantity: 0,
        maxTotalQuantity: 4,
        allowsQuantity: true,
        maxPerOption: 2,
        order: 5,
        options: [
          { id: 'o011', name: 'Queijo ralado', currentPrice: 3, priceDelta: 3, available: true, order: 1 },
          { id: 'o012', name: 'Bacon crocante', currentPrice: 5, priceDelta: 5, available: true, order: 2 },
        ],
      },
    ],
  },
];

assertSanitizedConversationFixture(catalog);

export const bemServidoConversationCatalog = deepFreeze(catalog);
