const UUID_JID_SUFFIX = /@(s\.whatsapp\.net|c\.us)$/;

/** Canonical WhatsApp JID accepted by the conversational ordering boundary. */
export function isConversationRemoteJid(value: string): boolean {
  if (typeof value !== 'string') return false;
  const match = value.match(UUID_JID_SUFFIX);
  if (!match) return false;
  const digits = value.slice(0, value.indexOf('@'));
  if (!/^\d+$/.test(digits)) return false;
  if (digits.length === 10 || digits.length === 11) return true;
  return digits.startsWith('55') && (digits.length === 12 || digits.length === 13);
}

/**
 * Derives the order customer phone from the already scoped JID. The caller's
 * customer snapshot is deliberately not part of this authority boundary.
 */
export function deriveConversationCustomerPhone(remoteJid: string): string {
  if (!isConversationRemoteJid(remoteJid)) throw new Error('CONVERSATION_JID_INVALID');
  const digits = remoteJid.slice(0, remoteJid.indexOf('@'));
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
}
