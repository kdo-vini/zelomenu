import { describe, expect, it } from 'vitest';
import { hasValidInternalCatalogKey } from './internalCatalogAuth';

describe('hasValidInternalCatalogKey', () => {
  it('falha fechada quando a chave dedicada não está configurada', () => {
    expect(hasValidInternalCatalogKey('qualquer-chave', '')).toBe(false);
    expect(hasValidInternalCatalogKey(undefined, undefined)).toBe(false);
  });

  it('aceita somente a chave exata, inclusive quando o tamanho informado diverge', () => {
    expect(hasValidInternalCatalogKey('chave-correta', 'chave-correta')).toBe(true);
    expect(hasValidInternalCatalogKey('chave-curta', 'chave-correta')).toBe(false);
    expect(hasValidInternalCatalogKey('chave-correta-extra', 'chave-correta')).toBe(false);
  });
});
