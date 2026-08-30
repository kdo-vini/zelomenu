import { describe, expect, it } from 'vitest';
import { deriveConversationConfirmationToken, hashConversationConfirmationToken } from './conversationConfirmationToken';

const binding = {
  empresaId: '10000000-0000-4000-8000-000000000001',
  remoteJid: '5511999999999@s.whatsapp.net',
  sessionId: '20000000-0000-4000-8000-000000000001',
  revision: 3,
  expiresAt: '2026-08-30T12:10:00.000Z',
};

describe('token de confirmação conversacional', () => {
  it('é opaco e determinístico para qualquer réplica com o mesmo binding', () => {
    const first = deriveConversationConfirmationToken('segredo-dedicado-com-mais-de-32-caracteres', binding);
    const otherReplica = deriveConversationConfirmationToken('segredo-dedicado-com-mais-de-32-caracteres', { ...binding });
    expect(first).toBe(otherReplica);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashConversationConfirmationToken(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['empresaId', '10000000-0000-4000-8000-000000000002'],
    ['remoteJid', '5511888888888@s.whatsapp.net'],
    ['sessionId', '20000000-0000-4000-8000-000000000002'],
    ['revision', 4],
    ['expiresAt', '2026-08-30T12:11:00.000Z'],
  ] as const)('muda quando o binding %s muda', (field, value) => {
    const original = deriveConversationConfirmationToken('segredo-dedicado-com-mais-de-32-caracteres', binding);
    const changed = deriveConversationConfirmationToken('segredo-dedicado-com-mais-de-32-caracteres', { ...binding, [field]: value });
    expect(changed).not.toBe(original);
  });
});
