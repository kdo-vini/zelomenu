import { createServer } from 'node:http';
import express, { type Express } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createInternalCatalogFailureLimiter, type InternalCatalogFailureLimiterOptions } from './internalCatalogRateLimit';

type RunningServer = { app: Express; server: ReturnType<typeof createServer>; baseUrl: string };
const runningServers: RunningServer[] = [];

async function startServer(options?: InternalCatalogFailureLimiterOptions): Promise<RunningServer> {
  const app = express();
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.locals.requestId = req.header('x-request-id') ?? 'generated-request-id';
    next();
  });
  const limiter = createInternalCatalogFailureLimiter({
    ...options,
    isInternalKeyValid: (provided) => provided === 'valid',
  });
  app.use('/internal/catalog/search', limiter.preParse);
  app.use(express.json({ limit: '1kb' }));
  app.use('/internal/catalog/search', limiter.postParse);
  app.post('/internal/catalog/search', (req, res) => {
    const respond = () => {
      if (req.header('x-test-fail') === 'true') return res.status(401).json({ error: 'NAO_AUTORIZADO', requestId: res.locals.requestId });
      return res.status(200).json({ ok: true });
    };
    if (req.header('x-test-delay') === 'true') return setTimeout(respond, 30);
    return respond();
  });
  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: unknown }).status) : 0;
    const isBodyParseFailure = (error instanceof SyntaxError && status === 400) || status === 413;
    if (isBodyParseFailure && res.locals.internalCatalogKeyValid === true) limiter.recordAuthenticatedParseFailure(req);
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

  it('CT#10: isola falhas autenticadas por empresa (corpo já interpretado a jusante) — uma empresa esgotada não bloqueia outra atrás do mesmo IP', async () => {
    const running = await startServer({ maxFailures: 5 });
    const postForEmpresa = (empresaId: string) => post(running, JSON.stringify({ empresaId }), {
      'x-zelo-internal-key': 'valid',
      'x-test-fail': 'true',
    });

    const statusesA: number[] = [];
    for (let index = 0; index < 5; index += 1) statusesA.push((await postForEmpresa('empresa-a')).status);
    expect(statusesA).toEqual(Array(5).fill(401));
    expect((await postForEmpresa('empresa-a')).status).toBe(429);

    // empresa-b shares the same IP but never sent a failure — it must not be
    // throttled by empresa-a's exhausted bucket.
    expect((await postForEmpresa('empresa-b')).status).toBe(401);
  });

  it('CT#10: falhas não autenticadas continuam por IP mesmo se o corpo (ainda não interpretado) alega empresas diferentes', async () => {
    const running = await startServer({ maxFailures: 3 });
    const postUnauthenticated = (claimedEmpresaId: string) => post(running, JSON.stringify({ empresaId: claimedEmpresaId }), {
      'x-test-fail': 'true',
      // no x-zelo-internal-key: reserved immediately, IP-only, before the
      // body is ever parsed — an unauthenticated caller cannot claim an
      // empresaId to spread its floods across separate buckets.
    });

    expect((await postUnauthenticated('empresa-a')).status).toBe(401);
    expect((await postUnauthenticated('empresa-b')).status).toBe(401);
    expect((await postUnauthenticated('empresa-c')).status).toBe(401);
    expect((await postUnauthenticated('empresa-d')).status).toBe(429);
  });

  it('limita 31 empresas alegadas pelo mesmo IP no teto autenticado por IP', async () => {
    const running = await startServer();
    const statuses: number[] = [];
    for (let index = 1; index <= 31; index += 1) {
      statuses.push((await post(running, JSON.stringify({ empresaId: `fake-${index}` }), {
        'x-forwarded-for': '198.51.100.10',
        'x-zelo-internal-key': 'valid',
        'x-test-fail': 'true',
      })).status);
    }
    expect(statuses.slice(0, 30)).toEqual(Array(30).fill(401));
    expect(statuses[30]).toBe(429);
  });

  it('mantém empresas em IPs diferentes independentes nos dois níveis', async () => {
    const running = await startServer({ maxFailures: 1 });
    const failing = (empresaId: string, ip: string) => post(running, JSON.stringify({ empresaId }), {
      'x-forwarded-for': ip,
      'x-zelo-internal-key': 'valid',
      'x-test-fail': 'true',
    });

    const empresaA = '10000000-0000-4000-8000-000000000001';
    const empresaB = '10000000-0000-4000-8000-000000000002';
    expect((await failing(empresaA, '198.51.100.11')).status).toBe(401);
    expect((await failing(empresaA, '198.51.100.11')).status).toBe(429);
    expect((await failing(empresaB, '198.51.100.12')).status).toBe(401);
  });
});
