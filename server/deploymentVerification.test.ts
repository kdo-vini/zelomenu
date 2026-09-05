import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createServer } from 'node:http';
import { inspectDeployment, waitForDeployment } from '../scripts/verify-deployment.mjs';

const sha = '1234567890abcdef1234567890abcdef12345678';
const baseUrl = 'https://fixture.invalid';
function fixtureRecords(overrides: Record<string, [string, string]> = {}): Record<string, [string, string]> {
  return {
    '/api/health': [JSON.stringify({ sourceCommit: sha, version: sha }), 'application/json'],
    '/': ['<html><script type="module" src="/assets/index-abcdefgh.js"></script><link href="/assets/index-abcdefgh.css"></html>', 'text/html'],
    '/assets/index-abcdefgh.js': ['import("./AppShell-12345678.js");', 'application/javascript'],
    '/assets/index-abcdefgh.css': ['body{}', 'text/css'],
    '/assets/AppShell-12345678.js': [`const version="${sha}";`, 'application/javascript'],
    ...overrides,
  };
}
function fixture(overrides: Record<string, [string, string]> = {}) {
  const records: Record<string, [string, string]> = fixtureRecords(overrides);
  const fetchImpl: typeof fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal);
    const row = records[url.pathname];
    return new Response(row?.[0] || '', { status: row ? 200 : 404, headers: {
      'content-type': row?.[1] || 'text/html', 'x-app-version': sha, 'cache-control': 'no-store',
    } });
  };
  return fetchImpl;
}

test('verifies both complete SHAs and the version in a referenced lazy bundle', async () => {
  const result = await inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture() });
  assert.equal(result.assets, 3);
  assert.equal(result.sourceCommit, sha);
});

test('rejects split backend/frontend revisions', async () => {
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture({
    '/api/health': [JSON.stringify({ sourceCommit: 'a'.repeat(40), version: 'a'.repeat(40) }), 'application/json'],
  }) }), /expected.*received/);
});

test('rejects a proxy response with stale version headers', async () => {
  const original = fixture();
  const fetchImpl: typeof fetch = async (input, options) => {
    const response = await original(input, options);
    response.headers.set('x-app-version', 'a'.repeat(40));
    return response;
  };
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl }), /expected.*received/);
});

test('rejects cacheable HTML despite current metadata', async () => {
  const original = fixture();
  const fetchImpl: typeof fetch = async (input, options) => {
    const response = await original(input, options);
    response.headers.set('cache-control', 'public, max-age=3600');
    return response;
  };
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl }), /cache policy/);
});

test('rejects a missing lazy asset even if metadata is current', async () => {
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture({
    '/assets/index-abcdefgh.js': ['import("./missing-12345678.js");', 'application/javascript'],
  }) }), /HTTP 404/);
});

test('rejects SPA fallback HTML served under a JavaScript URL', async () => {
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture({
    '/assets/AppShell-12345678.js': [`<html>${sha}</html>`, 'text/html'],
  }) }), /content type/);
});

test('rejects stale JS despite current metadata', async () => {
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture({
    '/assets/AppShell-12345678.js': ['const version="old";', 'application/javascript'],
  }) }), /does not contain baked version/);
});

test('does not follow assets from another origin', async () => {
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl: fixture({
    '/': ['<script src="https://other.invalid/assets/index-abcdefgh.js"></script>', 'text/html'],
  }) }), /no local JavaScript/);
});

test('bounds a real response whose headers arrive but body stalls by the global deadline', async () => {
  const server = createServer((_req, response) => { response.writeHead(200); response.write('{'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await assert.rejects(inspectDeployment({ baseUrl: `http://127.0.0.1:${address.port}`, expectedSha: sha, deadline: Date.now() + 1000 }), /\/api\/health \[body\].*(abort|timeout|deadline)/i);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('identifies the endpoint, request phase and connection cause without hiding the failure', async () => {
  const cause = Object.assign(new Error('connection timed out'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
  const failure = new TypeError('fetch failed', { cause });
  const fetchImpl: typeof fetch = async () => { throw failure; };
  await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha, fetchImpl }), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /fixture\.invalid\/api\/health \[request\].*fetch failed.*UND_ERR_CONNECT_TIMEOUT/);
    assert.equal(error.cause, failure);
    return true;
  });
});

test('rejects an absent deployment SHA before any retries', async () => {
  let inspected = false;
  await assert.rejects(waitForDeployment({ baseUrl, expectedSha: '', timeoutMs: 10, pollMs: 1,
    inspect: async () => { inspected = true; throw new Error('must not inspect'); }, log: () => {},
  }), /complete 40-character Git SHA/);
  assert.equal(inspected, false);
});

test('fails explicitly when production never converges and retries only checks', async () => {
  let calls = 0;
  await assert.rejects(waitForDeployment({ baseUrl, expectedSha: sha, timeoutMs: 35, pollMs: 5,
    inspect: async () => { calls++; throw new Error('old release'); }, log: () => {},
  }), /did not converge.*old release/);
  assert.ok(calls >= 2);
});

type HttpOverride = { status?: number; body?: string; type?: string; version?: string; disconnect?: boolean };
async function withHttpFixture(
  override: (path: string, count: number) => HttpOverride,
  run: (baseUrl: string, requests: { path: string; method: string }[]) => Promise<void>,
) {
  const records: Record<string, [string, string]> = fixtureRecords();
  const requests: { path: string; method: string }[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url!, baseUrl).pathname;
    requests.push({ path, method: request.method! });
    const custom = override(path, requests.filter(row => row.path === path).length);
    if (custom.disconnect) { response.destroy(); return; }
    const record = records[path];
    response.writeHead(custom.status ?? (record ? 200 : 404), {
      'content-type': custom.type ?? record?.[1] ?? 'text/plain',
      'x-app-version': custom.version ?? sha, 'cache-control': 'no-store',
    });
    response.end(custom.body ?? record?.[0] ?? 'Not found');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`, requests); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

test('verifies metadata, headers and the lazy asset graph over real HTTP', async () => {
  await withHttpFixture(() => ({}), async (baseUrl, requests) => {
    const result = await inspectDeployment({ baseUrl, expectedSha: sha });
    assert.equal(result.assets, 3);
    assert.equal(result.sourceCommit, sha);
    assert.deepEqual(requests.map(row => row.path), [
      '/api/health', '/', '/assets/index-abcdefgh.js', '/assets/index-abcdefgh.css', '/assets/AppShell-12345678.js',
    ]);
    assert.ok(requests.every(row => row.method === 'GET'));
  });
});

test.each([
  { name: 'old backend with new frontend', path: '/api/health', reply: { body: JSON.stringify({ sourceCommit: 'a'.repeat(40), version: 'a'.repeat(40) }) }, failure: /expected.*received/ },
  { name: 'stale proxy header', path: '/api/health', reply: { version: 'a'.repeat(40) }, failure: /expected.*received/ },
  { name: 'missing lazy chunk', path: '/assets/AppShell-12345678.js', reply: { status: 404 }, failure: /HTTP 404/ },
  { name: 'missing lazy chunk with query and fragment despite current entry SHA', path: '/assets/index-abcdefgh.js', reply: { body: `const version="${sha}"; import("./missing-12345678.js?v=1#chunk");` }, failure: /HTTP 404/ },
  { name: 'old lazy bundle', path: '/assets/AppShell-12345678.js', reply: { body: 'const version="old";' }, failure: /does not contain baked version/ },
  { name: 'HTML fallback instead of JavaScript', path: '/assets/AppShell-12345678.js', reply: { body: `<html>${sha}</html>`, type: 'text/html' }, failure: /content type/ },
  { name: 'forbidden public health', path: '/api/health', reply: { status: 403 }, failure: /HTTP 403/ },
])('fails over real HTTP for $name', async ({ path, reply, failure }) => {
  await withHttpFixture(current => current === path ? reply : {}, async baseUrl => {
    await assert.rejects(inspectDeployment({ baseUrl, expectedSha: sha }), failure);
  });
});

test('follows a valid lazy URL with query and fragment over real HTTP', async () => {
  await withHttpFixture(path => path === '/assets/index-abcdefgh.js'
    ? { body: `const version="${sha}"; import("./AppShell-12345678.js?v=1#chunk");` } : {}, async (baseUrl, requests) => {
    const result = await inspectDeployment({ baseUrl, expectedSha: sha });
    assert.equal(result.assets, 3);
    assert.ok(requests.some(row => row.path === '/assets/AppShell-12345678.js'));
  });
});

test.each(['network disconnect', 'release still rolling out'])('recovers from %s only after a complete real HTTP verification', async reason => {
  const logs: string[] = [];
  await withHttpFixture((path, count) => {
    if (path !== '/api/health' || count !== 1) return {};
    return reason === 'network disconnect' ? { disconnect: true }
      : { body: JSON.stringify({ sourceCommit: 'a'.repeat(40), version: 'a'.repeat(40) }) };
  }, async (baseUrl, requests) => {
    const result = await waitForDeployment({ baseUrl, expectedSha: sha, timeoutMs: 3000, pollMs: 5, log: message => logs.push(message) });
    assert.equal(result.sourceCommit, sha);
    assert.equal(result.assets, 3);
    assert.equal(requests.filter(row => row.path === '/api/health').length, 2);
    assert.ok(requests.every(row => row.method === 'GET'));
    assert.match(logs[0], /Awaiting production/);
    assert.match(logs.at(-1)!, /Production verified/);
  });
});
