import { describe, expect, it } from 'vitest';
import {
  createConversationOrdering,
  ConversationOrderingError,
  type ConversationOrderingAdapter,
  type ConversationOrderingRecord,
  type ConversationOrderDraft,
  type DraftMaterialization,
  type DraftMutationResult,
} from './conversationOrdering';

const EMPRESA_A = '10000000-0000-4000-8000-000000000001';
const JID_A = '5511999999999@s.whatsapp.net';

function materialization(productId = 10, unitPrice = 20): DraftMaterialization {
  return {
    cart: {
      items: [{
        productId,
        productName: 'X-Bacon',
        baseUnitPrice: unitPrice,
        selectedModifiers: [],
        modifierDeltaTotal: 0,
        quantity: 1,
        unitPrice,
        lineTotal: unitPrice,
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
    pricing: { subtotal: unitPrice, deliveryFee: 0, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: unitPrice },
    revalidation: { checkedAt: '2026-08-30T12:00:00.000Z', ok: true, issues: [] },
  };
}

class MemoryAdapter implements ConversationOrderingAdapter {
  records: ConversationOrderingRecord[] = [];
  createCalls = 0;
  tokenHashes = new Map<string, string>();
  issuedHashes: string[] = [];
  autoAccept = true;
  currentPrice = 20;
  currentDeliveryFee = 0;
  nextRevalidationIssues: Array<{ code: string; message: string }> = [];

  async materializeDraft(_empresaId: string, draft: ConversationOrderDraft): Promise<DraftMaterialization> {
    const resolved = materialization(draft.items[0]?.productId ?? 10, this.currentPrice);
    const quantity = draft.items[0]?.quantity ?? 1;
    resolved.cart.items[0].quantity = quantity;
    resolved.cart.items[0].lineTotal = resolved.cart.items[0].unitPrice * quantity;
    resolved.pricing.subtotal = resolved.cart.items[0].lineTotal;
    if (draft.fulfillment?.type === 'delivery') {
      resolved.fulfillment = {
        ...resolved.fulfillment,
        ...draft.fulfillment,
        type: 'delivery',
        asap: draft.fulfillment.asap !== false,
        deliveryFee: this.currentDeliveryFee,
        deliveryFeeToConfirm: false,
        deliveryStatus: 'eligible',
      };
    }
    resolved.pricing.deliveryFee = resolved.fulfillment.deliveryFee;
    resolved.pricing.total = resolved.pricing.subtotal + resolved.pricing.deliveryFee;
    return resolved;
  }

  async revalidateDraft(empresaId: string, draft: ConversationOrderDraft): Promise<DraftMaterialization> {
    const resolved = await this.materializeDraft(empresaId, draft);
    if (this.nextRevalidationIssues.length > 0) {
      resolved.revalidation = { checkedAt: '2026-08-30T12:01:00.000Z', ok: false, issues: this.nextRevalidationIssues };
    }
    return resolved;
  }

  async findOpen(empresaId: string, remoteJid: string): Promise<ConversationOrderingRecord | null> {
    return this.records.find((record) => record.empresaId === empresaId && record.remoteJid === remoteJid && record.state === 'cart_open') ?? null;
  }

  async findByOrderingId(orderingId: string): Promise<ConversationOrderingRecord | null> {
    return this.records.find((record) => record.orderingId === orderingId) ?? null;
  }

  async createOpen(input: Omit<ConversationOrderingRecord, 'sessionId' | 'orderingId' | 'revision' | 'state' | 'updatedAt' | 'order'>): Promise<ConversationOrderingRecord> {
    await Promise.resolve();
    const existing = await this.findOpen(input.empresaId, input.remoteJid);
    if (existing) return existing;
    this.createCalls += 1;
    const record: ConversationOrderingRecord = {
      ...input,
      sessionId: `20000000-0000-4000-8000-${String(this.records.length + 1).padStart(12, '0')}`,
      orderingId: `30000000-0000-4000-8000-${String(this.records.length + 1).padStart(12, '0')}`,
      state: 'cart_open',
      revision: 1,
      updatedAt: '2026-08-30T12:00:00.000Z',
      order: null,
    };
    this.records.push(record);
    return record;
  }

  async updateOpen(input: {
    current: ConversationOrderingRecord;
    expectedRevision: number;
    messageId: string;
    materialization: DraftMaterialization;
    pessoaId: string | null;
  }): Promise<DraftMutationResult> {
    const latest = await this.findByOrderingId(input.current.orderingId);
    if (!latest) throw new Error('missing');
    if (latest.processedMessageIds.includes(input.messageId)) return { kind: 'duplicate', record: latest };
    if (latest.revision !== input.expectedRevision || latest.state !== 'cart_open') return { kind: 'conflict', record: latest };
    Object.assign(latest, input.materialization, {
      revision: latest.revision + 1,
      updatedAt: new Date(Date.parse(latest.updatedAt) + 1_000).toISOString(),
      pessoaId: input.pessoaId,
      processedMessageIds: [...latest.processedMessageIds, input.messageId],
    });
    return { kind: 'applied', record: latest };
  }

  async cancelOpen(input: { current: ConversationOrderingRecord; expectedRevision: number; messageId: string }): Promise<DraftMutationResult> {
    const latest = await this.findByOrderingId(input.current.orderingId);
    if (!latest) throw new Error('missing');
    if (latest.processedMessageIds.includes(input.messageId)) return { kind: 'duplicate', record: latest };
    if (latest.revision !== input.expectedRevision || latest.state !== 'cart_open') return { kind: 'conflict', record: latest };
    latest.state = 'cancelled';
    latest.revision += 1;
    latest.updatedAt = new Date(Date.parse(latest.updatedAt) + 1_000).toISOString();
    latest.processedMessageIds.push(input.messageId);
    return { kind: 'applied', record: latest };
  }

  async persistRevalidation(input: {
    current: ConversationOrderingRecord;
    expectedRevision: number;
    messageId: string;
    materialization: DraftMaterialization;
  }): Promise<DraftMutationResult> {
    return this.updateOpen({ ...input, pessoaId: input.current.pessoaId });
  }
  async issueConfirmationToken(input: { sessionId: string; tokenHash: string }): Promise<void> {
    this.tokenHashes.set(input.sessionId, input.tokenHash);
    this.issuedHashes.push(input.tokenHash);
  }

  private confirm(current: ConversationOrderingRecord, pessoaId: string | null): ConversationOrderingRecord {
    if (current.order) {
      current.order.alreadyConfirmed = true;
      return current;
    }
    current.state = 'confirmed_waiting_review';
    current.pessoaId = pessoaId;
    current.order = { id: `50000000-0000-4000-8000-${String(this.records.indexOf(current) + 1).padStart(12, '0')}`, status: 'pending_review', alreadyConfirmed: false, revision: 1 };
    return current;
  }

  async confirmDirect(input: { current: ConversationOrderingRecord; pessoaId: string | null }): Promise<ConversationOrderingRecord> {
    return this.confirm(input.current, input.pessoaId);
  }

  async confirmWithToken(input: { current: ConversationOrderingRecord; tokenHash: string; pessoaId: string | null }): Promise<ConversationOrderingRecord> {
    if (this.tokenHashes.get(input.current.sessionId) !== input.tokenHash) {
      throw new ConversationOrderingError('CONFIRMACAO_INVALIDA', 'Esta confirmação não é mais válida.');
    }
    return this.confirm(input.current, input.pessoaId);
  }

  async applyAutoAccept(record: ConversationOrderingRecord): Promise<ConversationOrderingRecord> {
    if (this.autoAccept && record.order?.status === 'pending_review') {
      record.state = 'accepted';
      record.order.status = 'accepted';
      record.order.revision += 1;
    }
    return record;
  }
}

describe('ConversationOrdering', () => {
  it('abre uma única sessão para retry concorrente do mesmo messageId', async () => {
    const adapter = new MemoryAdapter();
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: () => 'token-opaco',
      hashConfirmationToken: () => 'a'.repeat(64),
      now: () => new Date('2026-08-30T12:00:00.000Z'),
    });
    const command = {
      type: 'open_or_update_draft' as const,
      empresaId: EMPRESA_A,
      remoteJid: JID_A,
      messageId: 'wamid.HBgMNTUxMTk5OTk5OTk5ORUCABIYFjNFQjA=',
      draft: { items: [{ productId: 10, quantity: 1 }] },
    };

    const [first, retry] = await Promise.all([ordering.apply(command), ordering.apply(command)]);
    const laterRetry = await ordering.apply(command);

    expect(first.orderingId).toBe(retry.orderingId);
    expect(first.revision).toBe(1);
    expect(retry.revision).toBe(1);
    expect(adapter.createCalls).toBe(1);
    expect(first.confirmationAction).toMatchObject({ type: 'confirm_order', token: 'token-opaco', revision: 1 });
    expect(laterRetry.confirmationAction).toEqual(first.confirmationAction);
    expect(adapter.issuedHashes).toEqual(['a'.repeat(64), 'a'.repeat(64)]);
  });

  it('aplica update uma vez por messageId e devolve conflito CAS com a revisão atual', async () => {
    const adapter = new MemoryAdapter();
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: (record) => `token-${record.revision}`,
      hashConfirmationToken: (token) => token.padEnd(64, 'a').slice(0, 64),
    });
    const opened = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.open-1234567890', draft: { items: [{ productId: 10, quantity: 1 }] },
    });
    const update = {
      type: 'open_or_update_draft' as const, empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.update-1234567890', orderingId: opened.orderingId,
      expectedRevision: 1, draft: { items: [{ productId: 10, quantity: 2 }] },
    };

    const changed = await ordering.apply(update);
    const retry = await ordering.apply(update);

    expect(changed.revision).toBe(2);
    expect(changed.cart.items[0].quantity).toBe(2);
    expect(retry.revision).toBe(2);
    await expect(ordering.apply({ ...update, messageId: 'wamid.stale-1234567890' })).rejects.toMatchObject({
      code: 'REVISAO_DESATUALIZADA',
      currentSnapshot: expect.objectContaining({ revision: 2 }),
    });
  });

  it('substitui o token por revisão e confirma botão idempotente com pessoa_id e autoaceite', async () => {
    const adapter = new MemoryAdapter();
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: (record) => `token-${record.revision}`,
      hashConfirmationToken: (token) => token.padEnd(64, 'a').slice(0, 64),
    });
    const opened = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.open-confirm-1234', draft: { items: [{ productId: 10, quantity: 1 }] },
    });
    const updated = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.update-confirm-1234', orderingId: opened.orderingId, expectedRevision: 1,
      draft: { items: [{ productId: 10, quantity: 2 }], pessoaId: '40000000-0000-4000-8000-000000000001' },
    });

    await expect(ordering.apply({
      type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.confirm-old-1234', orderingId: opened.orderingId, expectedRevision: 2,
      confirmationToken: opened.confirmationAction!.token,
    })).rejects.toMatchObject({ code: 'CONFIRMACAO_INVALIDA' });

    const command = {
      type: 'confirm_draft' as const, empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.confirm-new-1234', orderingId: opened.orderingId, expectedRevision: 2,
      confirmationToken: updated.confirmationAction!.token,
    };
    const confirmed = await ordering.apply(command);
    const retry = await ordering.apply(command);

    expect(confirmed.state).toBe('accepted');
    expect(confirmed.order).toMatchObject({ id: expect.any(String), alreadyConfirmed: false });
    expect(confirmed.pessoaId).toBe('40000000-0000-4000-8000-000000000001');
    expect(retry.order?.id).toBe(confirmed.order?.id);
    expect(adapter.records).toHaveLength(1);
  });

  it('revalida preço, taxa, estoque/publicação, cobertura e horário antes de confirmar', async () => {
    const scenarios = [
      { label: 'preço', configure: (adapter: MemoryAdapter) => { adapter.currentPrice = 25; }, issue: undefined },
      { label: 'taxa', configure: (adapter: MemoryAdapter) => { adapter.currentDeliveryFee = 8; }, issue: undefined },
      { label: 'estoque/publicação', configure: (adapter: MemoryAdapter) => { adapter.nextRevalidationIssues = [{ code: 'product_unavailable', message: 'Item indisponível.' }]; }, issue: 'product_unavailable' },
      { label: 'cobertura', configure: (adapter: MemoryAdapter) => { adapter.nextRevalidationIssues = [{ code: 'delivery_out_of_area', message: 'Endereço fora da área.' }]; }, issue: 'delivery_out_of_area' },
      { label: 'horário', configure: (adapter: MemoryAdapter) => { adapter.nextRevalidationIssues = [{ code: 'schedule_unavailable', message: 'Loja fechada.' }]; }, issue: 'schedule_unavailable' },
    ];

    for (const scenario of scenarios) {
      const adapter = new MemoryAdapter();
      if (scenario.label === 'taxa') adapter.currentDeliveryFee = 5;
      const ordering = createConversationOrdering(adapter, {
        createRawConfirmationToken: (record) => `token-review-${record.revision}`,
        hashConfirmationToken: (token) => token.padEnd(64, 'b').slice(0, 64),
      });
      const opened = await ordering.apply({
        type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
        messageId: `wamid.open-${scenario.label}-123456`,
        draft: {
          items: [{ productId: 10, quantity: 1 }],
          fulfillment: scenario.label === 'taxa' || scenario.label === 'cobertura'
            ? { type: 'delivery', deliveryPostalCode: '01001000', deliveryNumber: '10' }
            : undefined,
        },
      });
      scenario.configure(adapter);

      const reviewed = await ordering.apply({
        type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
        messageId: `wamid.confirm-${scenario.label}-123456`, orderingId: opened.orderingId,
        expectedRevision: 1, confirmationToken: opened.confirmationAction!.token,
      });

      expect(reviewed.requiresReview, scenario.label).toBe(true);
      expect(reviewed.revision, scenario.label).toBe(2);
      expect(reviewed.order, scenario.label).toBeNull();
      expect(reviewed.confirmationAction?.revision, scenario.label).toBe(2);
      if (scenario.issue) expect(reviewed.revalidation.issues.map((item) => item.code)).toContain(scenario.issue);
      if (scenario.label === 'preço') expect(reviewed.pricing.subtotal).toBe(25);
      if (scenario.label === 'taxa') expect(reviewed.pricing.deliveryFee).toBe(8);
    }
  });

  it('confirma por texto no mesmo pedido canônico, respeita autoaceite desligado e permite segundo pedido', async () => {
    const adapter = new MemoryAdapter();
    adapter.autoAccept = false;
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: (record) => `token-text-${record.revision}`,
      hashConfirmationToken: (token) => token.padEnd(64, 'c').slice(0, 64),
    });
    const first = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.first-open-123456', draft: { items: [{ productId: 10, quantity: 1 }] },
    });
    const confirmed = await ordering.apply({
      type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.first-text-confirm-123456', orderingId: first.orderingId, expectedRevision: 1,
    });
    expect(confirmed.state).toBe('confirmed_waiting_review');

    const second = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.second-open-123456', draft: { items: [{ productId: 10, quantity: 1 }] },
    });
    expect(second.orderingId).not.toBe(first.orderingId);
    expect(adapter.records).toHaveLength(2);
  });

  it('isola empresa/JID e cancela somente por comando explícito', async () => {
    const adapter = new MemoryAdapter();
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: (record) => `token-cancel-${record.revision}`,
      hashConfirmationToken: (token) => token.padEnd(64, 'd').slice(0, 64),
    });
    const opened = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.cancel-open-123456', draft: { items: [{ productId: 10, quantity: 1 }] },
    });
    await expect(ordering.apply({
      type: 'cancel_draft', empresaId: '10000000-0000-4000-8000-000000000002', remoteJid: JID_A,
      messageId: 'wamid.cancel-wrong-company', orderingId: opened.orderingId, expectedRevision: 1,
    })).rejects.toMatchObject({ code: 'PEDIDO_NAO_ENCONTRADO' });
    expect((await ordering.getSnapshot(opened.orderingId))?.state).toBe('cart_open');

    const cancelled = await ordering.apply({
      type: 'cancel_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.cancel-explicit-123456', orderingId: opened.orderingId, expectedRevision: 1,
    });
    expect(cancelled).toMatchObject({ state: 'cancelled', revision: 2, confirmationAction: null });
  });
});
