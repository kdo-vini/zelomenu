import { createServer } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderingSnapshot } from './conversationOrdering';
import { createInternalOrderingRouter, parseInternalOrderingCommand } from './internalOrdering';
import { createInternalCatalogFailureLimiter } from './internalCatalogRateLimit';

const EMPRESA = '10000000-0000-4000-8000-000000000001';
const ORDERING = '30000000-0000-4000-8000-000000000001';
const JID = '5511999999999@s.whatsapp.net';
const servers: ReturnType<typeof createServer>[] = [];

function snapshot(): OrderingSnapshot {
  return {
    orderingId: ORDERING,
    empresaId: EMPRESA,
    remoteJid: JID,
    state: 'cart_open',
    revision: 1,
    updatedAt: '2026-08-30T12:00:00.000Z',
    pessoaId: null,
    customer: { name: null, phone: null },
    cart: { items: [], observations: null },
    fulfillment: { type: 'pickup', asap: true, pickupDate: null, pickupTime: null, deliveryAddress: null, deliveryNeighborhood: null, deliveryFee: 0, deliveryFeeToConfirm: false },
    pricing: { subtotal: 0, deliveryFee: 0, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: 0 },
    payment: { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false },
    revalidation: { checkedAt: '2026-08-30T12:00:00.000Z', ok: true, issues: [] },
    requirements: [],
    readyForConfirmation: true,
    order: null,
    confirmationAction: { type: 'confirm_order', token: 'token-opaco-com-tamanho-valido', revision: 1, expiresAt: '2026-08-30T12:10:00.000Z' },
    requiresReview: false,
  };
}

async function start(options: { quotaMax?: number } = {}) {
  const ordering = { apply: vi.fn(async () => snapshot()), getSnapshot: vi.fn(async () => snapshot()) };
  const app = express();
  app.use((req, res, next) => {
    res.locals.requestId = req.header('x-request-id') ?? 'request-gerado';
    res.setHeader('x-request-id', res.locals.requestId);
    next();
  });
  app.use('/internal/ordering', createInternalCatalogFailureLimiter({ isInternalKeyValid: (key) => key === 'valid' }));
  app.use(express.json({ limit: '4kb' }));
  app.use('/internal/ordering', createInternalOrderingRouter(ordering, options));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return { ordering, baseUrl: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

function validCommand(empresaId = EMPRESA) {
  return {
    type: 'open_or_update_draft', empresaId, remoteJid: JID,
    messageId: 'wamid.valid-message-123456',
    draft: { items: [{ lineId: 'line-1', productId: 10, quantity: 2, notes: 'sem cebola' }] },
  };
}

describe('parseInternalOrderingCommand', () => {
  it('aceita somente IDs/quantidades/observações e aplica asap por padrão no domínio', () => {
    expect(parseInternalOrderingCommand(validCommand()).ok).toBe(true);
    expect(parseInternalOrderingCommand({
      ...validCommand(),
      draft: { items: [{ lineId: 'line-1', productId: 10, productName: 'Preço do caller', unitPrice: 0.01, quantity: 1 }] },
    })).toEqual({ ok: false, message: 'Envie somente os identificadores e quantidades dos itens.' });
  });

  it('valida UUIDs, JID, messageId, revisão, IDs e limites', () => {
    expect(parseInternalOrderingCommand({ ...validCommand(), empresaId: 'empresa' }).ok).toBe(false);
    expect(parseInternalOrderingCommand({ ...validCommand(), remoteJid: 'telefone' }).ok).toBe(false);
    expect(parseInternalOrderingCommand({ ...validCommand(), messageId: 'curta' }).ok).toBe(false);
    expect(parseInternalOrderingCommand({ ...validCommand(), orderingId: ORDERING, expectedRevision: 0 }).ok).toBe(false);
    expect(parseInternalOrderingCommand({ ...validCommand(), draft: { items: [{ lineId: 'line-1', productId: -1, quantity: 1 }] } }).ok).toBe(false);
  });

  it('exige lineId válido e único sem sintetizar identidade na borda', () => {
    expect(parseInternalOrderingCommand({
      ...validCommand(), draft: { items: [{ productId: 10, quantity: 1 }] },
    })).toEqual({ ok: false, message: 'Informe uma identificação válida para cada item.' });
    expect(parseInternalOrderingCommand({
      ...validCommand(), draft: { items: [{ lineId: 'linha.1', productId: 10, quantity: 1 }] },
    })).toEqual({ ok: false, message: 'Informe uma identificação válida para cada item.' });
    expect(parseInternalOrderingCommand({
      ...validCommand(),
      draft: { items: [
        { lineId: 'line-1', productId: 10, quantity: 1 },
        { lineId: 'line-1', productId: 10, quantity: 2 },
      ] },
    })).toEqual({ ok: false, message: 'Cada item do pedido precisa de uma identificação diferente.' });

    const parsed = parseInternalOrderingCommand(validCommand());
    expect(parsed.ok && parsed.value.type === 'open_or_update_draft'
      ? parsed.value.draft.items[0].lineId
      : null).toBe('line-1');
  });

  it('aceita remoção explícita e valida removedLineIds na borda', () => {
    const removalOnly = parseInternalOrderingCommand({
      ...validCommand(),
      orderingId: ORDERING,
      expectedRevision: 1,
      draft: { items: [], removedLineIds: ['line-1'] },
    });
    expect(removalOnly.ok && removalOnly.value.type === 'open_or_update_draft'
      ? removalOnly.value.draft.removedLineIds
      : null).toEqual(['line-1']);

    expect(parseInternalOrderingCommand({
      ...validCommand(), draft: { items: [], removedLineIds: ['line.1'] },
    })).toEqual({ ok: false, message: 'Revise a identificação dos itens removidos.' });
    expect(parseInternalOrderingCommand({
      ...validCommand(), draft: { items: [], removedLineIds: ['line-1', 'line-1'] },
    })).toEqual({ ok: false, message: 'Cada item removido precisa de uma identificação diferente.' });
    expect(parseInternalOrderingCommand({
      ...validCommand(),
      draft: {
        items: [{ lineId: 'line-1', productId: 10, quantity: 1 }],
        removedLineIds: ['line-1'],
      },
    })).toEqual({ ok: false, message: 'Um item não pode ser atualizado e removido ao mesmo tempo.' });
    expect(parseInternalOrderingCommand({
      ...validCommand(), draft: { items: [], removedLineIds: [] },
    })).toEqual({ ok: false, message: 'Informe pelo menos um item para atualizar ou remover.' });
  });
});

describe('rotas internas de ordering', () => {
  it('falha fechada, preserva requestId e não expõe nomes internos', async () => {
    const { baseUrl } = await start();
    const response = await fetch(`${baseUrl}/internal/ordering/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'req-auth-1' }, body: JSON.stringify(validCommand()),
    });
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'NAO_AUTORIZADO', requestId: 'req-auth-1' });
    expect(JSON.stringify(body)).not.toMatch(/Supabase|RPC|token_hash|create_zelo_order/i);
  });

  it('aplica comando autenticado e consulta snapshot sem devolver link de menu', async () => {
    const { baseUrl, ordering } = await start();
    const posted = await fetch(`${baseUrl}/internal/ordering/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' }, body: JSON.stringify(validCommand()),
    });
    const postBody = await posted.json();
    expect(posted.status).toBe(200);
    expect(ordering.apply).toHaveBeenCalledOnce();
    expect(postBody).not.toHaveProperty('link');
    expect(postBody).not.toHaveProperty('menuToken');

    const loaded = await fetch(`${baseUrl}/internal/ordering/${ORDERING}?empresaId=${EMPRESA}`, { headers: { 'x-zelo-internal-key': 'valid' } });
    expect(loaded.status).toBe(200);
    expect(ordering.getSnapshot).toHaveBeenCalledWith(ORDERING);
  });

  it('limita por empresa sem misturar empresas distintas', async () => {
    const { baseUrl } = await start({ quotaMax: 1 });
    const post = (empresaId: string) => fetch(`${baseUrl}/internal/ordering/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' }, body: JSON.stringify(validCommand(empresaId)),
    });
    const empresaB = '10000000-0000-4000-8000-000000000002';
    expect((await post(EMPRESA)).status).toBe(200);
    expect((await post(empresaB)).status).toBe(200);
    const limited = await post(EMPRESA);
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({ error: 'MUITAS_REQUISICOES', requestId: 'request-gerado' });
  });

  it('aplica quota por empresa também na consulta GET', async () => {
    const { baseUrl } = await start({ quotaMax: 1 });
    const empresaB = '10000000-0000-4000-8000-000000000002';
    const get = (empresaId: string) => fetch(`${baseUrl}/internal/ordering/${ORDERING}?empresaId=${empresaId}`, {
      headers: { 'x-zelo-internal-key': 'valid' },
    });

    expect((await get(EMPRESA)).status).toBe(200);
    expect((await get(empresaB)).status).not.toBe(429);
    const limited = await get(EMPRESA);
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({ error: 'MUITAS_REQUISICOES', requestId: 'request-gerado' });
  });
});
