import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessConfig, CatalogProduct } from './configStore';
import { bemServidoConversationCatalog } from './fixtures/bemServidoConversationCatalog';

let products: CatalogProduct[] = [];
let deliveryConfig: BusinessConfig['deliveryConfig'] = null;

const weeklyHours = {
  sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [],
};

function config(): BusinessConfig {
  return {
    name: 'Lanchonete Canônica',
    address: 'Rua Teste, 10',
    contato: null,
    deliveryConfig,
    pixReceiptConfig: null,
    pixPayment: null,
    publicationSummary: { total: products.length, published: products.filter((p) => p.available).length, unpublished: 0, paused: 0, hidden: 0, outOfStock: 0, missingCategory: 0, attention: 0 },
    catalogHierarchy: [{ nome: 'Lanches', subcategorias: [], produtosDireto: products }],
    products,
    weeklyHours,
    schedulingEnabled: true,
    schedulingLeadTimeMinutes: 0,
    closedDays: [],
  };
}

vi.mock('./configStore.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./configStore.js')>(),
  loadCatalogFromDb: vi.fn(async () => undefined),
  getConfig: () => config(),
}));

vi.mock('./zelomenuDeliveryService.js', () => ({
  revalidateDeliveryForCart: vi.fn(),
  createDeliveryQuoteRequest: vi.fn(),
  findDeliveryQuoteRequest: vi.fn(),
}));

import { materializeWhatsAppOrderDraft } from './zelomenuCartSessions';

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 10,
    name: 'X-Bacon oficial',
    price: 20,
    basePrice: 20,
    available: true,
    stockControlled: false,
    stockQuantity: 0,
    modifierGroups: [{
      id: 'g1', productId: 10, name: 'Adicionais', kind: 'adicional', pricingMode: 'somar',
      minSelections: 0, maxSelections: 2, minTotalQuantity: 0, maxTotalQuantity: null,
      allowsQuantity: false, maxPerOption: null, active: true, order: 0,
      options: [{ id: 'o1', name: 'Bacon extra', priceDelta: 3, active: true, order: 0 }],
    }],
    ...overrides,
  };
}

function massProduct(): CatalogProduct {
  const source = bemServidoConversationCatalog.find((candidate) => candidate.id === 1007)!;
  return {
    id: source.id,
    name: source.name,
    price: source.basePrice,
    basePrice: source.basePrice,
    available: source.available,
    stockControlled: false,
    stockQuantity: 0,
    modifierGroups: source.modifierGroups.map((group) => ({
      ...group,
      productId: source.id,
      active: true,
      options: group.options.map((option) => ({
        id: option.id,
        name: option.name,
        priceDelta: option.priceDelta,
        active: option.available,
        order: option.order,
      })),
    })),
  };
}

function productsWithSharedLinkedStock(stockQuantity: number): CatalogProduct[] {
  const linkedProduct = product({
    id: 20,
    name: 'Porção vinculada',
    price: 5,
    basePrice: 5,
    stockControlled: true,
    stockQuantity,
    modifierGroups: [],
  });
  const linkedOption = (id: string) => ({
    id,
    name: 'Porção extra',
    priceDelta: 5,
    active: true,
    order: 0,
    linkedProduct: {
      productId: linkedProduct.id,
      name: linkedProduct.name,
      photoUrl: null,
      price: linkedProduct.price,
      available: true,
    },
  });

  return [
    product({
      modifierGroups: [
        {
          id: 'g-stock-a', productId: 10, name: 'Primeiro grupo', kind: 'adicional', pricingMode: 'somar',
          minSelections: 0, maxSelections: 1, minTotalQuantity: 0, maxTotalQuantity: 5,
          allowsQuantity: true, maxPerOption: 5, active: true, order: 0,
          options: [linkedOption('o-stock-a')],
        },
        {
          id: 'g-stock-b', productId: 10, name: 'Segundo grupo', kind: 'adicional', pricingMode: 'somar',
          minSelections: 0, maxSelections: 1, minTotalQuantity: 0, maxTotalQuantity: 5,
          allowsQuantity: true, maxPerOption: 5, active: true, order: 1,
          options: [linkedOption('o-stock-b')],
        },
      ],
    }),
    linkedProduct,
  ];
}

function sharedLinkedStockItems() {
  return [
    {
      lineId: 'line-1',
      productId: 10,
      quantity: 2,
      selectedOptions: [{ groupId: 'g-stock-a', optionSelections: [{ optionId: 'o-stock-a', quantity: 2 }] }],
    },
    {
      lineId: 'line-2',
      productId: 10,
      quantity: 3,
      selectedOptions: [{ groupId: 'g-stock-b', optionSelections: [{ optionId: 'o-stock-b', quantity: 1 }] }],
    },
  ];
}

const EMPRESA_ID = '10000000-0000-4000-8000-000000000001';

beforeEach(() => {
  products = [product()];
  deliveryConfig = null;
});

describe('materializeWhatsAppOrderDraft', () => {
  it('materializa nomes, preços, complementos, subtotal e asap somente pelo servidor', async () => {
    const result = await materializeWhatsAppOrderDraft({
      empresaId: EMPRESA_ID,
      items: [{ lineId: 'line-1', productId: 10, quantity: 2, selectedOptions: [{ groupId: 'g1', optionSelections: [{ optionId: 'o1', quantity: 1 }] }] }],
      fulfillment: { type: 'pickup' },
    });

    expect(result.cart.items[0]).toMatchObject({ lineId: 'line-1', productName: 'X-Bacon oficial', baseUnitPrice: 20, unitPrice: 23, quantity: 2, lineTotal: 46 });
    expect(result.cart.items[0].selectedModifiers[0].selectedOptions[0]).toMatchObject({ optionName: 'Bacon extra', priceDelta: 3 });
    expect(result.pricing).toMatchObject({ subtotal: 46, deliveryFee: 0, total: 46 });
    expect(result.fulfillment).toMatchObject({ type: 'pickup', asap: true });
  });

  it('preserva a massa parcial no preço conhecido e pede somente o molho obrigatório mais opcionais', async () => {
    products = [massProduct()];

    const result = await materializeWhatsAppOrderDraft({
      empresaId: EMPRESA_ID,
      items: [{
        lineId: 'massa-1',
        productId: 1007,
        quantity: 1,
        selectedOptions: [{ groupId: 'g001', optionSelections: [{ optionId: 'o002', quantity: 1 }] }],
      }],
      customer: { name: 'Ana' },
      fulfillment: { type: 'pickup' },
      paymentMethod: 'dinheiro',
    });

    expect(result.cart.items[0]).toMatchObject({
      lineId: 'massa-1',
      productName: 'Monte Sua Massa',
      unitPrice: 25,
      lineTotal: 25,
    });
    expect(result.cart.items[0].selectedModifiers[0].selectedOptions[0]).toMatchObject({
      optionName: 'Talharim',
      priceDelta: 25,
    });
    expect(result.pricing).toMatchObject({ subtotal: 25, total: 25 });
    expect(result.requirements.map((requirement) => ({
      type: requirement.type,
      groupId: requirement.type === 'modifier_group' ? requirement.groupId : null,
      blocking: requirement.blocking,
    }))).toEqual([
      { type: 'modifier_group', groupId: 'g002', blocking: true },
      { type: 'modifier_group', groupId: 'g003', blocking: false },
      { type: 'modifier_group', groupId: 'g004', blocking: false },
      { type: 'modifier_group', groupId: 'g005', blocking: false },
    ]);
    expect(result.readyForConfirmation).toBe(false);
  });

  it('rejeita opção existente em outro produto em vez de aceitar IDs globais', async () => {
    products = [product(), massProduct()];

    await expect(materializeWhatsAppOrderDraft({
      empresaId: EMPRESA_ID,
      items: [{
        lineId: 'massa-1',
        productId: 1007,
        quantity: 1,
        selectedOptions: [{ groupId: 'g002', optionSelections: [{ optionId: 'o1', quantity: 1 }] }],
      }],
      fulfillment: { type: 'pickup' },
    })).rejects.toThrow('MODIFIER_INVALID:OPTION_OUTSIDE_PRODUCT');
  });

  it.each([
    {
      label: 'opções distintas',
      group: {
        maxSelections: 2,
        maxTotalQuantity: null,
        allowsQuantity: false,
        maxPerOption: null,
      },
      optionSelections: [
        { optionId: 'o1', quantity: 1 },
        { optionId: 'o2', quantity: 1 },
        { optionId: 'o3', quantity: 1 },
      ],
      expected: 'MODIFIER_INVALID:DISTINCT_SELECTIONS_EXCEEDED',
    },
    {
      label: 'quantidade total',
      group: {
        maxSelections: 2,
        maxTotalQuantity: 2,
        allowsQuantity: true,
        maxPerOption: null,
      },
      optionSelections: [
        { optionId: 'o1', quantity: 2 },
        { optionId: 'o2', quantity: 1 },
      ],
      expected: 'MODIFIER_INVALID:TOTAL_QUANTITY_EXCEEDED',
    },
    {
      label: 'quantidade por opção',
      group: {
        maxSelections: 2,
        maxTotalQuantity: 4,
        allowsQuantity: true,
        maxPerOption: 2,
      },
      optionSelections: [{ optionId: 'o1', quantity: 3 }],
      expected: 'MODIFIER_INVALID:OPTION_QUANTITY_EXCEEDED',
    },
  ])('rejeita excesso de $label sem truncar seleções', async ({ group, optionSelections, expected }) => {
    products = [product({
      modifierGroups: [{
        id: 'g1', productId: 10, name: 'Adicionais', kind: 'adicional', pricingMode: 'somar',
        minSelections: 0, minTotalQuantity: 0, active: true, order: 0,
        options: [
          { id: 'o1', name: 'Primeiro', priceDelta: 1, active: true, order: 0 },
          { id: 'o2', name: 'Segundo', priceDelta: 2, active: true, order: 1 },
          { id: 'o3', name: 'Terceiro', priceDelta: 3, active: true, order: 2 },
        ],
        ...group,
      }],
    })];

    await expect(materializeWhatsAppOrderDraft({
      empresaId: EMPRESA_ID,
      items: [{
        lineId: 'line-1',
        productId: 10,
        quantity: 1,
        selectedOptions: [{ groupId: 'g1', optionSelections }],
      }],
      fulfillment: { type: 'pickup' },
    })).rejects.toThrow(expected);
  });

  it('mantém modalidade ausente como nula e requisito bloqueante', async () => {
    const result = await materializeWhatsAppOrderDraft({
      empresaId: EMPRESA_ID,
      items: [{ lineId: 'line-1', productId: 10, quantity: 1 }],
    });

    expect(result.fulfillment.type).toBeNull();
    expect(result.requirements).toContainEqual({
      id: 'fulfillment_type',
      type: 'fulfillment_type',
      name: 'Escolha entrega ou retirada.',
      blocking: true,
    });
    expect(result.readyForConfirmation).toBe(false);
  });

  it('mantém o rascunho bloqueado enquanto faltar o nome do cliente', async () => {
    const result = await materializeWhatsAppOrderDraft({
      empresaId: EMPRESA_ID,
      items: [{ lineId: 'line-1', productId: 10, quantity: 1 }],
      fulfillment: { type: 'pickup' },
      paymentMethod: 'dinheiro',
    });

    expect(result.requirements).toContainEqual({
      id: 'customer_name',
      type: 'customer_name',
      name: 'Informe o nome para o pedido.',
      blocking: true,
    });
    expect(result.readyForConfirmation).toBe(false);
  });

  it('mantém o rascunho bloqueado enquanto faltar a forma de pagamento', async () => {
    const result = await materializeWhatsAppOrderDraft({
      empresaId: EMPRESA_ID,
      items: [{ lineId: 'line-1', productId: 10, quantity: 1 }],
      customer: { name: 'Ana' },
      fulfillment: { type: 'pickup' },
    });

    expect(result.requirements).toContainEqual({
      id: 'payment_method',
      type: 'payment_method',
      name: 'Escolha a forma de pagamento.',
      blocking: true,
    });
    expect(result.readyForConfirmation).toBe(false);
  });

  it('lista endereço, número e bairro ausentes em uma entrega', async () => {
    deliveryConfig = { enabled: true, neighborhoods: [] };
    const result = await materializeWhatsAppOrderDraft({
      empresaId: EMPRESA_ID,
      items: [{ lineId: 'line-1', productId: 10, quantity: 1 }],
      customer: { name: 'Ana' },
      fulfillment: { type: 'delivery' },
      paymentMethod: 'dinheiro',
    });

    expect(result.requirements).toContainEqual({
      id: 'delivery_address',
      type: 'delivery_address',
      name: 'Informe o endereço de entrega.',
      blocking: true,
      missingFields: ['address', 'number', 'neighborhood'],
    });
    expect(result.readyForConfirmation).toBe(false);
  });

  it('lista data e horário ausentes quando o pedido é agendado', async () => {
    const result = await materializeWhatsAppOrderDraft({
      empresaId: EMPRESA_ID,
      items: [{ lineId: 'line-1', productId: 10, quantity: 1 }],
      customer: { name: 'Ana' },
      fulfillment: { type: 'pickup', asap: false },
      paymentMethod: 'dinheiro',
    });

    expect(result.requirements).toContainEqual({
      id: 'schedule',
      type: 'schedule',
      name: 'Informe a data e o horário do pedido.',
      blocking: true,
      missingFields: ['date', 'time'],
    });
    expect(result.readyForConfirmation).toBe(false);
  });

  it.each(['invisível', 'pausado'])('rejeita produto %s na projeção pública canônica', async () => {
    products = [product({ available: false })];
    await expect(materializeWhatsAppOrderDraft({ empresaId: EMPRESA_ID, items: [{ lineId: 'line-1', productId: 10, quantity: 1 }] }))
      .rejects.toThrow('PRODUCT_UNAVAILABLE');
  });

  it('rejeita produto sem estoque e montagem com opção inválida', async () => {
    products = [product({ stockControlled: true, stockQuantity: 0 })];
    await expect(materializeWhatsAppOrderDraft({ empresaId: EMPRESA_ID, items: [{ lineId: 'line-1', productId: 10, quantity: 1 }] }))
      .rejects.toThrow(/PRODUCT_STOCK_EXCEEDED/);

    products = [product()];
    await expect(materializeWhatsAppOrderDraft({
      empresaId: EMPRESA_ID,
      items: [{ lineId: 'line-1', productId: 10, quantity: 1, selectedOptions: [{ groupId: 'g1', optionSelections: [{ optionId: 'inexistente', quantity: 1 }] }] }],
    })).rejects.toThrow(/MODIFIER_INVALID/);
  });

  it('soma a demanda do mesmo produto vinculado entre linhas e grupos', async () => {
    products = productsWithSharedLinkedStock(6);

    await expect(materializeWhatsAppOrderDraft({
      empresaId: EMPRESA_ID,
      items: sharedLinkedStockItems(),
    })).rejects.toThrow(
      'PRODUCT_STOCK_EXCEEDED:{"productName":"Porção vinculada","availableQuantity":6,"requestedQuantity":7}',
    );
  });

  it('aceita a montagem quando o estoque cobre exatamente a demanda vinculada agregada', async () => {
    products = productsWithSharedLinkedStock(7);

    await expect(materializeWhatsAppOrderDraft({
      empresaId: EMPRESA_ID,
      items: sharedLinkedStockItems(),
    })).resolves.toMatchObject({
      cart: {
        items: [
          { lineId: 'line-1', quantity: 2 },
          { lineId: 'line-2', quantity: 3 },
        ],
      },
    });
  });

  it('rejeita demanda vinculada fora do inteiro seguro pelo caminho de quantidade inválida', async () => {
    products = productsWithSharedLinkedStock(Number.MAX_SAFE_INTEGER);
    products[0].modifierGroups[0] = {
      ...products[0].modifierGroups[0],
      maxTotalQuantity: null,
      maxPerOption: null,
    };

    await expect(materializeWhatsAppOrderDraft({
      empresaId: EMPRESA_ID,
      items: [{
        lineId: 'line-1',
        productId: 10,
        quantity: 2,
        selectedOptions: [{
          groupId: 'g-stock-a',
          optionSelections: [{ optionId: 'o-stock-a', quantity: Number.MAX_SAFE_INTEGER }],
        }],
      }],
    })).rejects.toThrowError(/^MODIFIER_QUANTITY_INVALID$/);
  });

  it('não usa nome como fallback quando o ID solicitado não existe', async () => {
    await expect(materializeWhatsAppOrderDraft({ empresaId: EMPRESA_ID, items: [{ lineId: 'line-1', productId: 999, quantity: 1 }] }))
      .rejects.toThrow('PRODUCT_NOT_FOUND');
  });
});

describe('migração de paridade dos componentes na confirmação', () => {
  it('trava e resolve componentes canônicos, inclusive na viabilidade de grupos obrigatórios', () => {
    const sql = readFileSync(
      'supabase/migrations/20260902120000_whatsapp_materializer_component_parity.sql',
      'utf8',
    );
    const materializer = sql.match(
      /create or replace function public\.zelomenu_whatsapp_materialize_cart_v1\([\s\S]*?\n\$\$;/i,
    )?.[0];

    expect(materializer).toBeDefined();
    expect(materializer).toMatch(
      /returns jsonb\s+language plpgsql\s+security definer\s+set search_path = public, pg_temp/is,
    );
    expect(materializer).toMatch(
      /from public\.zelomenu_modifier_components component[\s\S]*?for update of component/is,
    );
    expect(materializer).toMatch(
      /left join public\.zelomenu_modifier_components linked_component\s+on linked_component\.id = link\.id_componente\s+and linked_component\.id_usuario = v_owner/is,
    );

    const requiredGroupViability = materializer?.match(
      /if exists\s*\(\s*select 1\s+from public\.zelomenu_modifier_groups required_group[\s\S]*?\) < required_group\.min_selecoes[\s\S]*?end if;/i,
    )?.[0];
    expect(requiredGroupViability).toBeDefined();
    expect(requiredGroupViability).toMatch(
      /link\.id_componente is not null\s+and linked_component\.id is not null\s+and not coalesce\(linked_component\.pausado_manualmente, false\)/is,
    );
    expect(materializer).toMatch(
      /link\.id_componente is not null and \(\s+linked_component\.id is null\s+or coalesce\(linked_component\.pausado_manualmente, false\)/is,
    );
    expect(materializer).toMatch(
      /coalesce\(nullif\(publication\.nome_publico, ''\), linked_product\.nome, linked_component\.nome, o\.nome\) as option_name/is,
    );
    expect(materializer).toMatch(
      /coalesce\(link\.price_override, linked_product\.preco, o\.price_delta\)::numeric\(10,2\) as resolved_price/is,
    );
    expect(materializer).toMatch(
      /if v_option\.linked_product_id is not null then\s+v_requirements := v_requirements/is,
    );
    expect(sql).toMatch(
      /revoke all on function public\.zelomenu_whatsapp_materialize_cart_v1\(uuid, jsonb\)\s+from public, anon, authenticated;[\s\S]*?grant execute on function public\.zelomenu_whatsapp_materialize_cart_v1\(uuid, jsonb\) to service_role;/is,
    );
  });
});
