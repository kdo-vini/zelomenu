import { ipKeyGenerator } from 'express-rate-limit';
import type { RequestHandler } from 'express';

export function makeInternalCatalogRateLimitKey(empresaId: string, ip: string): string {
  return `${empresaId}:${ip}`;
}

export function makeCoarseInternalCatalogRateLimitKey(ip: string): string {
  return ip;
}

export type InternalCatalogFailureLimiterOptions = {
  maxFailures?: number;
  windowMs?: number;
  now?: () => number;
};

/**
 * Failure-only coarse guard. It never reserves quota while a valid request is
 * in flight: successful searches do not compete globally, even under bursts.
 * Failures are stored per origin only after the response status is final.
 */
export function createInternalCatalogFailureLimiter({
  maxFailures = 30,
  windowMs = 60_000,
  now = Date.now,
}: InternalCatalogFailureLimiterOptions = {}): RequestHandler {
  const failuresByKey = new Map<string, number[]>();
  let accessCount = 0;

  const activeFailures = (key: string, currentTime: number): number[] => {
    const cutoff = currentTime - windowMs;
    const current = (failuresByKey.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (current.length === 0) failuresByKey.delete(key);
    else failuresByKey.set(key, current);
    return current;
  };

  const cleanupExpired = (currentTime: number): void => {
    accessCount += 1;
    if (accessCount % 64 !== 0) return;
    for (const key of failuresByKey.keys()) activeFailures(key, currentTime);
  };

  return (req, res, next) => {
    const currentTime = now();
    cleanupExpired(currentTime);
    const key = makeCoarseInternalCatalogRateLimitKey(ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? 'unknown'));
    if (activeFailures(key, currentTime).length >= maxFailures) {
      res.status(429).json({
        error: 'MUITAS_REQUISICOES',
        detail: 'Muitas tentativas em pouco tempo. Tente novamente em instantes.',
        requestId: res.locals.requestId,
      });
      return;
    }

    res.once('finish', () => {
      if (res.statusCode < 400) return;
      const completedAt = now();
      const failures = activeFailures(key, completedAt);
      failures.push(completedAt);
      failuresByKey.set(key, failures);
    });
    next();
  };
}
