import { describe, expect, it } from 'vitest';
import { makeCoarseInternalCatalogRateLimitKey, makeInternalCatalogRateLimitKey } from './internalCatalogRateLimit';

describe('makeInternalCatalogRateLimitKey', () => {
  it('separa a quota de empresas diferentes, mesmo atrás do mesmo IP do ZeloChat', () => {
    expect(makeInternalCatalogRateLimitKey('empresa-a', '127.0.0.1')).not.toBe(makeInternalCatalogRateLimitKey('empresa-b', '127.0.0.1'));
  });

  it('mantém uma chave coarse por IP quando nenhuma empresa é informada (chave inválida / auth)', () => {
    expect(makeCoarseInternalCatalogRateLimitKey('127.0.0.1')).toBe('127.0.0.1');
    expect(makeCoarseInternalCatalogRateLimitKey('127.0.0.1', null)).toBe('127.0.0.1');
    expect(makeCoarseInternalCatalogRateLimitKey('127.0.0.1', undefined)).toBe('127.0.0.1');
  });

  it('separa a chave coarse por empresa quando informada, com IP como desempate/fallback (CT#10)', () => {
    const withEmpresaA = makeCoarseInternalCatalogRateLimitKey('127.0.0.1', 'empresa-a');
    const withEmpresaB = makeCoarseInternalCatalogRateLimitKey('127.0.0.1', 'empresa-b');
    expect(withEmpresaA).not.toBe(withEmpresaB);
    expect(withEmpresaA).not.toBe(makeCoarseInternalCatalogRateLimitKey('127.0.0.1'));
  });
});
