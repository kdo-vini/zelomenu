import { describe, expect, it, vi } from 'vitest';
import {
  createConversationOrdering as createProductionConversationOrdering,
  ConversationOrderingError,
  jsonbSemanticallyEqual,
  type ConversationOrderingAdapter,
  type ConversationOrderingRecord,
  type ConversationOrderCreateDraft,
  type ConversationAiPermit,
  type ConversationOrderCommand,
  type DraftMaterialization,
  type DraftMutationResult,
  type OrderingRequirement,
} from './conversationOrdering';
import { deriveModifierRequirements } from './conversationOrderRequirements';
import { bemServidoConversationCatalog } from './fixtures/bemServidoConversationCatalog';

const EMPRESA_A = '10000000-0000-4000-8000-000000000001';
const JID_A = '5511999999999@s.whatsapp.net';
const AI_PERMIT = {
  conversationControlId: '60000000-0000-4000-8000-000000000001',
  conversationEpoch: '42',
} as const;
const PICKUP_FULFILLMENT = { type: 'pickup' } as const;

type TestConversationOrderCommand = ConversationOrderCommand extends infer Command
  ? Command extends ConversationOrderCommand
    ? Omit<Command, keyof ConversationAiPermit> & Partial<ConversationAiPermit>
    : never
  : never;

function createConversationOrdering(...args: Parameters<typeof createProductionConversationOrdering>) {
  const ordering = createProductionConversationOrdering(...args);
  return {
    ...ordering,
    apply(command: TestConversationOrderCommand) {
      return ordering.apply({ ...AI_PERMIT, ...command } as ConversationOrderCommand);
    },
  };
}

function materialization(productId = 10, unitPrice = 20, lineId = 'line-1'): DraftMaterialization {
  return {
    cart: {
      items: [{
        lineId,
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
    customer: { name: 'Cliente de teste', phone: null },
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
    payment: { declaredMethod: 'dinheiro', pixReceiptRequired: false, pixReceiptApproved: false },
    pricing: { subtotal: unitPrice, deliveryFee: 0, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: unitPrice },
    revalidation: { checkedAt: '2026-08-30T12:00:00.000Z', ok: true, issues: [] },
    requirements: [],
    readyForConfirmation: true,
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
  nextRequirements: OrderingRequirement[] = [];
  deliveryFeeToConfirm = false;
  forceReadyForConfirmation: boolean | null = null;
  customerName: string | null = 'Cliente de teste';
  paymentMethod: string | null = 'dinheiro';
  controlMode: 'ai' | 'human' = 'ai';
  controlEpoch: string = AI_PERMIT.conversationEpoch;
  revokeBeforeMutation: 'create' | 'update' | 'cancel' | 'confirm' | 'token' | null = null;
  mutationPermits: Array<{
    mutation: 'create' | 'update' | 'cancel' | 'confirm' | 'token';
    conversationControlId: unknown;
    conversationEpoch: unknown;
  }> = [];

  private fenceAiMutation(
    mutation: 'create' | 'update' | 'cancel' | 'confirm' | 'token',
    input: unknown,
  ): void {
    const candidate = input as Partial<typeof AI_PERMIT>;
    this.mutationPermits.push({
      mutation,
      conversationControlId: candidate.conversationControlId,
      conversationEpoch: candidate.conversationEpoch,
    });
    if (this.revokeBeforeMutation === mutation) {
      this.revokeBeforeMutation = null;
      this.controlMode = 'human';
      this.controlEpoch = String(BigInt(this.controlEpoch) + 1n);
    }
    // Models the unsafe legacy path: a mutation without a permit bypasses the
    // control row entirely. The RED test proves the domain currently does this.
    if (candidate.conversationControlId === undefined || candidate.conversationEpoch === undefined) return;
    if (candidate.conversationControlId !== AI_PERMIT.conversationControlId
      || candidate.conversationEpoch !== this.controlEpoch
      || this.controlMode !== 'ai') {
      throw new ConversationOrderingError(
        'AI_TURN_REVOKED',
        'Esta conversa passou para atendimento humano. Atualize antes de continuar.',
      );
    }
  }

  private roundTrip(record: ConversationOrderingRecord | null): ConversationOrderingRecord | null {
    if (!record || !this.reorderEveryRoundTrip) return record;
    const reordered = reorderJsonKeys(record) as ConversationOrderingRecord;
    const index = this.records.indexOf(record);
    if (index >= 0) this.records[index] = reordered;
    this.jsonbRoundTrips += 1;
    return reordered;
  }

  async materializeDraft(_scope: { empresaId: string; remoteJid: string }, draft: ConversationOrderCreateDraft): Promise<DraftMaterialization> {
    const first = draft.items[0];
    const resolved = materialization(first?.productId ?? 10, this.currentPrice, first?.lineId ?? 'line-1');
    resolved.cart.items = draft.items.map((item) => ({
      ...resolved.cart.items[0],
      lineId: item.lineId,
      productId: item.productId,
      productName: `Produto ${item.productId}`,
      quantity: item.quantity,
      lineTotal: this.currentPrice * item.quantity,
      notes: item.notes ?? null,
    }));
    resolved.pricing.subtotal = resolved.cart.items.reduce((total, item) => total + item.lineTotal, 0);
    if (draft.fulfillment?.type === 'delivery') {
      resolved.fulfillment = {
        ...resolved.fulfillment,
        ...draft.fulfillment,
        type: 'delivery',
        asap: draft.fulfillment.asap !== false,
        deliveryFee: this.currentDeliveryFee,
        deliveryFeeToConfirm: this.deliveryFeeToConfirm,
        deliveryStatus: 'eligible',
      };
    } else if (draft.fulfillment?.type === 'pickup') {
      resolved.fulfillment = { ...resolved.fulfillment, ...draft.fulfillment, type: 'pickup' };
    }
    resolved.customer = { ...resolved.customer, name: this.customerName };
    resolved.payment = { ...resolved.payment, declaredMethod: this.paymentMethod };
    resolved.requirements = [...this.nextRequirements];
    if (this.nextRevalidationIssues.length > 0) {
      resolved.revalidation = { checkedAt: '2026-08-30T12:01:00.000Z', ok: false, issues: this.nextRevalidationIssues };
    }
    resolved.readyForConfirmation = !resolved.requirements.some((requirement) => requirement.blocking)
      && resolved.revalidation.ok
      && resolved.fulfillment.type !== null
      && !resolved.fulfillment.deliveryFeeToConfirm;
    if (this.forceReadyForConfirmation !== null) {
      resolved.readyForConfirmation = this.forceReadyForConfirmation;
    }
    resolved.pricing.deliveryFee = resolved.fulfillment.deliveryFee;
    resolved.pricing.total = resolved.pricing.subtotal + resolved.pricing.deliveryFee;
    return resolved;
  }

  async revalidateDraft(empresaId: string, draft: ConversationOrderCreateDraft): Promise<DraftMaterialization> {
    const resolved = await this.materializeDraft({ empresaId, remoteJid: '5511999999999@s.whatsapp.net' }, draft);
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

  async findByOrderingId(lookup: { orderingId: string; empresaId: string; remoteJid: string }): Promise<ConversationOrderingRecord | null> {
    return this.roundTrip(this.records.find((record) => record.orderingId === lookup.orderingId && record.empresaId === lookup.empresaId && record.remoteJid === lookup.remoteJid) ?? null);
  }

  async createOpen(input: Omit<ConversationOrderingRecord, 'sessionId' | 'orderingId' | 'revision' | 'state' | 'updatedAt' | 'order' | 'reviewRequired'> & ConversationAiPermit): Promise<ConversationOrderingRecord> {
    await Promise.resolve();
    this.fenceAiMutation('create', input);
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
      reviewRequired: false,
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
  } & ConversationAiPermit): Promise<DraftMutationResult> {
    this.fenceAiMutation('update', input);
    const latest = await this.findByOrderingId({ orderingId: input.current.orderingId, empresaId: input.current.empresaId, remoteJid: input.current.remoteJid });
    if (!latest) throw new Error('missing');
    if (latest.processedMessageIds.includes(input.messageId)) return { kind: 'duplicate', record: latest };
    if (latest.revision !== input.expectedRevision || latest.state !== 'cart_open') return { kind: 'conflict', record: latest };
    Object.assign(latest, input.materialization, {
      revision: latest.revision + 1,
      updatedAt: this.writeTime ?? new Date(Date.parse(latest.updatedAt) + 1_000).toISOString(),
      pessoaId: input.pessoaId,
      reviewRequired: false,
      processedMessageIds: [...latest.processedMessageIds, input.messageId],
    });
    return { kind: 'applied', record: latest };
  }

  async cancelOpen(input: { current: ConversationOrderingRecord; expectedRevision: number; messageId: string } & ConversationAiPermit): Promise<DraftMutationResult> {
    this.fenceAiMutation('cancel', input);
    const latest = await this.findByOrderingId({ orderingId: input.current.orderingId, empresaId: input.current.empresaId, remoteJid: input.current.remoteJid });
    if (!latest) throw new Error('missing');
    if (latest.processedMessageIds.includes(input.messageId)) return { kind: 'duplicate', record: latest };
    if (latest.revision !== input.expectedRevision || latest.state !== 'cart_open') return { kind: 'conflict', record: latest };
    latest.state = 'cancelled';
    latest.revision += 1;
    latest.updatedAt = new Date(Date.parse(latest.updatedAt) + 1_000).toISOString();
    latest.processedMessageIds.push(input.messageId);
    return { kind: 'applied', record: latest };
  }

  async issueConfirmationToken(input: { current: ConversationOrderingRecord; tokenHash: string } & ConversationAiPermit) {
    this.fenceAiMutation('token', input);
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
  } & ConversationAiPermit) {
    this.fenceAiMutation('confirm', input);
    const latest = await this.findByOrderingId({ orderingId: input.current.orderingId, empresaId: input.current.empresaId, remoteJid: input.current.remoteJid });
    if (!latest) throw new Error('missing');
    if (!input.tokenHash || this.tokenHashes.get(input.current.sessionId) !== input.tokenHash) {
      throw new ConversationOrderingError('CONFIRMACAO_INVALIDA', 'Esta confirmação não é mais válida.');
    }
    if (latest.order) return { kind: 'confirmed' as const, record: this.confirm(latest, input.pessoaId) };
    if (latest.revision !== input.expectedRevision || latest.state !== 'cart_open') return { kind: 'conflict' as const, record: latest };
    if (this.changePriceAfterRevalidate != null) {
      this.currentPrice = this.changePriceAfterRevalidate;
      this.changePriceAfterRevalidate = null;
    }
    const draft: ConversationOrderCreateDraft = {
      items: latest.cart.items.flatMap((item) => item.productId == null ? [] : [{
        lineId: item.lineId,
        productId: item.productId,
        quantity: item.quantity,
        notes: item.notes,
        selectedOptions: item.selectedModifiers.map((group) => ({
          groupId: group.groupId,
          optionSelections: group.selectedOptions.map((option) => ({ optionId: option.optionId, quantity: option.quantity ?? 1 })),
        })),
      }]),
      fulfillment: latest.fulfillment.type === null ? null : {
        ...latest.fulfillment,
        type: latest.fulfillment.type,
      },
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
        conversationControlId: input.conversationControlId,
        conversationEpoch: input.conversationEpoch,
        current: latest, expectedRevision: input.expectedRevision, messageId: input.messageId,
        materialization: revalidated, pessoaId: input.pessoaId,
      });
      if (persisted.kind !== 'conflict') persisted.record.reviewRequired = true;
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
  it('encaminha o permit atual sem converter o epoch em todas as mutações', async () => {
    const updating = new MemoryAdapter();
    const updatingOrdering = createConversationOrdering(updating, {
      createRawConfirmationToken: (record) => `token-permit-${record.revision}`,
      hashConfirmationToken: (token) => token.padEnd(64, 'a').slice(0, 64),
    });
    const opened = await updatingOrdering.apply({
      ...AI_PERMIT,
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.permit-open-123456',
      draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });
    await updatingOrdering.apply({
      ...AI_PERMIT,
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.permit-update-123456', orderingId: opened.orderingId, expectedRevision: 1,
      draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 2 }], fulfillment: PICKUP_FULFILLMENT },
    });
    await updatingOrdering.apply({
      ...AI_PERMIT,
      type: 'cancel_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.permit-cancel-123456', orderingId: opened.orderingId, expectedRevision: 2,
    });

    const confirming = new MemoryAdapter();
    confirming.autoAccept = false;
    const confirmingOrdering = createConversationOrdering(confirming, {
      createRawConfirmationToken: (record) => `token-permit-confirm-${record.revision}`,
      hashConfirmationToken: (token) => token.padEnd(64, 'b').slice(0, 64),
    });
    const ready = await confirmingOrdering.apply({
      ...AI_PERMIT,
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.permit-confirm-open-123456',
      draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });
    await confirmingOrdering.apply({
      ...AI_PERMIT,
      type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.permit-confirm-123456', orderingId: ready.orderingId, expectedRevision: 1,
      confirmationToken: ready.confirmationAction!.token,
    });

    expect(updating.mutationPermits).toEqual([
      { mutation: 'create', ...AI_PERMIT },
      { mutation: 'token', ...AI_PERMIT },
      { mutation: 'update', ...AI_PERMIT },
      { mutation: 'token', ...AI_PERMIT },
      { mutation: 'cancel', ...AI_PERMIT },
    ]);
    expect(confirming.mutationPermits).toEqual([
      { mutation: 'create', ...AI_PERMIT },
      { mutation: 'token', ...AI_PERMIT },
      { mutation: 'confirm', ...AI_PERMIT },
    ]);
  });

  it('rejeita confirmação textual de revisão não pronta antes da RPC', async () => {
    const adapter = new MemoryAdapter();
    adapter.customerName = null;
    adapter.paymentMethod = null;
    adapter.nextRequirements = [
      {
        id: 'customer_name', type: 'customer_name', name: 'Informe o nome para o pedido.', blocking: true,
      },
      {
        id: 'payment_method', type: 'payment_method', name: 'Escolha a forma de pagamento.', blocking: true,
      },
    ];
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: () => 'token-incompleto',
      hashConfirmationToken: () => 'i'.repeat(64),
    });
    const opened = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.incomplete-confirm-open-123456',
      draft: { items: [{ lineId: 'line-1', productId: 1001, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });
    const confirmAtomically = vi.spyOn(adapter, 'confirmAtomically');

    const error = await ordering.apply({
      type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.incomplete-confirm-123456', orderingId: opened.orderingId,
      expectedRevision: opened.revision,
      // Not-ready orders reject on readiness before the token is even
      // examined (see the guard order in applyOnce); this placeholder is
      // never validated.
      confirmationToken: 'token-placeholder-unused-not-ready',
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ConversationOrderingError);
    expect(error).toMatchObject({ code: 'PEDIDO_INVALIDO', message: 'Revise os dados pendentes antes de confirmar.' });
    expect(error.currentSnapshot).toMatchObject({
      readyForConfirmation: false,
      customer: { name: null, phone: null },
      payment: { declaredMethod: null },
    });
    expect(confirmAtomically).not.toHaveBeenCalled();
    expect(adapter.issuedHashes).toEqual([]);
  });

  it.each([
    {
      label: 'nome vazio',
      mutate: (record: ConversationOrderingRecord) => { record.customer = { ...record.customer, name: '   ' }; },
    },
    {
      label: 'pagamento nulo',
      mutate: (record: ConversationOrderingRecord) => { record.payment = { ...record.payment, declaredMethod: null }; },
    },
    {
      label: 'entrega sem endereço completo',
      mutate: (record: ConversationOrderingRecord) => {
        record.fulfillment = {
          ...record.fulfillment,
          type: 'delivery',
          deliveryAddress: null,
          deliveryStreet: null,
          deliveryNumber: null,
          deliveryNeighborhood: null,
        };
      },
    },
    {
      label: 'agenda sem data e horário',
      mutate: (record: ConversationOrderingRecord) => {
        record.fulfillment = {
          ...record.fulfillment,
          type: 'pickup',
          asap: false,
          pickupDate: null,
          pickupTime: null,
        };
      },
    },
  ])('falha fechado para prontidão verdadeira mas $label', async ({ mutate }) => {
    const adapter = new MemoryAdapter();
    adapter.forceReadyForConfirmation = false;
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: () => 'token-malicious-ready',
      hashConfirmationToken: () => 'm'.repeat(64),
    });
    const opened = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.malicious-ready-open-123456',
      draft: { items: [{ lineId: 'line-1', productId: 1001, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });
    const stored = adapter.records[0]!;
    mutate(stored);
    stored.readyForConfirmation = true;
    const confirmAtomically = vi.spyOn(adapter, 'confirmAtomically');

    await expect(ordering.apply({
      type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.malicious-ready-confirm-123456', orderingId: opened.orderingId,
      expectedRevision: opened.revision,
      confirmationToken: 'token-placeholder-unused-not-ready',
    })).rejects.toMatchObject({
      code: 'PEDIDO_INVALIDO',
      message: 'Revise os dados pendentes antes de confirmar.',
      currentSnapshot: expect.objectContaining({ readyForConfirmation: false }),
    });
    expect(confirmAtomically).not.toHaveBeenCalled();
    expect(adapter.issuedHashes).toEqual([]);
  });

  it.each([
    {
      label: 'requirement sem blocking',
      mutate: (record: ConversationOrderingRecord) => { record.requirements = [{} as never]; },
    },
    {
      label: 'requirement nulo',
      mutate: (record: ConversationOrderingRecord) => { record.requirements = [null as never]; },
    },
    {
      label: 'blocking não booleano',
      mutate: (record: ConversationOrderingRecord) => { record.requirements = [{ blocking: 'false' } as never]; },
    },
    {
      label: 'revalidação com ok textual',
      mutate: (record: ConversationOrderingRecord) => {
        record.revalidation = { ...record.revalidation, ok: 'true' as never };
      },
    },
  ])('falha fechado para fact malformado: $label', async ({ label, mutate }) => {
    const adapter = new MemoryAdapter();
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: () => 'token-malformed-fact',
      hashConfirmationToken: () => 'z'.repeat(64),
    });
    const opened = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.malformed-fact-open-123456',
      draft: { items: [{ lineId: 'line-1', productId: 1001, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });
    mutate(adapter.records[0]!);
    adapter.issuedHashes = [];

    await expect(ordering.apply({
      type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: `wamid.malformed-fact-confirm-${label}`, orderingId: opened.orderingId,
      expectedRevision: opened.revision,
      confirmationToken: 'token-placeholder-unused-not-ready',
    })).rejects.toMatchObject({
      code: 'PEDIDO_INVALIDO',
      message: 'Revise os dados pendentes antes de confirmar.',
      currentSnapshot: expect.objectContaining({ readyForConfirmation: false }),
    });
    expect(adapter.issuedHashes).toEqual([]);
  });

  it.each(['create', 'update', 'cancel', 'confirm'] as const)(
    'não grava quando a tomada humana ocorre imediatamente antes de $s',
    async (mutation) => {
      const adapter = new MemoryAdapter();
      adapter.autoAccept = false;
      const ordering = createConversationOrdering(adapter, {
        createRawConfirmationToken: (record) => `token-revoked-${mutation}-${record.revision}`,
        hashConfirmationToken: (token) => token.padEnd(64, 'c').slice(0, 64),
      });

      let opened: Awaited<ReturnType<typeof ordering.apply>> | null = null;
      if (mutation !== 'create') {
        opened = await ordering.apply({
          ...AI_PERMIT,
          type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
          messageId: `wamid.revoked-${mutation}-open-123456`,
          draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
        });
      }
      const before = structuredClone(adapter.records);
      adapter.revokeBeforeMutation = mutation;

      const command = mutation === 'create'
        ? {
          ...AI_PERMIT,
          type: 'open_or_update_draft' as const, empresaId: EMPRESA_A, remoteJid: JID_A,
          messageId: 'wamid.revoked-create-123456',
          draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
        }
        : mutation === 'update'
          ? {
            ...AI_PERMIT,
            type: 'open_or_update_draft' as const, empresaId: EMPRESA_A, remoteJid: JID_A,
            messageId: 'wamid.revoked-update-123456', orderingId: opened!.orderingId, expectedRevision: 1,
            draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 2 }], fulfillment: PICKUP_FULFILLMENT },
          }
          : mutation === 'cancel'
            ? {
              ...AI_PERMIT,
              type: 'cancel_draft' as const, empresaId: EMPRESA_A, remoteJid: JID_A,
              messageId: 'wamid.revoked-cancel-123456', orderingId: opened!.orderingId, expectedRevision: 1,
            }
            : {
              ...AI_PERMIT,
              type: 'confirm_draft' as const, empresaId: EMPRESA_A, remoteJid: JID_A,
              messageId: 'wamid.revoked-confirm-123456', orderingId: opened!.orderingId, expectedRevision: 1,
              confirmationToken: opened!.confirmationAction!.token,
            };

      await expect(ordering.apply(command)).rejects.toMatchObject({
        code: 'AI_TURN_REVOKED',
        currentSnapshot: null,
      });
      expect(adapter.records).toEqual(before);
    },
  );

  it('nao emite token de confirmacao se a tomada ocorrer depois do draft e antes da emissao', async () => {
    const adapter = new MemoryAdapter();
    adapter.revokeBeforeMutation = 'token';
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: (record) => `token-revoked-issue-${record.revision}`,
      hashConfirmationToken: (token) => token.padEnd(64, 'd').slice(0, 64),
    });

    await expect(ordering.apply({
      ...AI_PERMIT,
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.revoked-token-open-123456',
      draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    })).rejects.toMatchObject({ code: 'AI_TURN_REVOKED', currentSnapshot: null });

    expect(adapter.records).toHaveLength(1);
    expect(adapter.tokenHashes).toEqual(new Map());
  });

  it('preserva linhas estáveis do mesmo produto ao atualizar somente a segunda linha', async () => {
    const adapter = new MemoryAdapter();
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: (record) => `token-lines-${record.revision}`,
      hashConfirmationToken: (token) => token.padEnd(64, 'a').slice(0, 64),
    });
    const opened = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.lines-open-123456',
      draft: {
        items: [
          { lineId: 'line-1', productId: 1001, quantity: 1, notes: 'Sem gelo' },
          { lineId: 'line-2', productId: 1001, quantity: 2 },
        ],
        fulfillment: PICKUP_FULFILLMENT,
      },
    });

    const updated = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.lines-update-123456', orderingId: opened.orderingId, expectedRevision: 1,
      draft: {
        items: [{ lineId: 'line-2', productId: 1001, quantity: 3 }],
        fulfillment: PICKUP_FULFILLMENT,
      },
    });

    expect(updated.cart.items).toMatchObject([
      { lineId: 'line-1', productId: 1001, quantity: 1, notes: 'Sem gelo' },
      { lineId: 'line-2', productId: 1001, quantity: 3 },
    ]);
    expect(updated.revision).toBe(2);
  });

  it('remove somente a linha explicitamente informada e preserva o replay idempotente', async () => {
    const adapter = new MemoryAdapter();
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: (record) => `token-remove-${record.revision}`,
      hashConfirmationToken: (token) => token.padEnd(64, 'a').slice(0, 64),
    });
    const opened = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.remove-open-123456',
      draft: {
        items: [
          { lineId: 'line-1', productId: 1001, quantity: 1 },
          { lineId: 'line-2', productId: 1001, quantity: 2 },
        ],
        fulfillment: PICKUP_FULFILLMENT,
      },
    });
    const removeCommand = {
      type: 'open_or_update_draft' as const, empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.remove-update-123456', orderingId: opened.orderingId, expectedRevision: 1,
      draft: { items: [], removedLineIds: ['line-1'], fulfillment: PICKUP_FULFILLMENT },
    };

    const updated = await ordering.apply(removeCommand);
    const retry = await ordering.apply(removeCommand);

    expect(updated.cart.items.map((item) => item.lineId)).toEqual(['line-2']);
    expect(updated.revision).toBe(2);
    expect(retry.cart.items.map((item) => item.lineId)).toEqual(['line-2']);
    expect(retry.revision).toBe(2);
  });

  it('rejeita removedLineIds inválidos, duplicados ou sobrepostos aos itens recebidos', async () => {
    const scenarios = [
      {
        label: 'inválido',
        items: [],
        removedLineIds: ['line.1'],
        message: 'Revise a identificação dos itens removidos.',
      },
      {
        label: 'duplicado',
        items: [],
        removedLineIds: ['line-1', 'line-1'],
        message: 'Cada item removido precisa de uma identificação diferente.',
      },
      {
        label: 'sobreposto',
        items: [{ lineId: 'line-1', productId: 1001, quantity: 3 }],
        removedLineIds: ['line-1'],
        message: 'Um item não pode ser atualizado e removido ao mesmo tempo.',
      },
    ];

    for (const [index, scenario] of scenarios.entries()) {
      const adapter = new MemoryAdapter();
      const ordering = createConversationOrdering(adapter, {
        createRawConfirmationToken: () => `token-remove-invalid-${index}`,
        hashConfirmationToken: () => 'b'.repeat(64),
      });
      const opened = await ordering.apply({
        type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
        messageId: `wamid.remove-validation-open-${index}`,
        draft: {
          items: [
            { lineId: 'line-1', productId: 1001, quantity: 1 },
            { lineId: 'line-2', productId: 1001, quantity: 2 },
          ],
          fulfillment: PICKUP_FULFILLMENT,
        },
      });

      await expect(ordering.apply({
        type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
        messageId: `wamid.remove-validation-update-${index}`, orderingId: opened.orderingId, expectedRevision: 1,
        draft: {
          items: scenario.items,
          removedLineIds: scenario.removedLineIds,
          fulfillment: PICKUP_FULFILLMENT,
        },
      }), scenario.label).rejects.toMatchObject({ code: 'ITEM_INVALIDO', message: scenario.message });
      expect((await ordering.getSnapshot({ orderingId: opened.orderingId, empresaId: opened.empresaId, remoteJid: opened.remoteJid }))?.revision, scenario.label).toBe(1);
    }
  });

  it('rejeita remoção de lineId ausente do carrinho atual', async () => {
    const adapter = new MemoryAdapter();
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: () => 'token-remove-missing',
      hashConfirmationToken: () => 'c'.repeat(64),
    });
    const opened = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.remove-missing-open-123456',
      draft: { items: [{ lineId: 'line-1', productId: 1001, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });

    await expect(ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.remove-missing-update-123456', orderingId: opened.orderingId, expectedRevision: 1,
      draft: { items: [], removedLineIds: ['line-2'], fulfillment: PICKUP_FULFILLMENT },
    })).rejects.toMatchObject({
      code: 'ITEM_INVALIDO',
      message: 'Não encontrei um item informado para remoção.',
    });
    expect((await ordering.getSnapshot({ orderingId: opened.orderingId, empresaId: opened.empresaId, remoteJid: opened.remoteJid }))?.revision).toBe(1);
  });

  it('rejeita remoção que deixaria o carrinho vazio e orienta cancelamento total', async () => {
    const adapter = new MemoryAdapter();
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: () => 'token-remove-last',
      hashConfirmationToken: () => 'd'.repeat(64),
    });
    const opened = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.remove-last-open-123456',
      draft: { items: [{ lineId: 'line-1', productId: 1001, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });

    await expect(ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.remove-last-update-123456', orderingId: opened.orderingId, expectedRevision: 1,
      draft: { items: [], removedLineIds: ['line-1'], fulfillment: PICKUP_FULFILLMENT },
    })).rejects.toMatchObject({
      code: 'PEDIDO_VAZIO',
      message: 'O pedido precisa ter pelo menos um item. Para encerrar tudo, cancele o pedido.',
    });
    expect((await ordering.getSnapshot({ orderingId: opened.orderingId, empresaId: opened.empresaId, remoteJid: opened.remoteJid }))?.revision).toBe(1);
  });

  it('não emite confirmação quando a materialização tem requisito bloqueante', async () => {
    const adapter = new MemoryAdapter();
    adapter.nextRequirements = deriveModifierRequirements(
      [{ lineId: 'line-1', productId: 1007 }],
      bemServidoConversationCatalog,
    );
    adapter.forceReadyForConfirmation = true;
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: () => 'token-blocked',
      hashConfirmationToken: () => 'a'.repeat(64),
    });

    const snapshot = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.blocked-open-123456',
      draft: { items: [{ lineId: 'line-1', productId: 1007, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });

    expect(snapshot.requirements.some((requirement) => requirement.blocking)).toBe(true);
    expect(snapshot.readyForConfirmation).toBe(false);
    expect(snapshot.confirmationAction).toBeNull();
    expect(adapter.issuedHashes).toEqual([]);
  });

  it('mantém modalidade ausente e exige escolha explícita sem assumir retirada', async () => {
    const adapter = new MemoryAdapter();
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: () => 'token-without-fulfillment',
      hashConfirmationToken: () => 'b'.repeat(64),
    });

    const snapshot = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.no-fulfillment-123456',
      draft: { items: [{ lineId: 'line-1', productId: 1001, quantity: 1 }] },
    });

    expect(snapshot.fulfillment.type).toBeNull();
    expect(snapshot.requirements).toContainEqual(expect.objectContaining({
      id: 'fulfillment_type', type: 'fulfillment_type', blocking: true,
    }));
    expect(snapshot.readyForConfirmation).toBe(false);
    expect(snapshot.confirmationAction).toBeNull();
    expect(adapter.issuedHashes).toEqual([]);
  });

  it('rejeita lineId fora do formato permitido antes de materializar', async () => {
    for (const [index, lineId] of ['', 'linha 1', 'linha.1', 'a'.repeat(65)].entries()) {
      const adapter = new MemoryAdapter();
      const ordering = createConversationOrdering(adapter, {
        createRawConfirmationToken: () => 'unused-invalid-line',
        hashConfirmationToken: () => 'c'.repeat(64),
      });

      await expect(ordering.apply({
        type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
        messageId: `wamid.invalid-line-${index}-123456`,
        draft: { items: [{ lineId, productId: 1001, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
      })).rejects.toMatchObject({
        code: 'ITEM_INVALIDO',
        message: 'Revise a identificação dos itens do pedido.',
      });
      expect(adapter.createCalls).toBe(0);
      expect(adapter.issuedHashes).toEqual([]);
    }
  });

  it('rejeita lineId duplicado antes de materializar', async () => {
    const adapter = new MemoryAdapter();
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: () => 'unused-duplicate-line',
      hashConfirmationToken: () => 'd'.repeat(64),
    });

    await expect(ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.duplicate-line-123456',
      draft: {
        items: [
          { lineId: 'line-1', productId: 1001, quantity: 1 },
          { lineId: 'line-1', productId: 1001, quantity: 2 },
        ],
        fulfillment: PICKUP_FULFILLMENT,
      },
    })).rejects.toMatchObject({
      code: 'ITEM_INVALIDO',
      message: 'Cada item do pedido precisa de uma identificação diferente.',
    });
    expect(adapter.createCalls).toBe(0);
    expect(adapter.issuedHashes).toEqual([]);
  });

  it('não emite confirmação com taxa pendente ou revalidação reprovada', async () => {
    const unsettledAdapter = new MemoryAdapter();
    unsettledAdapter.deliveryFeeToConfirm = true;
    unsettledAdapter.forceReadyForConfirmation = true;
    const unsettledOrdering = createConversationOrdering(unsettledAdapter, {
      createRawConfirmationToken: () => 'token-unsettled-fee',
      hashConfirmationToken: () => 'e'.repeat(64),
    });
    const unsettled = await unsettledOrdering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.unsettled-fee-123456',
      draft: {
        items: [{ lineId: 'line-1', productId: 1001, quantity: 1 }],
        fulfillment: { type: 'delivery' },
      },
    });

    const failedAdapter = new MemoryAdapter();
    failedAdapter.nextRevalidationIssues = [{ code: 'product_unavailable', message: 'Item indisponível.' }];
    failedAdapter.forceReadyForConfirmation = true;
    const failedOrdering = createConversationOrdering(failedAdapter, {
      createRawConfirmationToken: () => 'token-failed-revalidation',
      hashConfirmationToken: () => 'f'.repeat(64),
    });
    const failed = await failedOrdering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.failed-revalidation-123456',
      draft: { items: [{ lineId: 'line-1', productId: 1001, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });

    expect(unsettled).toMatchObject({ readyForConfirmation: false, confirmationAction: null });
    expect(failed).toMatchObject({ readyForConfirmation: false, confirmationAction: null });
    expect(unsettledAdapter.issuedHashes).toEqual([]);
    expect(failedAdapter.issuedHashes).toEqual([]);
  });

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
      draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
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
      messageId: 'wamid.open-1234567890', draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });
    const update = {
      type: 'open_or_update_draft' as const, empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.update-1234567890', orderingId: opened.orderingId,
      expectedRevision: 1, draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 2 }], fulfillment: PICKUP_FULFILLMENT },
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
      messageId: 'wamid.open-confirm-1234', draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });
    const updated = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.update-confirm-1234', orderingId: opened.orderingId, expectedRevision: 1,
      draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 2 }], fulfillment: PICKUP_FULFILLMENT, pessoaId: '40000000-0000-4000-8000-000000000001' },
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
    const initiallyConfirmed = structuredClone(confirmed);
    const retry = await ordering.apply(command);
    const replayWithIssuedToken = await ordering.apply({
      ...command,
      messageId: 'wamid.confirm-new-replay-1234',
    });

    expect(initiallyConfirmed.state).toBe('accepted');
    expect(initiallyConfirmed.order).toMatchObject({ id: expect.any(String), alreadyConfirmed: false });
    expect(initiallyConfirmed.pessoaId).toBe('40000000-0000-4000-8000-000000000001');
    expect(retry.order?.id).toBe(confirmed.order?.id);
    expect(replayWithIssuedToken.order).toMatchObject({
      id: confirmed.order?.id,
      alreadyConfirmed: true,
    });
    await expect(ordering.apply({
      ...command,
      messageId: 'wamid.confirm-new-forged-1234',
      confirmationToken: 'x'.repeat(43),
    })).rejects.toMatchObject({ code: 'CONFIRMACAO_INVALIDA' });
    expect(adapter.records).toHaveLength(1);
  });

  it('ZM1: exige confirmationToken no dominio mesmo quando o pedido esta pronto (bypass do parser)', async () => {
    const adapter = new MemoryAdapter();
    const ordering = createConversationOrdering(adapter, {
      createRawConfirmationToken: (record) => `token-required-${record.revision}`,
      hashConfirmationToken: (token) => token.padEnd(64, 'a').slice(0, 64),
    });
    const opened = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.token-required-open-123456',
      draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });
    expect(opened.readyForConfirmation).toBe(true);
    const confirmAtomically = vi.spyOn(adapter, 'confirmAtomically');

    // TestConversationOrderCommand types confirmationToken as required, so
    // the missing case can only be modeled by casting through unknown --
    // exactly what a caller that bypasses parseInternalOrderingCommand
    // (a bug, or a future call site) would produce at runtime.
    const commandWithoutToken = {
      type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.token-required-confirm-123456',
      orderingId: opened.orderingId, expectedRevision: 1,
    } as unknown as { type: 'confirm_draft'; empresaId: string; remoteJid: string; messageId: string; orderingId: string; expectedRevision: number; confirmationToken: string };

    await expect(ordering.apply(commandWithoutToken)).rejects.toMatchObject({
      code: 'CONFIRMACAO_INVALIDA',
      message: 'Informe a confirmação do pedido.',
    });
    expect(confirmAtomically).not.toHaveBeenCalled();
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
          items: [{ lineId: 'line-1', productId: 10, quantity: 1 }],
          fulfillment: scenario.label === 'taxa' || scenario.label === 'cobertura'
            ? {
              type: 'delivery',
              deliveryPostalCode: '01001000',
              deliveryAddress: 'Rua Teste',
              deliveryNeighborhood: 'Centro',
              deliveryNumber: '10',
            }
            : PICKUP_FULFILLMENT,
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
      if (scenario.issue) {
        expect(reviewed.revalidation.issues.map((item) => item.code)).toContain(scenario.issue);
        expect(reviewed.readyForConfirmation, scenario.label).toBe(false);
        expect(reviewed.confirmationAction, scenario.label).toBeNull();
      } else {
        expect(reviewed.readyForConfirmation, scenario.label).toBe(true);
        expect(reviewed.confirmationAction?.revision, scenario.label).toBe(2);
      }
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
      messageId: 'wamid.first-open-123456', draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });
    const confirmed = await ordering.apply({
      type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.first-text-confirm-123456', orderingId: first.orderingId, expectedRevision: 1,
      // A text "sim" reuses the same token the customer's summary carried --
      // it is a different USER INPUT than a button tap, not a different
      // token requirement.
      confirmationToken: first.confirmationAction!.token,
    });
    expect(confirmed.state).toBe('confirmed_waiting_review');

    const second = await ordering.apply({
      type: 'open_or_update_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.second-open-123456', draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
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
      draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    };
    const opened = await firstReplica.apply(openCommand);
    await firstReplica.apply({
      type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.historical-confirm-123456', orderingId: opened.orderingId, expectedRevision: 1,
      confirmationToken: opened.confirmationAction!.token,
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
      messageId: 'wamid.expiring-open-123456', draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    };
    const opened = await ordering.apply(command);
    expect(opened.confirmationAction?.expiresAt).toBe('2026-08-30T12:10:00.000Z');

    currentTime = new Date('2026-08-30T12:11:00.000Z');
    await expect(ordering.apply(command)).rejects.toMatchObject({
      code: 'RESUMO_EXPIRADO',
      currentSnapshot: expect.objectContaining({ requiresReview: false, confirmationAction: null, revision: 1 }),
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
      messageId: 'wamid.jsonb-open-123456', draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });

    const confirmed = await ordering.apply({
      type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.jsonb-confirm-123456', orderingId: opened.orderingId, expectedRevision: 1,
      confirmationToken: opened.confirmationAction!.token,
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
      messageId: 'wamid.atomic-open-123456', draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });
    adapter.changePriceAfterRevalidate = 30;

    const result = await ordering.apply({
      type: 'confirm_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.atomic-confirm-123456', orderingId: opened.orderingId, expectedRevision: 1,
      confirmationToken: opened.confirmationAction!.token,
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
      messageId: 'wamid.issue-conflict-123456', draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
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
      messageId: 'wamid.cancel-open-123456', draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 1 }], fulfillment: PICKUP_FULFILLMENT },
    });
    await expect(ordering.apply({
      type: 'cancel_draft', empresaId: '10000000-0000-4000-8000-000000000002', remoteJid: JID_A,
      messageId: 'wamid.cancel-wrong-company', orderingId: opened.orderingId, expectedRevision: 1,
    })).rejects.toMatchObject({ code: 'PEDIDO_NAO_ENCONTRADO' });
    expect((await ordering.getSnapshot({ orderingId: opened.orderingId, empresaId: opened.empresaId, remoteJid: opened.remoteJid }))?.state).toBe('cart_open');

    const cancelled = await ordering.apply({
      type: 'cancel_draft', empresaId: EMPRESA_A, remoteJid: JID_A,
      messageId: 'wamid.cancel-explicit-123456', orderingId: opened.orderingId, expectedRevision: 1,
    });
    expect(cancelled).toMatchObject({ state: 'cancelled', revision: 2, confirmationAction: null });
  });
});
