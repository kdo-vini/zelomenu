// Helpers puros para o botão "Enviar pedido no WhatsApp".
// Sem dependências de React/DB — compartilhado entre cliente e servidor.

/**
 * Normaliza um telefone brasileiro para o formato aceito pelo wa.me:
 * só dígitos, com DDI 55. Espelha normalizeBrazilianPhone do ZeloPDV.
 * Retorna null quando não dá para formar um número válido.
 */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  let digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) {
    const national = digits.slice(2);
    if (national.length === 10 || national.length === 11) return `55${national}`;
    return null;
  }
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}
