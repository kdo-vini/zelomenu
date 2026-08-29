import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export function makeInternalCatalogRateLimitKey(empresaId: string, ip: string): string {
  return `${empresaId}:${ip}`;
}

export function makeCoarseInternalCatalogRateLimitKey(ip: string): string {
  return ip;
}

export function createInternalCatalogCoarseLimiter() {
  return rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => makeCoarseInternalCatalogRateLimitKey(ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? 'unknown')),
    handler: (_req, res) => res.status(429).json({
      error: 'MUITAS_REQUISICOES',
      detail: 'Muitas tentativas em pouco tempo. Tente novamente em instantes.',
      requestId: res.locals.requestId,
    }),
  });
}
