import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { inspectDeployment } from './verify-deployment.mjs';

const info = JSON.parse(await readFile('BUILD_INFO.json', 'utf8'));
let child;
let baseUrl = process.env.BUILD_TEST_URL;
try {
  if (!baseUrl) {
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server-build/index.js'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(port),
        DOTENV_CONFIG_PATH: 'nonexistent-build-smoke.env',
        SUPABASE_URL: 'http://127.0.0.1:54329', SUPABASE_SERVICE_ROLE_KEY: 'isolated-placeholder',
        VITE_SUPABASE_URL: 'https://runtime-smoke.example', VITE_SUPABASE_ANON_KEY: 'public-smoke-placeholder',
        PUBLIC_APP_VERSION: 'runtime-overrides-must-not-change-artifact-version',
      },
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Compiled server startup timed out')), 15_000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Compiled server exited ${code}`)); });
      child.stdout.on('data', (data) => { if (String(data).includes('Server listening')) { clearTimeout(timer); resolve(); } });
      child.stderr.on('data', (data) => process.stderr.write(data));
    });
  }
  if (!child) {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { ready = (await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* container boot */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert(ready, 'Container must become ready before smoke assertions');
  }
  const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).version, info.version);
  assert.equal(health.headers.get('x-app-version'), info.version);
  const index = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(5000) });
  assert.equal(index.headers.get('cache-control'), 'no-store');
  assert.equal(index.headers.get('x-app-version'), info.version);
  const html = await index.text();
  assert.match(html, /window\.__ENV__/);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map((match) => match[1]);
  assert(assets.length > 0, 'Fresh frontend assets must be referenced in HTML');
  let frontendVersion = false;
  for (const asset of assets) {
    const response = await fetch(`${baseUrl}${asset}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, asset);
    if (asset.endsWith('.js') && (await response.text()).includes(info.version)) frontendVersion = true;
  }
  assert(frontendVersion, 'Frontend and server must carry the same version');
  for (const [route, status] of [['/api/missing-smoke', 404], ['/api/admin/zelomenu/metrics', 401], ['/internal/metrics/delivery', 401]]) {
    const response = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, status, route);
    assert.match(response.headers.get('content-type') || '', /application\/json/, route);
    await response.json();
  }
  if (!info.dirty) {
    const release = await inspectDeployment({ baseUrl, expectedSha: info.commit });
    console.log(`Full deployment verifier passed against compiled HTTP: ${release.assets} assets, ${release.bytes} bytes.`);
  }
  console.log(`Compiled HTTP smoke passed: ${info.version}, ${assets.length} entry assets, runtime HTML, API 404 and unauthenticated API 401.`);
} finally {
  if (child?.pid && child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
}
