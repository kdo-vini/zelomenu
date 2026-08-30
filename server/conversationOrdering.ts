import type {
  ZeloMenuCartSnapshot,
  ZeloMenuPaymentSnapshot,
  ZeloMenuPricingSnapshot,
} from '../src/domain/zelomenuCartSchema.js';
import type {
  ZeloMenuCustomerSnapshot,
  ZeloMenuFulfillmentSnapshot,
} from './zelomenuCartSessions.js';

export type ConversationOrderItemSelection = {
  productId: number;
  quantity: number;
  notes?: string | null;
  selectedOptions?: Array<{
    groupId: string;
    optionSelections: Array<{ optionId: string; quantity: number }>;
  }>;
};

export type ConversationOrderDraft = {
  items: ConversationOrderItemSelection[];
  observations?: string | null;
  customer?: { name?: string | null; phone?: string | null };
  pessoaId?: string | null;
  fulfillment?: Partial<ZeloMenuFulfillmentSnapshot> | null;
  paymentMethod?: string | null;
};

type CommandIdentity = {
  empresaId: string;
  remoteJid: string;
  messageId: string;
};

export type ConversationOrderCommand = CommandIdentity & (
  | { type: 'open_or_update_draft'; orderingId?: string; expectedRevision?: number; draft: ConversationOrderDraft }
  | { type: 'confirm_draft'; orderingId: string; expectedRevision: number; confirmationToken?: string; pessoaId?: string | null }
  | { type: 'cancel_draft'; orderingId: string; expectedRevision: number }
);

export type ConversationRevalidation = {
  checkedAt: string;
  ok: boolean;
  issues: Array<{ code: string; message: string }>;
};

export type DraftMaterialization = {
  cart: ZeloMenuCartSnapshot;
  customer: ZeloMenuCustomerSnapshot;
  fulfillment: ZeloMenuFulfillmentSnapshot;
  payment: ZeloMenuPaymentSnapshot;
  pricing: ZeloMenuPricingSnapshot;
  revalidation: ConversationRevalidation;
};

export type CanonicalOrderReference = {
  id: string;
  status: string;
  alreadyConfirmed: boolean;
  revision: number;
};

export type ConversationOrderingRecord = DraftMaterialization & {
  sessionId: string;
  orderingId: string;
  empresaId: string;
  remoteJid: string;
  state: 'cart_open' | 'confirmed_waiting_review' | 'confirmed_waiting_payment' | 'needs_customer_adjustment' | 'accepted' | 'rejected' | 'cancelled' | 'archived';
  revision: number;
  updatedAt: string;
  pessoaId: string | null;
  processedMessageIds: string[];
  order: CanonicalOrderReference | null;
};

export type OrderingSnapshot = Omit<ConversationOrderingRecord, 'sessionId' | 'processedMessageIds'> & {
  confirmationAction: {
    type: 'confirm_order';
    token: string;
    revision: number;
    expiresAt: string;
  } | null;
  requiresReview: boolean;
};

export type DraftMutationResult =
  | { kind: 'applied'; record: ConversationOrderingRecord }
  | { kind: 'duplicate'; record: ConversationOrderingRecord }
  | { kind: 'conflict'; record: ConversationOrderingRecord };

export interface ConversationOrderingAdapter {
  materializeDraft(empresaId: string, draft: ConversationOrderDraft): Promise<DraftMaterialization>;
  revalidateDraft(empresaId: string, draft: ConversationOrderDraft): Promise<DraftMaterialization>;
  findOpen(empresaId: string, remoteJid: string): Promise<ConversationOrderingRecord | null>;
  findByOrderingId(orderingId: string): Promise<ConversationOrderingRecord | null>;
  createOpen(input: Omit<ConversationOrderingRecord, 'sessionId' | 'orderingId' | 'revision' | 'state' | 'updatedAt' | 'order'>): Promise<ConversationOrderingRecord>;
  updateOpen(input: {
    current: ConversationOrderingRecord;
    expectedRevision: number;
    messageId: string;
    materialization: DraftMaterialization;
    pessoaId: string | null;
  }): Promise<DraftMutationResult>;
  cancelOpen(input: { current: ConversationOrderingRecord; expectedRevision: number; messageId: string }): Promise<DraftMutationResult>;
  persistRevalidation(input: {
    current: ConversationOrderingRecord;
    expectedRevision: number;
    messageId: string;
    materialization: DraftMaterialization;
  }): Promise<DraftMutationResult>;
  issueConfirmationToken(input: {
    tokenHash: string;
    empresaId: string;
    remoteJid: string;
    sessionId: string;
    expectedRevision: number;
    expiresAt: string;
  }): Promise<void>;
  confirmDirect(input: {
    current: ConversationOrderingRecord;
    expectedRevision: number;
    idempotencyKey: string;
    pessoaId: string | null;
  }): Promise<ConversationOrderingRecord>;
  confirmWithToken(input: {
    current: ConversationOrderingRecord;
    expectedRevision: number;
    tokenHash: string;
    idempotencyKey: string;
    pessoaId: string | null;
  }): Promise<ConversationOrderingRecord>;
  applyAutoAccept(record: ConversationOrderingRecord): Promise<ConversationOrderingRecord>;
}

export class ConversationOrderingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly currentSnapshot: OrderingSnapshot | null = null,
  ) {
    super(message);
    this.name = 'ConversationOrderingError';
  }
}

type ConversationOrderingOptions = {
  createRawConfirmationToken: (record: ConversationOrderingRecord, expiresAt: string) => string;
  hashConfirmationToken: (token: string) => string;
  now?: () => Date;
  confirmationTtlMs?: number;
};

function toSnapshot(record: ConversationOrderingRecord, confirmationAction: OrderingSnapshot['confirmationAction'] = null, requiresReview = false): OrderingSnapshot {
  const { sessionId: _sessionId, processedMessageIds: _processedMessageIds, ...publicRecord } = record;
  return { ...publicRecord, confirmationAction, requiresReview };
}

function recordAsDraft(record: ConversationOrderingRecord): ConversationOrderDraft {
  return {
    items: record.cart.items.flatMap((item) => item.productId == null ? [] : [{
      productId: item.productId,
      quantity: item.quantity,
      notes: item.notes ?? null,
      selectedOptions: item.selectedModifiers.map((group) => ({
        groupId: group.groupId,
        optionSelections: group.selectedOptions.map((option) => ({ optionId: option.optionId, quantity: option.quantity ?? 1 })),
      })),
    }]),
    observations: record.cart.observations,
    customer: record.customer,
    pessoaId: record.pessoaId,
    fulfillment: record.fulfillment,
    paymentMethod: record.payment.declaredMethod,
  };
}

function materializationChanged(current: ConversationOrderingRecord, next: DraftMaterialization): boolean {
  return JSON.stringify({
    cart: current.cart,
    customer: current.customer,
    fulfillment: current.fulfillment,
    payment: current.payment,
    pricing: current.pricing,
  }) !== JSON.stringify({
    cart: next.cart,
    customer: next.customer,
    fulfillment: next.fulfillment,
    payment: next.payment,
    pricing: next.pricing,
  });
}

function materializationFailure(error: unknown): { code: string; message: string } | null {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw === 'PRODUCT_NOT_FOUND') return { code: 'product_missing', message: 'Um item não existe mais no cardápio.' };
  if (raw === 'PRODUCT_UNAVAILABLE') return { code: 'product_unavailable', message: 'Um item não está disponível no momento.' };
  if (raw.startsWith('PRODUCT_STOCK_EXCEEDED')) return { code: 'stock_insufficient', message: 'A quantidade de um item ultrapassa o estoque atual.' };
  if (raw.startsWith('MODIFIER_INVALID')) return { code: 'modifier_invalid', message: 'Revise os complementos escolhidos.' };
  if (raw === 'DELIVERY_DISABLED') return { code: 'delivery_unavailable', message: 'A entrega não está disponível para este pedido.' };
  return null;
}

function asFriendlyMaterializationError(error: unknown): ConversationOrderingError {
  const issue = materializationFailure(error);
  return issue
    ? new ConversationOrderingError('PEDIDO_INVALIDO', issue.message)
    : new ConversationOrderingError('PEDIDO_INDISPONIVEL', 'Não foi possível revisar o pedido agora. Tente novamente.');
}

export function createConversationOrdering(adapter: ConversationOrderingAdapter, options: ConversationOrderingOptions) {
  const now = options.now ?? (() => new Date());
  const ttlMs = options.confirmationTtlMs ?? 10 * 60_000;
  const inFlight = new Map<string, Promise<OrderingSnapshot>>();

  async function withConfirmationAction(record: ConversationOrderingRecord, requiresReview = false): Promise<OrderingSnapshot> {
    if (record.state !== 'cart_open') return toSnapshot(record, null, requiresReview);
    const revisionTime = Date.parse(record.updatedAt);
    const expiresAt = new Date((Number.isFinite(revisionTime) ? revisionTime : now().getTime()) + ttlMs).toISOString();
    const token = options.createRawConfirmationToken(record, expiresAt);
    await adapter.issueConfirmationToken({
      tokenHash: options.hashConfirmationToken(token),
      empresaId: record.empresaId,
      remoteJid: record.remoteJid,
      sessionId: record.sessionId,
      expectedRevision: record.revision,
      expiresAt,
    });
    const action = { type: 'confirm_order' as const, token, revision: record.revision, expiresAt };
    return toSnapshot(record, action, requiresReview);
  }

  async function applyOnce(command: ConversationOrderCommand): Promise<OrderingSnapshot> {
    if (command.type === 'open_or_update_draft' && !command.orderingId) {
      const existing = await adapter.findOpen(command.empresaId, command.remoteJid);
      if (existing) {
        if (existing.processedMessageIds.includes(command.messageId)) return withConfirmationAction(existing);
        throw new ConversationOrderingError('PEDIDO_EM_ANDAMENTO', 'Já existe um pedido em andamento nesta conversa.', toSnapshot(existing));
      }
      let materialized: DraftMaterialization;
      try {
        materialized = await adapter.materializeDraft(command.empresaId, command.draft);
      } catch (error) {
        throw asFriendlyMaterializationError(error);
      }
      const record = await adapter.createOpen({
        ...materialized,
        empresaId: command.empresaId,
        remoteJid: command.remoteJid,
        pessoaId: command.draft.pessoaId ?? null,
        processedMessageIds: [command.messageId],
      });
      return withConfirmationAction(record);
    }

    const current = await adapter.findByOrderingId(command.orderingId!);
    if (!current || current.empresaId !== command.empresaId || current.remoteJid !== command.remoteJid) {
      throw new ConversationOrderingError('PEDIDO_NAO_ENCONTRADO', 'Não encontrei este pedido para a conversa informada.');
    }
    if (current.processedMessageIds.includes(command.messageId)) return withConfirmationAction(current);
    if (command.expectedRevision !== current.revision) {
      throw new ConversationOrderingError('REVISAO_DESATUALIZADA', 'O pedido foi atualizado. Use a revisão mais recente.', toSnapshot(current));
    }

    if (command.type === 'open_or_update_draft') {
      if (current.state !== 'cart_open') throw new ConversationOrderingError('PEDIDO_FECHADO', 'Este pedido já foi encerrado.', toSnapshot(current));
      let materialized: DraftMaterialization;
      try {
        materialized = await adapter.materializeDraft(command.empresaId, command.draft);
      } catch (error) {
        throw asFriendlyMaterializationError(error);
      }
      const result = await adapter.updateOpen({
        current,
        expectedRevision: command.expectedRevision,
        messageId: command.messageId,
        materialization: materialized,
        pessoaId: command.draft.pessoaId ?? current.pessoaId,
      });
      if (result.kind === 'conflict') {
        throw new ConversationOrderingError('REVISAO_DESATUALIZADA', 'O pedido foi atualizado. Use a revisão mais recente.', toSnapshot(result.record));
      }
      return withConfirmationAction(result.record);
    }

    if (command.type === 'cancel_draft') {
      if (current.state === 'cancelled') return toSnapshot(current);
      if (current.state !== 'cart_open') throw new ConversationOrderingError('PEDIDO_FECHADO', 'Este pedido já foi encerrado.', toSnapshot(current));
      const result = await adapter.cancelOpen({ current, expectedRevision: command.expectedRevision, messageId: command.messageId });
      if (result.kind === 'conflict') {
        throw new ConversationOrderingError('REVISAO_DESATUALIZADA', 'O pedido foi atualizado. Use a revisão mais recente.', toSnapshot(result.record));
      }
      return toSnapshot(result.record);
    }

    if (current.order) return toSnapshot(current);
    if (current.state !== 'cart_open') throw new ConversationOrderingError('PEDIDO_FECHADO', 'Este pedido já foi encerrado.', toSnapshot(current));

    let revalidated: DraftMaterialization;
    try {
      revalidated = await adapter.revalidateDraft(command.empresaId, recordAsDraft(current));
    } catch (error) {
      const issue = materializationFailure(error);
      if (!issue) throw asFriendlyMaterializationError(error);
      revalidated = {
        cart: current.cart,
        customer: current.customer,
        fulfillment: current.fulfillment,
        payment: current.payment,
        pricing: current.pricing,
        revalidation: { checkedAt: now().toISOString(), ok: false, issues: [issue] },
      };
    }
    if (!revalidated.revalidation.ok || materializationChanged(current, revalidated)) {
      const result = await adapter.persistRevalidation({
        current,
        expectedRevision: command.expectedRevision,
        messageId: command.messageId,
        materialization: revalidated,
      });
      if (result.kind === 'conflict') {
        throw new ConversationOrderingError('REVISAO_DESATUALIZADA', 'O pedido foi atualizado. Use a revisão mais recente.', toSnapshot(result.record));
      }
      return withConfirmationAction(result.record, true);
    }

    const idempotencyKey = `whatsapp:${current.sessionId}:${command.messageId}`;
    const confirmed = command.confirmationToken
      ? await adapter.confirmWithToken({
        current,
        expectedRevision: command.expectedRevision,
        tokenHash: options.hashConfirmationToken(command.confirmationToken),
        idempotencyKey,
        pessoaId: command.pessoaId ?? current.pessoaId,
      })
      : await adapter.confirmDirect({
        current,
        expectedRevision: command.expectedRevision,
        idempotencyKey,
        pessoaId: command.pessoaId ?? current.pessoaId,
      });
    return toSnapshot(await adapter.applyAutoAccept(confirmed));
  }

  return {
    apply(command: ConversationOrderCommand): Promise<OrderingSnapshot> {
      const key = `${command.empresaId}\u0000${command.remoteJid}\u0000${command.messageId}`;
      const current = inFlight.get(key);
      if (current) return current;
      const pending = applyOnce(command).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
      return pending;
    },
    async getSnapshot(orderingId: string): Promise<OrderingSnapshot | null> {
      const record = await adapter.findByOrderingId(orderingId);
      return record ? toSnapshot(record) : null;
    },
  };
}
