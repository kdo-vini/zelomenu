import { describe, expect, it } from 'vitest';
import { makeCoarseInternalCatalogRateLimitKey, makeInternalCatalogRateLimitKey } from './internalCatalogRateLimit';

describe('makeInternalCatalogRateLimitKey', () => {
  it('separa a quota de empresas diferentes, mesmo atrás do mesmo IP do ZeloChat', () => {
    expect(makeInternalCatalogRateLimitKey('empresa-a', '127.0.0.1')).not.toBe(makeInternalCatalogRateLimitKey('empresa-b', '127.0.0.1'));
  });

  it('mantém uma chave coarse por origem para cobrir autenticação e payload inválidos antes da quota da empresa', () => {
    expect(makeCoarseInternalCatalogRateLimitKey('127.0.0.1')).toBe('127.0.0.1');
  });
});
