import type {
  ZeloMenuCartItemSnapshot,
  ZeloMenuCartSnapshot,
  ZeloMenuPaymentSnapshot,
  ZeloMenuPricingSnapshot,
} from '../src/domain/zelomenuCartSchema.js';
import type {
  ZeloMenuCustomerSnapshot,
  ConversationFulfillmentSnapshot,
  ZeloMenuFulfillmentSnapshot,
} from './zelomenuCartSessions.js';
import {
  FULFILLMENT_TYPE_REQUIREMENT,
  type OrderingRequirement as CanonicalOrderingRequirement,
} from './conversationOrderRequirements.js';
import type { InternalOrderingErrorCode } from './internalOrderingErrorCodes.js';

export type { ConversationFulfillmentSnapshot } from './zelomenuCartSessions.js';

export type ConversationOrderItemSelection = {
  lineId: string;
  productId: number;
  quantity: number;
  notes?: string | null;
  selectedOptions?: Array<{
    groupId: string;
    optionSelections: Array<{ optionId: string; quantity: number }>;
  }>;
};

export type ConversationOrderCreateDraft = {
  items: ConversationOrderItemSelection[];
  observations?: string | null;
  customer?: { name?: string | null };
  pessoaId?: string | null;
  fulfillment?: Partial<ZeloMenuFulfillmentSnapshot> | null;
  paymentMethod?: string | null;
};

export type ConversationOrderLinePatch = {
  lineId: string;
  productId?: number;
  quantity?: number;
  notes?: string | null;
  selectedOptions?: NonNullable<ConversationOrderItemSelection['selectedOptions']>;
};

export type ConversationOrderPatch = {
  items?: ConversationOrderLinePatch[];
  removedLineIds?: string[];
  observations?: string | null;
  customer?: { name?: string | null } | null;
  pessoaId?: string | null;
  fulfillment?: Partial<ZeloMenuFulfillmentSnapshot> | null;
  paymentMethod?: string | null;
};

export type ConversationOrderDraft = ConversationOrderCreateDraft | ConversationOrderPatch;

export type ConversationOrderCartItemSnapshot = ZeloMenuCartItemSnapshot & {
  lineId: string;
};

export type ConversationOrderCartSnapshot = Omit<ZeloMenuCartSnapshot, 'items'> & {
  items: ConversationOrderCartItemSnapshot[];
};

export type OrderingRequirement = CanonicalOrderingRequirement;

type CommandIdentity = {
  empresaId: string;
  remoteJid: string;
  messageId: string;
};

export type ConversationScope = Pick<CommandIdentity, 'empresaId' | 'remoteJid'>;
export type ConversationOrderLookup = ConversationScope & { orderingId: string };

export type ConversationAiPermit = {
  conversationControlId: string;
  conversationEpoch: string;
};

export type ConversationOrderCommand = CommandIdentity & ConversationAiPermit & (
  | { type: 'open_or_update_draft'; orderingId?: string; expectedRevision?: number; draft: ConversationOrderDraft }
  | { type: 'confirm_draft'; orderingId: string; expectedRevision: number; confirmationToken: string; pessoaId?: string | null }
  | { type: 'cancel_draft'; orderingId: string; expectedRevision: number }
);

export type ConversationRevalidation = {
  checkedAt: string;
  ok: boolean;
  issues: Array<{ code: string; message: string }>;
};

export type DraftMaterialization = {
  cart: ConversationOrderCartSnapshot;
  customer: ZeloMenuCustomerSnapshot;
  fulfillment: ConversationFulfillmentSnapshot;
  payment: ZeloMenuPaymentSnapshot;
  pricing: ZeloMenuPricingSnapshot;
  revalidation: ConversationRevalidation;
  requirements: OrderingRequirement[];
  readyForConfirmation: boolean;
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
  reviewRequired: boolean;
};

export type OrderingSnapshot = Omit<ConversationOrderingRecord, 'sessionId' | 'processedMessageIds' | 'reviewRequired'> & {
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
  materializeDraft(scope: ConversationScope, draft: ConversationOrderCreateDraft): Promise<DraftMaterialization>;
  findOpen(empresaId: string, remoteJid: string): Promise<ConversationOrderingRecord | null>;
  findByMessageId(empresaId: string, remoteJid: string, messageId: string): Promise<ConversationOrderingRecord | null>;
  findByOrderingId(lookup: ConversationOrderLookup): Promise<ConversationOrderingRecord | null>;
  createOpen(input: Omit<ConversationOrderingRecord, 'sessionId' | 'orderingId' | 'revision' | 'state' | 'updatedAt' | 'order' | 'reviewRequired'> & ConversationAiPermit): Promise<ConversationOrderingRecord>;
  updateOpen(input: {
    current: ConversationOrderingRecord;
    expectedRevision: number;
    messageId: string;
    materialization: DraftMaterialization;
    pessoaId: string | null;
  } & ConversationAiPermit): Promise<DraftMutationResult>;
  cancelOpen(input: { current: ConversationOrderingRecord; expectedRevision: number; messageId: string } & ConversationAiPermit): Promise<DraftMutationResult>;
  issueConfirmationToken(input: {
    current: ConversationOrderingRecord;
    tokenHash: string;
    expiresAt: string;
  } & ConversationAiPermit): Promise<TokenIssuanceResult>;
  confirmAtomically(input: {
    current: ConversationOrderingRecord;
    expectedRevision: number;
    messageId: string;
    tokenHash: string | null;
    idempotencyKey: string;
    pessoaId: string | null;
  } & ConversationAiPermit): Promise<AtomicConfirmationResult>;
  applyAutoAccept(record: ConversationOrderingRecord): Promise<ConversationOrderingRecord>;
}

export class ConversationOrderingError extends Error {
  constructor(
    public readonly code: InternalOrderingErrorCode,
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

const LINE_ID = /^[A-Za-z0-9_-]{1,64}$/;
function validateDraftLineIds(draft: { items?: readonly { lineId: string }[]; removedLineIds?: readonly string[] }): void {
  const lineIds = new Set<string>();
  for (const item of draft.items ?? []) {
    if (!LINE_ID.test(item.lineId)) {
      throw new ConversationOrderingError('ITEM_INVALIDO', 'Revise a identificação dos itens do pedido.');
    }
    if (lineIds.has(item.lineId)) {
      throw new ConversationOrderingError('ITEM_INVALIDO', 'Cada item do pedido precisa de uma identificação diferente.');
    }
    lineIds.add(item.lineId);
  }
  const removedLineIds = new Set<string>();
  for (const lineId of draft.removedLineIds ?? []) {
    if (!LINE_ID.test(lineId)) {
      throw new ConversationOrderingError('ITEM_INVALIDO', 'Revise a identificação dos itens removidos.');
    }
    if (removedLineIds.has(lineId)) {
      throw new ConversationOrderingError('ITEM_INVALIDO', 'Cada item removido precisa de uma identificação diferente.');
    }
    if (lineIds.has(lineId)) {
      throw new ConversationOrderingError('ITEM_INVALIDO', 'Um item não pode ser atualizado e removido ao mesmo tempo.');
    }
    removedLineIds.add(lineId);
  }
}

function requirementsWithFulfillment(
  requirements: readonly OrderingRequirement[] | undefined,
  fulfillment: ConversationFulfillmentSnapshot | null | undefined,
): OrderingRequirement[] {
  const normalized = Array.isArray(requirements) ? [...requirements] : [];
  if (fulfillment?.type !== 'pickup' && fulfillment?.type !== 'delivery'
    && !normalized.some((requirement) => Boolean(requirement)
      && typeof requirement === 'object' && requirement.type === 'fulfillment_type')) {
    normalized.push(FULFILLMENT_TYPE_REQUIREMENT);
  }
  return normalized;
}

function isNonBlank(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasBooleanBlockingFlag(value: unknown): value is { blocking: boolean } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as { blocking?: unknown }).blocking === 'boolean';
}

function normalizeReadiness<T extends DraftMaterialization>(materialization: T): T {
  const requirements = requirementsWithFulfillment(materialization.requirements, materialization.fulfillment);
  const requirementsAreWellFormed = Array.isArray(materialization.requirements)
    && materialization.requirements.every(hasBooleanBlockingFlag);
  const fulfillment = materialization.fulfillment;
  const hasCompleteDeliveryAddress = fulfillment?.type !== 'delivery'
    || (
      (isNonBlank(fulfillment?.deliveryAddress) || isNonBlank(fulfillment?.deliveryStreet))
      && isNonBlank(fulfillment?.deliveryNumber)
      && isNonBlank(fulfillment?.deliveryNeighborhood)
    );
  const hasCompleteSchedule = typeof fulfillment?.asap === 'boolean'
    && (fulfillment.asap !== false
    || (isNonBlank(fulfillment?.pickupDate) && isNonBlank(fulfillment?.pickupTime)));
  const hasValidRevalidation = isNonBlank(materialization.revalidation?.checkedAt)
    && materialization.revalidation?.ok === true
    && Array.isArray(materialization.revalidation?.issues)
    && materialization.revalidation.issues.length === 0;
  const revalidationIssues = Array.isArray(materialization.revalidation?.issues)
    ? materialization.revalidation.issues
    : null;
  const hasBlockingRequirement = requirements.some((requirement) => (
    !hasBooleanBlockingFlag(requirement) || requirement.blocking
  ));
  const readyForConfirmation = materialization.readyForConfirmation === true
    && requirementsAreWellFormed
    && (fulfillment?.type === 'pickup' || fulfillment?.type === 'delivery')
    && hasCompleteDeliveryAddress
    && hasCompleteSchedule
    && isNonBlank(materialization.customer?.name)
    && isNonBlank(materialization.payment?.declaredMethod)
    && fulfillment?.deliveryFeeToConfirm === false
    && hasValidRevalidation
    && revalidationIssues !== null
    && !hasBlockingRequirement;
  return { ...materialization, requirements, readyForConfirmation };
}

function normalizeDraftMaterialization(
  draft: ConversationOrderCreateDraft,
  materialization: DraftMaterialization,
): DraftMaterialization {
  return normalizeReadiness({
    ...materialization,
    fulfillment: draft.fulfillment?.type
      ? materialization.fulfillment
      : { ...materialization.fulfillment, type: null },
  });
}

function fulfillmentFromSnapshot(
  fulfillment: ConversationFulfillmentSnapshot,
): ConversationOrderDraft['fulfillment'] {
  return fulfillment.type === null ? null : { ...fulfillment, type: fulfillment.type };
}

function mergeFulfillment(
  current: ConversationFulfillmentSnapshot,
  patch: ConversationOrderPatch['fulfillment'],
): ConversationOrderCreateDraft['fulfillment'] {
  if (patch === null) return null;
  if (patch === undefined) return fulfillmentFromSnapshot(current);
  return { ...current, ...patch, type: patch.type ?? current.type } as Partial<ZeloMenuFulfillmentSnapshot>;
}

function selectionFromCartItem(item: ConversationOrderCartItemSnapshot): ConversationOrderItemSelection {
  if (item.productId === null) {
    throw new ConversationOrderingError('PEDIDO_INVALIDO', 'Revise os itens do pedido antes de continuar.');
  }
  return {
    lineId: item.lineId,
    productId: item.productId,
    quantity: item.quantity,
    notes: item.notes,
    selectedOptions: item.selectedModifiers.map((group) => ({
      groupId: group.groupId,
      optionSelections: group.selectedOptions.map((option) => ({
        optionId: option.optionId,
        quantity: option.quantity ?? 1,
      })),
    })),
  };
}

function mergeDraftLines(
  current: ConversationOrderCartSnapshot,
  incoming: readonly ConversationOrderLinePatch[],
  removedLineIds: readonly string[],
): ConversationOrderItemSelection[] {
  const incomingByLineId = new Map(incoming.map((item) => [item.lineId, item]));
  const currentLineIds = new Set(current.items.map((item) => item.lineId));
  if (removedLineIds.some((lineId) => !currentLineIds.has(lineId))) {
    throw new ConversationOrderingError('ITEM_INVALIDO', 'Não encontrei um item informado para remoção.');
  }
  const removed = new Set(removedLineIds);
  if (incomingByLineId.size !== incoming.length || removedLineIds.some((id) => incomingByLineId.has(id))) {
    throw new ConversationOrderingError('ITEM_INVALIDO', 'Revise os itens informados.');
  }
  for (const patch of incoming) {
    if (patch.productId === undefined && patch.quantity === undefined
      && patch.notes === undefined && patch.selectedOptions === undefined) {
      throw new ConversationOrderingError(
        'PEDIDO_INVALIDO',
        'Informe produto, quantidade, observação ou complementos para alterar o item.',
      );
    }
    if (!currentLineIds.has(patch.lineId)
      && (patch.productId === undefined || patch.quantity === undefined)) {
      throw new ConversationOrderingError('ITEM_INVALIDO', 'Novos itens precisam de produto e quantidade.');
    }
  }
  const merged = [
    ...current.items
      .filter((item) => !removed.has(item.lineId))
      .map((item) => {
        const patch = incomingByLineId.get(item.lineId);
        if (!patch) return selectionFromCartItem(item);
        const base = selectionFromCartItem(item);
        return {
          lineId: item.lineId,
          productId: patch.productId ?? base.productId,
          quantity: patch.quantity ?? base.quantity,
          notes: Object.prototype.hasOwnProperty.call(patch, 'notes') ? patch.notes : base.notes,
          selectedOptions: Object.prototype.hasOwnProperty.call(patch, 'selectedOptions')
            ? patch.selectedOptions : base.selectedOptions,
        };
      }),
    ...incoming.filter((item) => !currentLineIds.has(item.lineId)).map((item) => ({
      lineId: item.lineId,
      productId: item.productId!,
      quantity: item.quantity!,
      notes: item.notes,
      selectedOptions: item.selectedOptions,
    })),
  ];
  if (merged.length === 0) {
    throw new ConversationOrderingError(
      'PEDIDO_VAZIO',
      'O pedido precisa ter pelo menos um item. Para encerrar tudo, cancele o pedido.',
    );
  }
  return merged;
}

function toSnapshot(record: ConversationOrderingRecord, confirmationAction: OrderingSnapshot['confirmationAction'] = null): OrderingSnapshot {
  const normalized = normalizeReadiness(record);
  const { sessionId: _sessionId, processedMessageIds: _processedMessageIds, reviewRequired: _reviewRequired, ...publicRecord } = normalized;
  return {
    ...publicRecord,
    confirmationAction: normalized.readyForConfirmation ? confirmationAction : null,
    requiresReview: normalized.reviewRequired === true,
  };
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

  async function withConfirmationAction(
    record: ConversationOrderingRecord,
    permit: ConversationAiPermit,
  ): Promise<OrderingSnapshot> {
    const normalized = normalizeReadiness(record);
    if (normalized.state !== 'cart_open' || !normalized.readyForConfirmation) {
      return toSnapshot(normalized);
    }
    const revisionTime = Date.parse(normalized.updatedAt);
    const expiresAt = new Date((Number.isFinite(revisionTime) ? revisionTime : now().getTime()) + ttlMs).toISOString();
    if (Date.parse(expiresAt) <= now().getTime()) {
      throw new ConversationOrderingError(
        'RESUMO_EXPIRADO',
        'Este resumo expirou. Atualize o pedido para receber uma nova confirmação.',
        toSnapshot(normalized),
      );
    }
    const token = options.createRawConfirmationToken(normalized, expiresAt);
    const issuance = await adapter.issueConfirmationToken({
      current: normalized,
      conversationControlId: permit.conversationControlId,
      conversationEpoch: permit.conversationEpoch,
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
    const action = { type: 'confirm_order' as const, token, revision: normalized.revision, expiresAt };
    return toSnapshot(normalized, action);
  }

  async function applyOnce(command: ConversationOrderCommand): Promise<OrderingSnapshot> {
    const historical = await adapter.findByMessageId(command.empresaId, command.remoteJid, command.messageId);
    if (historical && command.type !== 'confirm_draft') {
      return historical.state === 'cart_open' ? withConfirmationAction(historical, command) : toSnapshot(historical);
    }

    if (command.type === 'open_or_update_draft' && !command.orderingId) {
      const createDraft = command.draft as ConversationOrderCreateDraft;
      validateDraftLineIds(command.draft);
      if (((command.draft as ConversationOrderPatch).removedLineIds?.length ?? 0) > 0) {
        throw new ConversationOrderingError('ITEM_INVALIDO', 'Não encontrei um item informado para remoção.');
      }
      if (createDraft.items.length === 0) {
        throw new ConversationOrderingError(
          'PEDIDO_VAZIO',
          'O pedido precisa ter pelo menos um item. Para encerrar tudo, cancele o pedido.',
        );
      }
      const existing = await adapter.findOpen(command.empresaId, command.remoteJid);
      if (existing) {
        if (existing.processedMessageIds.includes(command.messageId)) return withConfirmationAction(existing, command);
        throw new ConversationOrderingError('PEDIDO_EM_ANDAMENTO', 'Já existe um pedido em andamento nesta conversa.', toSnapshot(existing));
      }
      let materialized: DraftMaterialization;
      try {
        materialized = normalizeDraftMaterialization(
          createDraft,
          await adapter.materializeDraft(command, createDraft),
        );
      } catch (error) {
        throw asFriendlyMaterializationError(error);
      }
      const record = await adapter.createOpen({
        ...materialized,
        conversationControlId: command.conversationControlId,
        conversationEpoch: command.conversationEpoch,
        empresaId: command.empresaId,
        remoteJid: command.remoteJid,
        pessoaId: createDraft.pessoaId ?? null,
        processedMessageIds: [command.messageId],
      });
      return withConfirmationAction(record, command);
    }

    const lookup = { orderingId: command.orderingId!, empresaId: command.empresaId, remoteJid: command.remoteJid };
    const current = await adapter.findByOrderingId(lookup);
    if (!current) {
      throw new ConversationOrderingError('PEDIDO_NAO_ENCONTRADO', 'Não encontrei este pedido para a conversa informada.');
    }
    if (current.processedMessageIds.includes(command.messageId) && command.type !== 'confirm_draft') {
      return withConfirmationAction(current, command);
    }
    if (command.expectedRevision !== current.revision) {
      throw new ConversationOrderingError('REVISAO_DESATUALIZADA', 'O pedido foi atualizado. Use a revisão mais recente.', toSnapshot(current));
    }

    if (command.type === 'open_or_update_draft') {
      if (current.state !== 'cart_open') throw new ConversationOrderingError('PEDIDO_FECHADO', 'Este pedido já foi encerrado.', toSnapshot(current));
      validateDraftLineIds(command.draft);
      const patch = command.draft as ConversationOrderPatch;
      const hasCustomerChange = Object.prototype.hasOwnProperty.call(patch, 'customer')
        && (patch.customer === null || Object.prototype.hasOwnProperty.call(patch.customer ?? {}, 'name'));
      const hasFulfillmentChange = Object.prototype.hasOwnProperty.call(patch, 'fulfillment')
        && (patch.fulfillment === null || Object.keys(patch.fulfillment ?? {}).length > 0);
      if ((patch.items?.length ?? 0) === 0 && (patch.removedLineIds?.length ?? 0) === 0
        && !hasCustomerChange && !hasFulfillmentChange
        && !Object.prototype.hasOwnProperty.call(patch, 'observations')
        && !Object.prototype.hasOwnProperty.call(patch, 'paymentMethod')
        && !Object.prototype.hasOwnProperty.call(patch, 'pessoaId')) {
        throw new ConversationOrderingError('PEDIDO_INVALIDO', 'Informe pelo menos uma alteração.');
      }
      const mergedItems = mergeDraftLines(
        current.cart,
        patch.items ?? [],
        patch.removedLineIds ?? [],
      );
      let materialized: DraftMaterialization;
      try {
        const materializationDraft: ConversationOrderCreateDraft = {
          observations: Object.prototype.hasOwnProperty.call(patch, 'observations') ? patch.observations : current.cart.observations,
          customer: Object.prototype.hasOwnProperty.call(patch, 'customer')
            ? { name: patch.customer?.name ?? null }
            : { name: current.customer.name },
          paymentMethod: Object.prototype.hasOwnProperty.call(patch, 'paymentMethod')
            ? patch.paymentMethod : current.payment.declaredMethod,
          pessoaId: Object.prototype.hasOwnProperty.call(patch, 'pessoaId') ? patch.pessoaId : current.pessoaId,
          items: mergedItems,
          fulfillment: mergeFulfillment(current.fulfillment, patch.fulfillment),
        };
        materialized = normalizeDraftMaterialization(
          materializationDraft,
          await adapter.materializeDraft(command, materializationDraft),
        );
      } catch (error) {
        throw asFriendlyMaterializationError(error);
      }
      const result = await adapter.updateOpen({
        current,
        conversationControlId: command.conversationControlId,
        conversationEpoch: command.conversationEpoch,
        expectedRevision: command.expectedRevision,
        messageId: command.messageId,
        materialization: materialized,
        pessoaId: Object.prototype.hasOwnProperty.call(patch, 'pessoaId') ? patch.pessoaId ?? null : current.pessoaId,
      });
      if (result.kind === 'conflict') {
        throw new ConversationOrderingError('REVISAO_DESATUALIZADA', 'O pedido foi atualizado. Use a revisão mais recente.', toSnapshot(result.record));
      }
      return withConfirmationAction(result.record, command);
    }

    if (command.type === 'cancel_draft') {
      if (current.state === 'cancelled') return toSnapshot(current);
      if (current.state !== 'cart_open') throw new ConversationOrderingError('PEDIDO_FECHADO', 'Este pedido já foi encerrado.', toSnapshot(current));
      const result = await adapter.cancelOpen({
        current,
        conversationControlId: command.conversationControlId,
        conversationEpoch: command.conversationEpoch,
        expectedRevision: command.expectedRevision,
        messageId: command.messageId,
      });
      if (result.kind === 'conflict') {
        throw new ConversationOrderingError('REVISAO_DESATUALIZADA', 'O pedido foi atualizado. Use a revisão mais recente.', toSnapshot(result.record));
      }
      return toSnapshot(result.record);
    }

    const normalizedCurrent = normalizeReadiness(current);
    if (!current.order && current.state !== 'cart_open') {
      throw new ConversationOrderingError('PEDIDO_FECHADO', 'Este pedido já foi encerrado.', toSnapshot(current));
    }
    if (!current.order && !normalizedCurrent.readyForConfirmation) {
      throw new ConversationOrderingError(
        'PEDIDO_INVALIDO',
        'Revise os dados pendentes antes de confirmar.',
        toSnapshot(normalizedCurrent),
      );
    }
    // A confirmation must always prove it saw the exact ready revision being
    // confirmed. This defends the domain even if some caller bypasses the
    // parser (server/internalOrdering.ts also requires confirmationToken).
    // Placed AFTER the readiness check on purpose: "revise pending data"
    // must still win over "you also forgot the confirmation" when the order
    // was never ready in the first place.
    if (!command.confirmationToken) {
      throw new ConversationOrderingError(
        'CONFIRMACAO_INVALIDA',
        'Informe a confirmação do pedido.',
        toSnapshot(normalizedCurrent),
      );
    }
    const idempotencyKey = `whatsapp:${current.sessionId}:${command.messageId}`;
    const result = await adapter.confirmAtomically({
      current,
      conversationControlId: command.conversationControlId,
      conversationEpoch: command.conversationEpoch,
      expectedRevision: command.expectedRevision,
      messageId: command.messageId,
      tokenHash: options.hashConfirmationToken(command.confirmationToken),
      idempotencyKey,
      pessoaId: command.pessoaId ?? current.pessoaId,
    });
    if (result.kind === 'conflict') {
      throw new ConversationOrderingError('REVISAO_DESATUALIZADA', 'O pedido foi atualizado. Use a revisão mais recente.', toSnapshot(result.record));
    }
    if (result.kind === 'requires_review') return withConfirmationAction(result.record, command);
    const originalAlreadyConfirmed = result.record.order?.alreadyConfirmed;
    // Confirmation already committed under the permit. Auto-accept is the
    // restaurant's independent CAS-protected order policy, so a later chat
    // takeover must not suppress acceptance of this valid canonical order.
    const autoAccepted = await adapter.applyAutoAccept(result.record);
    if (autoAccepted.order && originalAlreadyConfirmed != null) autoAccepted.order.alreadyConfirmed = originalAlreadyConfirmed;
    return toSnapshot(autoAccepted);
  }

  return {
    apply(command: ConversationOrderCommand): Promise<OrderingSnapshot> {
      const key = `${command.empresaId}\u0000${command.remoteJid}\u0000${command.messageId}\u0000${command.conversationControlId}\u0000${command.conversationEpoch}`;
      const current = inFlight.get(key);
      if (current) return current;
      const pending = applyOnce(command).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
      return pending;
    },
    async getSnapshot(lookup: ConversationOrderLookup): Promise<OrderingSnapshot | null> {
      const record = await adapter.findByOrderingId(lookup);
      return record ? toSnapshot(record) : null;
    },
  };
}
