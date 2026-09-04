import express, { type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
  ConversationOrderingError,
  type ConversationOrderCommand,
  type ConversationOrderLinePatch,
  type ConversationOrderPatch,
  type OrderingSnapshot,
} from './conversationOrdering.js';
import { makeInternalCatalogRateLimitKey } from './internalCatalogRateLimit.js';
import type { ZeloMenuFulfillmentSnapshot } from './zelomenuCartSessions.js';
import { isConversationRemoteJid } from './conversationOrderingIdentity.js';
import { internalOrderingErrorCode } from './internalOrderingErrorCodes.js';

type OrderingModule = {
  apply(command: ConversationOrderCommand): Promise<OrderingSnapshot>;
  getSnapshot(lookup: { orderingId: string; empresaId: string; remoteJid: string }): Promise<OrderingSnapshot | null>;
};
type ParseResult = { ok: true; value: ConversationOrderCommand } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGE_ID = /^[\x21-\x7e]{8,200}$/;
const OPTION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const LINE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BIGINT_DECIMAL = '9223372036854775807';
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

function isConversationEpoch(value: unknown): value is string {
  return typeof value === 'string'
    && /^(0|[1-9]\d{0,18})$/.test(value)
    && (value.length < 19 || value <= MAX_BIGINT_DECIMAL);
}

function text(value: unknown, max: number): string | null | undefined {
  if (value == null) return value === null ? null : undefined;
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized && normalized.length <= max ? normalized : undefined;
}

function parseOptionGroups(value: unknown): {
  ok: true;
  value: NonNullable<ConversationOrderLinePatch['selectedOptions']>;
} | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length > 20) return { ok: false, message: 'Revise os complementos do item.' };
  const result: NonNullable<ConversationOrderLinePatch['selectedOptions']> = [];
  for (const rawGroup of value) {
    if (!rawGroup || typeof rawGroup !== 'object') return { ok: false, message: 'Revise os complementos do item.' };
    const group = rawGroup as Record<string, unknown>;
    if (typeof group.groupId !== 'string' || !OPTION_ID.test(group.groupId)
      || !Array.isArray(group.optionSelections)
      || group.optionSelections.length < 1 || group.optionSelections.length > 30) {
      return { ok: false, message: 'Revise as opções do complemento.' };
    }
    const selections: Array<{ optionId: string; quantity: number }> = [];
    for (const raw of group.optionSelections) {
      if (!raw || typeof raw !== 'object') return { ok: false, message: 'Revise as opções do complemento.' };
      const option = raw as Record<string, unknown>;
      if (typeof option.optionId !== 'string' || !OPTION_ID.test(option.optionId)
        || !Number.isSafeInteger(option.quantity)
        || Number(option.quantity) < 1 || Number(option.quantity) > 99) {
        return { ok: false, message: 'Revise as opções do complemento.' };
      }
      selections.push({ optionId: option.optionId, quantity: Number(option.quantity) });
    }
    result.push({ groupId: group.groupId, optionSelections: selections });
  }
  return { ok: true, value: result };
}

function parseDraft(value: unknown, isUpdate: boolean): {
  ok: true;
  value: ConversationOrderPatch;
} | { ok: false; message: string } {
  if (!value || typeof value !== 'object') return { ok: false, message: 'Envie os dados do pedido.' };
  const row = value as Record<string, unknown>;
  if (!isUpdate && (!Array.isArray(row.items) || row.items.length < 1)) return { ok: false, message: 'Informe os itens do pedido.' };
  if (row.items !== undefined && (!Array.isArray(row.items) || row.items.length > 50)) return { ok: false, message: 'Informe até 50 itens.' };

  const items: ConversationOrderLinePatch[] = [];
  const lineIds = new Set<string>();
  for (const raw of (row.items ?? [])) {
    if (!raw || typeof raw !== 'object') return { ok: false, message: 'Revise os itens informados.' };
    const item = raw as Record<string, unknown>;
    if (own(item, 'productName') || own(item, 'price') || own(item, 'unitPrice') || own(item, 'lineTotal')) return { ok: false, message: 'Envie somente os identificadores e quantidades dos itens.' };
    if (typeof item.lineId !== 'string' || !LINE_ID.test(item.lineId)) return { ok: false, message: 'Informe uma identificação válida para cada item.' };
    if (lineIds.has(item.lineId)) return { ok: false, message: 'Cada item do pedido precisa de uma identificação diferente.' };
    lineIds.add(item.lineId);
    const hasAuthoritativeField = own(item, 'productId') || own(item, 'quantity') || own(item, 'notes') || own(item, 'selectedOptions');
    if (isUpdate && !hasAuthoritativeField) return { ok: false, message: 'Informe produto, quantidade, observação ou complementos para alterar o item.' };
    if (isUpdate && own(item, 'productId') && (!Number.isSafeInteger(item.productId) || Number(item.productId) <= 0)) return { ok: false, message: 'Informe um produto válido.' };
    if (isUpdate && own(item, 'quantity') && (!Number.isSafeInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 999)) return { ok: false, message: 'Informe uma quantidade válida.' };
    if (!isUpdate && (!Number.isSafeInteger(item.productId) || Number(item.productId) <= 0 || !Number.isSafeInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 999)) return { ok: false, message: 'Informe produto e quantidade válidos.' };
    const parsed: ConversationOrderLinePatch = { lineId: item.lineId };
    if (own(item, 'productId')) parsed.productId = Number(item.productId);
    if (own(item, 'quantity')) parsed.quantity = Number(item.quantity);
    if (own(item, 'notes')) {
      parsed.notes = text(item.notes, 200);
      if (item.notes !== null && parsed.notes === undefined) return { ok: false, message: 'Revise a observação do item.' };
    }
    if (own(item, 'selectedOptions')) {
      if (item.selectedOptions === null) return { ok: false, message: 'Revise os complementos do item.' };
      const options = parseOptionGroups(item.selectedOptions);
      if (!options.ok) return options;
      parsed.selectedOptions = options.value;
    }
    items.push(parsed);
  }

  let removedLineIds: string[] | undefined;
  if (own(row, 'removedLineIds')) {
    if (!Array.isArray(row.removedLineIds) || row.removedLineIds.length > 50) return { ok: false, message: 'Revise os itens removidos.' };
    removedLineIds = [];
    const seen = new Set<string>();
    for (const id of row.removedLineIds) {
      if (typeof id !== 'string' || !LINE_ID.test(id)) return { ok: false, message: 'Revise a identificação dos itens removidos.' };
      if (seen.has(id)) return { ok: false, message: 'Cada item removido precisa de uma identificação diferente.' };
      if (lineIds.has(id)) return { ok: false, message: 'Um item não pode ser atualizado e removido ao mesmo tempo.' };
      seen.add(id);
      removedLineIds.push(id);
    }
  }

  let customer: { name?: string | null } | null | undefined;
  if (own(row, 'customer')) {
    if (row.customer === null) customer = null;
    else if (!row.customer || typeof row.customer !== 'object') return { ok: false, message: 'Revise os dados do cliente.' };
    else {
      const candidate = row.customer as Record<string, unknown>;
      // Compatibility with the current caller: validate legacy phone input,
      // but deliberately do not copy it into the domain DTO.
      if (own(candidate, 'phone')) {
        const legacy = text(candidate.phone, 40);
        if (candidate.phone !== null && legacy === undefined) return { ok: false, message: 'Revise os dados do cliente.' };
      }
      if (own(candidate, 'name')) {
        const name = text(candidate.name, 120);
        if (candidate.name !== null && name === undefined) return { ok: false, message: 'Revise os dados do cliente.' };
        customer = { name };
      } else customer = {};
    }
  }
  const pessoaId = own(row, 'pessoaId')
    ? (row.pessoaId === null ? null : typeof row.pessoaId === 'string' && UUID.test(row.pessoaId) ? row.pessoaId : undefined)
    : undefined;
  if (own(row, 'pessoaId') && row.pessoaId !== null && pessoaId === undefined) return { ok: false, message: 'Informe um cliente válido.' };

  const observations = own(row, 'observations') ? text(row.observations, 500) : undefined;
  if (own(row, 'observations') && row.observations !== null && observations === undefined) return { ok: false, message: 'Revise a observação do pedido.' };
  const paymentMethod = own(row, 'paymentMethod') ? text(row.paymentMethod, 40) : undefined;
  if (own(row, 'paymentMethod') && row.paymentMethod !== null && paymentMethod === undefined) return { ok: false, message: 'Revise a forma de pagamento.' };

  let fulfillment: Partial<ZeloMenuFulfillmentSnapshot> | null | undefined;
  if (own(row, 'fulfillment')) {
    if (row.fulfillment === null) fulfillment = null;
    else if (!row.fulfillment || typeof row.fulfillment !== 'object') return { ok: false, message: 'Revise a forma de entrega ou retirada.' };
    else {
      const candidate = row.fulfillment as Record<string, unknown>;
      if (own(candidate, 'type') && candidate.type !== 'pickup' && candidate.type !== 'delivery') return { ok: false, message: 'Escolha entrega ou retirada.' };
      if (own(candidate, 'deliveryFee') || own(candidate, 'deliveryFeeToConfirm')) return { ok: false, message: 'A taxa de entrega é calculada pela loja.' };
      const parsed: Record<string, unknown> = {};
      for (const key of ['type', 'asap', 'pickupDate', 'pickupTime', 'deliveryAddress', 'deliveryNeighborhood', 'deliveryPostalCode', 'deliveryNumber', 'deliveryComplement']) {
        if (!own(candidate, key)) continue;
        const max = key === 'deliveryAddress' ? 250 : key === 'deliveryNeighborhood' ? 120 : key === 'deliveryComplement' ? 100 : key === 'deliveryNumber' ? 20 : key === 'deliveryPostalCode' ? 10 : key === 'pickupDate' ? 10 : key === 'pickupTime' ? 5 : 20;
        if (key === 'asap') {
          if (typeof candidate[key] !== 'boolean') return { ok: false, message: 'Revise a agenda do pedido.' };
          parsed[key] = candidate[key];
        } else if (key === 'type') parsed[key] = candidate[key];
        else {
          const field = text(candidate[key], max);
          if (candidate[key] !== null && field === undefined) return { ok: false, message: 'Revise os dados de entrega.' };
          parsed[key] = field;
        }
      }
      fulfillment = parsed as Partial<ZeloMenuFulfillmentSnapshot>;
    }
  }

  const result = {
    items,
    ...(own(row, 'removedLineIds') ? { removedLineIds } : {}),
    ...(own(row, 'observations') ? { observations } : {}),
    ...(own(row, 'customer') ? { customer } : {}),
    ...(own(row, 'pessoaId') ? { pessoaId } : {}),
    ...(own(row, 'fulfillment') ? { fulfillment } : {}),
    ...(own(row, 'paymentMethod') ? { paymentMethod } : {}),
  } as ConversationOrderPatch;
  const apparentChange = items.length > 0 || (removedLineIds?.length ?? 0) > 0
    || ['observations', 'customer', 'pessoaId', 'fulfillment', 'paymentMethod'].some((key) => {
      if (!own(row, key)) return false;
      if (key === 'customer') return customer === null || own(row.customer as object, 'name');
      if (key === 'fulfillment') return fulfillment === null || Object.keys(fulfillment ?? {}).length > 0;
      return true;
    });
  if (isUpdate && !apparentChange) {
    if (own(row, 'removedLineIds')) return { ok: false, message: 'Informe pelo menos um item para atualizar ou remover.' };
    return { ok: false, message: 'Informe pelo menos uma alteração.' };
  }
  return { ok: true, value: result };
}

export function parseInternalOrderingCommand(input: unknown): ParseResult {
  if (!input || typeof input !== 'object') return { ok: false, message: 'Envie os dados do comando.' };
  const row = input as Record<string, unknown>;
  if (row.type !== 'open_or_update_draft' && row.type !== 'confirm_draft' && row.type !== 'cancel_draft') return { ok: false, message: 'Informe uma ação válida.' };
  if (typeof row.empresaId !== 'string' || !UUID.test(row.empresaId)) return { ok: false, message: 'Informe uma empresa válida.' };
  if (typeof row.remoteJid !== 'string' || !isConversationRemoteJid(row.remoteJid)) return { ok: false, message: 'Informe uma conversa válida.' };
  if (typeof row.messageId !== 'string' || !MESSAGE_ID.test(row.messageId)) return { ok: false, message: 'Informe uma mensagem válida.' };
  if (typeof row.conversationControlId !== 'string' || !UUID.test(row.conversationControlId)) return { ok: false, message: 'Informe um controle válido para a conversa.' };
  if (!isConversationEpoch(row.conversationEpoch)) return { ok: false, message: 'Informe uma versão válida da conversa.' };
  const identity = { empresaId: row.empresaId, remoteJid: row.remoteJid, messageId: row.messageId, conversationControlId: row.conversationControlId, conversationEpoch: row.conversationEpoch } as const;

  if (row.type === 'open_or_update_draft') {
    const isUpdate = row.orderingId != null;
    const draft = parseDraft(row.draft, isUpdate);
    if (!draft.ok) return draft;
    if (!isUpdate && row.expectedRevision != null) return { ok: false, message: 'A abertura não deve informar revisão.' };
    if (isUpdate && (typeof row.orderingId !== 'string' || !UUID.test(row.orderingId) || !Number.isSafeInteger(row.expectedRevision) || Number(row.expectedRevision) < 1)) return { ok: false, message: 'Informe pedido e revisão válidos.' };
    return { ok: true, value: { ...identity, type: row.type, draft: draft.value, orderingId: isUpdate ? row.orderingId as string : undefined, expectedRevision: isUpdate ? Number(row.expectedRevision) : undefined } as ConversationOrderCommand };
  }
  if (typeof row.orderingId !== 'string' || !UUID.test(row.orderingId) || !Number.isSafeInteger(row.expectedRevision) || Number(row.expectedRevision) < 1) return { ok: false, message: 'Informe pedido e revisão válidos.' };
  if (row.type === 'cancel_draft') return { ok: true, value: { ...identity, type: row.type, orderingId: row.orderingId, expectedRevision: Number(row.expectedRevision) } };
  // ZM1: confirmationToken is mandatory for confirm_draft (was optional).
  // A confirmation must always prove it saw the exact revision being
  // confirmed -- text "sim" and button taps both carry the token already
  // visible to them via confirmationAction; there is no legitimate
  // confirm_draft with no token.
  if (typeof row.confirmationToken !== 'string' || !/^[A-Za-z0-9_-]{20,120}$/.test(row.confirmationToken)) return { ok: false, message: 'Informe a confirmação do pedido.' };
  const pessoaId = row.pessoaId == null ? null : typeof row.pessoaId === 'string' && UUID.test(row.pessoaId) ? row.pessoaId : undefined;
  if (row.pessoaId != null && pessoaId === undefined) return { ok: false, message: 'Informe um cliente válido.' };
  return { ok: true, value: { ...identity, type: row.type, orderingId: row.orderingId, expectedRevision: Number(row.expectedRevision), confirmationToken: row.confirmationToken, pessoaId } };
}

function sendOrderingError(error: unknown, res: Response): void {
  if (error instanceof ConversationOrderingError) {
    const status = error.code === 'PEDIDO_NAO_ENCONTRADO' ? 404 : error.code === 'REVISAO_DESATUALIZADA' || error.code === 'RESUMO_EXPIRADO' || error.code === 'PEDIDO_EM_ANDAMENTO' || error.code === 'PEDIDO_FECHADO' || error.code === 'CONFIRMACAO_INVALIDA' || error.code === 'AI_TURN_REVOKED' ? 409 : 400;
    res.status(status).json({ error: error.code, detail: error.message, current: error.currentSnapshot, requestId: res.locals.requestId });
    return;
  }
  console.error('[ZeloMenu] internal ordering error:', error);
  res.status(500).json({ error: internalOrderingErrorCode('PEDIDO_INDISPONIVEL'), detail: 'Não foi possível processar o pedido agora. Tente novamente.', requestId: res.locals.requestId });
}

export function createInternalOrderingRouter(ordering: OrderingModule, options: { quotaMax?: number; quotaWindowMs?: number } = {}): express.Router {
  const router = express.Router();
  const quota = rateLimit({
    windowMs: options.quotaWindowMs ?? 60_000,
    max: options.quotaMax ?? 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => makeInternalCatalogRateLimitKey(typeof req.body?.empresaId === 'string' ? req.body.empresaId : typeof req.query.empresaId === 'string' ? req.query.empresaId : 'empresa-invalida', ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? 'unknown')),
    handler: (_req, res) => res.status(429).json({ error: internalOrderingErrorCode('MUITAS_REQUISICOES'), detail: 'Muitos pedidos em pouco tempo. Tente novamente em instantes.', requestId: res.locals.requestId }),
  });
  router.use((_req, res, next) => res.locals.internalCatalogKeyValid === true ? next() : res.status(401).json({ error: internalOrderingErrorCode('NAO_AUTORIZADO'), detail: 'Não foi possível autorizar esta solicitação.', requestId: res.locals.requestId }));
  router.post('/commands', quota, async (req: Request, res: Response) => {
    const parsed = parseInternalOrderingCommand(req.body);
    if (!parsed.ok) return res.status(400).json({ error: internalOrderingErrorCode('COMANDO_INVALIDO'), detail: parsed.message, requestId: res.locals.requestId });
    try { res.setHeader('Cache-Control', 'no-store'); return res.json(await ordering.apply(parsed.value)); } catch (error) { sendOrderingError(error, res); }
  });
  router.get('/:orderingId', quota, async (req: Request, res: Response) => {
    if (!UUID.test(req.params.orderingId)) return res.status(400).json({ error: internalOrderingErrorCode('PEDIDO_INVALIDO'), detail: 'Informe um pedido válido.', requestId: res.locals.requestId });
    if (typeof req.query.empresaId !== 'string' || !UUID.test(req.query.empresaId)) return res.status(400).json({ error: internalOrderingErrorCode('EMPRESA_INVALIDA'), detail: 'Informe uma empresa válida.', requestId: res.locals.requestId });
    if (typeof req.query.remoteJid !== 'string' || !isConversationRemoteJid(req.query.remoteJid)) return res.status(400).json({ error: internalOrderingErrorCode('CONVERSA_INVALIDA'), detail: 'Informe uma conversa válida.', requestId: res.locals.requestId });
    try {
      const snapshot = await ordering.getSnapshot({ orderingId: req.params.orderingId, empresaId: req.query.empresaId, remoteJid: req.query.remoteJid });
      if (!snapshot) return res.status(404).json({ error: internalOrderingErrorCode('PEDIDO_NAO_ENCONTRADO'), detail: 'Não encontrei este pedido.', requestId: res.locals.requestId });
      res.setHeader('Cache-Control', 'no-store');
      return res.json(snapshot);
    } catch (error) { sendOrderingError(error, res); }
  });
  return router;
}
