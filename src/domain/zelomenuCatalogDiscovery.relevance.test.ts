import { describe, expect, it } from 'vitest';
import type { CatalogCategoriaGroup, CatalogProduct } from '../../server/configStore';
import { searchCatalogDiscovery } from './zelomenuCatalogDiscovery';

/**
 * Conjunto de avaliação da relevância da busca.
 *
 * As consultas são mensagens REAIS de clientes da Bem Servido (2026-09-09) e o
 * catálogo reproduz os produtos que decidem cada caso — inclusive a descrição
 * de "Batata frita com cheddar e bacon", que contém a palavra "vc" e por causa
 * dela era o único produto a pontuar para "vc pode mandar o cardapio?".
 *
 * Esta suíte existe porque ranking sem medição é chute: a primeira tentativa de
 * reescrita ficou PIOR que o algoritmo antigo (10/16 contra 12/16) e só dava
 * para saber rodando. Ao mexer no ranking, rode isto antes de publicar.
 */
function product(overrides: Partial<CatalogProduct> & Pick<CatalogProduct, 'id' | 'name'>): CatalogProduct {
  return { price: 20, basePrice: 20, available: true, modifierGroups: [], ...overrides };
}

const catalog: CatalogCategoriaGroup[] = [
  {
    nome: 'Porção',
    produtosDireto: [product({
      id: 1403,
      name: 'Batata frita com cheddar e bacon',
      price: 49.9,
      basePrice: 49.9,
      description: 'Para os amantes de cheddar essa porção vai surpreender vc com a cobertura do nosso molho cheddar, adicionando o bacon fritinho.',
    })],
    subcategorias: [],
  },
  {
    nome: 'Caldos',
    produtosDireto: [],
    subcategorias: [{
      nome: 'Caldos artesanais',
      produtos: [
        product({ id: 210, name: 'Caldo de mocotó', price: 18.99, basePrice: 18.99 }),
        product({ id: 211, name: 'Caldo verde', price: 17.99, basePrice: 17.99 }),
        product({ id: 212, name: 'Caldo de canjiquinha', price: 19.99, basePrice: 19.99 }),
      ],
    }],
  },
  {
    nome: 'Massas',
    produtosDireto: [
      product({ id: 500, name: 'Macarrão com legumes 500 ml', price: 27.99, basePrice: 27.99 }),
      product({ id: 501, name: 'Lasanha 500 g', price: 32.99, basePrice: 32.99 }),
      product({
        id: 1007,
        name: 'Monte sua massa',
        price: 22,
        basePrice: 22,
        modifierGroups: [{
          id: 'massa', productId: 1007, name: 'Escolha a massa', kind: 'variacao', pricingMode: 'substituir',
          minSelections: 1, maxSelections: 1, minTotalQuantity: 0, maxTotalQuantity: null,
          allowsQuantity: false, maxPerOption: null, active: true, order: 0,
          options: [
            { id: 'penne', name: 'Penne', priceDelta: 22, active: true, order: 0 },
            { id: 'talharim', name: 'Talharim', priceDelta: 22, active: true, order: 1 },
          ],
        }],
      }),
    ],
    subcategorias: [],
  },
  {
    nome: 'Marmitas',
    produtosDireto: [
      product({ id: 879, name: 'Marmita do dia', price: 18, basePrice: 18 }),
      product({ id: 880, name: 'Marmita de dobradinha', price: 26.99, basePrice: 26.99 }),
    ],
    subcategorias: [],
  },
  {
    nome: 'Pratos',
    produtosDireto: [product({ id: 700, name: 'Escondidinho de carne seca 500 ml', price: 36.9, basePrice: 36.9 })],
    subcategorias: [],
  },
];

const namesFor = (query: string) => [
  ...new Set(searchCatalogDiscovery({ empresaId: 'bem-servido', query, limit: 12, catalog }).results.map((c) => c.publicName)),
];

describe('relevância da busca do cardápio', () => {
  describe('frase de conversa não vira produto', () => {
    // Todas estas responderam com prato no WhatsApp de produção.
    it.each([
      ['vc pode mandar o cardapio?', 'a palavra "vc" está na descrição da batata frita'],
      ['Gostaria do cardápio por favorn', 'com erro de digitação em "favor"'],
      ['Depois me manda ó cardápio , fazendo favor', '"depois" e "fazendo" não cabem em lista fechada'],
      ['Entregar na creche do bela vista', 'endereço, não pedido'],
      ['Vou pagar por pix', 'forma de pagamento'],
      ['Pedir por aqui', 'rótulo do nosso próprio botão'],
      ['quanto tempo demora', 'pergunta operacional'],
    ])('%s não retorna nada (%s)', (query) => {
      expect(namesFor(query)).toEqual([]);
    });

    it('"do" em nome de produto não casa com "do" da frase', () => {
      // "Marmita do dia" contém "do". Antes isso bastava para a frase
      // "Gostaria do cardápio" pontuar 1,00 nesse produto.
      expect(namesFor('Gostaria do cardápio')).toEqual([]);
    });
  });

  describe('item que o cliente nomeia é encontrado', () => {
    it('encontra pelo plural', () => {
      expect(namesFor('tem caldos hj?')).toEqual(expect.arrayContaining(['Caldo verde', 'Caldo de mocotó']));
    });

    it('encontra uma opção dentro do produto montável', () => {
      expect(namesFor('quero um penne')).toEqual(['Monte sua massa']);
    });

    it('ignora o enquadramento e busca o que foi nomeado', () => {
      expect(namesFor('cardapio do macarrao')).toContain('Macarrão com legumes 500 ml');
    });

    it('não confunde item ausente com item parecido', () => {
      expect(namesFor('tem sushi?')).toEqual([]);
    });
  });

  describe('erro de digitação', () => {
    it('letra faltando é resolvida por trigrama', () => {
      expect(namesFor('macarao')).toContain('Macarrão com legumes 500 ml');
    });

    it('letra trocada no miolo é resolvida por distância de edição', () => {
      // Trigrama dá só 0,45 entre "marmyta" e "marmita" — abaixo do piso.
      expect(namesFor('marmyta')).toEqual(expect.arrayContaining(['Marmita do dia']));
    });

    it('palavra que não se parece com nada do cardápio continua sem resposta', () => {
      expect(namesFor('estrogonofe')).toEqual([]);
    });
  });

  describe('nota reflete a cobertura da consulta', () => {
    it('o nome exato cobre a consulta inteira', () => {
      const [best] = searchCatalogDiscovery({ empresaId: 'bem-servido', query: 'caldo verde', limit: 12, catalog }).results;
      expect(best.publicName).toBe('Caldo verde');
      expect(best.confidence).toBe(1);
    });

    it('acerto só na descrição não passa do piso', () => {
      // "cheddar" está no nome E na descrição da 1403, então ela responde;
      // "amantes", que só existe na descrição, não é resposta sozinho.
      expect(namesFor('cheddar')).toEqual(['Batata frita com cheddar e bacon']);
      expect(namesFor('amantes')).toEqual([]);
    });
  });
});
