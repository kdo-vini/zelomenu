import { describe, expect, it } from 'vitest';
import { toWhatsAppNumber } from './whatsappOrder';

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
