export const SUPPORT_WHATSAPP_NUMBER = '5514991537503';

export type SupportWhatsAppInput = {
  topic: string;
  impact: string;
  screen: string;
  message: string;
  faqQuestion?: string;
  businessName?: string;
};

export function buildSupportWhatsAppLink(input: SupportWhatsAppInput): string {
  const lines = [
    'Olá, preciso de ajuda com o ZeloMenu.',
    '',
    `Assunto: ${input.topic}`,
    `Impacto: ${input.impact}`,
    `Tela: ${input.screen}`,
    input.faqQuestion ? `FAQ consultado: ${input.faqQuestion}` : 'FAQ consultado: nenhum',
    input.businessName?.trim() ? `Estabelecimento: ${input.businessName.trim()}` : null,
    '',
    'Descrição:',
    input.message.trim(),
  ].filter((line): line is string => line !== null);

  const url = new URL(`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`);
  url.searchParams.set('text', lines.join('\n'));
  return url.toString();
}
