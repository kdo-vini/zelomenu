import { describe, expect, it } from 'vitest';
import { FAQ_ENTRIES, searchFaqEntries } from '../data/supportFaq';
import { buildSupportWhatsAppLink, SUPPORT_WHATSAPP_NUMBER } from './support';

describe('searchFaqEntries', () => {
  it('matches accents and keywords without hiding the full FAQ by default', () => {
    expect(searchFaqEntries(FAQ_ENTRIES, '').length).toBe(FAQ_ENTRIES.length);
    expect(searchFaqEntries(FAQ_ENTRIES, 'preco')[0]?.id).toBe('edit-price');
  });

  it('respects the selected category', () => {
    expect(searchFaqEntries(FAQ_ENTRIES, '', 'images').every((entry) => entry.category === 'images')).toBe(true);
  });
});

describe('buildSupportWhatsAppLink', () => {
  it('creates a reviewable support message with context', () => {
    const link = buildSupportWhatsAppLink({
      topic: 'Preço não atualiza',
      impact: 'Não consigo concluir uma tarefa',
      screen: 'Cardápio',
      faqQuestion: 'Salvei o preço, mas a alteração não apareceu.',
      businessName: 'Bistrô Teste',
      message: 'O produto continua mostrando o valor antigo depois de atualizar.',
    });
    const url = new URL(link);

    expect(url.hostname).toBe('wa.me');
    expect(url.pathname).toBe(`/${SUPPORT_WHATSAPP_NUMBER}`);
    expect(url.searchParams.get('text')).toContain('Assunto: Preço não atualiza');
    expect(url.searchParams.get('text')).toContain('FAQ consultado: Salvei o preço, mas a alteração não apareceu.');
    expect(url.searchParams.get('text')).toContain('Descrição:');
  });

  it('does not include an empty business name', () => {
    const link = buildSupportWhatsAppLink({
      topic: 'Dúvida',
      impact: 'Tenho uma dúvida',
      screen: 'Ajuda e suporte',
      message: 'Preciso entender esta configuração.',
      businessName: '  ',
    });

    expect(new URL(link).searchParams.get('text')).not.toContain('Estabelecimento:');
  });
});
