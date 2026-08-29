import { describe, expect, it } from 'vitest';
import { makeInternalCatalogRateLimitKey } from './internalCatalogRateLimit';

describe('makeInternalCatalogRateLimitKey', () => {
  it('separa a quota de empresas diferentes, mesmo atrás do mesmo IP do ZeloChat', () => {
    expect(makeInternalCatalogRateLimitKey('empresa-a', '127.0.0.1')).not.toBe(makeInternalCatalogRateLimitKey('empresa-b', '127.0.0.1'));
  });
});
