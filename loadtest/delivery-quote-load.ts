#!/usr/bin/env node
// ZeloMenu Delivery Quote — Load Test Suite
//
// Uso:
//   SLUG=loja-teste npx tsx loadtest/delivery-quote-load.ts
//   SLUG=loja-teste npx tsx loadtest/delivery-quote-load.ts --all
//   SLUG=loja-teste npx tsx loadtest/delivery-quote-load.ts --same-address --concurrent=50
//
// Opções:
//   --all                   Executa todos os cenários (padrão)
//   --same-address          Testa concorrência mesmo endereço
//   --different-addresses   Testa concorrência endereços diferentes
//   --provider-failure      Testa contingência (circuit breaker)
//   --cache-behavior        Testa comportamento do cache
//   --concurrent=<N>        Número de requisições simultâneas (padrão: 10)
//   --ceps=<lista>          CEPs separados por vírgula
//   --address-number=<N>    Número do endereço para entrega (padrão: 100)
//
// Variáveis de ambiente:
//   BASE_URL   URL do servidor (padrão: http://localhost:3101)
//   SLUG       Slug da loja (OBRIGATÓRIO)
//
// Exige Node 18+ (fetch nativo).

import { randomUUID } from 'node:crypto';

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3101').replace(/\/+$/, '');
const SLUG = process.env.SLUG || '';
let ADDRESS_NUMBER = process.env.DELIVERY_TEST_ADDRESS_NUMBER || '100';

// CEPs de teste — endereços reais em diferentes capitais
let TEST_CEPS: string[] = [
  '01001-000', // SP - Praça da Sé
  '20040-020', // RJ - Av. Rio Branco
  '30140-071', // BH - Av. Afonso Pena
  '80020-000', // CT - Rua XV de Novembro
  '90010-000', // POA - Rua da Praia
  '40020-000', // SAL - Praça Municipal
  '60060-000', // FOR - Praça do Ferreira
  '70040-010', // BSb - SBS
  '50010-040', // REC - Rua do Imperador
  '66010-020', // BEL - Av. Presidente Vargas
  '69005-050', // MAN - Av. Eduardo Ribeiro
  '57010-300', // MACE - Av. da Paz
  '59010-050', // NAT - Av. Rio Branco
  '64000-040', // THE - Rua Simplício Mendes
  '65010-400', // SLZ - Av. Pedro II
  '20010-010', // RJ - Rua Primeiro de Março
  '30130-001', // BH - Rua da Bahia
  '80010-020', // CT - Praça Tiradentes
  '90020-002', // POA - Rua dos Andradas
  '40010-010', // SAL - Av. Sete de Setembro
  '60020-000', // FOR - Rua Major Facundo
  '70300-010', // BSb - Eixo Monumental
  '50030-230', // REC - Av. Guararapes
  '66015-010', // BEL - Travessa Campos Sales
  '69010-050', // MAN - Rua José Clemente
  '57020-000', // MACE - Av. Moreira Lima
  '59015-000', // NAT - Av. Deodoro
  '64001-100', // THE - Rua 13 de Maio
  '65020-100', // SLZ - Rua do Egito
  '01010-000', // SP - Rua Boa Vista
  '20030-010', // RJ - Rua da Alfândega
  '30120-010', // BH - Rua Pernambuco
  '80030-010', // CT - Rua Barão do Rio Branco
  '90030-001', // POA - Rua Gen. Câmara
  '40015-000', // SAL - Largo do Pelourinho
  '60030-000', // FOR - Rua Barão do Rio Branco
  '70390-000', // BSb - Asa Sul
  '50040-000', // REC - Cais do Apolo
  '66020-000', // BEL - Rua João Diogo
  '69015-010', // MAN - Av. Epaminondas
  '57030-000', // MACE - Rua Barão de Atalaia
  '59020-000', // NAT - Av. Hermes da Fonseca
  '64000-070', // THE - Rua Oeiras
  '65030-100', // SLZ - Rua da Estrela
  '20060-010', // RJ - Av. Passos
  '30140-010', // BH - Rua São Paulo
  '80040-010', // CT - Rua Marechal Deodoro
  '90040-000', // POA - Largo Vespasiano Júlio Veppo
  '40020-010', // SAL - Rua do Tesouro
  '60040-000', // FOR - Rua Senador Pompeu
];

interface TestReport {
  timestamp: string;
  scenario: string;
  concurrency: number;
  totalRequests: number;
  succeeded: number;
  failed: number;
  durationsMs: number[];
  statusDistribution: Record<string, number>;
  errorCodes: Record<string, number>;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  minMs: number;
  meanMs: number;
  cacheLayerDistribution: Record<string, number>;
}

interface CartResult {
  ok: boolean;
  durationMs: number;
  httpStatus: number;
  deliveryStatus: string | null;
  cacheLayer: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(1)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function fmtPct(part: number, total: number): string {
  if (total === 0) return '0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function divider(title: string): string {
  const line = '─'.repeat(60);
  return `\n${line}\n  ${title}\n${line}`;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

interface FetchResult {
  status: number;
  data: unknown;
  ok: boolean;
  statusText: string;
}

async function apiFetch(
  path: string,
  options: RequestInit & { maxRetries?: number } = {},
): Promise<FetchResult> {
  const maxRetries = options.maxRetries ?? 3;
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'x-request-id': randomUUID(),
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (options.body && typeof options.body === 'string') {
    headers['content-type'] = 'application/json';
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      let data: unknown;
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      const ok = response.status >= 200 && response.status < 300;

      // 429 — retry com backoff
      if (response.status === 429 && attempt < maxRetries) {
        const backoff = Math.min(1000 * 2 ** attempt, 10_000);
        console.warn(`  [429] ${path} — retry ${attempt}/${maxRetries} in ${backoff}ms`);
        await sleep(backoff);
        continue;
      }

      return { status: response.status, data, ok, statusText: response.statusText };
    } catch (error) {
      if (attempt < maxRetries) {
        const backoff = Math.min(1000 * 2 ** attempt, 10_000);
        console.warn(`  [NET] ${path} — ${error instanceof Error ? error.message : String(error)}, retry ${attempt}/${maxRetries} in ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      return { status: 0, data: null, ok: false, statusText: String(error) };
    }
  }

  return { status: 0, data: null, ok: false, statusText: 'Max retries exceeded' };
}

async function getStoreInfo(slug: string): Promise<{ productName: string; deliveryEnabled: boolean } | null> {
  const result = await apiFetch(`/api/public/zelomenu/store/${encodeURIComponent(slug)}`, { maxRetries: 2 });
  if (!result.ok || !result.data || typeof result.data !== 'object') {
    console.error(`  Failed to fetch store: ${result.status} ${JSON.stringify(result.data)}`);
    return null;
  }

  const store = result.data as {
    catalog?: Array<{
      nome?: string;
      produtosDireto?: Array<{ name?: string; available?: boolean }>;
      subcategorias?: Array<{ produtos?: Array<{ name?: string; available?: boolean }> }>;
    }>;
    business?: { deliveryEnabled?: boolean };
  };

  const deliveryEnabled = store.business?.deliveryEnabled === true;
  const catalog = store.catalog ?? [];

  // Find first available product
  for (const category of catalog) {
    const directProducts = category.produtosDireto ?? [];
    for (const product of directProducts) {
      if (product.name && product.available !== false) {
        return { productName: product.name, deliveryEnabled };
      }
    }

    const subcategories = category.subcategorias ?? [];
    for (const sub of subcategories) {
      const products = sub.produtos ?? [];
      for (const product of products) {
        if (product.name && product.available !== false) {
          return { productName: product.name, deliveryEnabled };
        }
      }
    }
  }

  console.error('  No available products found in store catalog');
  return null;
}

async function createCartSession(slug: string, productName: string): Promise<{ token: string; revision: number; ok: boolean }> {
  const result = await apiFetch(`/api/public/zelomenu/store/${encodeURIComponent(slug)}/cart`, {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productName, quantity: 1 }],
      fulfillment: { type: 'pickup' },
    }),
    maxRetries: 2,
  });

  if (!result.ok) {
    return { token: '', revision: 0, ok: false };
  }

  const data = result.data as { token?: string; revision?: number } | null;
  if (!data?.token || typeof data.revision !== 'number') {
    return { token: '', revision: 0, ok: false };
  }

  return { token: data.token, revision: data.revision, ok: true };
}

async function patchCartDelivery(
  token: string,
  revision: number,
  cep: string,
  number: string,
): Promise<CartResult> {
  const start = process.hrtime.bigint();

  const result = await apiFetch(`/api/public/zelomenu/cart/${encodeURIComponent(token)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      expectedRevision: revision,
      fulfillment: {
        type: 'delivery',
        deliveryPostalCode: cep.replace(/\D/g, ''),
        deliveryNumber: number,
      },
    }),
    maxRetries: 1,
  });

  const durationMs = elapsedMs(start);

  if (!result.ok) {
    const errData = result.data as { error?: string; detail?: string } | null;
    return {
      ok: false,
      durationMs: round2(durationMs),
      httpStatus: result.status,
      deliveryStatus: null,
      cacheLayer: null,
      errorCode: errData?.error ?? `HTTP_${result.status}`,
      errorMessage: errData?.error ?? result.statusText,
    };
  }

  const data = result.data as {
    session?: {
      fulfillment?: {
        deliveryStatus?: string;
        deliveryCacheLayer?: string;
        deliveryFee?: number;
        deliveryDistanceM?: number;
        deliveryFeeToConfirm?: boolean;
      };
    };
  } | null;

  const fulfillment = data?.session?.fulfillment;
  const deliveryStatus = fulfillment?.deliveryStatus ?? null;
  const cacheLayer = fulfillment?.deliveryCacheLayer ?? null;

  return {
    ok: true,
    durationMs: round2(durationMs),
    httpStatus: result.status,
    deliveryStatus,
    cacheLayer,
    errorCode: null,
    errorMessage: null,
  };
}

// ─── Scenario runners ─────────────────────────────────────────────────────────

async function runConcurrentQuotes(
  scenarioName: string,
  count: number,
  ceps: string[],
  baseUrl: string,
): Promise<TestReport> {
  const slug = SLUG;
  console.log(`\n[${now()}] ${scenarioName} (${count}x, ${ceps.length} CEPs diferentes)`);

  // 1. Fetch store info
  const storeInfo = await getStoreInfo(slug);
  if (!storeInfo) {
    throw new Error(`Store "${slug}" not found or has no products. Check SLUG env var.`);
  }
  console.log(`  Store: "${slug}", product: "${storeInfo.productName}", delivery: ${storeInfo.deliveryEnabled}`);

  if (!storeInfo.deliveryEnabled) {
    console.warn('  WARNING: delivery is not enabled for this store; quotes may fail.');
  }

  // 2. Create cart sessions (sequentially, rate-limit aware)
  console.log(`  Creating ${count} cart sessions...`);
  const carts: Array<{ token: string; revision: number; cep: string }> = [];
  const createStart = process.hrtime.bigint();

  for (let i = 0; i < count; i++) {
    const cep = ceps[i % ceps.length];
    const result = await createCartSession(slug, storeInfo.productName);
    if (!result.ok) {
      console.error(`  Failed to create cart ${i + 1}/${count} — will retry once`);
      await sleep(2000);
      const retry = await createCartSession(slug, storeInfo.productName);
      if (!retry.ok) {
        throw new Error(`Cannot create cart session after retry. Server may be unavailable or rate-limited.`);
      }
      carts.push({ token: retry.token, revision: retry.revision, cep });
    } else {
      carts.push({ token: result.token, revision: result.revision, cep });
    }

    if ((i + 1) % 10 === 0) {
      console.log(`  Created ${i + 1}/${count} carts`);
    }

    // Small delay between cart creations to avoid rate limit bursts
    if (i < count - 1) await sleep(150);
  }

  const createTime = elapsedMs(createStart);
  console.log(`  All carts created in ${fmtMs(createTime)}`);

  // 3. Fire PATCH requests concurrently
  console.log(`  Firing ${count} concurrent PATCH requests...`);
  const patchStart = process.hrtime.bigint();

  const results = await Promise.all(
    carts.map((cart) => patchCartDelivery(cart.token, cart.revision, cart.cep, ADDRESS_NUMBER)),
  );

  const totalTime = elapsedMs(patchStart);

  // 4. Analyze results
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const durationsMs = results.map((r) => r.durationMs).sort((a, b) => a - b);

  const statusDistribution: Record<string, number> = {};
  for (const r of results) {
    const key = r.ok ? (r.deliveryStatus ?? 'ok_no_status') : `err_${r.httpStatus}`;
    statusDistribution[key] = (statusDistribution[key] || 0) + 1;
  }

  const cacheLayerDistribution: Record<string, number> = {};
  for (const r of results) {
    if (r.cacheLayer) {
      cacheLayerDistribution[r.cacheLayer] = (cacheLayerDistribution[r.cacheLayer] || 0) + 1;
    }
  }

  const errorCodes: Record<string, number> = {};
  for (const r of results) {
    if (r.errorCode) {
      errorCodes[r.errorCode] = (errorCodes[r.errorCode] || 0) + 1;
    }
  }

  const meanMs = durationsMs.length > 0
    ? round2(durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length)
    : 0;

  console.log(`\n  ── Results (${totalTime.toFixed(0)}ms total for ${count} PATCH reqs) ──`);
  console.log(`  Success: ${succeeded}/${count} (${fmtPct(succeeded, count)})`);
  console.log(`  Failed:  ${failed}/${count} (${fmtPct(failed, count)})`);
  console.log(`  Latency:`);
  console.log(`    min:  ${fmtMs(durationsMs[0] ?? 0)}`);
  console.log(`    p50:  ${fmtMs(percentile(durationsMs, 0.5))}`);
  console.log(`    p95:  ${fmtMs(percentile(durationsMs, 0.95))}`);
  console.log(`    p99:  ${fmtMs(percentile(durationsMs, 0.99))}`);
  console.log(`    max:  ${fmtMs(durationsMs[durationsMs.length - 1] ?? 0)}`);
  console.log(`    mean: ${fmtMs(meanMs)}`);
  console.log(`  Delivery statuses:`);
  for (const [status, count] of Object.entries(statusDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${status}: ${count} (${fmtPct(count, results.length)})`);
  }
  if (Object.keys(cacheLayerDistribution).length > 0) {
    console.log(`  Cache layers:`);
    for (const [layer, count] of Object.entries(cacheLayerDistribution).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${layer}: ${count} (${fmtPct(count, results.length)})`);
    }
  }
  if (Object.keys(errorCodes).length > 0) {
    console.log(`  Error codes:`);
    for (const [code, count] of Object.entries(errorCodes).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${code}: ${count}`);
    }
  }

  return {
    timestamp: now(),
    scenario: scenarioName,
    concurrency: count,
    totalRequests: count,
    succeeded,
    failed,
    durationsMs,
    statusDistribution,
    errorCodes,
    p50Ms: round2(percentile(durationsMs, 0.5)),
    p95Ms: round2(percentile(durationsMs, 0.95)),
    p99Ms: round2(percentile(durationsMs, 0.99)),
    maxMs: round2(durationsMs[durationsMs.length - 1] ?? 0),
    minMs: round2(durationsMs[0] ?? 0),
    meanMs,
    cacheLayerDistribution,
  };
}

// ─── Scenario: Same address ───────────────────────────────────────────────────

export async function testConcurrentSameAddress(count: number, baseUrl: string): Promise<TestReport> {
  return runConcurrentQuotes(
    `Concurrent same address (${count}x)`,

    count,
    [TEST_CEPS[0]], // Same CEP for all
    baseUrl,
  );
}

// ─── Scenario: Different addresses ────────────────────────────────────────────

export async function testConcurrentDifferentAddresses(count: number, baseUrl: string): Promise<TestReport> {
  return runConcurrentQuotes(
    `Concurrent different addresses (${count}x)`,

    count,
    TEST_CEPS, // Round-robin through all CEPs
    baseUrl,
  );
}

// ─── Scenario: Provider failure / circuit breaker ─────────────────────────────

export async function testProviderFailure(baseUrl: string): Promise<TestReport> {
  const scenarioName = 'Provider failure / circuit breaker';
  const count = 30; // Enough to trip circuit breakers
  console.log(`\n[${now()}] ${scenarioName} (${count}x rapid requests)`);

  const slug = SLUG;
  const storeInfo = await getStoreInfo(slug);
  if (!storeInfo) throw new Error(`Store "${slug}" not found.`);

  // Create carts
  console.log(`  Creating ${count} cart sessions...`);
  const carts: Array<{ token: string; revision: number; cep: string }> = [];

  for (let i = 0; i < count; i++) {
    // Cycle through CEPs to hit both cache (hot CEPs) and providers (cold CEPs)
    const cep = TEST_CEPS[i % TEST_CEPS.length];
    const result = await createCartSession(slug, storeInfo.productName);
    if (!result.ok) {
      await sleep(2000);
      const retry = await createCartSession(slug, storeInfo.productName);
      if (!retry.ok) throw new Error('Cannot create cart session.');
      carts.push({ token: retry.token, revision: retry.revision, cep });
    } else {
      carts.push({ token: result.token, revision: result.revision, cep });
    }
    if (i < count - 1) await sleep(100);
  }

  // Fire all PATCH requests concurrently — some may fail, some trigger circuit breaker
  console.log(`  Firing ${count} concurrent PATCH requests (may trigger circuit breaker)...`);
  const patchStart = process.hrtime.bigint();
  const results = await Promise.all(
    carts.map((cart) => patchCartDelivery(cart.token, cart.revision, cart.cep, ADDRESS_NUMBER)),
  );
  const totalTime = elapsedMs(patchStart);

  // Analyze
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const durationsMs = results.map((r) => r.durationMs).sort((a, b) => a - b);

  const statusDistribution: Record<string, number> = {};
  for (const r of results) {
    const key = r.ok ? (r.deliveryStatus ?? 'ok_no_status') : `err_${r.httpStatus}`;
    statusDistribution[key] = (statusDistribution[key] || 0) + 1;
  }

  const cacheLayerDistribution: Record<string, number> = {};
  for (const r of results) {
    if (r.cacheLayer) {
      cacheLayerDistribution[r.cacheLayer] = (cacheLayerDistribution[r.cacheLayer] || 0) + 1;
    }
  }

  const errorCodes: Record<string, number> = {};
  for (const r of results) {
    if (r.errorCode) errorCodes[r.errorCode] = (errorCodes[r.errorCode] || 0) + 1;
  }

  // Check for server errors (500) — any means the server crashed
  const serverErrors = results.filter((r) => r.httpStatus >= 500).length;
  const rateLimited = results.filter((r) => r.httpStatus === 429).length;

  console.log(`\n  ── Results ──`);
  console.log(`  Total time: ${fmtMs(totalTime)}`);
  console.log(`  Success: ${succeeded}/${count}`);
  console.log(`  Failed:  ${failed}/${count}`);
  console.log(`  Server errors (500+): ${serverErrors}`);
  console.log(`  Rate limited (429):  ${rateLimited}`);
  console.log(`\n  ${serverErrors > 0 ? 'CRITICAL: Server returned 500 errors — check server logs!' : 'OK: No server crashes observed.'}`);
  console.log(`\n  Latency:`);
  console.log(`    min:  ${fmtMs(durationsMs[0] ?? 0)}`);
  console.log(`    p50:  ${fmtMs(percentile(durationsMs, 0.5))}`);
  console.log(`    p95:  ${fmtMs(percentile(durationsMs, 0.95))}`);
  console.log(`    p99:  ${fmtMs(percentile(durationsMs, 0.99))}`);
  console.log(`  Delivery statuses:`);
  for (const [status, count] of Object.entries(statusDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${status}: ${count} (${fmtPct(count, results.length)})`);
  }
  if (Object.keys(cacheLayerDistribution).length > 0) {
    console.log(`  Cache layers:`);
    for (const [layer, count] of Object.entries(cacheLayerDistribution)) {
      console.log(`    ${layer}: ${count}`);
    }
  }
  if (Object.keys(errorCodes).length > 0) {
    console.log(`  Error codes:`);
    for (const [code, count] of Object.entries(errorCodes)) {
      console.log(`    ${code}: ${count}`);
    }
  }

  const meanMs = durationsMs.length > 0
    ? round2(durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length)
    : 0;

  return {
    timestamp: now(),
    scenario: scenarioName,
    concurrency: count,
    totalRequests: count,
    succeeded,
    failed,
    durationsMs,
    statusDistribution,
    errorCodes,
    p50Ms: round2(percentile(durationsMs, 0.5)),
    p95Ms: round2(percentile(durationsMs, 0.95)),
    p99Ms: round2(percentile(durationsMs, 0.99)),
    maxMs: round2(durationsMs[durationsMs.length - 1] ?? 0),
    minMs: round2(durationsMs[0] ?? 0),
    meanMs,
    cacheLayerDistribution,
  };
}

// ─── Scenario: Cache behavior ────────────────────────────────────────────────

export async function testCacheBehavior(baseUrl: string): Promise<TestReport> {
  const scenarioName = 'Cache behavior (cold → hot)';
  const cep = TEST_CEPS[0];
  const number = ADDRESS_NUMBER;
  console.log(`\n[${now()}] ${scenarioName} (CEP: ${cep}, number: ${number})`);

  const slug = SLUG;
  const storeInfo = await getStoreInfo(slug);
  if (!storeInfo) throw new Error(`Store "${slug}" not found.`);

  const results: CartResult[] = [];
  const rounds = 3; // Cold + 2 warm

  for (let round = 1; round <= rounds; round++) {
    const label = round === 1 ? 'COLD (first request)' : `WARM #${round - 1} (cache expected)`;
    console.log(`  ${label}...`);

    // Create a fresh cart for each round (can't reuse same cart due to revision locking)
    const cart = await createCartSession(slug, storeInfo.productName);
    if (!cart.ok) {
      await sleep(2000);
      const retry = await createCartSession(slug, storeInfo.productName);
      if (!retry.ok) throw new Error('Cannot create cart session.');
      const result = await patchCartDelivery(retry.token, retry.revision, cep, number);
      results.push(result);
    } else {
      const result = await patchCartDelivery(cart.token, cart.revision, cep, number);
      results.push(result);
    }

    const r = results[results.length - 1];
    console.log(`    → ${r.ok ? 'OK' : 'FAIL'} (${fmtMs(r.durationMs)}, status: ${r.deliveryStatus ?? 'N/A'}, cache: ${r.cacheLayer ?? 'N/A'})`);

    // Small delay between rounds
    if (round < rounds) await sleep(500);
  }

  const durationsMs = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const cold = results[0];
  const warmResults = results.slice(1);

  // Analyze
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  const cacheLayerDistribution: Record<string, number> = {};
  for (const r of results) {
    if (r.cacheLayer) cacheLayerDistribution[r.cacheLayer] = (cacheLayerDistribution[r.cacheLayer] || 0) + 1;
  }

  const statusDistribution: Record<string, number> = {};
  for (const r of results) {
    const key = r.ok ? (r.deliveryStatus ?? 'ok_no_status') : `err_${r.httpStatus}`;
    statusDistribution[key] = (statusDistribution[key] || 0) + 1;
  }

  const errorCodes: Record<string, number> = {};
  for (const r of results) {
    if (r.errorCode) errorCodes[r.errorCode] = (errorCodes[r.errorCode] || 0) + 1;
  }

  console.log(`\n  ── Cache Analysis ──`);
  console.log(`  Cold:  ${cold.ok ? 'OK' : 'FAIL'} — ${fmtMs(cold.durationMs)}, cache: ${cold.cacheLayer ?? 'none'}, status: ${cold.deliveryStatus ?? 'N/A'}`);
  for (let i = 0; i < warmResults.length; i++) {
    const w = warmResults[i];
    const improvement = cold.durationMs > 0
      ? ((1 - w.durationMs / cold.durationMs) * 100).toFixed(1)
      : 'N/A';
    console.log(`  Warm #${i + 1}: ${w.ok ? 'OK' : 'FAIL'} — ${fmtMs(w.durationMs)} (${improvement}% vs cold), cache: ${w.cacheLayer ?? 'none'}, status: ${w.deliveryStatus ?? 'N/A'}`);
  }

  if (warmResults.length > 0) {
    const avgWarm = warmResults.reduce((a, r) => a + r.durationMs, 0) / warmResults.length;
    const improvement = cold.durationMs > 0
      ? ((1 - avgWarm / cold.durationMs) * 100).toFixed(1)
      : 'N/A';
    console.log(`\n  Average warm latency: ${fmtMs(avgWarm)} (${improvement}% vs cold)`);
    const cacheHitRate = warmResults.filter((r) => r.cacheLayer && r.cacheLayer !== 'provider').length;
    console.log(`  Cache hit rate: ${cacheHitRate}/${warmResults.length} (${fmtPct(cacheHitRate, warmResults.length)})`);
  }

  const meanMs = durationsMs.length > 0
    ? round2(durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length)
    : 0;

  return {
    timestamp: now(),
    scenario: scenarioName,
    concurrency: 1,
    totalRequests: results.length,
    succeeded,
    failed,
    durationsMs,
    statusDistribution,
    errorCodes,
    p50Ms: round2(percentile(durationsMs, 0.5)),
    p95Ms: round2(percentile(durationsMs, 0.95)),
    p99Ms: round2(percentile(durationsMs, 0.99)),
    maxMs: round2(durationsMs[durationsMs.length - 1] ?? 0),
    minMs: round2(durationsMs[0] ?? 0),
    meanMs,
    cacheLayerDistribution,
  };
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function printSummary(reports: TestReport[]): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  LOAD TEST SUMMARY — ${now()}`);
  console.log(`  Target: ${BASE_URL}/api/public/zelomenu/cart/:token`);
  console.log(`  Store:  ${SLUG}`);
  console.log(`${'═'.repeat(60)}`);

  for (const report of reports) {
    console.log(`\n  ${report.scenario}`);
    console.log(`  ${'─'.repeat(50)}`);
    console.log(`    Requests:    ${report.totalRequests}`);
    console.log(`    Succeeded:   ${report.succeeded} (${fmtPct(report.succeeded, report.totalRequests)})`);
    console.log(`    Failed:      ${report.failed} (${fmtPct(report.failed, report.totalRequests)})`);
    console.log(`    Latency (ms):`);
    console.log(`      min:  ${fmtMs(report.minMs)}`);
    console.log(`      p50:  ${fmtMs(report.p50Ms)}`);
    console.log(`      p95:  ${fmtMs(report.p95Ms)}`);
    console.log(`      p99:  ${fmtMs(report.p99Ms)}`);
    console.log(`      max:  ${fmtMs(report.maxMs)}`);
    console.log(`      mean: ${fmtMs(report.meanMs)}`);

    if (Object.keys(report.cacheLayerDistribution).length > 0) {
      const layers = Object.entries(report.cacheLayerDistribution)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      console.log(`    Cache layers: ${layers}`);
    }

    if (Object.keys(report.errorCodes).length > 0) {
      const errors = Object.entries(report.errorCodes)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      console.log(`    Errors: ${errors}`);
    }
  }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!SLUG) {
    console.error(`
ERROR: SLUG environment variable is required.
Usage:
  SLUG=loja-teste npx tsx loadtest/delivery-quote-load.ts [options]

Options:
  --all                   Run all scenarios (default)
  --same-address          Test concurrent requests with same CEP
  --different-addresses   Test concurrent requests with different CEPs
  --provider-failure      Test circuit breaker / contingency
  --cache-behavior        Test cache cold → warm
  --concurrent=<N>        Number of concurrent requests (default: 10)
    `);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const concurrentArg = args.find((a) => a.startsWith('--concurrent='));
  const CONCURRENT = concurrentArg ? parseInt(concurrentArg.split('=')[1], 10) : 10;
  const addressNumberArg = args.find((a) => a.startsWith('--address-number='));
  if (addressNumberArg) ADDRESS_NUMBER = addressNumberArg.slice('--address-number='.length).trim() || ADDRESS_NUMBER;
  const cepsArg = args.find((a) => a.startsWith('--ceps='));
  if (cepsArg) {
    const configuredCeps = cepsArg
      .slice('--ceps='.length)
      .split(',')
      .map((cep) => cep.trim())
      .filter(Boolean);
    if (configuredCeps.length > 0) TEST_CEPS = configuredCeps;
  }

  if (/^https:\/\/menu\.zelopdv\.com\.br\/?$/i.test(BASE_URL) && process.env.LOADTEST_ALLOW_PRODUCTION !== 'true') {
    console.error('Refusing to run load test against production. Set LOADTEST_ALLOW_PRODUCTION=true only with explicit approval.');
    process.exit(1);
  }

  const scenarios = args.length === 0 || args.includes('--all')
    ? ['--same-address', '--different-addresses', '--provider-failure', '--cache-behavior']
    : args.filter((a) => a.startsWith('--')
      && !a.startsWith('--concurrent=')
      && !a.startsWith('--ceps=')
      && !a.startsWith('--address-number=')
      && a !== '--all');

  console.log(`${'═'.repeat(60)}`);
  console.log(`  ZELOMENU DELIVERY QUOTE LOAD TEST`);
  console.log(`  ${now()}`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Store:  ${SLUG}`);
  console.log(`  Concurrent: ${CONCURRENT}`);
  console.log(`  CEPs:   ${TEST_CEPS.length} available`);
  console.log(`${'═'.repeat(60)}`);

  // Check server availability
  const healthCheck = await apiFetch('/api/public/zelomenu/delivery/cep', {
    method: 'POST',
    body: JSON.stringify({ cep: TEST_CEPS[0] }),
    maxRetries: 1,
  });

  if (!healthCheck.ok && healthCheck.status === 0) {
    console.error(`\nERROR: Server at ${BASE_URL} is not responding.`);
    console.error(`Make sure the dev server is running (npm run dev:all or npm run dev:server).`);
    process.exit(1);
  }

  console.log(`\n Server is reachable. Starting scenarios...\n`);

  const reports: TestReport[] = [];

  if (scenarios.includes('--same-address')) {
    reports.push(await testConcurrentSameAddress(CONCURRENT, BASE_URL));
  }

  if (scenarios.includes('--different-addresses')) {
    reports.push(await testConcurrentDifferentAddresses(CONCURRENT, BASE_URL));
  }

  if (scenarios.includes('--provider-failure')) {
    reports.push(await testProviderFailure(BASE_URL));
  }

  if (scenarios.includes('--cache-behavior')) {
    reports.push(await testCacheBehavior(BASE_URL));
  }

  if (reports.length > 0) {
    printSummary(reports);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Load test complete.`);
  console.log(`${'═'.repeat(60)}\n`);
}

// Allow running directly or importing
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith('delivery-quote-load.ts') ||
    process.argv[1].endsWith('delivery-quote-load.js') ||
    process.argv[1].replace(/\\/g, '/').endsWith('loadtest/delivery-quote-load'));

if (isMainModule) {
  main().catch((error) => {
    console.error('\nFATAL:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
