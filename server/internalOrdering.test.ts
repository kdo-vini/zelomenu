import { createServer } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationOrderingError,
  createConversationOrdering,
  type ConversationOrderingAdapter,
  type ConversationOrderingRecord,
  type DraftMaterialization,
  type OrderingSnapshot,
} from './conversationOrdering';
import { createInternalOrderingRouter, parseInternalOrderingCommand } from './internalOrdering';
import { createInternalCatalogFailureLimiter } from './internalCatalogRateLimit';
import { bemServidoConversationCatalog } from './fixtures/bemServidoConversationCatalog';

const EMPRESA = '10000000-0000-4000-8000-000000000001';
const ORDERING = '30000000-0000-4000-8000-000000000001';
const CONVERSATION_CONTROL = '60000000-0000-4000-8000-000000000001';
const JID = '5511999999999@s.whatsapp.net';
const servers: ReturnType<typeof createServer>[] = [];

function snapshot(): OrderingSnapshot {
  return {
    orderingId: ORDERING,
    empresaId: EMPRESA,
    remoteJid: JID,
    state: 'cart_open',
    revision: 1,
    updatedAt: '2026-08-30T12:00:00.000Z',
    pessoaId: null,
    customer: { name: null, phone: null },
    cart: { items: [], observations: null },
    fulfillment: { type: 'pickup', asap: true, pickupDate: null, pickupTime: null, deliveryAddress: null, deliveryNeighborhood: null, deliveryFee: 0, deliveryFeeToConfirm: false },
    pricing: { subtotal: 0, deliveryFee: 0, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: 0 },
    payment: { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false },
    revalidation: { checkedAt: '2026-08-30T12:00:00.000Z', ok: true, issues: [] },
    requirements: [],
    readyForConfirmation: true,
    order: null,
    confirmationAction: { type: 'confirm_order', token: 'token-opaco-com-tamanho-valido', revision: 1, expiresAt: '2026-08-30T12:10:00.000Z' },
    requiresReview: false,
  };
}

async function start(options: {
  quotaMax?: number;
  ordering?: Parameters<typeof createInternalOrderingRouter>[0];
} = {}) {
  const ordering = options.ordering ?? { apply: vi.fn(async () => snapshot()), getSnapshot: vi.fn(async () => snapshot()) };
  const app = express();
  app.use((req, res, next) => {
    res.locals.requestId = req.header('x-request-id') ?? 'request-gerado';
    res.setHeader('x-request-id', res.locals.requestId);
    next();
  });
  app.use('/internal/ordering', createInternalCatalogFailureLimiter({ isInternalKeyValid: (key) => key === 'valid' }));
  app.use(express.json({ limit: '4kb' }));
  app.use('/internal/ordering', createInternalOrderingRouter(ordering, { quotaMax: options.quotaMax }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return { ordering, baseUrl: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  try {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
  } finally {
    vi.restoreAllMocks();
  }
});

function validCommand(empresaId = EMPRESA) {
  return {
    type: 'open_or_update_draft', empresaId, remoteJid: JID,
    messageId: 'wamid.valid-message-123456',
    conversationControlId: CONVERSATION_CONTROL,
    conversationEpoch: '42',
    draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 2, notes: 'sem cebola' }] },
  };
}

function massRequirement(
  groupId: 'g002' | 'g003' | 'g004' | 'g005',
  blocking: boolean,
): OrderingSnapshot['requirements'][number] {
  const product = bemServidoConversationCatalog.find((candidate) => candidate.id === 1007)!;
  const group = product.modifierGroups.find((candidate) => candidate.id === groupId)!;
  return {
    id: `massa-1:${group.id}`,
    type: 'modifier_group',
    lineId: 'massa-1',
    productId: product.id,
    groupId: group.id,
    name: group.name,
    blocking,
    kind: group.kind,
    pricingMode: group.pricingMode,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    minTotalQuantity: group.minTotalQuantity,
    maxTotalQuantity: group.maxTotalQuantity,
    allowsQuantity: group.allowsQuantity,
    maxPerOption: group.maxPerOption,
    selectedDistinctCount: 0,
    selectedTotalQuantity: 0,
    options: group.options
      .filter((option) => option.available)
      .map((option) => ({ ...option })),
  };
}

function massSnapshot(complete: boolean): OrderingSnapshot {
  const selectedModifiers: OrderingSnapshot['cart']['items'][number]['selectedModifiers'] = [{
    groupId: 'g001',
    groupName: 'Escolha a massa',
    kind: 'variacao',
    selectedOptions: [{ optionId: 'o002', optionName: 'Talharim', priceDelta: 25, quantity: 1 }],
  }];
  if (complete) {
    selectedModifiers.push({
      groupId: 'g002',
      groupName: 'Escolha o molho',
      kind: 'adicional',
      selectedOptions: [{ optionId: 'o003', optionName: 'Molho ao sugo', priceDelta: 0, quantity: 1 }],
    });
  }
  const revision = complete ? 2 : 1;
  return {
    orderingId: ORDERING,
    empresaId: EMPRESA,
    remoteJid: JID,
    state: 'cart_open',
    revision,
    updatedAt: complete ? '2026-09-02T12:01:00.000Z' : '2026-09-02T12:00:00.000Z',
    pessoaId: null,
    customer: { name: 'Cliente de teste', phone: null },
    cart: {
      items: [{
        lineId: 'massa-1',
        productId: 1007,
        productName: 'Monte Sua Massa',
        baseUnitPrice: 0,
        selectedModifiers,
        modifierDeltaTotal: 25,
        quantity: 1,
        unitPrice: 25,
        lineTotal: 25,
        notes: null,
      }],
      observations: null,
    },
    fulfillment: {
      type: 'pickup',
      asap: true,
      pickupDate: null,
      pickupTime: null,
      deliveryAddress: null,
      deliveryNeighborhood: null,
      deliveryFee: 0,
      deliveryFeeToConfirm: false,
    },
    pricing: {
      subtotal: 25,
      deliveryFee: 0,
      discount: 0,
      couponCode: null,
      couponDiscountType: null,
      couponDiscountValue: null,
      total: 25,
    },
    payment: { declaredMethod: 'dinheiro', pixReceiptRequired: false, pixReceiptApproved: false },
    revalidation: {
      checkedAt: complete ? '2026-09-02T12:01:00.000Z' : '2026-09-02T12:00:00.000Z',
      ok: true,
      issues: [],
    },
    requirements: complete
      ? [massRequirement('g003', false), massRequirement('g004', false), massRequirement('g005', false)]
      : [massRequirement('g002', true), massRequirement('g003', false), massRequirement('g004', false), massRequirement('g005', false)],
    readyForConfirmation: complete,
    order: null,
    confirmationAction: complete ? {
      type: 'confirm_order',
      token: 'confirmacao-teste-opaca-123456',
      revision,
      expiresAt: '2026-09-02T12:11:00.000Z',
    } : null,
    requiresReview: false,
  };
}

function massMaterialization(complete: boolean): DraftMaterialization {
  const snapshot = massSnapshot(complete);
  return {
    cart: snapshot.cart,
    customer: snapshot.customer,
    fulfillment: snapshot.fulfillment,
    payment: snapshot.payment,
    pricing: snapshot.pricing,
    revalidation: snapshot.revalidation,
    requirements: snapshot.requirements,
    readyForConfirmation: snapshot.readyForConfirmation,
  };
}

function massRecord(complete: boolean): ConversationOrderingRecord {
  const snapshot = massSnapshot(complete);
  return {
    ...massMaterialization(complete),
    sessionId: '20000000-0000-4000-8000-000000000001',
    orderingId: snapshot.orderingId,
    empresaId: snapshot.empresaId,
    remoteJid: snapshot.remoteJid,
    state: snapshot.state,
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    pessoaId: snapshot.pessoaId,
    processedMessageIds: complete ? ['wamid.mass-open-123456', 'wamid.mass-complete-123456'] : ['wamid.mass-open-123456'],
    order: snapshot.order,
  };
}

const expectedRequirements = {
  g002: {
    id: 'massa-1:g002', type: 'modifier_group', lineId: 'massa-1', productId: 1007,
    groupId: 'g002', name: 'Escolha o molho', blocking: true, kind: 'adicional', pricingMode: 'somar',
    minSelections: 1, maxSelections: 1, minTotalQuantity: 1, maxTotalQuantity: 1,
    allowsQuantity: false, maxPerOption: 1, selectedDistinctCount: 0, selectedTotalQuantity: 0,
    options: [
      { id: 'o003', name: 'Molho ao sugo', currentPrice: 0, priceDelta: 0, available: true, order: 1 },
      { id: 'o004', name: 'Molho branco', currentPrice: 0, priceDelta: 0, available: true, order: 2 },
    ],
  },
  g003: {
    id: 'massa-1:g003', type: 'modifier_group', lineId: 'massa-1', productId: 1007,
    groupId: 'g003', name: 'Proteínas', blocking: false, kind: 'adicional', pricingMode: 'somar',
    minSelections: 0, maxSelections: 2, minTotalQuantity: 0, maxTotalQuantity: 2,
    allowsQuantity: true, maxPerOption: 2, selectedDistinctCount: 0, selectedTotalQuantity: 0,
    options: [
      { id: 'o005', name: 'Bife acebolado', currentPrice: 12, priceDelta: 12, available: true, order: 1 },
      { id: 'o006', name: 'Frango grelhado', currentPrice: 10, priceDelta: 10, available: true, order: 2 },
      { id: 'o007', name: 'Calabresa acebolada', currentPrice: 9, priceDelta: 9, available: true, order: 3 },
    ],
  },
  g004: {
    id: 'massa-1:g004', type: 'modifier_group', lineId: 'massa-1', productId: 1007,
    groupId: 'g004', name: 'Acompanhamentos', blocking: false, kind: 'adicional', pricingMode: 'somar',
    minSelections: 0, maxSelections: 2, minTotalQuantity: 0, maxTotalQuantity: 2,
    allowsQuantity: false, maxPerOption: 1, selectedDistinctCount: 0, selectedTotalQuantity: 0,
    options: [
      { id: 'o008', name: 'Salada', currentPrice: 0, priceDelta: 0, available: true, order: 1 },
      { id: 'o009', name: 'Batata palha', currentPrice: 0, priceDelta: 0, available: true, order: 2 },
    ],
  },
  g005: {
    id: 'massa-1:g005', type: 'modifier_group', lineId: 'massa-1', productId: 1007,
    groupId: 'g005', name: 'Extra pago', blocking: false, kind: 'adicional', pricingMode: 'somar',
    minSelections: 0, maxSelections: 2, minTotalQuantity: 0, maxTotalQuantity: 4,
    allowsQuantity: true, maxPerOption: 2, selectedDistinctCount: 0, selectedTotalQuantity: 0,
    options: [
      { id: 'o011', name: 'Queijo ralado', currentPrice: 3, priceDelta: 3, available: true, order: 1 },
      { id: 'o012', name: 'Bacon crocante', currentPrice: 5, priceDelta: 5, available: true, order: 2 },
    ],
  },
} as const;

function expectedMassSnapshot(complete: boolean) {
  const selectedModifiers = [{
    groupId: 'g001', groupName: 'Escolha a massa', kind: 'variacao',
    selectedOptions: [{ optionId: 'o002', optionName: 'Talharim', priceDelta: 25, quantity: 1 }],
  }];
  if (complete) {
    selectedModifiers.push({
      groupId: 'g002', groupName: 'Escolha o molho', kind: 'adicional',
      selectedOptions: [{ optionId: 'o003', optionName: 'Molho ao sugo', priceDelta: 0, quantity: 1 }],
    });
  }
  const revision = complete ? 2 : 1;
  return {
    orderingId: ORDERING,
    empresaId: EMPRESA,
    remoteJid: JID,
    state: 'cart_open',
    revision,
    updatedAt: complete ? '2026-09-02T12:01:00.000Z' : '2026-09-02T12:00:00.000Z',
    pessoaId: null,
    customer: { name: 'Cliente de teste', phone: null },
    cart: {
      items: [{
        lineId: 'massa-1', productId: 1007, productName: 'Monte Sua Massa', baseUnitPrice: 0,
        selectedModifiers, modifierDeltaTotal: 25, quantity: 1, unitPrice: 25, lineTotal: 25, notes: null,
      }],
      observations: null,
    },
    fulfillment: {
      type: 'pickup', asap: true, pickupDate: null, pickupTime: null,
      deliveryAddress: null, deliveryNeighborhood: null, deliveryFee: 0, deliveryFeeToConfirm: false,
    },
    pricing: {
      subtotal: 25, deliveryFee: 0, discount: 0, couponCode: null,
      couponDiscountType: null, couponDiscountValue: null, total: 25,
    },
    payment: { declaredMethod: 'dinheiro', pixReceiptRequired: false, pixReceiptApproved: false },
    revalidation: {
      checkedAt: complete ? '2026-09-02T12:01:00.000Z' : '2026-09-02T12:00:00.000Z',
      ok: true,
      issues: [],
    },
    requirements: complete
      ? [expectedRequirements.g003, expectedRequirements.g004, expectedRequirements.g005]
      : [expectedRequirements.g002, expectedRequirements.g003, expectedRequirements.g004, expectedRequirements.g005],
    readyForConfirmation: complete,
    order: null,
    confirmationAction: complete ? {
      type: 'confirm_order', token: 'confirmacao-teste-opaca-123456', revision,
      expiresAt: '2026-09-02T12:11:00.000Z',
    } : null,
    requiresReview: false,
  };
}

describe('parseInternalOrderingCommand', () => {
  it('exige permit de conversa com epoch decimal exato e dentro de bigint', () => {
    const { conversationEpoch: _missing, ...missingEpoch } = validCommand();
    const invalidEpochs = [42, '-1', '9223372036854775808'];

    expect(parseInternalOrderingCommand(missingEpoch)).toEqual({
      ok: false,
      message: 'Informe uma versão válida da conversa.',
    });
    for (const conversationEpoch of invalidEpochs) {
      expect(parseInternalOrderingCommand({
        ...validCommand(),
        conversationEpoch,
      }), String(conversationEpoch)).toEqual({
        ok: false,
        message: 'Informe uma versão válida da conversa.',
      });
    }

    const parsed = parseInternalOrderingCommand(validCommand());
    expect(parsed.ok ? {
      conversationControlId: parsed.value.conversationControlId,
      conversationEpoch: parsed.value.conversationEpoch,
    } : null).toEqual({
      conversationControlId: CONVERSATION_CONTROL,
      conversationEpoch: '42',
    });
  });

  it('rejeita epoch decimal com zero a esquerda', () => {
    expect(parseInternalOrderingCommand({
      ...validCommand(),
      conversationEpoch: '042',
    })).toEqual({
      ok: false,
      message: 'Informe uma versão válida da conversa.',
    });
  });

  it('preserva o maior bigint como string decimal exata', () => {
    const parsed = parseInternalOrderingCommand({
      ...validCommand(),
      conversationEpoch: '9223372036854775807',
    });

    expect(parsed.ok ? parsed.value.conversationEpoch : null)
      .toBe('9223372036854775807');
  });

  it('aceita somente IDs/quantidades/observações e aplica asap por padrão no domínio', () => {
    expect(parseInternalOrderingCommand(validCommand()).ok).toBe(true);
    expect(parseInternalOrderingCommand({
      ...validCommand(),
      draft: { items: [{ lineId: 'line-1', productId: 10, productName: 'Preço do caller', unitPrice: 0.01, quantity: 1 }] },
    })).toEqual({ ok: false, message: 'Envie somente os identificadores e quantidades dos itens.' });
  });

  it('valida UUIDs, JID, messageId, revisão, IDs e limites', () => {
    expect(parseInternalOrderingCommand({ ...validCommand(), empresaId: 'empresa' }).ok).toBe(false);
    expect(parseInternalOrderingCommand({ ...validCommand(), remoteJid: 'telefone' }).ok).toBe(false);
    expect(parseInternalOrderingCommand({ ...validCommand(), messageId: 'curta' }).ok).toBe(false);
    expect(parseInternalOrderingCommand({ ...validCommand(), orderingId: ORDERING, expectedRevision: 0 }).ok).toBe(false);
    expect(parseInternalOrderingCommand({ ...validCommand(), draft: { items: [{ lineId: 'line-1', productId: -1, quantity: 1 }] } }).ok).toBe(false);
  });

  it('exige lineId válido e único sem sintetizar identidade na borda', () => {
    expect(parseInternalOrderingCommand({
      ...validCommand(), draft: { items: [{ productId: 10, quantity: 1 }] },
    })).toEqual({ ok: false, message: 'Informe uma identificação válida para cada item.' });
    expect(parseInternalOrderingCommand({
      ...validCommand(), draft: { items: [{ lineId: 'linha.1', productId: 10, quantity: 1 }] },
    })).toEqual({ ok: false, message: 'Informe uma identificação válida para cada item.' });
    expect(parseInternalOrderingCommand({
      ...validCommand(),
      draft: { items: [
        { lineId: 'line-1', productId: 10, quantity: 1 },
        { lineId: 'line-1', productId: 10, quantity: 2 },
      ] },
    })).toEqual({ ok: false, message: 'Cada item do pedido precisa de uma identificação diferente.' });

    const parsed = parseInternalOrderingCommand(validCommand());
    expect(parsed.ok && parsed.value.type === 'open_or_update_draft'
      ? parsed.value.draft.items[0].lineId
      : null).toBe('line-1');
  });

  it('aceita remoção explícita e valida removedLineIds na borda', () => {
    const removalOnly = parseInternalOrderingCommand({
      ...validCommand(),
      orderingId: ORDERING,
      expectedRevision: 1,
      draft: { items: [], removedLineIds: ['line-1'] },
    });
    expect(removalOnly.ok && removalOnly.value.type === 'open_or_update_draft'
      ? removalOnly.value.draft.removedLineIds
      : null).toEqual(['line-1']);

    expect(parseInternalOrderingCommand({
      ...validCommand(), draft: { items: [], removedLineIds: ['line.1'] },
    })).toEqual({ ok: false, message: 'Revise a identificação dos itens removidos.' });
    expect(parseInternalOrderingCommand({
      ...validCommand(), draft: { items: [], removedLineIds: ['line-1', 'line-1'] },
    })).toEqual({ ok: false, message: 'Cada item removido precisa de uma identificação diferente.' });
    expect(parseInternalOrderingCommand({
      ...validCommand(),
      draft: {
        items: [{ lineId: 'line-1', productId: 10, quantity: 1 }],
        removedLineIds: ['line-1'],
      },
    })).toEqual({ ok: false, message: 'Um item não pode ser atualizado e removido ao mesmo tempo.' });
    expect(parseInternalOrderingCommand({
      ...validCommand(), draft: { items: [], removedLineIds: [] },
    })).toEqual({ ok: false, message: 'Informe pelo menos um item para atualizar ou remover.' });
  });
});

describe('rotas internas de ordering', () => {
  it('serializa exatamente o rascunho parcial de massa sem ação de confirmação', async () => {
    const ordering = {
      apply: vi.fn(async () => massSnapshot(false)),
      getSnapshot: vi.fn(async () => massSnapshot(false)),
    };
    const { baseUrl } = await start({ ordering });

    const response = await fetch(`${baseUrl}/internal/ordering/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' },
      body: JSON.stringify(validCommand()),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expectedMassSnapshot(false));
  });

  it('serializa exatamente a massa completa e preserva a mesma resposta no replay da mensagem', async () => {
    let stored = massRecord(false);
    const adapter: ConversationOrderingAdapter = {
      materializeDraft: vi.fn(async () => massMaterialization(true)),
      findOpen: vi.fn(async () => stored),
      findByMessageId: vi.fn(async (empresaId, remoteJid, messageId) => (
        stored.empresaId === empresaId
          && stored.remoteJid === remoteJid
          && stored.processedMessageIds.includes(messageId)
          ? stored
          : null
      )),
      findByOrderingId: vi.fn(async (orderingId) => stored.orderingId === orderingId ? stored : null),
      async createOpen() { throw new Error('createOpen não deveria ser chamado'); },
      updateOpen: vi.fn(async (input) => {
        if (stored.processedMessageIds.includes(input.messageId)) return { kind: 'duplicate' as const, record: stored };
        stored = {
          ...stored,
          ...input.materialization,
          revision: stored.revision + 1,
          updatedAt: '2026-09-02T12:01:00.000Z',
          pessoaId: input.pessoaId,
          processedMessageIds: [...stored.processedMessageIds, input.messageId],
        };
        return { kind: 'applied' as const, record: stored };
      }),
      async cancelOpen() { throw new Error('cancelOpen não deveria ser chamado'); },
      issueConfirmationToken: vi.fn(async () => ({ kind: 'issued' as const })),
      async confirmAtomically() { throw new Error('confirmAtomically não deveria ser chamado'); },
      async applyAutoAccept(record) { return record; },
    };
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: () => 'confirmacao-teste-opaca-123456',
      hashConfirmationToken: () => 'a'.repeat(64),
      now: () => new Date('2026-09-02T12:01:00.000Z'),
    });
    const { baseUrl } = await start({ ordering });
    const command = {
      ...validCommand(),
      messageId: 'wamid.mass-complete-123456',
      orderingId: ORDERING,
      expectedRevision: 1,
      draft: {
        items: [{
          lineId: 'massa-1',
          productId: 1007,
          quantity: 1,
          selectedOptions: [
            { groupId: 'g001', optionSelections: [{ optionId: 'o002', quantity: 1 }] },
            { groupId: 'g002', optionSelections: [{ optionId: 'o003', quantity: 1 }] },
          ],
        }],
        customer: { name: 'Cliente de teste' },
        fulfillment: { type: 'pickup' },
        paymentMethod: 'dinheiro',
      },
    };
    const post = () => fetch(`${baseUrl}/internal/ordering/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' },
      body: JSON.stringify(command),
    });

    const first = await post();
    const replay = await post();

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    await expect(first.json()).resolves.toEqual(expectedMassSnapshot(true));
    await expect(replay.json()).resolves.toEqual(expectedMassSnapshot(true));
    expect(adapter.materializeDraft).toHaveBeenCalledOnce();
    expect(adapter.updateOpen).toHaveBeenCalledOnce();
  });

  it('serializa exatamente o conflito de revisão com o snapshot atual', async () => {
    const ordering = {
      apply: vi.fn(async () => {
        throw new ConversationOrderingError(
          'REVISAO_DESATUALIZADA',
          'O pedido foi atualizado. Use a revisão mais recente.',
          snapshot(),
        );
      }),
      getSnapshot: vi.fn(async () => snapshot()),
    };
    const { baseUrl } = await start({ ordering });

    const response = await fetch(`${baseUrl}/internal/ordering/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-stale-1', 'x-zelo-internal-key': 'valid' },
      body: JSON.stringify(validCommand()),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'REVISAO_DESATUALIZADA',
      detail: 'O pedido foi atualizado. Use a revisão mais recente.',
      current: {
        orderingId: ORDERING,
        empresaId: EMPRESA,
        remoteJid: JID,
        state: 'cart_open',
        revision: 1,
        updatedAt: '2026-08-30T12:00:00.000Z',
        pessoaId: null,
        customer: { name: null, phone: null },
        cart: { items: [], observations: null },
        fulfillment: {
          type: 'pickup', asap: true, pickupDate: null, pickupTime: null,
          deliveryAddress: null, deliveryNeighborhood: null, deliveryFee: 0, deliveryFeeToConfirm: false,
        },
        pricing: {
          subtotal: 0, deliveryFee: 0, discount: 0, couponCode: null,
          couponDiscountType: null, couponDiscountValue: null, total: 0,
        },
        payment: { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false },
        revalidation: { checkedAt: '2026-08-30T12:00:00.000Z', ok: true, issues: [] },
        requirements: [],
        readyForConfirmation: true,
        order: null,
        confirmationAction: {
          type: 'confirm_order', token: 'token-opaco-com-tamanho-valido', revision: 1,
          expiresAt: '2026-08-30T12:10:00.000Z',
        },
        requiresReview: false,
      },
      requestId: 'req-stale-1',
    });
  });
  it('falha fechada, preserva requestId e não expõe nomes internos', async () => {
    const { baseUrl } = await start();
    const response = await fetch(`${baseUrl}/internal/ordering/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'req-auth-1' }, body: JSON.stringify(validCommand()),
    });
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'NAO_AUTORIZADO', requestId: 'req-auth-1' });
    expect(JSON.stringify(body)).not.toMatch(/Supabase|RPC|token_hash|create_zelo_order/i);
  });

  it('aplica comando autenticado e consulta snapshot sem devolver link de menu', async () => {
    const { baseUrl, ordering } = await start();
    const posted = await fetch(`${baseUrl}/internal/ordering/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' }, body: JSON.stringify(validCommand()),
    });
    const postBody = await posted.json();
    expect(posted.status).toBe(200);
    expect(ordering.apply).toHaveBeenCalledOnce();
    expect(postBody).not.toHaveProperty('link');
    expect(postBody).not.toHaveProperty('menuToken');

    const loaded = await fetch(`${baseUrl}/internal/ordering/${ORDERING}?empresaId=${EMPRESA}`, { headers: { 'x-zelo-internal-key': 'valid' } });
    expect(loaded.status).toBe(200);
    expect(ordering.getSnapshot).toHaveBeenCalledWith(ORDERING);
  });

  it('devolve revogacao sem snapshot ou dados da conversa e com texto amigavel', async () => {
    const ordering = {
      apply: vi.fn(async () => {
        throw new ConversationOrderingError(
          'AI_TURN_REVOKED',
          'Esta conversa passou para atendimento humano. Atualize antes de continuar.',
        );
      }),
      getSnapshot: vi.fn(async () => snapshot()),
    };
    const { baseUrl } = await start({ ordering });

    const response = await fetch(`${baseUrl}/internal/ordering/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' },
      body: JSON.stringify(validCommand()),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: 'AI_TURN_REVOKED',
      detail: 'Esta conversa passou para atendimento humano. Atualize antes de continuar.',
      current: null,
      requestId: 'request-gerado',
    });
    expect(JSON.stringify(body)).not.toMatch(/Supabase|RPC|epoch|control|5511999999999|10000000-/i);
  });

  it('redige erro inesperado, detalhes técnicos e dados de cliente da resposta', async () => {
    const technicalFailure = [
      'Supabase RPC confirm_whatsapp_zelo_order_atomic_v1 falhou',
      `empresa=${EMPRESA}`,
      `jid=${JID}`,
      'cliente=Cliente de teste',
    ].join(' ');
    const ordering = {
      apply: vi.fn(async () => { throw new Error(technicalFailure); }),
      getSnapshot: vi.fn(async () => snapshot()),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { baseUrl } = await start({ ordering });

    const response = await fetch(`${baseUrl}/internal/ordering/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-internal-1', 'x-zelo-internal-key': 'valid' },
      body: JSON.stringify(validCommand()),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'PEDIDO_INDISPONIVEL',
      detail: 'Não foi possível processar o pedido agora. Tente novamente.',
      requestId: 'req-internal-1',
    });
    expect(JSON.stringify(body)).not.toContain(technicalFailure);
    expect(JSON.stringify(body)).not.toMatch(/Supabase|RPC|confirm_whatsapp|Cliente de teste|5511999999999|10000000-/i);
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it('limita por empresa sem misturar empresas distintas', async () => {
    const { baseUrl } = await start({ quotaMax: 1 });
    const post = (empresaId: string) => fetch(`${baseUrl}/internal/ordering/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' }, body: JSON.stringify(validCommand(empresaId)),
    });
    const empresaB = '10000000-0000-4000-8000-000000000002';
    expect((await post(EMPRESA)).status).toBe(200);
    expect((await post(empresaB)).status).toBe(200);
    const limited = await post(EMPRESA);
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({ error: 'MUITAS_REQUISICOES', requestId: 'request-gerado' });
  });

  it('aplica quota por empresa também na consulta GET', async () => {
    const { baseUrl } = await start({ quotaMax: 1 });
    const empresaB = '10000000-0000-4000-8000-000000000002';
    const get = (empresaId: string) => fetch(`${baseUrl}/internal/ordering/${ORDERING}?empresaId=${empresaId}`, {
      headers: { 'x-zelo-internal-key': 'valid' },
    });

    expect((await get(EMPRESA)).status).toBe(200);
    expect((await get(empresaB)).status).not.toBe(429);
    const limited = await get(EMPRESA);
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({ error: 'MUITAS_REQUISICOES', requestId: 'request-gerado' });
  });
});
