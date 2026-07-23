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

export type WhatsAppOrderItem = {
  name: string;
  quantity: number;
  lineTotal: number;
};

export type WhatsAppOrderInput = {
  orderId: string;
  customerName: string | null;
  customerPhone?: string | null;
  items: WhatsAppOrderItem[];
  subtotal: number;
  total: number;
  deliveryFee?: number;
  feeToConfirm: boolean;
  discount?: number;
  couponCode?: string | null;
  paymentMethod?: string | null;
  isDelivery: boolean;
  whenLabel: string;
  deliveryAddress?: string | null;
  deliveryNeighborhood?: string | null;
  observations?: string | null;
};

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function buildWhatsAppOrderMessage(input: WhatsAppOrderInput): string {
  const lines: string[] = [];

  lines.push('Olá! Segue meu pedido pelo cardápio digital.');
  lines.push('');

  // ── Order info ──
  lines.push(`Pedido #${input.orderId.slice(0, 8).toUpperCase()}`);
  const name = input.customerName?.trim();
  if (name) lines.push(`Cliente: ${name}`);
  const phone = input.customerPhone?.trim();
  if (phone) lines.push(`Telefone: ${phone}`);
  lines.push('');

  // ── Items ──
  for (const item of input.items) {
    lines.push(`${item.quantity}x ${item.name} — ${formatBRL(item.lineTotal)}`);
  }
  lines.push('');

  // ── Pricing breakdown ──
  lines.push(`Subtotal: ${formatBRL(input.subtotal)}`);
  if (input.isDelivery && input.deliveryFee != null && !input.feeToConfirm) {
    lines.push(`Entrega: ${formatBRL(input.deliveryFee)}`);
  }
  if (input.isDelivery && input.feeToConfirm) {
    lines.push('entrega a confirmar');
  }
  const discount = input.discount ?? 0;
  if (discount > 0) {
    const couponTag = input.couponCode?.trim() ? ` (${input.couponCode.trim()})` : '';
    lines.push(`Desconto${couponTag}: -${formatBRL(discount)}`);
  }
  if (!input.feeToConfirm) {
    lines.push(`Total: ${formatBRL(input.total)}`);
  }
  lines.push(`${input.isDelivery ? 'Entrega' : 'Retirada'} · ${input.whenLabel}`);

  const address = input.deliveryAddress?.trim();
  if (input.isDelivery && address) {
    const bairro = input.deliveryNeighborhood?.trim();
    lines.push(`Endereço: ${address}${bairro ? `, ${bairro}` : ''}`);
  }

  const payment = input.paymentMethod?.trim();
  if (payment) lines.push(`Pagamento: ${payment}`);

  const obs = input.observations?.trim();
  if (obs) lines.push(`Obs.: ${obs}`);

  // ── Footer ──
  lines.push('');
  lines.push('───');
  lines.push('📱 zelopdv.com.br');
  lines.push('Sistema Zelo Menu');

  return lines.join('\n');
}

export function buildWhatsAppOrderLink(whatsapp: string, message: string): string {
  return `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`;
}
