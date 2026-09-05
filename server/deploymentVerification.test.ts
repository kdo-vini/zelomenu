import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createServer } from 'node:http';
import { inspectDeployment, waitForDeployment } from '../scripts/verify-deployment.mjs';

const sha = '1234567890abcdef1234567890abcdef12345678';
const baseUrl = 'https://fixture.invalid';
function fixture(overrides: Record<string, [string, string]> = {}) {
  const records: Record<string, [string, string]> = {
    '/api/health': [JSON.stringify({ sourceCommit: sha, version: sha }), 'application/json'],
    '/': ['<html><script type="module" src="/assets/index-abcdefgh.js"></script><link href="/assets/index-abcdefgh.css"></html>', 'text/html'],
    '/assets/index-abcdefgh.js': ['import("./AppShell-12345678.js");', 'application/javascript'],
    '/assets/index-abcdefgh.css': ['body{}', 'text/css'],
    '/assets/AppShell-12345678.js': [`const version="${sha}";`, 'application/javascript'],
    ...overrides,
  };
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
    await assert.rejects(inspectDeployment({ baseUrl: `http://127.0.0.1:${address.port}`, expectedSha: sha, deadline: Date.now() + 60 }), /abort|timeout|deadline/i);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('fails explicitly when production never converges and retries only checks', async () => {
  let calls = 0;
  await assert.rejects(waitForDeployment({ baseUrl, expectedSha: sha, timeoutMs: 35, pollMs: 5,
    inspect: async () => { calls++; throw new Error('old release'); }, log: () => {},
  }), /did not converge.*old release/);
  assert.ok(calls >= 2);
});
