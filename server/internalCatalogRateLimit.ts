import { ipKeyGenerator } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import { hasValidInternalCatalogKey } from './internalCatalogAuth.js';
import { internalOrderingErrorCode } from './internalOrderingErrorCodes.js';

export function makeInternalCatalogRateLimitKey(empresaId: string, ip: string): string {
  return `${empresaId}:${ip}`;
}

// Same permissive shape internalCatalogSearch.ts validates empresaId against
// (looser than ordering's strict UUID, whose format is a subset of this one).
// This is only ever used to build a rate-limit bucket key, never trusted as
// an identifier — it just keeps a hostile/garbage value from blowing up the
// key space or injecting into the key format.
const EMPRESA_ID_KEY_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * A CT#10-fix helper: pulls a plausible empresaId out of the request body or
 * query string, IF one is present and well-shaped. Only ever called from the
 * post-parse stage below, once body parsing has actually run — an
 * unauthenticated caller's claimed empresaId must never be trusted for
 * keying, since that would let it spread a flood of invalid-key attempts
 * across many buckets and evade the limiter entirely (the pre-parse stage
 * never calls this).
 */
export function empresaIdForRateLimitKey(req: Pick<Request, 'body' | 'query'>): string | null {
  const bodyValue = (req.body as { empresaId?: unknown } | undefined)?.empresaId;
  if (typeof bodyValue === 'string' && EMPRESA_ID_KEY_SHAPE.test(bodyValue)) return bodyValue;
  const queryValue = (req.query as { empresaId?: unknown } | undefined)?.empresaId;
  if (typeof queryValue === 'string' && EMPRESA_ID_KEY_SHAPE.test(queryValue)) return queryValue;
  return null;
}

export function makeCoarseInternalCatalogRateLimitKey(ip: string, empresaId?: string | null): string {
  return empresaId ? `${empresaId}:${ip}` : ip;
}

export type InternalCatalogFailureLimiterOptions = {
  maxFailures?: number;
  maxFailuresPerIp?: number;
  windowMs?: number;
  now?: () => number;
  isInternalKeyValid?: (provided: unknown) => boolean;
};

export type InternalCatalogFailureLimiter = {
  /**
   * Mount BEFORE body parsing, exactly like today. Reserves a failure
   * immediately (IP-only — see CT#10 note above) for an invalid internal key,
   * and blocks with 429 once the IP-only bucket is exhausted. Never reads
   * req.body/req.query — they are not populated yet at this point.
   */
  preParse: RequestHandler;
  /**
   * Mount AFTER body parsing (and after its JSON-error/oversized-payload
   * handling), before the real route handler. Only acts when the pre-parse
   * stage already marked the internal key valid. This is where CT#10 is
   * actually fixed: it checks and later records failures in a bucket keyed
   * by the caller's own empresaId (falling back to IP when none is present
   * or well-shaped), so one tenant's guaranteed 4xx traffic can no longer
   * throttle a different tenant sharing the same egress IP.
   */
  postParse: RequestHandler;
  /**
   * Call from the JSON-parse-error middleware (malformed JSON / oversized
   * payload) when `res.locals.internalCatalogKeyValid === true` — those
   * requests throw before `postParse` ever runs (Express routes a body-parser
   * error straight to the next error-handling middleware, skipping every
   * regular middleware in between), so without this call they would never be
   * counted at all. There is no empresaId to key by (the body never parsed),
   * so this always records an IP-only failure — consistent with "IP-only for
   * requests with no/invalid empresaId".
   */
  recordAuthenticatedParseFailure: (req: Parameters<RequestHandler>[0]) => void;
};

/**
 * Two-tier failure-only guard. Authenticated, parsed failures count against
 * both a per-empresa bucket (so one tenant does not normally throttle another)
 * and a broader per-IP ceiling (so a shared-key holder cannot evade the guard
 * by cycling caller-supplied empresaIds). Invalid keys and unparseable bodies
 * remain IP-only. Whichever applicable tier is exhausted first wins.
 * Successful requests never register a failure in either stage.
 */
export function createInternalCatalogFailureLimiter({
  maxFailures = 30,
  maxFailuresPerIp = 30,
  windowMs = 60_000,
  now = Date.now,
  isInternalKeyValid = hasValidInternalCatalogKey,
}: InternalCatalogFailureLimiterOptions = {}): InternalCatalogFailureLimiter {
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

  const ipOf = (req: Parameters<RequestHandler>[0]): string => (
    ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? 'unknown')
  );

  const preParse: RequestHandler = (req, res, next) => {
    const currentTime = now();
    cleanupExpired(currentTime);
    const ip = ipOf(req);
    const unauthenticatedKey = makeCoarseInternalCatalogRateLimitKey(ip);
    const failures = activeFailures(unauthenticatedKey, currentTime);
    const keyIsValid = isInternalKeyValid(req.header('x-zelo-internal-key'));
    const ipLimit = keyIsValid ? maxFailuresPerIp : maxFailures;
    if (failures.length >= ipLimit) {
      res.status(429).json({
        error: internalOrderingErrorCode('MUITAS_REQUISICOES'),
        detail: 'Muitas tentativas em pouco tempo. Tente novamente em instantes.',
        requestId: res.locals.requestId,
      });
      return;
    }

    res.locals.internalCatalogKeyValid = keyIsValid;
    if (!keyIsValid) {
      // Reserve atomically before the 401 handler runs. Concurrent invalid
      // requests cannot all pass the check, and this branch never double-counts
      // on finish.
      failures.push(currentTime);
      failuresByKey.set(unauthenticatedKey, failures);
    }
    next();
  };

  const postParse: RequestHandler = (req, res, next) => {
    if (res.locals.internalCatalogKeyValid !== true) {
      // Either an invalid key (already reserved/handled pre-parse) or a
      // malformed/oversized body that never reached this stage at all
      // (Express routes those straight to the JSON error middleware).
      next();
      return;
    }
    const currentTime = now();
    const ip = ipOf(req);
    const empresaId = empresaIdForRateLimitKey(req);
    const key = makeCoarseInternalCatalogRateLimitKey(ip, empresaId);
    const companyFailures = activeFailures(key, currentTime);
    const ipFailures = activeFailures(ip, currentTime);
    if (companyFailures.length >= maxFailures || ipFailures.length >= maxFailuresPerIp) {
      res.status(429).json({
        error: internalOrderingErrorCode('MUITAS_REQUISICOES'),
        detail: 'Muitas tentativas em pouco tempo. Tente novamente em instantes.',
        requestId: res.locals.requestId,
      });
      return;
    }
    res.once('finish', () => {
      if (res.statusCode < 400) return;
      const completedAt = now();
      const completedCompanyFailures = activeFailures(key, completedAt);
      completedCompanyFailures.push(completedAt);
      failuresByKey.set(key, completedCompanyFailures);
      if (key !== ip) {
        const completedIpFailures = activeFailures(ip, completedAt);
        completedIpFailures.push(completedAt);
        failuresByKey.set(ip, completedIpFailures);
      }
    });
    next();
  };

  const recordAuthenticatedParseFailure = (req: Parameters<RequestHandler>[0]): void => {
    const currentTime = now();
    const ip = ipOf(req);
    const key = makeCoarseInternalCatalogRateLimitKey(ip);
    const failures = activeFailures(key, currentTime);
    failures.push(currentTime);
    failuresByKey.set(key, failures);
  };

  return { preParse, postParse, recordAuthenticatedParseFailure };
}
