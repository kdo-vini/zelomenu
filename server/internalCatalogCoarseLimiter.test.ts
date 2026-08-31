import { createServer } from 'node:http';
import express, { type Express } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createInternalCatalogFailureLimiter, type InternalCatalogFailureLimiterOptions } from './internalCatalogRateLimit';

type RunningServer = { app: Express; server: ReturnType<typeof createServer>; baseUrl: string };
const runningServers: RunningServer[] = [];

async function startServer(options?: InternalCatalogFailureLimiterOptions): Promise<RunningServer> {
  const app = express();
  app.use((req, res, next) => {
    res.locals.requestId = req.header('x-request-id') ?? 'generated-request-id';
    next();
  });
  app.use('/internal/catalog/search', createInternalCatalogFailureLimiter({
    ...options,
    isInternalKeyValid: (provided) => provided === 'valid',
  }));
  app.use(express.json({ limit: '1kb' }));
  app.post('/internal/catalog/search', (req, res) => {
    const respond = () => {
      if (req.header('x-test-fail') === 'true') return res.status(401).json({ error: 'NAO_AUTORIZADO', requestId: res.locals.requestId });
      return res.status(200).json({ ok: true });
    };
    if (req.header('x-test-delay') === 'true') return setTimeout(respond, 30);
    return respond();
  });
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: unknown }).status) : 0;
    if (error instanceof SyntaxError && status === 400) return res.status(400).json({ error: 'JSON_INVALIDO', requestId: res.locals.requestId });
    if (status === 413) return res.status(413).json({ error: 'PAYLOAD_MUITO_GRANDE', requestId: res.locals.requestId });
    return next(error);
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_MISSING');
  const running = { app, server, baseUrl: `http://127.0.0.1:${address.port}` };
  runningServers.push(running);
  return running;
}

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((running) => new Promise<void>((resolve, reject) => running.server.close((error) => error ? reject(error) : resolve()))));
});

async function post(running: RunningServer, body: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${running.baseUrl}/internal/catalog/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

describe('createInternalCatalogFailureLimiter', () => {
  it('não reserva quota coarse para mais de trinta respostas 2xx simultâneas e atrasadas do mesmo IP', async () => {
    const running = await startServer();

    const statuses = await Promise.all(Array.from({ length: 35 }, async (_value, index) => (
      (await post(running, JSON.stringify({ empresaId: index % 2 === 0 ? 'empresa-a' : 'empresa-b' }), { 'x-test-delay': 'true', 'x-zelo-internal-key': 'valid' })).status
    )));

    expect(statuses).toEqual(Array(35).fill(200));
  });

  it('reserva falhas de chave inválida imediatamente e bloqueia concorrência acima de trinta', async () => {
    const running = await startServer();

    const responses = await Promise.all(Array.from({ length: 35 }, async (_value, index) => (
      post(running, '{}', { 'x-test-fail': 'true', 'x-test-delay': 'true', 'x-request-id': `invalid-concurrent-${index}` })
    )));
    const statuses = responses.map((response) => response.status);

    expect(statuses.filter((status) => status === 401)).toHaveLength(30);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
    await expect(responses.find((response) => response.status === 429)?.json()).resolves.toMatchObject({ error: 'MUITAS_REQUISICOES' });
  });

  it('acumula erros autenticados no fim da resposta e bloqueia a trigésima primeira com requestId', async () => {
    const running = await startServer();

    const statuses = [] as number[];
    for (let index = 0; index < 28; index += 1) {
      statuses.push((await post(running, '{}', { 'x-test-fail': 'true', 'x-request-id': `invalid-key-${index}` })).status);
    }
    statuses.push((await post(running, '{', { 'x-zelo-internal-key': 'valid', 'x-request-id': 'invalid-json' })).status);
    statuses.push((await post(running, JSON.stringify({ fill: 'x'.repeat(2_000) }), { 'x-zelo-internal-key': 'valid', 'x-request-id': 'large-payload' })).status);
    const throttled = await post(running, '{}', { 'x-test-fail': 'true', 'x-request-id': 'throttled' });

    expect(statuses.slice(0, 28)).toEqual(Array(28).fill(401));
    expect(statuses.slice(28, 30)).toEqual([400, 413]);
    expect(throttled.status).toBe(429);
    await expect(throttled.json()).resolves.toMatchObject({ error: 'MUITAS_REQUISICOES', requestId: 'throttled' });
  });

  it('expira as falhas da janela sem manter bloqueio indefinidamente', async () => {
    let now = 1_000;
    const running = await startServer({ maxFailures: 1, windowMs: 100, now: () => now });

    expect((await post(running, '{}', { 'x-test-fail': 'true' })).status).toBe(401);
    expect((await post(running, '{}', { 'x-test-fail': 'true' })).status).toBe(429);
    now += 101;
    expect((await post(running, '{}', { 'x-test-fail': 'true' })).status).toBe(401);
  });
});
