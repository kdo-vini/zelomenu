import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWireFixtureSnapshots } from './conversationOrderingWireFixtures.js';
import {
  ACCEPTED_COMMAND_BODIES,
  ERROR_CATALOG,
  REJECTED_COMMAND_BODIES,
  REQUIREMENT_TYPE_CATALOG,
} from './conversationOrderingWireContract.js';
import { createInternalOrderingRouter, parseInternalOrderingCommand } from './internalOrdering.js';
import { createInternalCatalogFailureLimiter } from './internalCatalogRateLimit.js';
import { ConversationOrderingError, type ConversationOrderCommand, type OrderingSnapshot } from './conversationOrdering.js';

const originalSupabaseEnvironment = vi.hoisted(() => {
  const original = { url: process.env.SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://wire-fixtures.test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key-for-wire-fixtures';
  return original;
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '..', 'docs', 'contracts', 'conversation-ordering-wire', 'v1');

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function expectMatchesCommittedFile(filename: string, value: unknown) {
  const expected = stableJson(value);
  const filePath = path.join(FIXTURE_DIR, filename);
  let actual: string | null = null;
  try {
    actual = await fs.readFile(filePath, 'utf8');
  } catch {
    actual = null;
  }
  expect(
    actual,
    `${filename} is missing or stale under docs/contracts/conversation-ordering-wire/v1/. ` +
    `Regenerate it (see README.md in that folder) so it matches the code-generated content.`,
  ).toBe(expected);
}

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  process.env.SUPABASE_URL = originalSupabaseEnvironment.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseEnvironment.serviceRoleKey;
});

type OrderingStub = { apply: (command: ConversationOrderCommand) => Promise<OrderingSnapshot>; getSnapshot: (lookup: unknown) => Promise<OrderingSnapshot | null> };

async function startOrderingHarness(options: { ordering?: OrderingStub; quotaMax?: number; bodyLimit?: string } = {}) {
  const ordering = options.ordering ?? { apply: vi.fn(), getSnapshot: vi.fn() };
  const app = express();
  app.use((req, res, next) => {
    res.locals.requestId = req.header('x-request-id') ?? 'request-de-teste';
    next();
  });
  // Mirrors server/index.ts: the coarse failure limiter's pre-parse stage
  // runs before JSON parsing, its post-parse stage right after.
  const failureLimiter = createInternalCatalogFailureLimiter({ isInternalKeyValid: (key) => key === 'valid' });
  app.use('/internal/ordering', failureLimiter.preParse);
  app.use(express.json({ limit: options.bodyLimit ?? '1mb' }));
  app.use((error: unknown, req: express.Request, res: Response, next: (error: unknown) => void) => {
    const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: unknown }).status) : 0;
    const isBodyParseFailure = (error instanceof SyntaxError && status === 400) || status === 413;
    if (isBodyParseFailure && res.locals.internalCatalogKeyValid === true) failureLimiter.recordAuthenticatedParseFailure(req);
    if (error instanceof SyntaxError && status === 400) {
      return res.status(400).json({ error: 'JSON_INVALIDO', detail: 'Envie dados em JSON válido.', requestId: res.locals.requestId });
    }
    if (status === 413) {
      return res.status(413).json({ error: 'PAYLOAD_MUITO_GRANDE', detail: 'Os dados enviados são grandes demais.', requestId: res.locals.requestId });
    }
    return next(error);
  });
  app.use('/internal/ordering', failureLimiter.postParse);
  app.use('/internal/ordering', createInternalOrderingRouter(ordering as never, { quotaMax: options.quotaMax }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

const EMPRESA_ID = '10000000-0000-4000-8000-0000000000f1';
const REMOTE_JID = '5511900000001@s.whatsapp.net';

function validConfirmCommand() {
  return {
    type: 'confirm_draft',
    empresaId: EMPRESA_ID,
    remoteJid: REMOTE_JID,
    messageId: 'wamid.harness-confirm-000001',
    conversationControlId: '60000000-0000-4000-8000-0000000000f1',
    conversationEpoch: '1',
    orderingId: '30000000-0000-4000-8000-000000000001',
    expectedRevision: 1,
  };
}

describe('conversation ordering wire fixtures', () => {
  it('gera o bundle de snapshots exatamente igual ao arquivo commitado', async () => {
    const snapshots = await buildWireFixtureSnapshots();
    for (const [filename, value] of Object.entries(snapshots)) {
      await expectMatchesCommittedFile(filename, value);
    }
  });

  it('a snapshot parcial cobre massa escolhida, molho faltando, acompanhamento parcial, adicional pago e uma 2a linha com variação/molho bloqueantes', async () => {
    const snapshots = await buildWireFixtureSnapshots();
    const partial = snapshots['snapshot.partial-montavel.json'];
    expect(partial.fulfillment.type).toBeNull();
    expect(partial.payment.declaredMethod).toBeNull();
    expect(partial.readyForConfirmation).toBe(false);

    const byId = Object.fromEntries(partial.requirements.map((requirement) => [requirement.id, requirement]));
    // linha 1: massa já escolhida (sem requirement), molho faltando (bloqueante), acompanhamento parcial e adicional pago não-bloqueantes
    expect(byId['linha-massa-1:g001']).toBeUndefined();
    expect(byId['linha-massa-1:g002']).toMatchObject({ type: 'modifier_group', blocking: true, kind: 'adicional' });
    expect(byId['linha-massa-1:g004']).toMatchObject({ blocking: false, selectedDistinctCount: 1 });
    expect(byId['linha-massa-1:g005']).toMatchObject({ blocking: false });
    // linha 2: nada escolhido -> variação/tamanho (g001, kind variacao) também aparece bloqueante
    expect(byId['linha-massa-2:g001']).toMatchObject({ type: 'modifier_group', blocking: true, kind: 'variacao' });
    expect(byId['linha-massa-2:g002']).toMatchObject({ blocking: true });
    expect(partial.requirements.some((requirement) => requirement.type === 'fulfillment_type')).toBe(true);
    expect(partial.requirements.some((requirement) => requirement.type === 'payment_method')).toBe(true);
  });

  it('a snapshot pronta tem confirmationToken, revision > 1 e entrega com pix', async () => {
    const snapshots = await buildWireFixtureSnapshots();
    const ready = snapshots['snapshot.ready.json'];
    expect(ready.readyForConfirmation).toBe(true);
    expect(ready.revision).toBeGreaterThan(1);
    expect(ready.confirmationAction?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ready.fulfillment.type).toBe('delivery');
    expect(ready.payment.declaredMethod).toBe('pix');
  });

  it('a snapshot de revisão exige acompanhar taxa de entrega alterada', async () => {
    const snapshots = await buildWireFixtureSnapshots();
    const reviewRequired = snapshots['snapshot.review-required.json'];
    expect(reviewRequired.requiresReview).toBe(true);
    expect(reviewRequired.fulfillment.deliveryFeeToConfirm).toBe(true);
    expect(reviewRequired.state).toBe('cart_open');
    expect(reviewRequired.confirmationAction).toBeNull();
  });

  it('gera requirement-types.json exatamente igual ao arquivo commitado', async () => {
    await expectMatchesCommittedFile('requirement-types.json', REQUIREMENT_TYPE_CATALOG);
  });

  it('commands.accepted.json: cada corpo é de fato aceito pelo parser real', async () => {
    const generated = ACCEPTED_COMMAND_BODIES.map(({ name, body }) => {
      const parsed = parseInternalOrderingCommand(body);
      expect(parsed.ok, `esperava aceitar "${name}", mas o parser rejeitou: ${!parsed.ok ? parsed.message : ''}`).toBe(true);
      return { name, body };
    });
    await expectMatchesCommittedFile('commands.accepted.json', generated);
  });

  it('commands.rejected.json: cada corpo é de fato rejeitado pelo parser real, com o código e a mensagem exatos', async () => {
    const generated = REJECTED_COMMAND_BODIES.map(({ name, body }) => {
      const parsed = parseInternalOrderingCommand(body);
      expect(parsed.ok, `esperava rejeitar "${name}", mas o parser aceitou`).toBe(false);
      return { name, body, expectedError: { error: 'COMANDO_INVALIDO', message: parsed.ok ? '' : parsed.message } };
    });
    await expectMatchesCommittedFile('commands.rejected.json', generated);
  });

  it('errors.json cobre exatamente os códigos que o código-fonte hoje lança/retorna', async () => {
    const sourceFiles = ['conversationOrdering.ts', 'internalOrdering.ts', 'supabaseConversationOrderingAdapter.ts'];
    const contents = await Promise.all(sourceFiles.map((file) => fs.readFile(path.join(__dirname, file), 'utf8')));
    const found = new Set<string>();
    for (const content of contents) {
      for (const match of content.matchAll(/ConversationOrderingError\(\s*\n?\s*'([A-Z_]+)'/g)) found.add(match[1]);
      for (const match of content.matchAll(/error:\s*'([A-Z_]+)'/g)) found.add(match[1]);
    }
    // Transport-level codes are sourced from server/index.ts, which this
    // ordering-specific grep intentionally does not scan.
    found.add('JSON_INVALIDO');
    found.add('PAYLOAD_MUITO_GRANDE');
    expect(new Set(Object.keys(ERROR_CATALOG))).toEqual(found);
    await expectMatchesCommittedFile('errors.json', ERROR_CATALOG);
  });

  it('verifica ao vivo o status HTTP de cada código de domínio no catálogo', async () => {
    const cases: Array<{ code: string; message?: string; expectedStatus: number; throwPlain?: boolean }> = [
      { code: 'ITEM_INVALIDO', message: 'mensagem de teste', expectedStatus: 400 },
      { code: 'PEDIDO_VAZIO', message: ERROR_CATALOG.PEDIDO_VAZIO.detail, expectedStatus: 400 },
      { code: 'CLIENTE_INVALIDO', message: ERROR_CATALOG.CLIENTE_INVALIDO.detail, expectedStatus: 400 },
      { code: 'CONFIRMACAO_INDISPONIVEL', message: ERROR_CATALOG.CONFIRMACAO_INDISPONIVEL.detail, expectedStatus: 400 },
      { code: 'PEDIDO_NAO_ENCONTRADO', message: 'mensagem de teste', expectedStatus: 404 },
      { code: 'REVISAO_DESATUALIZADA', message: ERROR_CATALOG.REVISAO_DESATUALIZADA.detail, expectedStatus: 409 },
      { code: 'RESUMO_EXPIRADO', message: ERROR_CATALOG.RESUMO_EXPIRADO.detail, expectedStatus: 409 },
      { code: 'PEDIDO_EM_ANDAMENTO', message: ERROR_CATALOG.PEDIDO_EM_ANDAMENTO.detail, expectedStatus: 409 },
      { code: 'PEDIDO_FECHADO', message: ERROR_CATALOG.PEDIDO_FECHADO.detail, expectedStatus: 409 },
      { code: 'CONFIRMACAO_INVALIDA', message: ERROR_CATALOG.CONFIRMACAO_INVALIDA.detail, expectedStatus: 409 },
      { code: 'AI_TURN_REVOKED', message: ERROR_CATALOG.AI_TURN_REVOKED.detail, expectedStatus: 409 },
      { code: 'PEDIDO_INDISPONIVEL', message: 'mensagem de teste', expectedStatus: 400 },
      { code: 'PEDIDO_INDISPONIVEL', expectedStatus: 500, throwPlain: true },
    ];
    for (const testCase of cases) {
      const ordering: OrderingStub = {
        apply: vi.fn(async () => {
          if (testCase.throwPlain) throw new Error('erro inesperado simulado');
          throw new ConversationOrderingError(testCase.code, testCase.message ?? 'mensagem de teste');
        }),
        getSnapshot: vi.fn(async () => null),
      };
      const { baseUrl } = await startOrderingHarness({ ordering });
      const response = await fetch(`${baseUrl}/internal/ordering/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' },
        body: JSON.stringify(validConfirmCommand()),
      });
      expect(response.status, `${testCase.code}${testCase.throwPlain ? ' (erro não-domínio)' : ''}`).toBe(testCase.expectedStatus);
      const json = await response.json();
      expect(json.error).toBe(testCase.code);
    }
  });

  it('verifica ao vivo NAO_AUTORIZADO, COMANDO_INVALIDO, EMPRESA_INVALIDA, CONVERSA_INVALIDA e PEDIDO_INVALIDO/PEDIDO_NAO_ENCONTRADO (GET)', async () => {
    const { baseUrl } = await startOrderingHarness({ ordering: { apply: vi.fn(), getSnapshot: vi.fn(async () => null) } });

    const unauthorized = await fetch(`${baseUrl}/internal/ordering/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'invalida' }, body: '{}',
    });
    expect(unauthorized.status).toBe(401);
    expect((await unauthorized.json()).error).toBe('NAO_AUTORIZADO');

    const invalidCommand = await fetch(`${baseUrl}/internal/ordering/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' }, body: JSON.stringify({}),
    });
    expect(invalidCommand.status).toBe(400);
    expect((await invalidCommand.json()).error).toBe('COMANDO_INVALIDO');

    const badEmpresa = await fetch(`${baseUrl}/internal/ordering/${'30000000-0000-4000-8000-000000000001'}?empresaId=nao-uuid&remoteJid=${REMOTE_JID}`, {
      headers: { 'x-zelo-internal-key': 'valid' },
    });
    expect(badEmpresa.status).toBe(400);
    expect((await badEmpresa.json()).error).toBe('EMPRESA_INVALIDA');

    const badJid = await fetch(`${baseUrl}/internal/ordering/${'30000000-0000-4000-8000-000000000001'}?empresaId=${EMPRESA_ID}&remoteJid=telefone`, {
      headers: { 'x-zelo-internal-key': 'valid' },
    });
    expect(badJid.status).toBe(400);
    expect((await badJid.json()).error).toBe('CONVERSA_INVALIDA');

    const badOrderingId = await fetch(`${baseUrl}/internal/ordering/nao-uuid?empresaId=${EMPRESA_ID}&remoteJid=${REMOTE_JID}`, {
      headers: { 'x-zelo-internal-key': 'valid' },
    });
    expect(badOrderingId.status).toBe(400);
    expect((await badOrderingId.json()).error).toBe('PEDIDO_INVALIDO');

    const notFound = await fetch(`${baseUrl}/internal/ordering/30000000-0000-4000-8000-000000000099?empresaId=${EMPRESA_ID}&remoteJid=${REMOTE_JID}`, {
      headers: { 'x-zelo-internal-key': 'valid' },
    });
    expect(notFound.status).toBe(404);
    expect((await notFound.json()).error).toBe('PEDIDO_NAO_ENCONTRADO');
  });

  it('verifica ao vivo MUITAS_REQUISICOES (quota), JSON_INVALIDO e PAYLOAD_MUITO_GRANDE', async () => {
    const okSnapshot = { orderingId: '30000000-0000-4000-8000-000000000001' } as unknown as OrderingSnapshot;
    const { baseUrl } = await startOrderingHarness({ ordering: { apply: vi.fn(async () => okSnapshot), getSnapshot: vi.fn() }, quotaMax: 1 });
    const body = JSON.stringify(validConfirmCommand());
    const first = await fetch(`${baseUrl}/internal/ordering/commands`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' }, body });
    expect(first.status).toBe(200);
    const second = await fetch(`${baseUrl}/internal/ordering/commands`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' }, body });
    expect(second.status).toBe(429);
    expect((await second.json()).error).toBe('MUITAS_REQUISICOES');

    const { baseUrl: baseUrl2 } = await startOrderingHarness({ ordering: { apply: vi.fn(), getSnapshot: vi.fn() } });
    const malformed = await fetch(`${baseUrl2}/internal/ordering/commands`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' }, body: '{ nao e json' });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error).toBe('JSON_INVALIDO');

    const { baseUrl: baseUrl3 } = await startOrderingHarness({ ordering: { apply: vi.fn(), getSnapshot: vi.fn() }, bodyLimit: '10b' });
    const tooLarge = await fetch(`${baseUrl3}/internal/ordering/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-zelo-internal-key': 'valid' }, body: JSON.stringify(validConfirmCommand()),
    });
    expect(tooLarge.status).toBe(413);
    expect((await tooLarge.json()).error).toBe('PAYLOAD_MUITO_GRANDE');
  });
});
