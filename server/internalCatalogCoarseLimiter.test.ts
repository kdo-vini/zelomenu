import { createServer } from 'node:http';
import express, { type Express } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createInternalCatalogCoarseLimiter } from './internalCatalogRateLimit';

type RunningServer = { app: Express; server: ReturnType<typeof createServer>; baseUrl: string };
const runningServers: RunningServer[] = [];

async function startServer(): Promise<RunningServer> {
  const app = express();
  app.use((req, res, next) => {
    res.locals.requestId = req.header('x-request-id') ?? 'generated-request-id';
    next();
  });
  app.use('/internal/catalog/search', createInternalCatalogCoarseLimiter());
  app.use(express.json({ limit: '1kb' }));
  app.post('/internal/catalog/search', (req, res) => {
    if (req.header('x-test-fail') === 'true') return res.status(401).json({ error: 'NAO_AUTORIZADO', requestId: res.locals.requestId });
    return res.status(200).json({ ok: true });
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

describe('createInternalCatalogCoarseLimiter', () => {
  it('não consome a quota coarse com mais de trinta respostas 2xx de empresas no mesmo IP', async () => {
    const running = await startServer();

    const statuses = [] as number[];
    for (let index = 0; index < 35; index += 1) {
      statuses.push((await post(running, JSON.stringify({ empresaId: index % 2 === 0 ? 'empresa-a' : 'empresa-b' }))).status);
    }

    expect(statuses).toEqual(Array(35).fill(200));
  });

  it('conta falhas antes do parser: chave inválida, JSON inválido e payload grande recebem 429 após o limite', async () => {
    const running = await startServer();

    const statuses = [] as number[];
    for (let index = 0; index < 28; index += 1) {
      statuses.push((await post(running, '{}', { 'x-test-fail': 'true', 'x-request-id': `invalid-key-${index}` })).status);
    }
    statuses.push((await post(running, '{', { 'x-request-id': 'invalid-json' })).status);
    statuses.push((await post(running, JSON.stringify({ fill: 'x'.repeat(2_000) }), { 'x-request-id': 'large-payload' })).status);
    statuses.push((await post(running, '{}', { 'x-test-fail': 'true', 'x-request-id': 'throttled' })).status);

    expect(statuses.slice(0, 28)).toEqual(Array(28).fill(401));
    expect(statuses.slice(28, 30)).toEqual([400, 413]);
    expect(statuses[30]).toBe(429);
  });
});
