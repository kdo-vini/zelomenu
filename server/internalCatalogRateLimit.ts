import { ipKeyGenerator } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { hasValidInternalCatalogKey } from './internalCatalogAuth.js';

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
  isInternalKeyValid?: (provided: unknown) => boolean;
};

/**
 * Failure-only coarse guard. Invalid internal keys reserve a failure immediately
 * so concurrent unauthorized requests cannot evade the limit. Valid requests
 * only register a failure after their final status, so successful searches never
 * compete globally, even under bursts.
 */
export function createInternalCatalogFailureLimiter({
  maxFailures = 30,
  windowMs = 60_000,
  now = Date.now,
  isInternalKeyValid = hasValidInternalCatalogKey,
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
    const failures = activeFailures(key, currentTime);
    if (failures.length >= maxFailures) {
      res.status(429).json({
        error: 'MUITAS_REQUISICOES',
        detail: 'Muitas tentativas em pouco tempo. Tente novamente em instantes.',
        requestId: res.locals.requestId,
      });
      return;
    }

    const keyIsValid = isInternalKeyValid(req.header('x-zelo-internal-key'));
    res.locals.internalCatalogKeyValid = keyIsValid;
    if (!keyIsValid) {
      // Reserve atomically before the 401 handler runs. Concurrent invalid
      // requests cannot all pass the check, and this branch never double-counts
      // on finish.
      failures.push(currentTime);
      failuresByKey.set(key, failures);
      next();
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
