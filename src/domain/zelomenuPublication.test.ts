import { describe, it, expect } from 'vitest';
import {
  resolveZeloMenuLinkedOptionAvailability,
  getZeloMenuPublicationStatus,
  type ZeloMenuPublicationProduct,
} from './zelomenuPublication';

describe('resolveZeloMenuLinkedOptionAvailability', () => {
  it('stock-controlled product with stock → available', () => {
    expect(resolveZeloMenuLinkedOptionAvailability({ controlar_estoque: true, estoque_atual: 5 })).toBe(true);
  });

  it('stock-controlled product with zero stock → unavailable', () => {
    expect(resolveZeloMenuLinkedOptionAvailability({ controlar_estoque: true, estoque_atual: 0 })).toBe(false);
  });

  it('stock-controlled product with negative stock → unavailable', () => {
    expect(resolveZeloMenuLinkedOptionAvailability({ controlar_estoque: true, estoque_atual: -1 })).toBe(false);
  });

  it('stock not controlled → always available regardless of estoque_atual', () => {
    expect(resolveZeloMenuLinkedOptionAvailability({ controlar_estoque: false, estoque_atual: 0 })).toBe(true);
  });

  it('ignores publication/visibility fields entirely — only accepts stock fields, so an unpublished product cannot influence this check by construction', () => {
    // A product with visivel_online=false / pausado_manualmente=true / ocultar_no_pdv=true
    // would report status 'unpublished'/'paused'/'hidden' via getZeloMenuPublicationStatus,
    // but must still be usable as a linked combo ingredient as long as it has stock.
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
    expect(
      resolveZeloMenuLinkedOptionAvailability({
        controlar_estoque: unpublished.controlar_estoque,
        estoque_atual: unpublished.estoque_atual,
      }),
    ).toBe(true);
  });
});
