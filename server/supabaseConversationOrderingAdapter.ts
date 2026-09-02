import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ConversationOrderingError,
  createConversationOrdering,
  type CanonicalOrderReference,
  type AtomicConfirmationResult,
  type ConversationOrderDraft,
  type ConversationOrderingAdapter,
  type ConversationOrderingRecord,
  type DraftMaterialization,
  type DraftMutationResult,
} from './conversationOrdering.js';
import { getServiceSupabase } from './supabaseServer.js';
import { applyZeloMenuAutoAccept, materializeWhatsAppOrderDraft, type ZeloMenuCartState } from './zelomenuCartSessions.js';
import { deriveConversationConfirmationToken, hashConversationConfirmationToken } from './conversationConfirmationToken.js';

const SESSION_COLUMNS = 'id, empresa_id, ordering_id, context, state, source_ref, customer_snapshot, cart_snapshot, fulfillment_snapshot, pricing_snapshot, payment_snapshot, metadata, revision, last_revalidated_at, last_revalidation, archived_at, updated_at';

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
    return {
      ...materialized,
      cart: {
        ...materialized.cart,
        items: materialized.cart.items.map((item, index) => ({
          ...item,
          lineId: draft.items[index]!.lineId,
        })),
      },
      requirements: [],
      readyForConfirmation: materialized.revalidation.ok
        && !materialized.fulfillment.deliveryFeeToConfirm,
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
      requirements: [],
      readyForConfirmation: false,
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

  async createOpen(input: Omit<ConversationOrderingRecord, 'sessionId' | 'orderingId' | 'revision' | 'state' | 'updatedAt' | 'order'>): Promise<ConversationOrderingRecord> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.from('zelomenu_cart_sessions').insert({
      empresa_id: input.empresaId,
      context: 'whatsapp_order',
      state: 'cart_open',
      source_ref: input.remoteJid,
      customer_snapshot: input.customer,
      cart_snapshot: input.cart,
      fulfillment_snapshot: input.fulfillment,
      pricing_snapshot: input.pricing,
      payment_snapshot: input.payment,
      metadata: { pessoaId: input.pessoaId, processedMessageIds: input.processedMessageIds },
      revision: 1,
      last_revalidated_at: input.revalidation.checkedAt,
      last_revalidation: input.revalidation,
      created_at: now,
      updated_at: now,
    }).select(SESSION_COLUMNS).maybeSingle();
    if (!error && data) return this.mapRow(data as SessionRow);
    if (error?.code !== '23505') throw error ?? new Error('ORDERING_CREATE_FAILED');
    const existing = await this.findOpen(input.empresaId, input.remoteJid);
    if (existing?.processedMessageIds.some((id) => input.processedMessageIds.includes(id))) return existing;
    throw new ConversationOrderingError('PEDIDO_EM_ANDAMENTO', 'Já existe um pedido em andamento nesta conversa.');
  }

  async updateOpen(input: {
    current: ConversationOrderingRecord; expectedRevision: number; messageId: string;
    materialization: DraftMaterialization; pessoaId: string | null;
  }): Promise<DraftMutationResult> {
    return this.mutateOpen(input.current, input.expectedRevision, input.messageId, {
      customer_snapshot: input.materialization.customer,
      cart_snapshot: input.materialization.cart,
      fulfillment_snapshot: input.materialization.fulfillment,
      pricing_snapshot: input.materialization.pricing,
      payment_snapshot: input.materialization.payment,
      last_revalidated_at: input.materialization.revalidation.checkedAt,
      last_revalidation: input.materialization.revalidation,
      metadata: nextMetadata({ ...input.current, pessoaId: input.pessoaId }, input.messageId),
    });
  }

  async cancelOpen(input: { current: ConversationOrderingRecord; expectedRevision: number; messageId: string }): Promise<DraftMutationResult> {
    return this.mutateOpen(input.current, input.expectedRevision, input.messageId, {
      state: 'cancelled',
      archived_at: new Date().toISOString(),
      metadata: nextMetadata(input.current, input.messageId, { cancellationReason: 'explicit_command' }),
    });
  }

  private async mutateOpen(
    current: ConversationOrderingRecord,
    expectedRevision: number,
    messageId: string,
    patch: Record<string, unknown>,
  ): Promise<DraftMutationResult> {
    const { data, error } = await this.supabase.from('zelomenu_cart_sessions').update({
      ...patch,
      revision: expectedRevision + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', current.sessionId)
      .eq('empresa_id', current.empresaId)
      .eq('source_ref', current.remoteJid)
      .eq('context', 'whatsapp_order')
      .eq('state', 'cart_open')
      .eq('revision', expectedRevision)
      .select(SESSION_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (data) return { kind: 'applied', record: await this.mapRow(data as SessionRow) };
    const latest = await this.findByOrderingId(current.orderingId);
    if (!latest) throw new ConversationOrderingError('PEDIDO_NAO_ENCONTRADO', 'Não encontrei este pedido.');
    return latest.processedMessageIds.includes(messageId)
      ? { kind: 'duplicate', record: latest }
      : { kind: 'conflict', record: latest };
  }

  async issueConfirmationToken(input: {
    current: ConversationOrderingRecord; tokenHash: string; expiresAt: string;
  }) {
    // Retries e réplicas derivam o mesmo hash/binding/expiry. Esta chamada
    // depende do contrato idempotente da RPC: se o mesmo token ainda estiver
    // vivo, ela deve devolvê-lo sem invalidar/reinserir a linha UNIQUE.
    const { error } = await this.supabase.rpc('issue_whatsapp_zelo_confirmation_token', {
      p_token_hash: input.tokenHash,
      p_empresa_id: input.current.empresaId,
      p_source_ref: input.current.remoteJid,
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
  }): Promise<AtomicConfirmationResult> {
    // Mandatory companion RPC contract (ZeloPDV migration): one transaction
    // locks this whatsapp_order/cart_open session, verifies binding/revision and
    // optional token, rematerializes every catalog/modifier/stock/delivery/store
    // rule, then either persists a bumped review snapshot or creates exactly one
    // canonical order. There is deliberately no app-side revalidate/create path.
    const { data, error } = await this.supabase.rpc('confirm_whatsapp_zelo_order_atomic_v1', {
      p_empresa_id: input.current.empresaId,
      p_source_ref: input.current.remoteJid,
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
    if (/confirm_whatsapp_zelo_order_atomic_v1|function .* does not exist|42883/i.test(message)) {
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
