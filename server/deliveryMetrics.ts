// Simple in-memory metrics collector for delivery operations.
// Exposes counters via GET /metrics endpoint for Prometheus scraping or manual
// inspection. No external dependencies — data resets on process restart.

const counters = new Map<string, number>();
const latencies: number[] = [];
const maxLatencySample = 1000;

function inc(name: string): void {
  counters.set(name, (counters.get(name) ?? 0) + 1);
}

export function recordQuote(status: string): void {
  inc(`delivery_quote_total:${status}`);
}

export function recordCacheHit(layer: string): void {
  inc(`delivery_cache_hit:${layer}`);
}

export function recordProviderCall(provider: string, result: 'success' | 'failure' | 'timeout' | 'fallback'): void {
  inc(`delivery_provider:${provider}:${result}`);
}

export function recordLatency(ms: number): void {
  latencies.push(ms);
  if (latencies.length > maxLatencySample) latencies.shift();
}

export function recordCircuitBreaker(state: 'open' | 'closed' | 'half-open'): void {
  counters.set(`delivery_circuit:${state}`, 1);
}

export function recordBlockedCheckout(): void {
  inc('delivery_blocked_checkout');
}

export function snapshot(): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [k, v] of counters) out[k] = v;

  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    out.delivery_quote_latency_ms_p50 = percentile(sorted, 0.5);
    out.delivery_quote_latency_ms_p95 = percentile(sorted, 0.95);
    out.delivery_quote_latency_ms_p99 = percentile(sorted, 0.99);
    out.delivery_quote_latency_ms_count = latencies.length;
  }

  return out;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

export function reset(): void {
  counters.clear();
  latencies.length = 0;
}
