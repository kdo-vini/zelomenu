import { createHash, timingSafeEqual } from 'node:crypto';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Compares fixed-size digests so a wrong-length header does not bypass the constant-time comparison. */
export function hasValidInternalCatalogKey(provided: unknown, configured = process.env.ZELO_INTERNAL_API_KEY): boolean {
  if (typeof configured !== 'string' || configured.length === 0 || typeof provided !== 'string') return false;
  return timingSafeEqual(digest(provided), digest(configured));
}
