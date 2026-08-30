import { createHash, createHmac } from 'node:crypto';

export type ConversationConfirmationBinding = {
  empresaId: string;
  remoteJid: string;
  sessionId: string;
  revision: number;
  expiresAt: string;
};

/** Opaque and deterministic across replicas; only its SHA-256 crosses the DB seam. */
export function deriveConversationConfirmationToken(secret: string, binding: ConversationConfirmationBinding): string {
  return createHmac('sha256', secret)
    .update(binding.empresaId)
    .update('\u0000')
    .update(binding.remoteJid)
    .update('\u0000')
    .update(binding.sessionId)
    .update('\u0000')
    .update(String(binding.revision))
    .update('\u0000')
    .update(binding.expiresAt)
    .digest('base64url');
}

export function hashConversationConfirmationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
