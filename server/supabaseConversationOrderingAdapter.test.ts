import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationOrderingRecord, DraftMaterialization } from './conversationOrdering';
import { SupabaseConversationOrderingAdapter } from './supabaseConversationOrderingAdapter';
import { deriveModifierRequirements } from './conversationOrderRequirements';
import { bemServidoConversationCatalog } from './fixtures/bemServidoConversationCatalog';

vi.hoisted(() => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ordering-adapter.test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key-for-ordering-adapter';
});

const materializeWhatsAppOrderDraft = vi.hoisted(() => vi.fn());

vi.mock('./zelomenuCartSessions', async (importOriginal) => ({
  ...await importOriginal<typeof import('./zelomenuCartSessions')>(),
  materializeWhatsAppOrderDraft,
}));

const EMPRESA = '10000000-0000-4000-8000-000000000001';
const AI_PERMIT = {
  conversationControlId: '60000000-0000-4000-8000-000000000001',
  conversationEpoch: '42',
} as const;

const CUSTOMER_NAME_REQUIREMENT: ConversationOrderingRecord['requirements'][number] = {
  id: 'customer_name',
  type: 'customer_name',
  name: 'Informe o nome para o pedido.',
  blocking: true,
};

const PAYMENT_METHOD_REQUIREMENT: ConversationOrderingRecord['requirements'][number] = {
  id: 'payment_method',
  type: 'payment_method',
  name: 'Escolha a forma de pagamento.',
  blocking: true,
};

const VALID_MODIFIER_REQUIREMENT: Extract<
  ConversationOrderingRecord['requirements'][number],
  { type: 'modifier_group' }
> = {
  id: 'line-1:group-1',
  type: 'modifier_group',
  lineId: 'line-1',
  productId: 1007,
  groupId: 'group-1',
  name: 'Molho',
  blocking: false,
  kind: 'variacao',
  pricingMode: 'somar',
  minSelections: 0,
  maxSelections: 1,
  minTotalQuantity: 0,
  maxTotalQuantity: 1,
  allowsQuantity: false,
  maxPerOption: 1,
  selectedDistinctCount: 0,
  selectedTotalQuantity: 0,
  options: [{
    id: 'option-1',
    name: 'Molho branco',
    currentPrice: 3,
    priceDelta: -3,
    available: true,
    order: 0,
  }],
};

const VALID_REQUIREMENTS = [
  VALID_MODIFIER_REQUIREMENT,
  {
    id: 'fulfillment_type',
    type: 'fulfillment_type',
    name: 'Escolha entrega ou retirada.',
    blocking: true,
  },
  CUSTOMER_NAME_REQUIREMENT,
  PAYMENT_METHOD_REQUIREMENT,
  {
    id: 'delivery_address',
    type: 'delivery_address',
    name: 'Informe o endereco de entrega.',
    blocking: true,
    missingFields: ['number'],
  },
  {
    id: 'schedule',
    type: 'schedule',
    name: 'Informe quando deseja receber.',
    blocking: true,
    missingFields: ['date'],
  },
] satisfies ConversationOrderingRecord['requirements'];

function record(overrides: Partial<ConversationOrderingRecord> = {}): ConversationOrderingRecord {
  return {
    sessionId: '20000000-0000-4000-8000-000000000001',
    orderingId: '30000000-0000-4000-8000-000000000001',
    empresaId: '10000000-0000-4000-8000-000000000001',
    remoteJid: '5511999999999@s.whatsapp.net',
    state: 'cart_open',
    revision: 1,
    updatedAt: '2026-08-30T12:00:00.000Z',
    pessoaId: null,
    processedMessageIds: ['wamid.open-atomic-contract'],
    customer: { name: 'Cliente de teste', phone: null },
    cart: { items: [], observations: null },
    fulfillment: { type: 'pickup', asap: true, pickupDate: null, pickupTime: null, deliveryAddress: null, deliveryNeighborhood: null, deliveryFee: 0, deliveryFeeToConfirm: false },
    pricing: { subtotal: 0, deliveryFee: 0, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: 0 },
    payment: { declaredMethod: 'dinheiro', pixReceiptRequired: false, pixReceiptApproved: false },
    revalidation: { checkedAt: '2026-08-30T12:00:00.000Z', ok: true, issues: [] },
    requirements: [],
    readyForConfirmation: true,
    reviewRequired: false,
    order: null,
    ...overrides,
  };
}

function adapterWithRpc(result: { data: unknown; error: { message: string } | null }, refreshed = record()) {
  const rpc = vi.fn(async () => result);
  const adapter = new SupabaseConversationOrderingAdapter({ rpc } as never);
  Object.defineProperty(adapter, 'findRequired', { value: vi.fn(async () => refreshed) });
  return { adapter, rpc };
}

function sessionRow(snapshot: ConversationOrderingRecord) {
  return {
    id: snapshot.sessionId,
    empresa_id: snapshot.empresaId,
    ordering_id: snapshot.orderingId,
    context: 'whatsapp_order',
    state: snapshot.state,
    source_ref: snapshot.remoteJid,
    customer_snapshot: snapshot.customer,
    cart_snapshot: snapshot.cart,
    fulfillment_snapshot: snapshot.fulfillment,
    pricing_snapshot: snapshot.pricing,
    payment_snapshot: snapshot.payment,
    metadata: {
      pessoaId: snapshot.pessoaId,
      processedMessageIds: snapshot.processedMessageIds,
      ...(snapshot.reviewRequired ? { conversationReview: { required: true, revision: snapshot.revision, messageId: 'wamid.review-marker', cause: 'issues' } } : {}),
    },
    revision: snapshot.revision,
    last_revalidated_at: snapshot.revalidation.checkedAt,
    last_revalidation: snapshot.revalidation,
    requirements_snapshot: snapshot.requirements,
    ready_for_confirmation: snapshot.readyForConfirmation,
    archived_at: null,
    updated_at: snapshot.updatedAt,
  };
}

function chainReturning(result: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['eq', 'contains', 'order', 'limit']) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn(async () => result);
  return query;
}

function adapterReading(row: Record<string, unknown>) {
  const returned = chainReturning({ data: row, error: null });
  const select = vi.fn(() => returned);
  const from = vi.fn(() => ({ select }));
  return new SupabaseConversationOrderingAdapter({ from } as never);
}

function adapterWithCreateCollision(rows: Array<Record<string, unknown>>) {
  const rpc = vi.fn(async (functionName: string) => {
    if (functionName !== 'zelomenu_open_whatsapp_order_with_ai_epoch_v1') {
      throw new Error(`unexpected RPC: ${functionName}`);
    }
    return {
      data: null,
      error: {
        code: '23505',
        details: 'Key (empresa_id, source_ref) already exists.',
        hint: '',
        message: 'duplicate open WhatsApp cart',
      },
    };
  });
  const from = vi.fn((tableName: string) => {
    if (tableName !== 'zelomenu_cart_sessions') {
      throw new Error(`unexpected table: ${tableName}`);
    }
    const filters = new Map<string, unknown>();
    const query: Record<string, unknown> = {};
    query.eq = vi.fn((column: string, value: unknown) => {
      filters.set(column, value);
      return query;
    });
    query.maybeSingle = vi.fn(async () => {
      const matches = rows.filter((row) => (
        [...filters].every(([column, value]) => row[column] === value)
      ));
      if (matches.length === 1) return { data: matches[0], error: null };
      return {
        data: null,
        error: {
          code: 'PGRST116',
          details: `Expected one scoped row, found ${matches.length}.`,
          hint: '',
          message: 'JSON object requested, multiple (or no) rows returned',
        },
      };
    });
    return { select: vi.fn(() => query) };
  });
  return new SupabaseConversationOrderingAdapter({ rpc, from } as never);
}

function createOpenInput(snapshot: ConversationOrderingRecord, processedMessageIds: string[]) {
  return {
    ...AI_PERMIT,
    empresaId: snapshot.empresaId,
    remoteJid: snapshot.remoteJid,
    pessoaId: snapshot.pessoaId,
    processedMessageIds,
    customer: snapshot.customer,
    cart: snapshot.cart,
    fulfillment: snapshot.fulfillment,
    pricing: snapshot.pricing,
    payment: snapshot.payment,
    revalidation: snapshot.revalidation,
    requirements: snapshot.requirements,
    readyForConfirmation: snapshot.readyForConfirmation,
  };
}

describe('colisao cross-replica ao criar pedido', () => {
  it('aplica pedido, empresa, JID e contexto antes de mapear a leitura', async () => {
    const filters: Array<[string, unknown]> = [];
    const query: Record<string, any> = {};
    query.eq = vi.fn((column: string, value: unknown) => { filters.push([column, value]); return query; });
    query.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const adapter = new SupabaseConversationOrderingAdapter({ from: vi.fn(() => ({ select: vi.fn(() => query) })) } as never);
    await adapter.findByOrderingId({ orderingId: '30000000-0000-4000-8000-000000000001', empresaId: EMPRESA, remoteJid: '5511999999999@s.whatsapp.net' });
    expect(filters).toEqual([
      ['ordering_id', '30000000-0000-4000-8000-000000000001'],
      ['empresa_id', EMPRESA],
      ['source_ref', '5511999999999@s.whatsapp.net'],
      ['context', 'whatsapp_order'],
    ]);
  });

  it('retorna o carrinho do mesmo tenant e JID quando a mensagem ja venceu a corrida', async () => {
    const replayed = record({ processedMessageIds: ['wamid.same-message'] });
    const otherTenant = record({
      sessionId: '20000000-0000-4000-8000-000000000002',
      orderingId: '30000000-0000-4000-8000-000000000002',
      empresaId: '10000000-0000-4000-8000-000000000002',
      processedMessageIds: ['wamid.same-message'],
    });
    const otherJid = record({
      sessionId: '20000000-0000-4000-8000-000000000003',
      orderingId: '30000000-0000-4000-8000-000000000003',
      remoteJid: '5511888888888@s.whatsapp.net',
      processedMessageIds: ['wamid.same-message'],
    });
    const adapter = adapterWithCreateCollision([
      sessionRow(otherTenant),
      sessionRow(otherJid),
      sessionRow(replayed),
    ]);

    await expect(adapter.createOpen(createOpenInput(replayed, ['wamid.same-message'])))
      .resolves.toEqual(replayed);
  });

  it('rejeita outra mensagem quando ja existe carrinho aberto no mesmo tenant e JID', async () => {
    const existing = record({ processedMessageIds: ['wamid.existing-message'] });
    const adapter = adapterWithCreateCollision([sessionRow(existing)]);

    await expect(adapter.createOpen(createOpenInput(existing, ['wamid.new-message'])))
      .rejects.toMatchObject({
        code: 'PEDIDO_EM_ANDAMENTO',
        currentSnapshot: null,
      });
  });
});

describe('SupabaseConversationOrderingAdapter confirmação atômica', () => {
  it('preserva requisitos e decisão de prontidão produzidos pelo materializador', async () => {
    const requirements = deriveModifierRequirements(
      [{ lineId: 'line-1', productId: 1007 }],
      bemServidoConversationCatalog,
    );
    materializeWhatsAppOrderDraft.mockResolvedValueOnce({
      cart: {
        items: [{
          lineId: 'line-1',
          productId: 1007,
          productName: 'Monte Sua Massa',
          baseUnitPrice: 0,
          selectedModifiers: [],
          modifierDeltaTotal: 0,
          quantity: 1,
          unitPrice: 0,
          lineTotal: 0,
          notes: null,
        }],
        observations: null,
      },
      customer: { name: null, phone: null },
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
      payment: { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false },
      pricing: {
        subtotal: 0,
        deliveryFee: 0,
        discount: 0,
        couponCode: null,
        couponDiscountType: null,
        couponDiscountValue: null,
        total: 0,
      },
      revalidation: { checkedAt: '2026-08-30T12:00:00.000Z', ok: true, issues: [] },
      requirements,
      readyForConfirmation: false,
    });
    const adapter = new SupabaseConversationOrderingAdapter({} as never);

    const result = await adapter.materializeDraft({ empresaId: EMPRESA, remoteJid: '5511999999999@s.whatsapp.net' }, {
      items: [{ lineId: 'line-1', productId: 1007, quantity: 1 }],
      fulfillment: { type: 'pickup' },
    });

    expect(result.requirements).toEqual(requirements);
    expect(result.readyForConfirmation).toBe(false);
    expect(result.cart.items[0].lineId).toBe('line-1');
  });

  it('falha quando o materializador não devolve lineId em vez de inferir pela posição', async () => {
    materializeWhatsAppOrderDraft.mockResolvedValueOnce({
      cart: { items: [{ productId: 1007, productName: 'Produto', baseUnitPrice: 1, selectedModifiers: [], modifierDeltaTotal: 0, quantity: 1, unitPrice: 1, lineTotal: 1, notes: null }], observations: null },
      customer: { name: 'Ana', phone: null },
      fulfillment: { type: 'pickup', asap: true, pickupDate: null, pickupTime: null, deliveryAddress: null, deliveryNeighborhood: null, deliveryFee: 0, deliveryFeeToConfirm: false },
      payment: { declaredMethod: 'dinheiro', pixReceiptRequired: false, pixReceiptApproved: false },
      pricing: { subtotal: 1, deliveryFee: 0, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: 1 },
      revalidation: { checkedAt: '2026-08-30T12:00:00.000Z', ok: true, issues: [] },
      requirements: [],
      readyForConfirmation: true,
    });
    const adapter = new SupabaseConversationOrderingAdapter({} as never);

    await expect(adapter.materializeDraft({ empresaId: EMPRESA, remoteJid: '5511999999999@s.whatsapp.net' }, {
      items: [{ lineId: 'line-1', productId: 1007, quantity: 1 }],
      fulfillment: { type: 'pickup' },
    })).rejects.toThrow('MATERIALIZED_LINE_ID_MISSING');
  });

  it('falha quando o materializador devolve lineIds duplicados', async () => {
    materializeWhatsAppOrderDraft.mockResolvedValueOnce({
      cart: {
        items: [
          { lineId: 'same-line', productId: 1007, productName: 'Produto A', baseUnitPrice: 1, selectedModifiers: [], modifierDeltaTotal: 0, quantity: 1, unitPrice: 1, lineTotal: 1, notes: null },
          { lineId: 'same-line', productId: 1007, productName: 'Produto B', baseUnitPrice: 1, selectedModifiers: [], modifierDeltaTotal: 0, quantity: 1, unitPrice: 1, lineTotal: 1, notes: null },
        ],
        observations: null,
      },
      customer: { name: 'Ana', phone: null },
      fulfillment: { type: 'pickup', asap: true, pickupDate: null, pickupTime: null, deliveryAddress: null, deliveryNeighborhood: null, deliveryFee: 0, deliveryFeeToConfirm: false },
      payment: { declaredMethod: 'dinheiro', pixReceiptRequired: false, pixReceiptApproved: false },
      pricing: { subtotal: 2, deliveryFee: 0, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: 2 },
      revalidation: { checkedAt: '2026-08-30T12:00:00.000Z', ok: true, issues: [] },
      requirements: [],
      readyForConfirmation: true,
    });
    const adapter = new SupabaseConversationOrderingAdapter({} as never);

    await expect(adapter.materializeDraft({ empresaId: EMPRESA, remoteJid: '5511999999999@s.whatsapp.net' }, {
      items: [
        { lineId: 'line-1', productId: 1007, quantity: 1 },
        { lineId: 'line-2', productId: 1007, quantity: 1 },
      ],
      fulfillment: { type: 'pickup' },
    })).rejects.toThrow('MATERIALIZED_LINE_ID_DUPLICATE');
  });

  it.each([
    { label: 'texto', tokenHash: null },
    { label: 'botão', tokenHash: 'a'.repeat(64) },
  ])('usa a mesma RPC transacional para $label e preserva requiresReview', async ({ tokenHash }) => {
    const current = record();
    const reviewed = record({ revision: 2, revalidation: { checkedAt: '2026-08-30T12:01:00.000Z', ok: false, issues: [{ code: 'stock_insufficient', message: 'Revise a quantidade.' }] } });
    const { adapter, rpc } = adapterWithRpc({ data: { outcome: 'requires_review' }, error: null }, reviewed);

    await expect(adapter.confirmAtomically({
      current,
      ...AI_PERMIT,
      expectedRevision: 1,
      messageId: 'wamid.confirm-atomic-contract',
      tokenHash,
      idempotencyKey: 'whatsapp:session:message',
      pessoaId: '40000000-0000-4000-8000-000000000001',
    })).resolves.toEqual({ kind: 'requires_review', record: reviewed });
    expect(rpc).toHaveBeenCalledWith('confirm_whatsapp_zelo_order_with_ai_epoch_v1', {
      p_empresa_id: current.empresaId,
      p_source_ref: current.remoteJid,
      p_conversation_control_id: AI_PERMIT.conversationControlId,
      p_conversation_epoch: AI_PERMIT.conversationEpoch,
      p_session_id: current.sessionId,
      p_expected_revision: 1,
      p_message_id: 'wamid.confirm-atomic-contract',
      p_idempotency_key: 'whatsapp:session:message',
      p_pessoa_id: '40000000-0000-4000-8000-000000000001',
      p_token_hash: tokenHash,
    });
  });

  it('falha fechado quando a RPC canônica ainda não existe', async () => {
    const current = record();
    const { adapter } = adapterWithRpc({ data: null, error: { message: 'function confirm_whatsapp_zelo_order_atomic_v1 does not exist' } });

    await expect(adapter.confirmAtomically({
      current, ...AI_PERMIT, expectedRevision: 1, messageId: 'wamid.missing-rpc-contract', tokenHash: null,
      idempotencyKey: 'whatsapp:session:missing', pessoaId: null,
    })).rejects.toMatchObject({ code: 'CONFIRMACAO_INDISPONIVEL', currentSnapshot: null });
  });

  it('relê a sessão quando a emissão de token perde a revisão', async () => {
    const current = record();
    const latest = record({ revision: 2 });
    const { adapter, rpc } = adapterWithRpc({ data: null, error: { message: 'SESSION_REVISION_MISMATCH' } }, latest);

    await expect(adapter.issueConfirmationToken({ current, ...AI_PERMIT, tokenHash: 'b'.repeat(64), expiresAt: '2026-08-30T12:10:00.000Z' }))
      .resolves.toEqual({ kind: 'conflict', record: latest });
    expect(rpc).toHaveBeenCalledWith('issue_whatsapp_zelo_confirmation_token_with_ai_epoch_v1', {
      p_token_hash: 'b'.repeat(64),
      p_empresa_id: current.empresaId,
      p_source_ref: current.remoteJid,
      p_conversation_control_id: AI_PERMIT.conversationControlId,
      p_conversation_epoch: AI_PERMIT.conversationEpoch,
      p_session_id: current.sessionId,
      p_expected_revision: current.revision,
      p_expires_at: '2026-08-30T12:10:00.000Z',
    });
  });

  it('nao emite token depois de takeover', async () => {
    const current = record();
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'AI_TURN_REVOKED' } }));
    const adapter = new SupabaseConversationOrderingAdapter({ rpc } as never);

    await expect(adapter.issueConfirmationToken({
      current,
      ...AI_PERMIT,
      tokenHash: 'c'.repeat(64),
      expiresAt: '2026-08-30T12:10:00.000Z',
    })).rejects.toMatchObject({ code: 'AI_TURN_REVOKED', currentSnapshot: null });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('falha fechado com mensagem amigavel quando o wrapper cercado de token nao existe', async () => {
    const current = record();
    const { adapter } = adapterWithRpc({
      data: null,
      error: { message: 'Could not find the function public.issue_whatsapp_zelo_confirmation_token_with_ai_epoch_v1 in the schema cache' },
    });

    await expect(adapter.issueConfirmationToken({
      current,
      ...AI_PERMIT,
      tokenHash: 'd'.repeat(64),
      expiresAt: '2026-08-30T12:10:00.000Z',
    })).rejects.toMatchObject({ code: 'CONFIRMACAO_INDISPONIVEL', currentSnapshot: null });
  });
});

describe('mapeamento de prontidão do SupabaseConversationOrderingAdapter', () => {
  it.each(['issue', 'confirm'] as const)('mapeia ORDER_NOT_READY em $0 para o contrato público estável', async (operation) => {
    const current = record();
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'ORDER_NOT_READY' } }));
    const adapter = new SupabaseConversationOrderingAdapter({ rpc } as never);

    const result = operation === 'issue'
      ? adapter.issueConfirmationToken({
        current,
        ...AI_PERMIT,
        tokenHash: 'r'.repeat(64),
        expiresAt: '2026-08-30T12:10:00.000Z',
      })
      : adapter.confirmAtomically({
        current,
        ...AI_PERMIT,
        expectedRevision: current.revision,
        messageId: 'wamid.order-not-ready-123456',
        tokenHash: null,
        idempotencyKey: 'whatsapp:order-not-ready',
        pessoaId: null,
      });

    await expect(result).rejects.toMatchObject({
      code: 'PEDIDO_INVALIDO',
      message: 'Revise os dados pendentes antes de confirmar.',
      currentSnapshot: null,
    });
  });
});

describe('fencing atomico do SupabaseConversationOrderingAdapter', () => {
  it.each(['create', 'update', 'cancel', 'confirm'] as const)(
    'nao executa escrita quando o controle e tomado imediatamente antes de %s',
    async (mutation) => {
      const current = record();
      const confirmed = record({
        state: 'confirmed_waiting_review',
        order: {
          id: '50000000-0000-4000-8000-000000000001',
          status: 'pending_review',
          revision: 1,
          alreadyConfirmed: true,
        },
      });
      const database = {
        sessions: mutation === 'create' ? [] as Array<Record<string, unknown>> : [sessionRow(current)],
        orders: [] as Array<Record<string, unknown>>,
      };
      const before = structuredClone(database);
      const takeover = () => ({ mode: 'human' as const, epoch: '43' });
      const directMutation = (kind: 'create' | 'update' | 'cancel') => {
        takeover();
        if (kind === 'create') database.sessions.push(sessionRow(current));
        if (kind === 'update') database.sessions[0] = sessionRow(record({ revision: 2 }));
        if (kind === 'cancel') database.sessions[0] = sessionRow(record({ state: 'cancelled', revision: 2, readyForConfirmation: false }));
        const returned = chainReturning({ data: database.sessions.at(-1), error: null });
        returned.select = vi.fn(() => returned);
        return returned;
      };
      const from = vi.fn(() => ({
        insert: vi.fn(() => directMutation('create')),
        update: vi.fn(() => directMutation(mutation === 'cancel' ? 'cancel' : 'update')),
      }));
      const rpc = vi.fn(async (name: string) => {
        takeover();
        if (name.endsWith('_with_ai_epoch_v1')) {
          return { data: null, error: { message: 'AI_TURN_REVOKED' } };
        }
        database.orders.push({ id: confirmed.order!.id, sessionId: current.sessionId });
        return { data: { outcome: 'confirmed', alreadyConfirmed: true }, error: null };
      });
      const adapter = new SupabaseConversationOrderingAdapter({ from, rpc } as never);
      Object.defineProperty(adapter, 'findRequired', { value: vi.fn(async () => confirmed) });
      const materialization: DraftMaterialization = {
        cart: current.cart,
        customer: current.customer,
        fulfillment: current.fulfillment,
        pricing: current.pricing,
        payment: current.payment,
        revalidation: current.revalidation,
        requirements: current.requirements,
        readyForConfirmation: current.readyForConfirmation,
      };

      const result = mutation === 'create'
        ? adapter.createOpen({
          ...AI_PERMIT,
          empresaId: current.empresaId,
          remoteJid: current.remoteJid,
          pessoaId: current.pessoaId,
          processedMessageIds: ['wamid.revoked-create'],
          ...materialization,
        })
        : mutation === 'update'
          ? adapter.updateOpen({
            ...AI_PERMIT,
            current,
            expectedRevision: 1,
            messageId: 'wamid.revoked-update',
            materialization,
            pessoaId: null,
          })
          : mutation === 'cancel'
            ? adapter.cancelOpen({
              ...AI_PERMIT,
              current,
              expectedRevision: 1,
              messageId: 'wamid.revoked-cancel',
            })
            : adapter.confirmAtomically({
              ...AI_PERMIT,
              current,
              expectedRevision: 1,
              messageId: 'wamid.revoked-confirm',
              tokenHash: null,
              idempotencyKey: 'whatsapp:revoked-confirm',
              pessoaId: null,
            });

      await expect(result).rejects.toMatchObject({
        code: 'AI_TURN_REVOKED',
        currentSnapshot: null,
      });
      expect(database).toEqual(before);
    },
  );
});

describe('SupabaseConversationOrderingAdapter snapshots parciais', () => {
  it.each([
    { label: 'null', requirements: [null] },
    { label: 'objeto vazio', requirements: [{}] },
    {
      label: 'discriminante desconhecido',
      requirements: [{ id: 'customer_name', type: 'unknown', name: 'Nome', blocking: true }],
    },
    {
      label: 'kind de modificador desconhecido',
      requirements: [{ ...VALID_MODIFIER_REQUIREMENT, kind: 'combo' }],
    },
    {
      label: 'campo simples invalido',
      requirements: [{ ...CUSTOMER_NAME_REQUIREMENT, name: 42 }],
    },
    {
      label: 'campo aninhado invalido',
      requirements: [{
        ...VALID_MODIFIER_REQUIREMENT,
        options: [{ ...VALID_MODIFIER_REQUIREMENT.options[0], available: 'yes' }],
      }],
    },
    {
      label: 'campo de endereco desconhecido',
      requirements: [{
        id: 'delivery_address', type: 'delivery_address', name: 'Endereco', blocking: true,
        missingFields: ['postalCode'],
      }],
    },
    {
      label: 'campo de agenda desconhecido',
      requirements: [{
        id: 'schedule', type: 'schedule', name: 'Agenda', blocking: true,
        missingFields: ['tomorrow'],
      }],
    },
    {
      label: 'blocking falso com minimo de escolhas pendente',
      requirements: [{
        ...VALID_MODIFIER_REQUIREMENT,
        minSelections: 1,
        selectedDistinctCount: 0,
        blocking: false,
      }],
    },
    {
      label: 'blocking falso com minimo de quantidade pendente',
      requirements: [{
        ...VALID_MODIFIER_REQUIREMENT,
        minTotalQuantity: 1,
        selectedTotalQuantity: 0,
        blocking: false,
      }],
    },
    {
      label: 'escolhas selecionadas acima do maximo',
      requirements: [{
        ...VALID_MODIFIER_REQUIREMENT,
        maxSelections: 1,
        selectedDistinctCount: 2,
      }],
    },
    {
      label: 'quantidade selecionada acima do maximo',
      requirements: [{
        ...VALID_MODIFIER_REQUIREMENT,
        maxTotalQuantity: 1,
        selectedTotalQuantity: 2,
      }],
    },
    {
      label: 'auto selecao aponta para opcao ausente',
      requirements: [{
        ...VALID_MODIFIER_REQUIREMENT,
        autoSelectableOptionId: 'option-missing',
      }],
    },
    {
      label: 'auto selecao aponta para opcao indisponivel',
      requirements: [{
        ...VALID_MODIFIER_REQUIREMENT,
        autoSelectableOptionId: 'option-1',
        options: [{ ...VALID_MODIFIER_REQUIREMENT.options[0], available: false }],
      }],
    },
  ])('falha fechado para snapshot malformado: $label', async ({ requirements }) => {
    const row = sessionRow(record()) as Record<string, unknown>;
    row.requirements_snapshot = requirements;
    row.ready_for_confirmation = true;

    await expect(adapterReading(row).findByOrderingId({ orderingId: String(row.ordering_id), empresaId: String(row.empresa_id), remoteJid: String(row.source_ref) })).resolves.toMatchObject({
      requirements: [],
      readyForConfirmation: false,
    });
  });

  it('falha fechado quando prontidao verdadeira acompanha requisito bloqueante', async () => {
    const row = sessionRow(record({
      requirements: [CUSTOMER_NAME_REQUIREMENT],
      readyForConfirmation: true,
    })) as Record<string, unknown>;

    await expect(adapterReading(row).findByOrderingId({ orderingId: String(row.ordering_id), empresaId: String(row.empresa_id), remoteJid: String(row.source_ref) })).resolves.toMatchObject({
      requirements: [],
      readyForConfirmation: false,
    });
  });

  it('falha fechado quando blocking verdadeiro diverge de minimos ja atendidos', async () => {
    const inconsistent = {
      ...VALID_MODIFIER_REQUIREMENT,
      blocking: true,
    } satisfies typeof VALID_MODIFIER_REQUIREMENT;
    const row = sessionRow(record({
      requirements: [inconsistent],
      readyForConfirmation: false,
    })) as Record<string, unknown>;

    await expect(adapterReading(row).findByOrderingId({ orderingId: String(row.ordering_id), empresaId: String(row.empresa_id), remoteJid: String(row.source_ref) })).resolves.toMatchObject({
      requirements: [],
      readyForConfirmation: false,
    });
  });

  it('falha fechado para prontidao verdadeira fora de whatsapp_order cart_open', async () => {
    const row = sessionRow(record({
      state: 'cancelled',
      requirements: [],
      readyForConfirmation: true,
    })) as Record<string, unknown>;

    await expect(adapterReading(row).findByOrderingId({ orderingId: String(row.ordering_id), empresaId: String(row.empresa_id), remoteJid: String(row.source_ref) })).resolves.toMatchObject({
      requirements: [],
      readyForConfirmation: false,
    });
  });

  it('preserva todas as variantes validas do contrato de requisitos', async () => {
    const row = sessionRow(record({
      requirements: VALID_REQUIREMENTS,
      readyForConfirmation: false,
    })) as Record<string, unknown>;

    await expect(adapterReading(row).findByOrderingId({ orderingId: String(row.ordering_id), empresaId: String(row.empresa_id), remoteJid: String(row.source_ref) })).resolves.toMatchObject({
      requirements: VALID_REQUIREMENTS,
      readyForConfirmation: false,
    });
  });

  it('preserva requisito opcional pronto com delta de preco negativo', async () => {
    const row = sessionRow(record({
      requirements: [VALID_MODIFIER_REQUIREMENT],
      readyForConfirmation: true,
    })) as Record<string, unknown>;

    await expect(adapterReading(row).findByOrderingId({ orderingId: String(row.ordering_id), empresaId: String(row.empresa_id), remoteJid: String(row.source_ref) })).resolves.toMatchObject({
      requirements: [VALID_MODIFIER_REQUIREMENT],
      readyForConfirmation: true,
    });
  });

  it('mantem linhas legadas sem materializacao confiavel fechadas para confirmacao', async () => {
    const stored = record({ requirements: [], readyForConfirmation: true });
    const legacyRow = sessionRow(stored) as Record<string, unknown>;
    delete legacyRow.requirements_snapshot;
    delete legacyRow.ready_for_confirmation;
    const returned = chainReturning({ data: legacyRow, error: null });
    const select = vi.fn(() => returned);
    const from = vi.fn(() => ({ select }));
    const adapter = new SupabaseConversationOrderingAdapter({ from } as never);

    await expect(adapter.findByOrderingId({ orderingId: stored.orderingId, empresaId: stored.empresaId, remoteJid: stored.remoteJid })).resolves.toMatchObject({
      requirements: [],
      readyForConfirmation: false,
    });
  });

  it('restaura requisitos e prontidao armazenados ao reler uma sessao materializada', async () => {
    const stored = record({ requirements: [], readyForConfirmation: true });
    const returned = chainReturning({ data: sessionRow(stored), error: null });
    const select = vi.fn(() => returned);
    const from = vi.fn(() => ({ select }));
    const adapter = new SupabaseConversationOrderingAdapter({ from } as never);

    await expect(adapter.findByOrderingId({ orderingId: stored.orderingId, empresaId: stored.empresaId, remoteJid: stored.remoteJid })).resolves.toMatchObject({
      requirements: [],
      readyForConfirmation: true,
    });
    expect(select).toHaveBeenCalledWith(expect.stringContaining('requirements_snapshot'));
    expect(select).toHaveBeenCalledWith(expect.stringContaining('ready_for_confirmation'));
  });

  it('persiste requisitos e prontidao pela RPC cercada ao criar a sessao', async () => {
    const expected = record({
      requirements: [CUSTOMER_NAME_REQUIREMENT],
      readyForConfirmation: false,
    });
    const { adapter, rpc } = adapterWithRpc({
      data: { outcome: 'applied', orderingId: expected.orderingId },
      error: null,
    }, expected);

    const created = await adapter.createOpen({
      ...AI_PERMIT,
      empresaId: expected.empresaId,
      remoteJid: expected.remoteJid,
      pessoaId: expected.pessoaId,
      processedMessageIds: expected.processedMessageIds,
      customer: expected.customer,
      cart: expected.cart,
      fulfillment: expected.fulfillment,
      pricing: expected.pricing,
      payment: expected.payment,
      revalidation: expected.revalidation,
      requirements: expected.requirements,
      readyForConfirmation: expected.readyForConfirmation,
    });

    expect(rpc).toHaveBeenCalledWith('zelomenu_open_whatsapp_order_with_ai_epoch_v1', {
      p_empresa_id: expected.empresaId,
      p_source_ref: expected.remoteJid,
      p_conversation_control_id: AI_PERMIT.conversationControlId,
      p_conversation_epoch: AI_PERMIT.conversationEpoch,
      p_customer_snapshot: expected.customer,
      p_cart_snapshot: expected.cart,
      p_fulfillment_snapshot: expected.fulfillment,
      p_pricing_snapshot: expected.pricing,
      p_payment_snapshot: expected.payment,
      p_metadata: { pessoaId: expected.pessoaId, processedMessageIds: expected.processedMessageIds },
      p_last_revalidated_at: expected.revalidation.checkedAt,
      p_last_revalidation: expected.revalidation,
      p_requirements_snapshot: [CUSTOMER_NAME_REQUIREMENT],
      p_ready_for_confirmation: false,
    });
    expect(created).toMatchObject({
      requirements: [CUSTOMER_NAME_REQUIREMENT],
      readyForConfirmation: false,
    });
  });

  it('envia a nova materializacao para a RPC cercada e preserva o snapshot ao perder o CAS', async () => {
    const current = record({ requirements: [CUSTOMER_NAME_REQUIREMENT], readyForConfirmation: false });
    const stored = record({
      revision: 2,
      requirements: [PAYMENT_METHOD_REQUIREMENT],
      readyForConfirmation: false,
    });
    const { adapter, rpc } = adapterWithRpc({ data: { outcome: 'conflict' }, error: null }, stored);
    const materialization: DraftMaterialization = {
      cart: current.cart,
      customer: current.customer,
      fulfillment: current.fulfillment,
      pricing: current.pricing,
      payment: current.payment,
      revalidation: current.revalidation,
      requirements: [PAYMENT_METHOD_REQUIREMENT],
      readyForConfirmation: false,
    };

    const result = await adapter.updateOpen({
      current,
      ...AI_PERMIT,
      expectedRevision: current.revision,
      messageId: 'wamid.requirements-cas-conflict',
      materialization,
      pessoaId: current.pessoaId,
    });

    expect(rpc).toHaveBeenCalledWith('zelomenu_update_whatsapp_order_with_ai_epoch_v1', {
      p_empresa_id: current.empresaId,
      p_source_ref: current.remoteJid,
      p_conversation_control_id: AI_PERMIT.conversationControlId,
      p_conversation_epoch: AI_PERMIT.conversationEpoch,
      p_session_id: current.sessionId,
      p_expected_revision: current.revision,
      p_message_id: 'wamid.requirements-cas-conflict',
      p_customer_snapshot: materialization.customer,
      p_cart_snapshot: materialization.cart,
      p_fulfillment_snapshot: materialization.fulfillment,
      p_pricing_snapshot: materialization.pricing,
      p_payment_snapshot: materialization.payment,
      p_last_revalidated_at: materialization.revalidation.checkedAt,
      p_last_revalidation: materialization.revalidation,
      p_requirements_snapshot: [PAYMENT_METHOD_REQUIREMENT],
      p_ready_for_confirmation: false,
      p_metadata: { pessoaId: current.pessoaId, processedMessageIds: [...current.processedMessageIds, 'wamid.requirements-cas-conflict'] },
    });
    expect(result).toMatchObject({
      kind: 'conflict',
      record: {
        revision: 2,
        requirements: [PAYMENT_METHOD_REQUIREMENT],
        readyForConfirmation: false,
      },
    });
  });

  it('aplica update quando o permit de epoch ainda e atual', async () => {
    const current = record({ requirements: [CUSTOMER_NAME_REQUIREMENT], readyForConfirmation: false });
    const updated = record({ revision: 2, requirements: [PAYMENT_METHOD_REQUIREMENT], readyForConfirmation: false });
    const { adapter, rpc } = adapterWithRpc({ data: { outcome: 'applied' }, error: null }, updated);
    const materialization: DraftMaterialization = {
      cart: current.cart,
      customer: current.customer,
      fulfillment: current.fulfillment,
      pricing: current.pricing,
      payment: current.payment,
      revalidation: current.revalidation,
      requirements: updated.requirements,
      readyForConfirmation: false,
    };

    await expect(adapter.updateOpen({
      ...AI_PERMIT,
      current,
      expectedRevision: 1,
      messageId: 'wamid.current-permit-update',
      materialization,
      pessoaId: null,
    })).resolves.toEqual({ kind: 'applied', record: updated });
    expect(rpc).toHaveBeenCalledWith(
      'zelomenu_update_whatsapp_order_with_ai_epoch_v1',
      expect.objectContaining({
        p_conversation_control_id: AI_PERMIT.conversationControlId,
        p_conversation_epoch: '42',
      }),
    );
  });

  it('limpa a prontidao pela RPC cercada ao cancelar uma sessao pronta', async () => {
    const current = record({ requirements: [], readyForConfirmation: true });
    const cancelled = record({
      state: 'cancelled',
      revision: 2,
      requirements: [],
      readyForConfirmation: false,
    });
    const { adapter, rpc } = adapterWithRpc({ data: { outcome: 'applied' }, error: null }, cancelled);

    await expect(adapter.cancelOpen({
      current,
      ...AI_PERMIT,
      expectedRevision: current.revision,
      messageId: 'wamid.cancel-ready-order',
    })).resolves.toMatchObject({
      kind: 'applied',
      record: { state: 'cancelled', readyForConfirmation: false },
    });
    expect(rpc).toHaveBeenCalledWith('zelomenu_cancel_whatsapp_order_with_ai_epoch_v1', {
      p_empresa_id: current.empresaId,
      p_source_ref: current.remoteJid,
      p_conversation_control_id: AI_PERMIT.conversationControlId,
      p_conversation_epoch: AI_PERMIT.conversationEpoch,
      p_session_id: current.sessionId,
      p_expected_revision: current.revision,
      p_message_id: 'wamid.cancel-ready-order',
      p_metadata: {
        pessoaId: current.pessoaId,
        processedMessageIds: [...current.processedMessageIds, 'wamid.cancel-ready-order'],
        cancellationReason: 'explicit_command',
      },
    });
  });
});

describe('migration de snapshots parciais', () => {
  it('instala um trigger terminal antes da constraint de prontidao', () => {
    const sql = readFileSync(
      'supabase/migrations/20260902110000_conversation_ordering_partial_snapshots.sql',
      'utf8',
    );
    const functionName = 'public.zelomenu_clear_conversation_readiness_on_terminal_state()';

    expect(sql).toContain(`create or replace function ${functionName}`);
    expect(sql).toMatch(/returns trigger\s+language plpgsql\s+security invoker\s+set search_path = pg_catalog/is);
    expect(sql).toMatch(/if new\.context <> 'whatsapp_order' or new\.state <> 'cart_open' then\s+new\.ready_for_confirmation := false;/is);
    expect(sql).toMatch(/create trigger zelomenu_cart_sessions_clear_terminal_readiness\s+before update on public\.zelomenu_cart_sessions\s+for each row execute function public\.zelomenu_clear_conversation_readiness_on_terminal_state\(\);/is);
    expect(sql).toContain(`revoke all on function ${functionName} from public, anon, authenticated;`);
    expect(sql.indexOf('create trigger zelomenu_cart_sessions_clear_terminal_readiness'))
      .toBeLessThan(sql.indexOf('add constraint zelomenu_cart_sessions_ready_for_confirmation_state_check'));
  });
});

describe('migration de autoridade de confirmação', () => {
  it('define readiness pura e aplica-a após os locks de sessão/token', () => {
    const sql = readFileSync(
      'supabase/migrations/20260902140000_harden_conversation_confirmation_authority.sql',
      'utf8',
    );
    expect(sql).toMatch(/create or replace function public\.zelomenu_whatsapp_order_is_ready_v1\([\s\S]+returns boolean[\s\S]+immutable/is);
    expect(sql).toMatch(/p_context = 'whatsapp_order'[\s\S]+p_state = 'cart_open'[\s\S]+p_ready_for_confirmation = true/is);
    expect(sql).toMatch(/deliveryAddress[\s\S]+deliveryNumber[\s\S]+deliveryNeighborhood/is);
    expect(sql).toMatch(/declaredMethod[\s\S]+pickupDate[\s\S]+pickupTime/is);
    expect(sql).toMatch(/select coalesce\(\([\s\S]+\), false\)/is);
    expect(sql).toMatch(/if public\.zelomenu_whatsapp_order_is_ready_v1\([\s\S]+\) is not true then/is);
    expect(sql).toMatch(/create or replace function public\.issue_whatsapp_zelo_confirmation_token[\s\S]+ORDER_NOT_READY/is);
    expect(sql).toMatch(/create or replace function public\.confirm_whatsapp_zelo_order_atomic_v1[\s\S]+ORDER_NOT_READY/is);
    expect(sql).toMatch(/modifier_groups[\s\S]+modifier_options[\s\S]+modifier_option_products[\s\S]+linked_product[\s\S]+zelomenu_product_publications/is);
    expect(sql).toMatch(/jsonb_build_object\('required', true, 'revision', s\.revision \+ 1,[\s\S]+'cause', case when jsonb_array_length\(v_issues\) > 0 then 'issues' else 'snapshot_changed' end\)/is);
    expect(sql).toMatch(/update public\.zelomenu_whatsapp_confirmation_tokens[\s\S]+where session_id = s\.id and revision < s\.revision \+ 1[\s\S]+invalidated_at is null and consumed_at is null;/is);
    expect(sql).toMatch(/revoke all on function public\.zelomenu_whatsapp_order_is_ready_v1[\s\S]+grant execute on function public\.zelomenu_whatsapp_order_is_ready_v1[\s\S]+to service_role;/is);
  });
});

describe('fixture de integridade da confirmação conversacional', () => {
  const fixture = readFileSync(
    'supabase/tests/conversation_order_confirmation_integrity.sql',
    'utf8',
  );

  it('usa hashes SHA-256 hexadecimais literais e distintos para emissão', () => {
    const issuedHashes = [...fixture.matchAll(
      /issue_whatsapp_zelo_confirmation_token\(\s*'([^']+)'/g,
    )].map((match) => match[1]);

    // ZM1: 3 additional literal issuances were added for sessions 114/115/116
    // once confirm_draft required a token, so the requires_review lineId
    // scenarios could still legitimately reach that outcome.
    expect(issuedHashes).toHaveLength(16);
    expect(issuedHashes.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    expect(new Set(issuedHashes).size).toBe(issuedHashes.length);
    expect(fixture).not.toMatch(/repeat\(\s*'[^']+'\s*,\s*64\s*\)/);
  });

  it('prepara casos de lineId para atravessar readiness e materialização', () => {
    const lineCasesStart = fixture.indexOf('with line_cases');
    const serviceRoleStart = fixture.indexOf('set local role service_role;');
    const lineCases = fixture.slice(lineCasesStart, serviceRoleStart);

    expect(lineCasesStart).toBeGreaterThanOrEqual(0);
    expect(serviceRoleStart).toBeGreaterThan(lineCasesStart);
    expect(lineCases).not.toContain("where id = 'c1000000-0000-4000-8000-000000000102'");
    expect(lineCases).toMatch(/line_cases\(id, ordering_id, source_ref, cart_snapshot\)/);
    expect(lineCases).toMatch(/'5511900000022@s\.whatsapp\.net'[\s\S]+?"lineId":"bad id"/);
    expect(lineCases).toMatch(/'5511900000023@s\.whatsapp\.net'[\s\S]+?"productId":2147482801/);
    expect(lineCases).toMatch(
      /'5511900000024@s\.whatsapp\.net'[\s\S]+?"lineId":"same"[\s\S]+?"lineId":"same"/,
    );
    expect(lineCases).toMatch(/requirements_snapshot[\s\S]+?'\[\]'::jsonb[\s\S]+?true/);
    expect(fixture).toMatch(/jsonb_set\([\s\S]+to_jsonb\(public\.zelomenu_whatsapp_phone_from_source_ref_v1\(source_ref\)\)/);
    expect(fixture).toContain("'c1000000-0000-4000-8000-000000000117'");
    expect(fixture).toContain('phone divergent from scoped JID blocks token issuance');
  });
});

describe('migration de fencing por epoch', () => {
  it('trava o controle compartilhado real e cerca todas as escritas com RPCs server-only', () => {
    const sql = readFileSync(
      'supabase/migrations/20260902130000_fence_conversation_ordering_with_ai_epoch.sql',
      'utf8',
    );

    expect(sql).toContain("to_regclass('public.zelochat_conversation_ai_control')");
    expect(sql).toContain("to_regclass('public.zelochat_sessions')");
    expect(sql).not.toContain('create table public.zelochat_conversation_control');
    expect(sql).toMatch(/execute[\s\S]+from public\.zelochat_conversation_ai_control c[\s\S]+for update of c/is);
    expect(sql).toMatch(/s\.empresa_id = \$1[\s\S]+s\.remote_jid = \$3[\s\S]+s\.conversation_control_id = c\.id/is);
    expect(sql).toMatch(/v_epoch is distinct from p_conversation_epoch[\s\S]+v_mode is distinct from 'ai'/is);
    expect(sql).toContain("message = 'AI_TURN_REVOKED'");

    for (const functionName of [
      'zelomenu_open_whatsapp_order_with_ai_epoch_v1',
      'zelomenu_update_whatsapp_order_with_ai_epoch_v1',
      'zelomenu_cancel_whatsapp_order_with_ai_epoch_v1',
      'issue_whatsapp_zelo_confirmation_token_with_ai_epoch_v1',
      'confirm_whatsapp_zelo_order_with_ai_epoch_v1',
    ]) {
      expect(sql).toContain(`create or replace function public.${functionName}(`);
      expect(sql).toContain(`revoke all on function public.${functionName}`);
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${functionName}[\\s\\S]+to service_role;`, 'i'));
    }
    expect(sql).toMatch(/confirm_whatsapp_zelo_order_atomic_v1[\s\S]+p_empresa_id[\s\S]+p_source_ref/is);
  });

  it('mantem o pgTAP executavel em schema Menu isolado com bootstrap apenas de teste', () => {
    const sql = readFileSync('supabase/tests/conversation_order_ai_epoch.sql', 'utf8');

    expect(sql).toContain("to_regclass('public.zelochat_conversation_ai_control')");
    expect(sql).toContain("to_regclass('public.zelochat_sessions')");
    expect(sql).toContain("to_regprocedure('public.zelochat_conversation_control_lock_gate()')");
    expect(sql).toContain('create table public.zelochat_conversation_ai_control');
    expect(sql).toContain('create table public.zelochat_sessions');
    expect(sql).not.toContain('create table public.zelochat_conversation_control');
    expect(sql.trimEnd()).toMatch(/rollback;$/i);
  });

  it('mantem o snapshot temporario legivel durante a execucao como service_role', () => {
    const sql = readFileSync('supabase/tests/conversation_order_ai_epoch.sql', 'utf8');

    expect(sql).toMatch(
      /create temporary table conversation_epoch_before[\s\S]+grant select on conversation_epoch_before to service_role;[\s\S]+set local role service_role;/i,
    );
  });

  it('semeia a identidade canonica e prova que a bridge preservou o controle exato', () => {
    const sql = readFileSync('supabase/tests/conversation_order_ai_epoch.sql', 'utf8');

    expect(sql).toContain("'phone:11888888888'");
    expect(sql).not.toContain("'phone:5511888888888'");
    expect(sql).toMatch(
      /insert into public\.zelochat_sessions[\s\S]+select is\([\s\S]+conversation_control_id[\s\S]+'b8000000-0000-4000-8000-000000000003'::uuid[\s\S]+shared bridge preserves exact seeded control binding[\s\S]+set local role service_role;/i,
    );
  });

  it('prova que um permit AI atual passa antes de qualquer takeover', () => {
    const sql = readFileSync('supabase/tests/conversation_order_ai_epoch.sql', 'utf8');

    expect(sql).toMatch(
      /set local role service_role;[\s\S]+select lives_ok\([\s\S]+zelomenu_assert_ai_conversation_permit_v1\([\s\S]+'10'[\s\S]+current AI permit succeeds[\s\S]+-- A takeover advances the control immediately before create\./i,
    );
  });

  it('rejeita epoch obsoleto enquanto o controle continua em modo AI', () => {
    const sql = readFileSync('supabase/tests/conversation_order_ai_epoch.sql', 'utf8');

    expect(sql).toMatch(
      /select throws_ok\([\s\S]+zelomenu_assert_ai_conversation_permit_v1\([\s\S]+'9'[\s\S]+'ZL409'[\s\S]+'AI_TURN_REVOKED'[\s\S]+stale epoch is rejected while control remains in AI mode[\s\S]+-- A takeover advances the control immediately before create\./i,
    );
  });
});
