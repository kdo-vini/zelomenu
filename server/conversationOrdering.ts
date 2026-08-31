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

export type AtomicConfirmationResult =
  | { kind: 'confirmed'; record: ConversationOrderingRecord }
  | { kind: 'requires_review'; record: ConversationOrderingRecord }
  | { kind: 'conflict'; record: ConversationOrderingRecord };

export type TokenIssuanceResult =
  | { kind: 'issued' }
  | { kind: 'conflict'; record: ConversationOrderingRecord };

export interface ConversationOrderingAdapter {
  materializeDraft(empresaId: string, draft: ConversationOrderDraft): Promise<DraftMaterialization>;
  findOpen(empresaId: string, remoteJid: string): Promise<ConversationOrderingRecord | null>;
  findByMessageId(empresaId: string, remoteJid: string, messageId: string): Promise<ConversationOrderingRecord | null>;
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
  issueConfirmationToken(input: {
    current: ConversationOrderingRecord;
    tokenHash: string;
    expiresAt: string;
  }): Promise<TokenIssuanceResult>;
  confirmAtomically(input: {
    current: ConversationOrderingRecord;
    expectedRevision: number;
    messageId: string;
    tokenHash: string | null;
    idempotencyKey: string;
    pessoaId: string | null;
  }): Promise<AtomicConfirmationResult>;
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

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonicalJson(child)]));
  }
  return value;
}

export function jsonbSemanticallyEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
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
    if (Date.parse(expiresAt) <= now().getTime()) {
      throw new ConversationOrderingError(
        'RESUMO_EXPIRADO',
        'Este resumo expirou. Atualize o pedido para receber uma nova confirmação.',
        toSnapshot(record, null, true),
      );
    }
    const token = options.createRawConfirmationToken(record, expiresAt);
    const issuance = await adapter.issueConfirmationToken({
      current: record,
      tokenHash: options.hashConfirmationToken(token),
      expiresAt,
    });
    if (issuance.kind === 'conflict') {
      throw new ConversationOrderingError(
        'REVISAO_DESATUALIZADA',
        'O pedido foi atualizado. Use a revisão mais recente.',
        toSnapshot(issuance.record),
      );
    }
    const action = { type: 'confirm_order' as const, token, revision: record.revision, expiresAt };
    return toSnapshot(record, action, requiresReview);
  }

  async function applyOnce(command: ConversationOrderCommand): Promise<OrderingSnapshot> {
    const historical = await adapter.findByMessageId(command.empresaId, command.remoteJid, command.messageId);
    if (historical) return historical.state === 'cart_open' ? withConfirmationAction(historical) : toSnapshot(historical);

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

    const idempotencyKey = `whatsapp:${current.sessionId}:${command.messageId}`;
    const result = await adapter.confirmAtomically({
      current,
      expectedRevision: command.expectedRevision,
      messageId: command.messageId,
      tokenHash: command.confirmationToken ? options.hashConfirmationToken(command.confirmationToken) : null,
      idempotencyKey,
      pessoaId: command.pessoaId ?? current.pessoaId,
    });
    if (result.kind === 'conflict') {
      throw new ConversationOrderingError('REVISAO_DESATUALIZADA', 'O pedido foi atualizado. Use a revisão mais recente.', toSnapshot(result.record));
    }
    if (result.kind === 'requires_review') return withConfirmationAction(result.record, true);
    const originalAlreadyConfirmed = result.record.order?.alreadyConfirmed;
    const autoAccepted = await adapter.applyAutoAccept(result.record);
    if (autoAccepted.order && originalAlreadyConfirmed != null) autoAccepted.order.alreadyConfirmed = originalAlreadyConfirmed;
    return toSnapshot(autoAccepted);
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
