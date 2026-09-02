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
    priceDelta: 3,
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
    customer: { name: null, phone: null },
    cart: { items: [], observations: null },
    fulfillment: { type: 'pickup', asap: true, pickupDate: null, pickupTime: null, deliveryAddress: null, deliveryNeighborhood: null, deliveryFee: 0, deliveryFeeToConfirm: false },
    pricing: { subtotal: 0, deliveryFee: 0, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: 0 },
    payment: { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false },
    revalidation: { checkedAt: '2026-08-30T12:00:00.000Z', ok: true, issues: [] },
    requirements: [],
    readyForConfirmation: true,
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
    metadata: { pessoaId: snapshot.pessoaId, processedMessageIds: snapshot.processedMessageIds },
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

describe('SupabaseConversationOrderingAdapter confirmação atômica', () => {
  it('preserva requisitos e decisão de prontidão produzidos pelo materializador', async () => {
    const requirements = deriveModifierRequirements(
      [{ lineId: 'line-1', productId: 1007 }],
      bemServidoConversationCatalog,
    );
    materializeWhatsAppOrderDraft.mockResolvedValueOnce({
      cart: {
        items: [{
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

    const result = await adapter.materializeDraft(EMPRESA, {
      items: [{ lineId: 'line-1', productId: 1007, quantity: 1 }],
      fulfillment: { type: 'pickup' },
    });

    expect(result.requirements).toEqual(requirements);
    expect(result.readyForConfirmation).toBe(false);
    expect(result.cart.items[0].lineId).toBe('line-1');
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
      expectedRevision: 1,
      messageId: 'wamid.confirm-atomic-contract',
      tokenHash,
      idempotencyKey: 'whatsapp:session:message',
      pessoaId: '40000000-0000-4000-8000-000000000001',
    })).resolves.toEqual({ kind: 'requires_review', record: reviewed });
    expect(rpc).toHaveBeenCalledWith('confirm_whatsapp_zelo_order_atomic_v1', {
      p_empresa_id: current.empresaId,
      p_source_ref: current.remoteJid,
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
      current, expectedRevision: 1, messageId: 'wamid.missing-rpc-contract', tokenHash: null,
      idempotencyKey: 'whatsapp:session:missing', pessoaId: null,
    })).rejects.toMatchObject({ code: 'CONFIRMACAO_INDISPONIVEL', currentSnapshot: null });
  });

  it('relê a sessão quando a emissão de token perde a revisão', async () => {
    const current = record();
    const latest = record({ revision: 2 });
    const { adapter } = adapterWithRpc({ data: null, error: { message: 'SESSION_REVISION_MISMATCH' } }, latest);

    await expect(adapter.issueConfirmationToken({ current, tokenHash: 'b'.repeat(64), expiresAt: '2026-08-30T12:10:00.000Z' }))
      .resolves.toEqual({ kind: 'conflict', record: latest });
  });
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
  ])('falha fechado para snapshot malformado: $label', async ({ requirements }) => {
    const row = sessionRow(record()) as Record<string, unknown>;
    row.requirements_snapshot = requirements;
    row.ready_for_confirmation = true;

    await expect(adapterReading(row).findByOrderingId(String(row.ordering_id))).resolves.toMatchObject({
      requirements: [],
      readyForConfirmation: false,
    });
  });

  it('falha fechado quando prontidao verdadeira acompanha requisito bloqueante', async () => {
    const row = sessionRow(record({
      requirements: [CUSTOMER_NAME_REQUIREMENT],
      readyForConfirmation: true,
    })) as Record<string, unknown>;

    await expect(adapterReading(row).findByOrderingId(String(row.ordering_id))).resolves.toMatchObject({
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

    await expect(adapterReading(row).findByOrderingId(String(row.ordering_id))).resolves.toMatchObject({
      requirements: [],
      readyForConfirmation: false,
    });
  });

  it('preserva todas as variantes validas do contrato de requisitos', async () => {
    const row = sessionRow(record({
      requirements: VALID_REQUIREMENTS,
      readyForConfirmation: false,
    })) as Record<string, unknown>;

    await expect(adapterReading(row).findByOrderingId(String(row.ordering_id))).resolves.toMatchObject({
      requirements: VALID_REQUIREMENTS,
      readyForConfirmation: false,
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

    await expect(adapter.findByOrderingId(stored.orderingId)).resolves.toMatchObject({
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

    await expect(adapter.findByOrderingId(stored.orderingId)).resolves.toMatchObject({
      requirements: [],
      readyForConfirmation: true,
    });
    expect(select).toHaveBeenCalledWith(expect.stringContaining('requirements_snapshot'));
    expect(select).toHaveBeenCalledWith(expect.stringContaining('ready_for_confirmation'));
  });

  it('seleciona e persiste requisitos e prontidao ao criar a sessao', async () => {
    const expected = record({
      requirements: [CUSTOMER_NAME_REQUIREMENT],
      readyForConfirmation: false,
    });
    const returned = chainReturning({ data: sessionRow(expected), error: null });
    const select = vi.fn(() => returned);
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    const adapter = new SupabaseConversationOrderingAdapter({ from } as never);

    const created = await adapter.createOpen({
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

    expect(select).toHaveBeenCalledWith(expect.stringContaining('requirements_snapshot'));
    expect(select).toHaveBeenCalledWith(expect.stringContaining('ready_for_confirmation'));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      requirements_snapshot: [CUSTOMER_NAME_REQUIREMENT],
      ready_for_confirmation: false,
    }));
    expect(created).toMatchObject({
      requirements: [CUSTOMER_NAME_REQUIREMENT],
      readyForConfirmation: false,
    });
  });

  it('persiste a nova materializacao e preserva o snapshot armazenado ao perder o CAS', async () => {
    const current = record({ requirements: [CUSTOMER_NAME_REQUIREMENT], readyForConfirmation: false });
    const stored = record({
      revision: 2,
      requirements: [PAYMENT_METHOD_REQUIREMENT],
      readyForConfirmation: false,
    });
    const updateResult = chainReturning({ data: null, error: null });
    const updateSelect = vi.fn(() => updateResult);
    updateResult.select = updateSelect;
    const update = vi.fn(() => updateResult);
    const reloadResult = chainReturning({ data: sessionRow(stored), error: null });
    const reloadSelect = vi.fn(() => reloadResult);
    const from = vi.fn()
      .mockReturnValueOnce({ update })
      .mockReturnValueOnce({ select: reloadSelect });
    const adapter = new SupabaseConversationOrderingAdapter({ from } as never);
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
      expectedRevision: current.revision,
      messageId: 'wamid.requirements-cas-conflict',
      materialization,
      pessoaId: current.pessoaId,
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      requirements_snapshot: [PAYMENT_METHOD_REQUIREMENT],
      ready_for_confirmation: false,
    }));
    expect(updateSelect).toHaveBeenCalledWith(expect.stringContaining('requirements_snapshot'));
    expect(updateSelect).toHaveBeenCalledWith(expect.stringContaining('ready_for_confirmation'));
    expect(reloadSelect).toHaveBeenCalledWith(expect.stringContaining('requirements_snapshot'));
    expect(reloadSelect).toHaveBeenCalledWith(expect.stringContaining('ready_for_confirmation'));
    expect(result).toMatchObject({
      kind: 'conflict',
      record: {
        revision: 2,
        requirements: [PAYMENT_METHOD_REQUIREMENT],
        readyForConfirmation: false,
      },
    });
  });

  it('limpa a prontidao ao cancelar uma sessao pronta', async () => {
    const current = record({ requirements: [], readyForConfirmation: true });
    const cancelled = record({
      state: 'cancelled',
      revision: 2,
      requirements: [],
      readyForConfirmation: false,
    });
    const updateResult = chainReturning({ data: sessionRow(cancelled), error: null });
    const select = vi.fn(() => updateResult);
    updateResult.select = select;
    const update = vi.fn(() => updateResult);
    const from = vi.fn(() => ({ update }));
    const adapter = new SupabaseConversationOrderingAdapter({ from } as never);

    await expect(adapter.cancelOpen({
      current,
      expectedRevision: current.revision,
      messageId: 'wamid.cancel-ready-order',
    })).resolves.toMatchObject({
      kind: 'applied',
      record: { state: 'cancelled', readyForConfirmation: false },
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      state: 'cancelled',
      ready_for_confirmation: false,
    }));
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
