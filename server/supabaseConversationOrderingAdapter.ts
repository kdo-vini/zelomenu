import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ConversationOrderingError,
  createConversationOrdering,
  type CanonicalOrderReference,
  type AtomicConfirmationResult,
  type ConversationAiPermit,
  type ConversationOrderDraft,
  type ConversationOrderingAdapter,
  type ConversationOrderingRecord,
  type DraftMaterialization,
  type DraftMutationResult,
  type OrderingRequirement,
} from './conversationOrdering.js';
import { getServiceSupabase } from './supabaseServer.js';
import { applyZeloMenuAutoAccept, materializeWhatsAppOrderDraft, type ZeloMenuCartState } from './zelomenuCartSessions.js';
import { deriveConversationConfirmationToken, hashConversationConfirmationToken } from './conversationConfirmationToken.js';

const SESSION_COLUMNS = 'id, empresa_id, ordering_id, context, state, source_ref, customer_snapshot, cart_snapshot, fulfillment_snapshot, pricing_snapshot, payment_snapshot, metadata, revision, last_revalidated_at, last_revalidation, requirements_snapshot, ready_for_confirmation, archived_at, updated_at';

type SessionRow = {
  id: string;
  empresa_id: string;
  ordering_id: string;
  context: string;
  state: ZeloMenuCartState;
  source_ref: string;
  customer_snapshot: ConversationOrderingRecord['customer'];
  cart_snapshot: ConversationOrderingRecord['cart'];
  fulfillment_snapshot: ConversationOrderingRecord['fulfillment'];
  pricing_snapshot: ConversationOrderingRecord['pricing'];
  payment_snapshot: ConversationOrderingRecord['payment'];
  metadata: Record<string, unknown> | null;
  revision: number;
  last_revalidated_at: string | null;
  last_revalidation: ConversationOrderingRecord['revalidation'] | null;
  requirements_snapshot: unknown;
  ready_for_confirmation: unknown;
  archived_at: string | null;
  updated_at: string;
};

function processedMessageIds(metadata: Record<string, unknown>): string[] {
  return Array.isArray(metadata.processedMessageIds)
    ? metadata.processedMessageIds.filter((value): value is string => typeof value === 'string')
    : [];
}

function nextMetadata(current: ConversationOrderingRecord, messageId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pessoaId: current.pessoaId,
    processedMessageIds: [...new Set([...current.processedMessageIds, messageId])],
    ...extra,
  };
}

function safeState(state: ZeloMenuCartState): ConversationOrderingRecord['state'] {
  return state;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNullableBound(value: unknown, minimum: number): value is number | null {
  return value === null || (Number.isSafeInteger(value) && Number(value) >= minimum);
}

function hasValidRequirementBase(
  value: Record<string, unknown>,
  type: OrderingRequirement['type'],
  id: OrderingRequirement['id'],
): boolean {
  return value.type === type
    && value.id === id
    && isNonEmptyString(value.name)
    && value.blocking === true;
}

function isValidModifierOption(value: unknown): boolean {
  return isObject(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && typeof value.currentPrice === 'number'
    && Number.isFinite(value.currentPrice)
    && typeof value.priceDelta === 'number'
    && Number.isFinite(value.priceDelta)
    && typeof value.available === 'boolean'
    && Number.isSafeInteger(value.order);
}

function isValidModifierRequirement(value: Record<string, unknown>): boolean {
  if (value.type !== 'modifier_group'
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.lineId)
    || !Number.isSafeInteger(value.productId)
    || Number(value.productId) < 1
    || !isNonEmptyString(value.groupId)
    || !isNonEmptyString(value.name)
    || typeof value.blocking !== 'boolean'
    || (value.kind !== 'adicional' && value.kind !== 'variacao')
    || (value.pricingMode !== 'somar' && value.pricingMode !== 'substituir')
    || !isNonNegativeInteger(value.minSelections)
    || !isNullableBound(value.maxSelections, Number(value.minSelections))
    || !isNonNegativeInteger(value.minTotalQuantity)
    || !isNullableBound(value.maxTotalQuantity, Number(value.minTotalQuantity))
    || typeof value.allowsQuantity !== 'boolean'
    || !isNullableBound(value.maxPerOption, 1)
    || !isNonNegativeInteger(value.selectedDistinctCount)
    || !isNonNegativeInteger(value.selectedTotalQuantity)
    || (value.maxSelections !== null && Number(value.selectedDistinctCount) > Number(value.maxSelections))
    || (value.maxTotalQuantity !== null && Number(value.selectedTotalQuantity) > Number(value.maxTotalQuantity))
    || (value.autoSelectableOptionId !== undefined && !isNonEmptyString(value.autoSelectableOptionId))
    || !Array.isArray(value.options)
    || !value.options.every(isValidModifierOption)) {
    return false;
  }
  const blocking = Number(value.selectedDistinctCount) < Number(value.minSelections)
    || Number(value.selectedTotalQuantity) < Number(value.minTotalQuantity);
  if (value.blocking !== blocking) return false;
  if (typeof value.autoSelectableOptionId === 'string'
    && !value.options.some((option) => isObject(option)
      && option.id === value.autoSelectableOptionId
      && option.available === true)) {
    return false;
  }
  return value.id === `${value.lineId}:${value.groupId}`;
}

function hasValidMissingFields(value: unknown, allowed: ReadonlySet<string>): boolean {
  return Array.isArray(value)
    && value.length > 0
    && value.every((field) => typeof field === 'string' && allowed.has(field))
    && new Set(value).size === value.length;
}

const DELIVERY_REQUIREMENT_FIELDS = new Set(['address', 'number', 'neighborhood']);
const SCHEDULE_REQUIREMENT_FIELDS = new Set(['date', 'time']);

function isValidOrderingRequirement(value: unknown): value is OrderingRequirement {
  if (!isObject(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'modifier_group':
      return isValidModifierRequirement(value);
    case 'fulfillment_type':
    case 'customer_name':
    case 'payment_method':
      return hasValidRequirementBase(value, value.type, value.type);
    case 'delivery_address':
      return hasValidRequirementBase(value, value.type, value.type)
        && hasValidMissingFields(value.missingFields, DELIVERY_REQUIREMENT_FIELDS);
    case 'schedule':
      return hasValidRequirementBase(value, value.type, value.type)
        && hasValidMissingFields(value.missingFields, SCHEDULE_REQUIREMENT_FIELDS);
    default:
      return false;
  }
}

function validatedRequirementsSnapshot(value: unknown): OrderingRequirement[] | null {
  return Array.isArray(value) && value.every(isValidOrderingRequirement) ? value : null;
}

export class SupabaseConversationOrderingAdapter implements ConversationOrderingAdapter {
  constructor(private readonly supabase: SupabaseClient = getServiceSupabase()) {}

  async materializeDraft(empresaId: string, draft: ConversationOrderDraft): Promise<DraftMaterialization> {
    const materialized = await materializeWhatsAppOrderDraft({
      empresaId,
      items: draft.items,
      observations: draft.observations,
      customer: draft.customer,
      fulfillment: draft.fulfillment,
      paymentMethod: draft.paymentMethod,
    });
    if (materialized.cart.items.length !== draft.items.length) {
      throw new Error('MATERIALIZED_LINE_COUNT_MISMATCH');
    }
    const upstream = materialized as typeof materialized & Partial<Pick<
      DraftMaterialization,
      'requirements' | 'readyForConfirmation'
    >>;
    return {
      ...upstream,
      cart: {
        ...upstream.cart,
        items: upstream.cart.items.map((item, index) => ({
          ...item,
          lineId: draft.items[index]!.lineId,
        })),
      },
      requirements: upstream.requirements ?? [],
      readyForConfirmation: upstream.readyForConfirmation === true
        && upstream.revalidation.ok
        && !upstream.fulfillment.deliveryFeeToConfirm,
    };
  }

  private async loadOrder(sessionId: string): Promise<CanonicalOrderReference | null> {
    const { data, error } = await this.supabase.from('zelo_orders')
      .select('id, status, revision')
      .eq('zelomenu_session_id', sessionId)
      .maybeSingle();
    if (error) throw error;
    return data ? { id: String(data.id), status: String(data.status), revision: Number(data.revision), alreadyConfirmed: true } : null;
  }

  private async mapRow(row: SessionRow): Promise<ConversationOrderingRecord> {
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const state = safeState(row.state);
    const requirements = validatedRequirementsSnapshot(row.requirements_snapshot);
    const hasTrustworthyReadiness = requirements !== null
      && typeof row.ready_for_confirmation === 'boolean'
      && (!row.ready_for_confirmation || (
        row.context === 'whatsapp_order'
        && state === 'cart_open'
        && !requirements.some((requirement) => requirement.blocking)
      ));
    const trustedRequirements = hasTrustworthyReadiness ? requirements : [];
    return {
      sessionId: row.id,
      orderingId: row.ordering_id,
      empresaId: row.empresa_id,
      remoteJid: row.source_ref,
      state,
      revision: Number(row.revision),
      updatedAt: row.updated_at,
      customer: row.customer_snapshot,
      cart: row.cart_snapshot,
      fulfillment: row.fulfillment_snapshot,
      pricing: row.pricing_snapshot,
      payment: row.payment_snapshot,
      pessoaId: typeof metadata.pessoaId === 'string' ? metadata.pessoaId : null,
      processedMessageIds: processedMessageIds(metadata),
      revalidation: row.last_revalidation ?? { checkedAt: row.last_revalidated_at ?? new Date(0).toISOString(), ok: true, issues: [] },
      requirements: trustedRequirements,
      readyForConfirmation: hasTrustworthyReadiness && row.ready_for_confirmation === true,
      order: state === 'cart_open' || state === 'cancelled' || state === 'archived' ? null : await this.loadOrder(row.id),
    };
  }

  async findOpen(empresaId: string, remoteJid: string): Promise<ConversationOrderingRecord | null> {
    const { data, error } = await this.supabase.from('zelomenu_cart_sessions')
      .select(SESSION_COLUMNS)
      .eq('empresa_id', empresaId)
      .eq('source_ref', remoteJid)
      .eq('context', 'whatsapp_order')
      .eq('state', 'cart_open')
      .maybeSingle();
    if (error) throw error;
    return data ? this.mapRow(data as SessionRow) : null;
  }

  async findByMessageId(empresaId: string, remoteJid: string, messageId: string): Promise<ConversationOrderingRecord | null> {
    const { data, error } = await this.supabase.from('zelomenu_cart_sessions')
      .select(SESSION_COLUMNS)
      .eq('empresa_id', empresaId)
      .eq('source_ref', remoteJid)
      .eq('context', 'whatsapp_order')
      .contains('metadata', { processedMessageIds: [messageId] })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? this.mapRow(data as SessionRow) : null;
  }

  async findByOrderingId(orderingId: string): Promise<ConversationOrderingRecord | null> {
    const { data, error } = await this.supabase.from('zelomenu_cart_sessions')
      .select(SESSION_COLUMNS)
      .eq('ordering_id', orderingId)
      .eq('context', 'whatsapp_order')
      .maybeSingle();
    if (error) throw error;
    return data ? this.mapRow(data as SessionRow) : null;
  }

  async createOpen(input: Omit<ConversationOrderingRecord, 'sessionId' | 'orderingId' | 'revision' | 'state' | 'updatedAt' | 'order'> & ConversationAiPermit): Promise<ConversationOrderingRecord> {
    const { data, error } = await this.supabase.rpc('zelomenu_open_whatsapp_order_with_ai_epoch_v1', {
      p_empresa_id: input.empresaId,
      p_source_ref: input.remoteJid,
      p_conversation_control_id: input.conversationControlId,
      p_conversation_epoch: input.conversationEpoch,
      p_customer_snapshot: input.customer,
      p_cart_snapshot: input.cart,
      p_fulfillment_snapshot: input.fulfillment,
      p_pricing_snapshot: input.pricing,
      p_payment_snapshot: input.payment,
      p_metadata: { pessoaId: input.pessoaId, processedMessageIds: input.processedMessageIds },
      p_last_revalidated_at: input.revalidation.checkedAt,
      p_last_revalidation: input.revalidation,
      p_requirements_snapshot: input.requirements,
      p_ready_for_confirmation: input.readyForConfirmation,
    });
    if (!error) {
      const result = data as { outcome?: unknown; orderingId?: unknown } | null;
      if (result?.outcome === 'applied' && typeof result.orderingId === 'string') {
        return this.findRequired(result.orderingId);
      }
      throw new ConversationOrderingError('PEDIDO_INDISPONIVEL', 'Não foi possível iniciar o pedido agora. Tente novamente.');
    }
    if (error.code !== '23505') throw this.rpcError(error.message);
    const existing = await this.findOpen(input.empresaId, input.remoteJid);
    if (existing?.processedMessageIds.some((id) => input.processedMessageIds.includes(id))) return existing;
    throw new ConversationOrderingError('PEDIDO_EM_ANDAMENTO', 'Já existe um pedido em andamento nesta conversa.');
  }

  async updateOpen(input: {
    current: ConversationOrderingRecord; expectedRevision: number; messageId: string;
    materialization: DraftMaterialization; pessoaId: string | null;
  } & ConversationAiPermit): Promise<DraftMutationResult> {
    const { data, error } = await this.supabase.rpc('zelomenu_update_whatsapp_order_with_ai_epoch_v1', {
      p_empresa_id: input.current.empresaId,
      p_source_ref: input.current.remoteJid,
      p_conversation_control_id: input.conversationControlId,
      p_conversation_epoch: input.conversationEpoch,
      p_session_id: input.current.sessionId,
      p_expected_revision: input.expectedRevision,
      p_message_id: input.messageId,
      p_customer_snapshot: input.materialization.customer,
      p_cart_snapshot: input.materialization.cart,
      p_fulfillment_snapshot: input.materialization.fulfillment,
      p_pricing_snapshot: input.materialization.pricing,
      p_payment_snapshot: input.materialization.payment,
      p_last_revalidated_at: input.materialization.revalidation.checkedAt,
      p_last_revalidation: input.materialization.revalidation,
      p_requirements_snapshot: input.materialization.requirements,
      p_ready_for_confirmation: input.materialization.readyForConfirmation,
      p_metadata: nextMetadata({ ...input.current, pessoaId: input.pessoaId }, input.messageId),
    });
    if (error) throw this.rpcError(error.message);
    return this.resolveDraftMutation(data, input.current, input.messageId);
  }

  async cancelOpen(input: { current: ConversationOrderingRecord; expectedRevision: number; messageId: string } & ConversationAiPermit): Promise<DraftMutationResult> {
    const { data, error } = await this.supabase.rpc('zelomenu_cancel_whatsapp_order_with_ai_epoch_v1', {
      p_empresa_id: input.current.empresaId,
      p_source_ref: input.current.remoteJid,
      p_conversation_control_id: input.conversationControlId,
      p_conversation_epoch: input.conversationEpoch,
      p_session_id: input.current.sessionId,
      p_expected_revision: input.expectedRevision,
      p_message_id: input.messageId,
      p_metadata: nextMetadata(input.current, input.messageId, { cancellationReason: 'explicit_command' }),
    });
    if (error) throw this.rpcError(error.message);
    return this.resolveDraftMutation(data, input.current, input.messageId);
  }

  private async resolveDraftMutation(
    data: unknown,
    current: ConversationOrderingRecord,
    messageId: string,
  ): Promise<DraftMutationResult> {
    const result = data as { outcome?: unknown } | null;
    if (result?.outcome !== 'applied' && result?.outcome !== 'conflict') {
      throw new ConversationOrderingError('PEDIDO_INDISPONIVEL', 'Não foi possível atualizar o pedido agora. Tente novamente.');
    }
    const latest = await this.findRequired(current.orderingId);
    if (result.outcome === 'applied') return { kind: 'applied', record: latest };
    return latest.processedMessageIds.includes(messageId)
      ? { kind: 'duplicate', record: latest }
      : { kind: 'conflict', record: latest };
  }

  async issueConfirmationToken(input: {
    current: ConversationOrderingRecord; tokenHash: string; expiresAt: string;
  } & ConversationAiPermit) {
    // Retries e réplicas derivam o mesmo hash/binding/expiry. Esta chamada
    // depende do contrato idempotente da RPC: se o mesmo token ainda estiver
    // vivo, ela deve devolvê-lo sem invalidar/reinserir a linha UNIQUE.
    const { error } = await this.supabase.rpc('issue_whatsapp_zelo_confirmation_token_with_ai_epoch_v1', {
      p_token_hash: input.tokenHash,
      p_empresa_id: input.current.empresaId,
      p_source_ref: input.current.remoteJid,
      p_conversation_control_id: input.conversationControlId,
      p_conversation_epoch: input.conversationEpoch,
      p_session_id: input.current.sessionId,
      p_expected_revision: input.current.revision,
      p_expires_at: input.expiresAt,
    });
    if (error) {
      if (/REVISION|REVISAO/.test(error.message)) {
        return { kind: 'conflict' as const, record: await this.findRequired(input.current.orderingId) };
      }
      throw this.rpcError(error.message);
    }
    return { kind: 'issued' as const };
  }

  async confirmAtomically(input: {
    current: ConversationOrderingRecord; expectedRevision: number; messageId: string;
    tokenHash: string | null; idempotencyKey: string; pessoaId: string | null;
  } & ConversationAiPermit): Promise<AtomicConfirmationResult> {
    // Mandatory companion RPC contract (ZeloPDV migration): one transaction
    // locks this whatsapp_order/cart_open session, verifies binding/revision and
    // optional token, rematerializes every catalog/modifier/stock/delivery/store
    // rule, then either persists a bumped review snapshot or creates exactly one
    // canonical order. There is deliberately no app-side revalidate/create path.
    const { data, error } = await this.supabase.rpc('confirm_whatsapp_zelo_order_with_ai_epoch_v1', {
      p_empresa_id: input.current.empresaId,
      p_source_ref: input.current.remoteJid,
      p_conversation_control_id: input.conversationControlId,
      p_conversation_epoch: input.conversationEpoch,
      p_session_id: input.current.sessionId,
      p_expected_revision: input.expectedRevision,
      p_message_id: input.messageId,
      p_idempotency_key: input.idempotencyKey,
      p_pessoa_id: input.pessoaId,
      p_token_hash: input.tokenHash,
    });
    if (error) throw this.rpcError(error.message);
    const result = data as { outcome?: unknown; alreadyConfirmed?: unknown } | null;
    if (result?.outcome !== 'confirmed' && result?.outcome !== 'requires_review' && result?.outcome !== 'conflict') {
      throw new ConversationOrderingError('PEDIDO_INDISPONIVEL', 'Não foi possível concluir o pedido agora. Tente novamente.');
    }
    const record = await this.findRequired(input.current.orderingId);
    if (result.outcome === 'confirmed') {
      if (!record.order || typeof result.alreadyConfirmed !== 'boolean') {
        throw new ConversationOrderingError('PEDIDO_INDISPONIVEL', 'Não foi possível concluir o pedido agora. Tente novamente.');
      }
      record.order.alreadyConfirmed = result.alreadyConfirmed;
    }
    return { kind: result.outcome, record };
  }

  async applyAutoAccept(record: ConversationOrderingRecord): Promise<ConversationOrderingRecord> {
    if (!record.order) return record;
    const result = await applyZeloMenuAutoAccept({
      empresaId: record.empresaId,
      orderId: record.order.id,
      status: record.order.status,
      revision: record.order.revision,
    });
    const refreshed = await this.findRequired(record.orderingId);
    const alreadyConfirmed = record.order.alreadyConfirmed;
    if (result.accepted) {
      refreshed.state = 'accepted';
      if (refreshed.order) {
        refreshed.order.status = result.status;
        refreshed.order.revision = result.revision;
      }
    }
    if (refreshed.order) refreshed.order.alreadyConfirmed = alreadyConfirmed;
    return refreshed;
  }

  private async findRequired(orderingId: string): Promise<ConversationOrderingRecord> {
    const record = await this.findByOrderingId(orderingId);
    if (!record) throw new ConversationOrderingError('PEDIDO_NAO_ENCONTRADO', 'Não encontrei este pedido.');
    return record;
  }

  private rpcError(message: string): ConversationOrderingError {
    if (/AI_TURN_REVOKED/.test(message)) {
      return new ConversationOrderingError('AI_TURN_REVOKED', 'Esta conversa mudou de atendimento. Vou deixar a equipe continuar por aqui.');
    }
    if (/CONFIRMATION_TOKEN_RPC_UNAVAILABLE|issue_whatsapp_zelo_confirmation_token_with_ai_epoch_v1|confirm_whatsapp_zelo_order_(?:with_ai_epoch|atomic)_v1|function .* does not exist|42883/i.test(message)) {
      return new ConversationOrderingError('CONFIRMACAO_INDISPONIVEL', 'A confirmação de pedidos não está disponível agora.');
    }
    if (/REVISION|REVISAO/.test(message)) return new ConversationOrderingError('REVISAO_DESATUALIZADA', 'O pedido foi atualizado. Use a revisão mais recente.');
    if (/TOKEN|CONFIRMATION/.test(message)) return new ConversationOrderingError('CONFIRMACAO_INVALIDA', 'Esta confirmação não é mais válida. Peça um novo resumo.');
    if (/CUSTOMER_NOT_FOUND/.test(message)) return new ConversationOrderingError('CLIENTE_INVALIDO', 'Não foi possível vincular o cliente a este pedido.');
    if (/CART_ALREADY|SESSION_NOT_OPEN/.test(message)) return new ConversationOrderingError('PEDIDO_FECHADO', 'Este pedido já foi encerrado.');
    return new ConversationOrderingError('PEDIDO_INDISPONIVEL', 'Não foi possível concluir o pedido agora. Tente novamente.');
  }
}

function tokenSecret(): string {
  const secret = process.env.ZELO_CONFIRMATION_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new ConversationOrderingError('CONFIRMACAO_INDISPONIVEL', 'A confirmação de pedidos não está disponível agora.');
  }
  return secret;
}

export const ConversationOrdering = createConversationOrdering(new SupabaseConversationOrderingAdapter(), {
  createRawConfirmationToken(record, expiresAt) {
    return deriveConversationConfirmationToken(tokenSecret(), { ...record, expiresAt });
  },
  hashConfirmationToken(token) {
    return hashConversationConfirmationToken(token);
  },
});
