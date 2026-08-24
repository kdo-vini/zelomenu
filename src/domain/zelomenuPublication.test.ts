import { describe, it, expect } from 'vitest';
import {
  resolveZeloMenuLinkedOptionAvailability,
  getZeloMenuPublicationStatus,
  type ZeloMenuPublicationProduct,
} from './zelomenuPublication';

describe('resolveZeloMenuLinkedOptionAvailability', () => {
  it('stock-controlled product with stock is available', () => {
    expect(resolveZeloMenuLinkedOptionAvailability({ controlar_estoque: true, estoque_atual: 5 })).toBe(true);
  });

  it('stock-controlled product with zero stock is unavailable', () => {
    expect(resolveZeloMenuLinkedOptionAvailability({ controlar_estoque: true, estoque_atual: 0 })).toBe(false);
  });

  it('stock-controlled product with negative stock is unavailable', () => {
    expect(resolveZeloMenuLinkedOptionAvailability({ controlar_estoque: true, estoque_atual: -1 })).toBe(false);
  });

  it('does not require stock when stock control is disabled', () => {
    expect(resolveZeloMenuLinkedOptionAvailability({ controlar_estoque: false, estoque_atual: 0 })).toBe(true);
  });

  it('keeps an unpublished product available as a component regardless of PDV visibility', () => {
    const unpublished: ZeloMenuPublicationProduct = {
      id: 196,
      nome: 'Penne',
      id_categoria: 52,
      controlar_estoque: false,
      estoque_atual: 0,
      ocultar_no_pdv: true,
      publication: {
        id_produto: 196,
        nome_publico: null,
        descricao_publica: null,
        foto_url: null,
        visivel_online: false,
        pausado_manualmente: true,
        ordem: 0,
      },
    };
    expect(getZeloMenuPublicationStatus(unpublished).status).not.toBe('published');
    expect(resolveZeloMenuLinkedOptionAvailability(unpublished)).toBe(true);
  });

  it('keeps linked components available when they are hidden only in the PDV', () => {
    expect(resolveZeloMenuLinkedOptionAvailability({
      controlar_estoque: false,
      estoque_atual: 0,
      ocultar_no_pdv: true,
    })).toBe(true);
  });

  it('does not let PDV visibility pause a published ZeloMenu product', () => {
    expect(getZeloMenuPublicationStatus({
      id: 850,
      nome: 'Bife a rolê',
      id_categoria: 106,
      controlar_estoque: false,
      estoque_atual: 0,
      ocultar_no_pdv: true,
      publication: {
        id_produto: 850,
        nome_publico: null,
        descricao_publica: null,
        foto_url: null,
        visivel_online: true,
        pausado_manualmente: false,
        ordem: 0,
      },
    })).toMatchObject({ status: 'published', label: 'Publicado' });
  });
});
