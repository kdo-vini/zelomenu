import { describe, expect, it } from 'vitest';
import { toWhatsAppNumber, buildWhatsAppOrderMessage, buildWhatsAppOrderLink } from './whatsappOrder';

describe('toWhatsAppNumber', () => {
  it('normaliza número com máscara (sem DDI) para 55 + nacional', () => {
    expect(toWhatsAppNumber('(11) 99999-9999')).toBe('5511999999999');
  });

  it('normaliza número só com dígitos de 11 e 10', () => {
    expect(toWhatsAppNumber('11999999999')).toBe('5511999999999');
    expect(toWhatsAppNumber('1133334444')).toBe('551133334444');
  });

  it('mantém DDI 55 já presente', () => {
    expect(toWhatsAppNumber('5511999999999')).toBe('5511999999999');
    expect(toWhatsAppNumber('+55 (11) 99999-9999')).toBe('5511999999999');
  });

  it('remove prefixo internacional 00', () => {
    expect(toWhatsAppNumber('005511999999999')).toBe('5511999999999');
  });

  it('rejeita números inválidos e vazios', () => {
    expect(toWhatsAppNumber('123')).toBeNull();
    expect(toWhatsAppNumber('55123')).toBeNull();
    expect(toWhatsAppNumber('')).toBeNull();
    expect(toWhatsAppNumber(null)).toBeNull();
    expect(toWhatsAppNumber(undefined)).toBeNull();
  });
});

describe('buildWhatsAppOrderMessage', () => {
  const base = {
    orderId: 'a1b2c3d4e5',
    customerName: 'João Silva',
    items: [
      { name: 'Coxinha', quantity: 2, lineTotal: 12 },
      { name: 'Refrigerante lata', quantity: 1, lineTotal: 6 },
    ],
    subtotal: 18,
    total: 18,
    feeToConfirm: false,
    isDelivery: false,
    whenLabel: 'o quanto antes',
    observations: 'sem cebola',
  };

  it('monta retirada com nome, itens, total e observações', () => {
    const msg = buildWhatsAppOrderMessage(base);
    expect(msg).toContain('Pedido #A1B2C3D4');
    expect(msg).toContain('Cliente: João Silva');
    expect(msg).toContain('• 2x Coxinha');
    expect(msg).toContain('• 1x Refrigerante lata');
    expect(msg).toContain('Total:');
    expect(msg).toContain('Retirada · o quanto antes');
    expect(msg).toContain('Obs.: sem cebola');
    expect(msg).not.toContain('Endereço:');
  });

  it('omite a linha de cliente quando não há nome', () => {
    const msg = buildWhatsAppOrderMessage({ ...base, customerName: null });
    expect(msg).not.toContain('Cliente:');
  });

  it('mostra subtotal + entrega a confirmar quando feeToConfirm', () => {
    const msg = buildWhatsAppOrderMessage({ ...base, feeToConfirm: true });
    expect(msg).toContain('Subtotal:');
    expect(msg).toContain('entrega a confirmar');
    expect(msg).not.toContain('Total:');
  });

  it('inclui endereço e bairro em delivery', () => {
    const msg = buildWhatsAppOrderMessage({
      ...base,
      isDelivery: true,
      whenLabel: 'hoje às 20:00',
      deliveryAddress: 'Rua X, 100',
      deliveryNeighborhood: 'Centro',
    });
    expect(msg).toContain('Entrega · hoje às 20:00');
    expect(msg).toContain('Endereço: Rua X, 100, Centro');
  });
});

describe('buildWhatsAppOrderLink', () => {
  it('monta link wa.me com a mensagem codificada', () => {
    const link = buildWhatsAppOrderLink('5511999999999', 'Olá loja');
    expect(link).toBe('https://wa.me/5511999999999?text=Ol%C3%A1%20loja');
  });
});
