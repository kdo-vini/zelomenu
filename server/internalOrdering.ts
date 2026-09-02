import express, { type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
  ConversationOrderingError,
  type ConversationOrderCommand,
  type OrderingSnapshot,
} from './conversationOrdering.js';
import { makeInternalCatalogRateLimitKey } from './internalCatalogRateLimit.js';
import type { ZeloMenuFulfillmentSnapshot } from './zelomenuCartSessions.js';

type OrderingModule = {
  apply(command: ConversationOrderCommand): Promise<OrderingSnapshot>;
  getSnapshot(orderingId: string): Promise<OrderingSnapshot | null>;
};

type ParseResult = { ok: true; value: ConversationOrderCommand } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JID = /^\d{8,20}@(s\.whatsapp\.net|c\.us)$/;
const MESSAGE_ID = /^[\x21-\x7e]{8,200}$/;
const OPTION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const LINE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function text(value: unknown, max: number): string | null | undefined {
  if (value == null) return value === null ? null : undefined;
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized && normalized.length <= max ? normalized : undefined;
}

function parseDraft(value: unknown): { ok: true; value: Extract<ConversationOrderCommand, { type: 'open_or_update_draft' }>['draft'] } | { ok: false; message: string } {
  if (!value || typeof value !== 'object') return { ok: false, message: 'Envie os dados do pedido.' };
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.items) || row.items.length > 50) {
    return { ok: false, message: 'Informe até 50 itens.' };
  }
  const items = [] as Extract<ConversationOrderCommand, { type: 'open_or_update_draft' }>['draft']['items'];
  const lineIds = new Set<string>();
  for (const raw of row.items) {
    if (!raw || typeof raw !== 'object') return { ok: false, message: 'Revise os itens informados.' };
    const item = raw as Record<string, unknown>;
    if ('productName' in item || 'price' in item || 'unitPrice' in item || 'lineTotal' in item) {
      return { ok: false, message: 'Envie somente os identificadores e quantidades dos itens.' };
    }
    if (typeof item.lineId !== 'string' || !LINE_ID.test(item.lineId)) {
      return { ok: false, message: 'Informe uma identificação válida para cada item.' };
    }
    if (lineIds.has(item.lineId)) {
      return { ok: false, message: 'Cada item do pedido precisa de uma identificação diferente.' };
    }
    lineIds.add(item.lineId);
    if (!Number.isSafeInteger(item.productId) || Number(item.productId) <= 0) return { ok: false, message: 'Informe um produto válido.' };
    if (!Number.isSafeInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 999) return { ok: false, message: 'Informe uma quantidade válida.' };
    const notes = text(item.notes, 200);
    if (item.notes != null && notes === undefined) return { ok: false, message: 'Revise a observação do item.' };
    const selectedOptions = [] as NonNullable<(typeof items)[number]['selectedOptions']>;
    if (item.selectedOptions != null) {
      if (!Array.isArray(item.selectedOptions) || item.selectedOptions.length > 20) return { ok: false, message: 'Revise os complementos do item.' };
      for (const rawGroup of item.selectedOptions) {
        if (!rawGroup || typeof rawGroup !== 'object') return { ok: false, message: 'Revise os complementos do item.' };
        const group = rawGroup as Record<string, unknown>;
        if (typeof group.groupId !== 'string' || !OPTION_ID.test(group.groupId)) return { ok: false, message: 'Informe um grupo de complemento válido.' };
        if (!Array.isArray(group.optionSelections) || group.optionSelections.length < 1 || group.optionSelections.length > 30) return { ok: false, message: 'Revise as opções do complemento.' };
        const optionSelections = [] as Array<{ optionId: string; quantity: number }>;
        for (const rawOption of group.optionSelections) {
          if (!rawOption || typeof rawOption !== 'object') return { ok: false, message: 'Revise as opções do complemento.' };
          const option = rawOption as Record<string, unknown>;
          if (typeof option.optionId !== 'string' || !OPTION_ID.test(option.optionId)) return { ok: false, message: 'Informe uma opção válida.' };
          if (!Number.isSafeInteger(option.quantity) || Number(option.quantity) < 1 || Number(option.quantity) > 99) return { ok: false, message: 'Informe uma quantidade válida para o complemento.' };
          optionSelections.push({ optionId: option.optionId, quantity: Number(option.quantity) });
        }
        selectedOptions.push({ groupId: group.groupId, optionSelections });
      }
    }
    items.push({ lineId: item.lineId, productId: Number(item.productId), quantity: Number(item.quantity), notes, selectedOptions });
  }

  let removedLineIds: string[] | undefined;
  if (row.removedLineIds !== undefined) {
    if (!Array.isArray(row.removedLineIds) || row.removedLineIds.length > 50) {
      return { ok: false, message: 'Revise os itens removidos.' };
    }
    removedLineIds = [];
    const removed = new Set<string>();
    for (const lineId of row.removedLineIds) {
      if (typeof lineId !== 'string' || !LINE_ID.test(lineId)) {
        return { ok: false, message: 'Revise a identificação dos itens removidos.' };
      }
      if (removed.has(lineId)) {
        return { ok: false, message: 'Cada item removido precisa de uma identificação diferente.' };
      }
      if (lineIds.has(lineId)) {
        return { ok: false, message: 'Um item não pode ser atualizado e removido ao mesmo tempo.' };
      }
      removed.add(lineId);
      removedLineIds.push(lineId);
    }
  }
  if (items.length === 0 && (removedLineIds?.length ?? 0) === 0) {
    return { ok: false, message: 'Informe pelo menos um item para atualizar ou remover.' };
  }

  const customerRaw = row.customer;
  let customer: { name?: string | null; phone?: string | null } | undefined;
  if (customerRaw != null) {
    if (!customerRaw || typeof customerRaw !== 'object') return { ok: false, message: 'Revise os dados do cliente.' };
    const candidate = customerRaw as Record<string, unknown>;
    const name = text(candidate.name, 120);
    const phone = text(candidate.phone, 40);
    if ((candidate.name != null && name === undefined) || (candidate.phone != null && phone === undefined)) return { ok: false, message: 'Revise os dados do cliente.' };
    customer = { name, phone };
  }
  const pessoaId = row.pessoaId == null ? null : typeof row.pessoaId === 'string' && UUID.test(row.pessoaId) ? row.pessoaId : undefined;
  if (row.pessoaId != null && pessoaId === undefined) return { ok: false, message: 'Informe um cliente válido.' };
  const observations = text(row.observations, 500);
  if (row.observations != null && observations === undefined) return { ok: false, message: 'Revise a observação do pedido.' };
  const paymentMethod = text(row.paymentMethod, 40);
  if (row.paymentMethod != null && paymentMethod === undefined) return { ok: false, message: 'Revise a forma de pagamento.' };

  let fulfillment: Partial<ZeloMenuFulfillmentSnapshot> | null | undefined;
  if (row.fulfillment != null) {
    if (typeof row.fulfillment !== 'object') return { ok: false, message: 'Revise a forma de entrega ou retirada.' };
    const candidate = row.fulfillment as Record<string, unknown>;
    if (candidate.type !== 'pickup' && candidate.type !== 'delivery') return { ok: false, message: 'Escolha entrega ou retirada.' };
    if ('deliveryFee' in candidate || 'deliveryFeeToConfirm' in candidate) return { ok: false, message: 'A taxa de entrega é calculada pela loja.' };
    fulfillment = {
      type: candidate.type,
      asap: candidate.asap !== false,
      pickupDate: text(candidate.pickupDate, 10),
      pickupTime: text(candidate.pickupTime, 5),
      deliveryAddress: text(candidate.deliveryAddress, 250),
      deliveryNeighborhood: text(candidate.deliveryNeighborhood, 120),
      deliveryPostalCode: text(candidate.deliveryPostalCode, 10),
      deliveryNumber: text(candidate.deliveryNumber, 20),
      deliveryComplement: text(candidate.deliveryComplement, 100),
    };
  }

  return { ok: true, value: { items, removedLineIds, observations, customer, pessoaId, fulfillment, paymentMethod } };
}

export function parseInternalOrderingCommand(input: unknown): ParseResult {
  if (!input || typeof input !== 'object') return { ok: false, message: 'Envie os dados do comando.' };
  const row = input as Record<string, unknown>;
  if (row.type !== 'open_or_update_draft' && row.type !== 'confirm_draft' && row.type !== 'cancel_draft') return { ok: false, message: 'Informe uma ação válida.' };
  if (typeof row.empresaId !== 'string' || !UUID.test(row.empresaId)) return { ok: false, message: 'Informe uma empresa válida.' };
  if (typeof row.remoteJid !== 'string' || !JID.test(row.remoteJid)) return { ok: false, message: 'Informe uma conversa válida.' };
  if (typeof row.messageId !== 'string' || !MESSAGE_ID.test(row.messageId)) return { ok: false, message: 'Informe uma mensagem válida.' };
  const identity = { empresaId: row.empresaId, remoteJid: row.remoteJid, messageId: row.messageId };

  if (row.type === 'open_or_update_draft') {
    const draft = parseDraft(row.draft);
    if (!draft.ok) return draft;
    if (row.orderingId == null && row.expectedRevision != null) return { ok: false, message: 'A abertura não deve informar revisão.' };
    if (row.orderingId != null && (typeof row.orderingId !== 'string' || !UUID.test(row.orderingId))) return { ok: false, message: 'Informe um pedido válido.' };
    if (row.orderingId != null && (!Number.isSafeInteger(row.expectedRevision) || Number(row.expectedRevision) < 1)) return { ok: false, message: 'Informe a revisão atual do pedido.' };
    return { ok: true, value: { ...identity, type: row.type, draft: draft.value, orderingId: row.orderingId as string | undefined, expectedRevision: row.expectedRevision as number | undefined } };
  }

  if (typeof row.orderingId !== 'string' || !UUID.test(row.orderingId)) return { ok: false, message: 'Informe um pedido válido.' };
  if (!Number.isSafeInteger(row.expectedRevision) || Number(row.expectedRevision) < 1) return { ok: false, message: 'Informe a revisão atual do pedido.' };
  if (row.type === 'cancel_draft') return { ok: true, value: { ...identity, type: row.type, orderingId: row.orderingId, expectedRevision: Number(row.expectedRevision) } };
  if (row.confirmationToken != null && (typeof row.confirmationToken !== 'string' || !/^[A-Za-z0-9_-]{20,120}$/.test(row.confirmationToken))) return { ok: false, message: 'A confirmação informada não é válida.' };
  const pessoaId = row.pessoaId == null ? null : typeof row.pessoaId === 'string' && UUID.test(row.pessoaId) ? row.pessoaId : undefined;
  if (row.pessoaId != null && pessoaId === undefined) return { ok: false, message: 'Informe um cliente válido.' };
  return { ok: true, value: { ...identity, type: row.type, orderingId: row.orderingId, expectedRevision: Number(row.expectedRevision), confirmationToken: row.confirmationToken as string | undefined, pessoaId } };
}

function sendOrderingError(error: unknown, res: Response): void {
  if (error instanceof ConversationOrderingError) {
    const status = error.code === 'PEDIDO_NAO_ENCONTRADO' ? 404
      : error.code === 'REVISAO_DESATUALIZADA' || error.code === 'RESUMO_EXPIRADO' || error.code === 'PEDIDO_EM_ANDAMENTO' || error.code === 'PEDIDO_FECHADO' || error.code === 'CONFIRMACAO_INVALIDA' ? 409
      : 400;
    res.status(status).json({ error: error.code, detail: error.message, current: error.currentSnapshot, requestId: res.locals.requestId });
    return;
  }
  console.error('[ZeloMenu] internal ordering error:', error);
  res.status(500).json({ error: 'PEDIDO_INDISPONIVEL', detail: 'Não foi possível processar o pedido agora. Tente novamente.', requestId: res.locals.requestId });
}

export function createInternalOrderingRouter(
  ordering: OrderingModule,
  options: { quotaMax?: number; quotaWindowMs?: number } = {},
): express.Router {
  const router = express.Router();
  const quota = rateLimit({
    windowMs: options.quotaWindowMs ?? 60_000,
    max: options.quotaMax ?? 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => makeInternalCatalogRateLimitKey(
      typeof req.body?.empresaId === 'string'
        ? req.body.empresaId
        : typeof req.query.empresaId === 'string' ? req.query.empresaId : 'empresa-invalida',
      ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? 'unknown'),
    ),
    handler: (_req, res) => res.status(429).json({ error: 'MUITAS_REQUISICOES', detail: 'Muitos pedidos em pouco tempo. Tente novamente em instantes.', requestId: res.locals.requestId }),
  });

  router.use((_req, res, next) => {
    if (res.locals.internalCatalogKeyValid === true) return next();
    return res.status(401).json({ error: 'NAO_AUTORIZADO', detail: 'Não foi possível autorizar esta solicitação.', requestId: res.locals.requestId });
  });

  router.post('/commands', quota, async (req: Request, res: Response) => {
    const parsed = parseInternalOrderingCommand(req.body);
    if (!parsed.ok) return res.status(400).json({ error: 'COMANDO_INVALIDO', detail: parsed.message, requestId: res.locals.requestId });
    try {
      res.setHeader('Cache-Control', 'no-store');
      return res.json(await ordering.apply(parsed.value));
    } catch (error) {
      sendOrderingError(error, res);
    }
  });

  router.get('/:orderingId', quota, async (req: Request, res: Response) => {
    if (!UUID.test(req.params.orderingId)) return res.status(400).json({ error: 'PEDIDO_INVALIDO', detail: 'Informe um pedido válido.', requestId: res.locals.requestId });
    if (typeof req.query.empresaId !== 'string' || !UUID.test(req.query.empresaId)) {
      return res.status(400).json({ error: 'EMPRESA_INVALIDA', detail: 'Informe uma empresa válida.', requestId: res.locals.requestId });
    }
    try {
      const snapshot = await ordering.getSnapshot(req.params.orderingId);
      if (!snapshot || snapshot.empresaId !== req.query.empresaId) return res.status(404).json({ error: 'PEDIDO_NAO_ENCONTRADO', detail: 'Não encontrei este pedido.', requestId: res.locals.requestId });
      res.setHeader('Cache-Control', 'no-store');
      return res.json(snapshot);
    } catch (error) {
      sendOrderingError(error, res);
    }
  });

  return router;
}
