// ZeloMenu — Pix Copia e Cola (BR Code EMV) com valor por pedido (FONTE ÚNICA, node-free).
//
// Monta o payload EMV/TLV do BR Code estático do Pix, conforme o "Manual de
// Padrões para Iniciação do Pix" do BACEN. Zero dependência nova — CRC16 e
// TLV são feitos à mão e travados por testes com vetores conhecidos (é
// dinheiro: um byte errado aqui e o banco rejeita o pagamento).
//
// Uso: server/zelomenuCartSessions.ts chama buildPixBrCode() com o total
// TRAVADO da sessão (session.pricing.total) para montar o copia-e-cola
// mostrado ao cliente na tela de pedido confirmado.

export type PixKeyType = 'cpf' | 'cnpj' | 'phone' | 'email' | 'random';

/** Lista canônica dos tipos válidos — usada pelos três lugares do servidor
 * (configStore, zelomenuCartSessions, index) que precisam validar um
 * `pixKeyType` vindo de JSON/DB antes de tratá-lo como `PixKeyType`. */
export const PIX_KEY_TYPES: readonly PixKeyType[] = ['cpf', 'cnpj', 'phone', 'email', 'random'];

export function isPixKeyType(value: unknown): value is PixKeyType {
  return typeof value === 'string' && (PIX_KEY_TYPES as readonly string[]).includes(value);
}

const PHONE_E164_BR = /^\+55\d{10,11}$/;
const EMAIL_BASIC = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RANDOM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normaliza a chave Pix conforme o tipo declarado pelo merchant (sem chute —
 * a ambiguidade dos 11 dígitos crus, cpf x celular, é resolvida pelo tipo).
 */
export function normalizePixKey(key: string, type: PixKeyType): string {
  const trimmed = (key ?? '').trim();
  switch (type) {
    case 'cpf':
    case 'cnpj':
      return trimmed.replace(/\D/g, '');
    case 'phone': {
      const digits = trimmed.replace(/\D/g, '');
      if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
        return `+${digits}`;
      }
      return `+55${digits}`;
    }
    case 'email':
      return trimmed.toLowerCase();
    case 'random':
      return trimmed;
    default:
      return trimmed;
  }
}

/** Valida o formato da chave já normalizada para o tipo declarado. */
export function isValidPixKeyForType(key: string, type: PixKeyType): boolean {
  const normalized = normalizePixKey(key, type);
  switch (type) {
    case 'cpf':
      return /^\d{11}$/.test(normalized);
    case 'cnpj':
      return /^\d{14}$/.test(normalized);
    case 'phone':
      return PHONE_E164_BR.test(normalized);
    case 'email':
      return EMAIL_BASIC.test(normalized);
    case 'random':
      return RANDOM_UUID.test(normalized);
    default:
      return false;
  }
}

// ─── EMV / TLV ──────────────────────────────────────────────────────────────

function tlv(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, '0')}${value}`;
}

/** Remove acentos, mantém só ASCII imprimível e coloca em maiúsculo — regra
 * do BACEN para os campos "Nome do recebedor" (59) e "Cidade" (60). */
function foldAscii(value: string): string {
  // NFD separa a letra base do diacrítico (ex.: "é" → "e" + acento
  // combinante); o strip de não-ASCII abaixo já derruba tanto o diacrítico
  // quanto qualquer outro caractere fora do intervalo imprimível ASCII.
  return value
    .normalize('NFD')
    .replace(/[^\x20-\x7E]/g, '')
    .toUpperCase()
    .trim();
}

/**
 * CRC16-CCITT (poly 0x1021, init 0xFFFF, sem reflexão, xorout 0) — o mesmo
 * algoritmo usado pelo campo 63 do BR Code do Pix. Vetor de checagem padrão
 * ("123456789" → 0x29B1) travado em pixBrCode.test.ts.
 */
export function crc16ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildPixBrCode(input: {
  key: string;
  keyType: PixKeyType;
  merchantName: string;
  merchantCity: string;
  amount: number; // em reais, > 0
  txid?: string; // default '***'
}): string {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('PIX_AMOUNT_INVALID');
  }

  const normalizedKey = normalizePixKey(input.key, input.keyType);
  const merchantAccountInfo = tlv('00', 'br.gov.bcb.pix') + tlv('01', normalizedKey);
  const merchantName = foldAscii(input.merchantName || 'LOJA').slice(0, 25) || 'LOJA';
  const merchantCity = foldAscii(input.merchantCity || 'BRASIL').slice(0, 15) || 'BRASIL';
  const txid = foldAscii(input.txid ?? '***').slice(0, 25) || '***';
  const amount = input.amount.toFixed(2);

  const additionalData = tlv('05', txid);

  const payloadWithoutCrc =
    tlv('00', '01') +
    tlv('01', '11') +
    tlv('26', merchantAccountInfo) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('54', amount) +
    tlv('58', 'BR') +
    tlv('59', merchantName) +
    tlv('60', merchantCity) +
    tlv('62', additionalData) +
    '6304';

  return payloadWithoutCrc + crc16ccitt(payloadWithoutCrc);
}
