import { describe, it, expect } from 'vitest';
import {
  buildPixBrCode,
  crc16ccitt,
  isValidPixKeyForType,
  normalizePixKey,
} from './pixBrCode';

// TLV helper duplicated here (not imported from pixBrCode.ts) so the
// "expected" payloads below are built independently of the module under
// test — if buildPixBrCode ever mis-orders fields or miscounts a length,
// this comparison catches it.
function tlv(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, '0')}${value}`;
}

function expectedBrCode(params: {
  key: string;
  merchantName: string;
  merchantCity: string;
  amount: string;
  txid: string;
}): string {
  const merchantAccountInfo = tlv('00', 'br.gov.bcb.pix') + tlv('01', params.key);
  const additionalData = tlv('05', params.txid);
  const body =
    tlv('00', '01') +
    tlv('01', '11') +
    tlv('26', merchantAccountInfo) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('54', params.amount) +
    tlv('58', 'BR') +
    tlv('59', params.merchantName) +
    tlv('60', params.merchantCity) +
    tlv('62', additionalData) +
    '6304';
  return body + crc16ccitt(body);
}

describe('crc16ccitt', () => {
  it('bate com o vetor de referência padrão do CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF)', () => {
    // Vetor de checagem canônico do algoritmo (catálogo CRC RevEng):
    // crc16ccitt("123456789") === 0x29B1. É o mesmo algoritmo usado pelo
    // BACEN no campo 63 do BR Code do Pix.
    expect(crc16ccitt('123456789')).toBe('29B1');
  });

  it('devolve sempre 4 caracteres hexadecimais em maiúsculo', () => {
    expect(crc16ccitt('')).toMatch(/^[0-9A-F]{4}$/);
    expect(crc16ccitt('abc')).toMatch(/^[0-9A-F]{4}$/);
  });
});

describe('normalizePixKey', () => {
  it('cpf: mantém só os dígitos', () => {
    expect(normalizePixKey('123.456.789-09', 'cpf')).toBe('12345678909');
  });

  it('cnpj: mantém só os dígitos', () => {
    expect(normalizePixKey('12.345.678/0001-95', 'cnpj')).toBe('12345678000195');
  });

  it('phone: 11 dígitos crus (sem 55) ganham o prefixo +55', () => {
    expect(normalizePixKey('11987654321', 'phone')).toBe('+5511987654321');
  });

  it('phone: já vem com 55 ou +55 e não duplica o prefixo', () => {
    expect(normalizePixKey('+5511987654321', 'phone')).toBe('+5511987654321');
    expect(normalizePixKey('5511987654321', 'phone')).toBe('+5511987654321');
  });

  it('phone: remove pontuação/espacos antes de normalizar', () => {
    expect(normalizePixKey('(11) 98765-4321', 'phone')).toBe('+5511987654321');
  });

  it('email: trim + minúsculo', () => {
    expect(normalizePixKey('  Fulano@Example.COM  ', 'email')).toBe('fulano@example.com');
  });

  it('random: mantém a chave como está (só trim)', () => {
    expect(normalizePixKey('  123e4567-e89b-12d3-a456-426614174000  ', 'random'))
      .toBe('123e4567-e89b-12d3-a456-426614174000');
  });
});

describe('isValidPixKeyForType', () => {
  it('cpf: exige exatamente 11 dígitos', () => {
    expect(isValidPixKeyForType('123.456.789-09', 'cpf')).toBe(true);
    expect(isValidPixKeyForType('123456789', 'cpf')).toBe(false);
    expect(isValidPixKeyForType('123456789012', 'cpf')).toBe(false);
  });

  it('cnpj: exige exatamente 14 dígitos', () => {
    expect(isValidPixKeyForType('12.345.678/0001-95', 'cnpj')).toBe(true);
    expect(isValidPixKeyForType('1234567800019', 'cnpj')).toBe(false);
  });

  it('phone: exige +55 e 10 ou 11 dígitos depois do DDI', () => {
    expect(isValidPixKeyForType('11987654321', 'phone')).toBe(true); // celular com 9º dígito
    expect(isValidPixKeyForType('1132345678', 'phone')).toBe(true); // fixo sem 9º dígito
    expect(isValidPixKeyForType('123', 'phone')).toBe(false);
    expect(isValidPixKeyForType('123456789012345', 'phone')).toBe(false);
  });

  it('email: exige um formato básico de e-mail', () => {
    expect(isValidPixKeyForType('fulano@example.com', 'email')).toBe(true);
    expect(isValidPixKeyForType('fulano@', 'email')).toBe(false);
    expect(isValidPixKeyForType('fulano', 'email')).toBe(false);
  });

  it('random: exige formato de UUID', () => {
    expect(isValidPixKeyForType('123e4567-e89b-12d3-a456-426614174000', 'random')).toBe(true);
    expect(isValidPixKeyForType('não-é-um-uuid', 'random')).toBe(false);
    expect(isValidPixKeyForType('123e4567e89b12d3a456426614174000', 'random')).toBe(false);
  });
});

describe('buildPixBrCode', () => {
  it('monta o BR Code para chave cpf, campo a campo (comparação byte a byte)', () => {
    const result = buildPixBrCode({
      key: '123.456.789-09',
      keyType: 'cpf',
      merchantName: 'Restaurante Bom Sabor',
      merchantCity: 'São Paulo',
      amount: 49.9,
    });
    const expected = expectedBrCode({
      key: '12345678909',
      merchantName: 'RESTAURANTE BOM SABOR',
      merchantCity: 'SAO PAULO',
      amount: '49.90',
      txid: '***',
    });
    expect(result).toBe(expected);
  });

  it('monta o BR Code para chave cnpj', () => {
    const result = buildPixBrCode({
      key: '12.345.678/0001-95',
      keyType: 'cnpj',
      merchantName: 'Padaria Trigo Dourado',
      merchantCity: 'Recife',
      amount: 12.5,
    });
    const expected = expectedBrCode({
      key: '12345678000195',
      merchantName: 'PADARIA TRIGO DOURADO',
      merchantCity: 'RECIFE',
      amount: '12.50',
      txid: '***',
    });
    expect(result).toBe(expected);
  });

  it('monta o BR Code para chave phone (celular)', () => {
    const result = buildPixBrCode({
      key: '(11) 98765-4321',
      keyType: 'phone',
      merchantName: 'Lanchonete da Esquina',
      merchantCity: 'Belo Horizonte',
      amount: 35,
    });
    const expected = expectedBrCode({
      key: '+5511987654321',
      merchantName: 'LANCHONETE DA ESQUINA',
      merchantCity: 'BELO HORIZONTE',
      amount: '35.00',
      txid: '***',
    });
    expect(result).toBe(expected);
  });

  it('monta o BR Code para chave email', () => {
    const result = buildPixBrCode({
      key: '  Loja@Exemplo.COM  ',
      keyType: 'email',
      merchantName: 'Loja Exemplo',
      merchantCity: 'Curitiba',
      amount: 100,
    });
    const expected = expectedBrCode({
      key: 'loja@exemplo.com',
      merchantName: 'LOJA EXEMPLO',
      merchantCity: 'CURITIBA',
      amount: '100.00',
      txid: '***',
    });
    expect(result).toBe(expected);
  });

  it('monta o BR Code para chave aleatória (EVP/UUID)', () => {
    const result = buildPixBrCode({
      key: '123e4567-e89b-12d3-a456-426614174000',
      keyType: 'random',
      merchantName: 'Doceria Ponto Doce',
      merchantCity: 'Salvador',
      amount: 7.25,
    });
    const expected = expectedBrCode({
      key: '123e4567-e89b-12d3-a456-426614174000',
      merchantName: 'DOCERIA PONTO DOCE',
      merchantCity: 'SALVADOR',
      amount: '7.25',
      txid: '***',
    });
    expect(result).toBe(expected);
  });

  it('aplica ascii-fold + maiúsculo e recorta nome (25) e cidade (15) nos limites do EMV', () => {
    const result = buildPixBrCode({
      key: 'loja@exemplo.com',
      keyType: 'email',
      merchantName: 'Restaurante e Confeitaria São José Ltda',
      merchantCity: 'São José dos Campos',
      amount: 20,
    });
    // Nome sem acento e maiúsculo: "RESTAURANTE E CONFEITARIA SAO JOSE LTDA"
    // (39 chars) -> recorta para os 25 primeiros: "RESTAURANTE E CONFEITARIA".
    // Cidade: "SAO JOSE DOS CAMPOS" (19 chars) -> recorta para 15: "SAO JOSE DOS CA".
    expect(result).toBe(expectedBrCode({
      key: 'loja@exemplo.com',
      merchantName: 'RESTAURANTE E CONFEITARIA',
      merchantCity: 'SAO JOSE DOS CA',
      amount: '20.00',
      txid: '***',
    }));
  });

  it('usa fallback LOJA / BRASIL quando nome ou cidade vêm vazios', () => {
    const result = buildPixBrCode({
      key: 'loja@exemplo.com',
      keyType: 'email',
      merchantName: '   ',
      merchantCity: '',
      amount: 20,
    });
    expect(result).toBe(expectedBrCode({
      key: 'loja@exemplo.com',
      merchantName: 'LOJA',
      merchantCity: 'BRASIL',
      amount: '20.00',
      txid: '***',
    }));
  });

  it('usa txid *** por padrão quando não informado', () => {
    const result = buildPixBrCode({
      key: 'loja@exemplo.com',
      keyType: 'email',
      merchantName: 'Loja',
      merchantCity: 'Recife',
      amount: 5,
    });
    expect(result).toContain('0503***');
  });

  it('respeita um txid customizado quando informado', () => {
    const result = buildPixBrCode({
      key: 'loja@exemplo.com',
      keyType: 'email',
      merchantName: 'Loja',
      merchantCity: 'Recife',
      amount: 5,
      txid: 'PEDIDO123',
    });
    expect(result).toContain('0509PEDIDO123');
  });

  it('o CRC final bate com o CRC calculado sobre o restante do payload', () => {
    const result = buildPixBrCode({
      key: 'loja@exemplo.com',
      keyType: 'email',
      merchantName: 'Loja',
      merchantCity: 'Recife',
      amount: 10,
    });
    const withoutCrc = result.slice(0, -4);
    const crc = result.slice(-4);
    expect(crc).toBe(crc16ccitt(withoutCrc));
    expect(withoutCrc.endsWith('6304')).toBe(true);
  });

  it('lança erro para valor zero ou negativo (dinheiro: nunca gera código sem valor válido)', () => {
    const base = { key: 'loja@exemplo.com', keyType: 'email' as const, merchantName: 'Loja', merchantCity: 'Recife' };
    expect(() => buildPixBrCode({ ...base, amount: 0 })).toThrow();
    expect(() => buildPixBrCode({ ...base, amount: -10 })).toThrow();
    expect(() => buildPixBrCode({ ...base, amount: NaN })).toThrow();
  });
});
