import { describe, expect, it } from 'vitest';
import { deriveConversationCustomerPhone, isConversationRemoteJid } from './conversationOrderingIdentity';

describe('identidade da conversa', () => {
  it.each([
    ['5511999999999@s.whatsapp.net', '5511999999999'],
    ['11999999999@c.us', '5511999999999'],
    ['5511999999999@c.us', '5511999999999'],
    ['1133334444@s.whatsapp.net', '551133334444'],
    ['551133334444@c.us', '551133334444'],
    ['55113334444@c.us', '5555113334444'],
  ])('deriva o telefone canônico de %s', (jid, phone) => {
    expect(isConversationRemoteJid(jid)).toBe(true);
    expect(deriveConversationCustomerPhone(jid)).toBe(phone);
  });

  it.each(['5511999999999@outro', '123@c.us', '551199999999999@c.us', '551133344@c.us'])('rejeita JID inválido %s', (jid) => {
    expect(isConversationRemoteJid(jid)).toBe(false);
    expect(() => deriveConversationCustomerPhone(jid)).toThrow('CONVERSATION_JID_INVALID');
  });
});
