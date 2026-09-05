import { execFileSync } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { build as buildFrontend } from 'vite';
import { build as buildServer } from 'esbuild';

// Both artifacts are built from this checkout. Runtime configuration cannot
// label an old frontend as a newer deployment.
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('A Git commit is required for the build');
const requested = process.env.PUBLIC_APP_VERSION?.trim();
if (requested && !requested.startsWith('${') && requested !== commit) {
  throw new Error('PUBLIC_APP_VERSION must equal the full checked-out Git SHA');
}
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
if (dirty && process.env.BUILD_REQUIRE_CLEAN === '1') throw new Error('Production build requires a clean Git checkout, including untracked files');
const version = `${commit}${dirty ? '-dirty' : ''}`;
const info = { version, commit, dirty, builtAt: new Date().toISOString(), node: process.versions.node };
process.env.VITE_APP_VERSION = version;
const serverOutput = path.resolve('server-build');
if (path.dirname(serverOutput) !== process.cwd()) throw new Error('Build output must stay inside the checkout');
await rm(serverOutput, { recursive: true, force: true });
await buildFrontend();
await buildServer({ entryPoints: ['server/index.ts'], outfile: 'server-build/index.js', bundle: true,
  platform: 'node', format: 'esm', target: 'node24', packages: 'external', logLevel: 'info' });
await writeFile('BUILD_INFO.json', `${JSON.stringify(info, null, 2)}\n`);
console.log(`Built frontend and server: ${version}`);
