import { describe, expect, it } from 'vitest';
import {
  createConversationOrdering,
  ConversationOrderingError,
  jsonbSemanticallyEqual,
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

function reorderJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderJsonKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, child]) => [key, reorderJsonKeys(child)]));
  }
  return value;
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
  writeTime: string | null = null;
  reorderEveryRoundTrip = false;
  changePriceAfterRevalidate: number | null = null;
  conflictNextIssuance = false;
  jsonbRoundTrips = 0;

  private roundTrip(record: ConversationOrderingRecord | null): ConversationOrderingRecord | null {
    if (!record || !this.reorderEveryRoundTrip) return record;
    const reordered = reorderJsonKeys(record) as ConversationOrderingRecord;
    const index = this.records.indexOf(record);
    if (index >= 0) this.records[index] = reordered;
    this.jsonbRoundTrips += 1;
    return reordered;
  }

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
    const result = this.reorderEveryRoundTrip ? reorderJsonKeys(resolved) as DraftMaterialization : resolved;
    if (this.changePriceAfterRevalidate != null) this.currentPrice = this.changePriceAfterRevalidate;
    return result;
  }

  async findOpen(empresaId: string, remoteJid: string): Promise<ConversationOrderingRecord | null> {
    return this.roundTrip(this.records.find((record) => record.empresaId === empresaId && record.remoteJid === remoteJid && record.state === 'cart_open') ?? null);
  }

  async findByMessageId(empresaId: string, remoteJid: string, messageId: string): Promise<ConversationOrderingRecord | null> {
    return this.roundTrip(this.records.find((record) => record.empresaId === empresaId
      && record.remoteJid === remoteJid
      && record.processedMessageIds.includes(messageId)) ?? null);
  }

  async findByOrderingId(orderingId: string): Promise<ConversationOrderingRecord | null> {
    return this.roundTrip(this.records.find((record) => record.orderingId === orderingId) ?? null);
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
      updatedAt: this.writeTime ?? new Date().toISOString(),
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
      updatedAt: this.writeTime ?? new Date(Date.parse(latest.updatedAt) + 1_000).toISOString(),
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
  async issueConfirmationToken(input: { current: ConversationOrderingRecord; tokenHash: string }) {
    if (this.conflictNextIssuance) {
      this.conflictNextIssuance = false;
      input.current.revision += 1;
      input.current.updatedAt = new Date().toISOString();
      return { kind: 'conflict' as const, record: input.current };
    }
    this.tokenHashes.set(input.current.sessionId, input.tokenHash);
    this.issuedHashes.push(input.tokenHash);
    return { kind: 'issued' as const };
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

  async confirmAtomically(input: {
    current: ConversationOrderingRecord; expectedRevision: number; messageId: string;
    tokenHash: string | null; pessoaId: string | null;
  }) {
    const latest = await this.findByOrderingId(input.current.orderingId);
    if (!latest) throw new Error('missing');
    if (latest.revision !== input.expectedRevision || latest.state !== 'cart_open') return { kind: 'conflict' as const, record: latest };
    if (input.tokenHash && this.tokenHashes.get(input.current.sessionId) !== input.tokenHash) {
      throw new ConversationOrderingError('CONFIRMACAO_INVALIDA', 'Esta confirmação não é mais válida.');
    }
    if (this.changePriceAfterRevalidate != null) {
      this.currentPrice = this.changePriceAfterRevalidate;
      this.changePriceAfterRevalidate = null;
    }
    const draft: ConversationOrderDraft = {
      items: latest.cart.items.flatMap((item) => item.productId == null ? [] : [{
        productId: item.productId,
        quantity: item.quantity,
        notes: item.notes,
        selectedOptions: item.selectedModifiers.map((group) => ({
          groupId: group.groupId,
          optionSelections: group.selectedOptions.map((option) => ({ optionId: option.optionId, quantity: option.quantity ?? 1 })),
        })),
      }]),
      fulfillment: latest.fulfillment,
      paymentMethod: latest.payment.declaredMethod,
      pessoaId: latest.pessoaId,
      customer: latest.customer,
      observations: latest.cart.observations,
    };
    const revalidated = await this.revalidateDraft(latest.empresaId, draft);
    const same = jsonbSemanticallyEqual(
      { cart: latest.cart, customer: latest.customer, fulfillment: latest.fulfillment, payment: latest.payment, pricing: latest.pricing },
      { cart: revalidated.cart, customer: revalidated.customer, fulfillment: revalidated.fulfillment, payment: revalidated.payment, pricing: revalidated.pricing },
    );
    if (!revalidated.revalidation.ok || !same) {
      const persisted = await this.updateOpen({
        current: latest, expectedRevision: input.expectedRevision, messageId: input.messageId,
        materialization: revalidated, pessoaId: input.pessoaId,
      });
      return { kind: persisted.kind === 'conflict' ? 'conflict' as const : 'requires_review' as const, record: persisted.record };
    }
    latest.processedMessageIds.push(input.messageId);
    return { kind: 'confirmed' as const, record: this.confirm(latest, input.pessoaId) };
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

  it('devolve a sessão histórica no retry concorrente após fechamento e aceita mensagem nova', async () => {
    const adapter = new MemoryAdapter();
    adapter.autoAccept = false;
    const firstReplica = createConversationOrdering(adapter, {
      createRawConfirmationToken: (record) => `token-history-${record.revision}`,
      hashConfirmationToken: (token) => token.padEnd(64, 'e').slice(0, 64),
    });
    const openCommand = {
      type: 'open_or_update_draft' as const,
      empresaId: EMPRESA_A,
      remoteJid: JID_A,
      messageId: 'wamid.historical-open-123456',
      draft: { items: [{ productId: 10, quantity: 1 }] },
    };
    const opened = await firstReplica.apply(openCommand);
    await firstReplica.apply({
      type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.historical-confirm-123456', orderingId: opened.orderingId, expectedRevision: 1,
    });

    const replicaA = createConversationOrdering(adapter, {
      createRawConfirmationToken: () => 'unused-history-a', hashConfirmationToken: () => 'a'.repeat(64),
    });
    const replicaB = createConversationOrdering(adapter, {
      createRawConfirmationToken: () => 'unused-history-b', hashConfirmationToken: () => 'b'.repeat(64),
    });
    const [retryA, retryB] = await Promise.all([replicaA.apply(openCommand), replicaB.apply(openCommand)]);

    expect(retryA.orderingId).toBe(opened.orderingId);
    expect(retryB.orderingId).toBe(opened.orderingId);
    expect(adapter.records).toHaveLength(1);

    const next = await replicaA.apply({
      ...openCommand,
      messageId: 'wamid.new-legitimate-open-123456',
    });
    expect(next.orderingId).not.toBe(opened.orderingId);
    expect(adapter.records).toHaveLength(2);
  });

  it('não ressuscita token expirado e exige refresh por nova revisão/mensagem', async () => {
    const adapter = new MemoryAdapter();
    let currentTime = new Date('2026-08-30T12:00:00.000Z');
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: (record, expiresAt) => `token-expiry-${record.revision}-${expiresAt}`,
      hashConfirmationToken: (token) => token.padEnd(64, 'f').slice(0, 64),
      now: () => currentTime,
    });
    adapter.writeTime = currentTime.toISOString();
    const command = {
      type: 'open_or_update_draft' as const, empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.expiring-open-123456', draft: { items: [{ productId: 10, quantity: 1 }] },
    };
    const opened = await ordering.apply(command);
    expect(opened.confirmationAction?.expiresAt).toBe('2026-08-30T12:10:00.000Z');

    currentTime = new Date('2026-08-30T12:11:00.000Z');
    await expect(ordering.apply(command)).rejects.toMatchObject({
      code: 'RESUMO_EXPIRADO',
      currentSnapshot: expect.objectContaining({ requiresReview: true, confirmationAction: null, revision: 1 }),
    });
    expect(adapter.issuedHashes).toHaveLength(1);

    adapter.writeTime = currentTime.toISOString();
    const refreshed = await ordering.apply({
      ...command,
      orderingId: opened.orderingId,
      expectedRevision: 1,
      messageId: 'wamid.expiry-refresh-123456',
    });
    expect(refreshed.revision).toBe(2);
    expect(Date.parse(refreshed.confirmationAction!.expiresAt)).toBeGreaterThan(currentTime.getTime());
  });

  it('trata JSONB com chaves recursivamente reordenadas como materialização igual', async () => {
    const adapter = new MemoryAdapter();
    adapter.autoAccept = false;
    adapter.reorderEveryRoundTrip = true;
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: (record) => `token-jsonb-${record.revision}`,
      hashConfirmationToken: (token) => token.padEnd(64, '0').slice(0, 64),
    });
    const opened = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.jsonb-open-123456', draft: { items: [{ productId: 10, quantity: 1 }] },
    });

    const confirmed = await ordering.apply({
      type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.jsonb-confirm-123456', orderingId: opened.orderingId, expectedRevision: 1,
    });

    expect(confirmed).toMatchObject({ state: 'confirmed_waiting_review', revision: 1, requiresReview: false });
    expect(confirmed.order).not.toBeNull();
    expect(adapter.jsonbRoundTrips).toBeGreaterThanOrEqual(2);
  });

  it('vincula revalidação e criação em uma única confirmação atômica', async () => {
    const adapter = new MemoryAdapter();
    adapter.autoAccept = false;
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: (record) => `token-atomic-${record.revision}`,
      hashConfirmationToken: (token) => token.padEnd(64, '1').slice(0, 64),
    });
    const opened = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.atomic-open-123456', draft: { items: [{ productId: 10, quantity: 1 }] },
    });
    adapter.changePriceAfterRevalidate = 30;

    const result = await ordering.apply({
      type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.atomic-confirm-123456', orderingId: opened.orderingId, expectedRevision: 1,
    });

    expect(result).toMatchObject({ state: 'cart_open', revision: 2, requiresReview: true, order: null });
    expect(result.pricing.total).toBe(30);
  });

  it('devolve snapshot e revisão atuais quando a emissão perde o CAS', async () => {
    const adapter = new MemoryAdapter();
    adapter.conflictNextIssuance = true;
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: () => 'token-issuance-conflict',
      hashConfirmationToken: () => '2'.repeat(64),
    });

    await expect(ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.issue-conflict-123456', draft: { items: [{ productId: 10, quantity: 1 }] },
    })).rejects.toMatchObject({
      code: 'REVISAO_DESATUALIZADA',
      currentSnapshot: expect.objectContaining({ revision: 2 }),
    });
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
