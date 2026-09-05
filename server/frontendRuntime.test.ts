import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let child: ChildProcess;
let baseUrl: string;
let createdHtmlFixture = false;

beforeAll(async () => {
  // CI runs unit tests before build. Exercise the actual server with a minimal
  // HTML fixture in that case; preserve any existing build on developer machines.
  if (!existsSync('dist/index.html')) {
    mkdirSync('dist', { recursive: true });
    writeFileSync('dist/index.html', '<html><head><title>Cardápio</title></head><body></body></html>', { flag: 'wx' });
    createdHtmlFixture = true;
  }
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  baseUrl = `http://127.0.0.1:${port}`;
  // No real credentials or providers: these tests exercise local HTTP serving only.
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      DOTENV_CONFIG_PATH: 'nonexistent-audit-test.env', PORT: String(port),
      SUPABASE_URL: 'http://127.0.0.1:54329', SUPABASE_SERVICE_ROLE_KEY: 'local-test-placeholder',
      VITE_SUPABASE_URL: 'https://runtime-test.example', VITE_SUPABASE_ANON_KEY: 'runtime-public-test-key',
      ZELOMENU_METRICS_KEY: 'isolated-metrics-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Server startup timeout: ${output}`)), 15_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    child.stderr?.on('data', (data) => { output += String(data); });
    child.stdout?.on('data', (data) => {
      output += String(data);
      if (output.includes('Server listening')) { clearTimeout(timer); resolve(); }
    });
  });
}, 20_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.kill(); });
  }
  if (createdHtmlFixture) unlinkSync('dist/index.html');
});

describe('production frontend HTTP serving', () => {
  it('restricts global telemetry to its dedicated operator key', async () => {
    expect((await fetch(`${baseUrl}/internal/metrics/delivery`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/internal/metrics/delivery`, { headers: { 'x-metrics-key': 'wrong' } })).status).toBe(401);
    const result = await fetch(`${baseUrl}/internal/metrics/delivery`, { headers: { 'x-metrics-key': 'isolated-metrics-key' } });
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
  });
  it.each(['/', '/index.html', '/admin', '/loja-teste'])('injeta configuração runtime em %s sem cache de HTML', async (route) => {
    const response = await fetch(`${baseUrl}${route}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"VITE_SUPABASE_URL":"https://runtime-test.example"');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['/api/rota-inexistente', '/internal/rota-inexistente'])('retorna JSON 404 para %s', async (route) => {
    const response = await fetch(`${baseUrl}${route}`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ error: 'NOT_FOUND' });
  });
});
