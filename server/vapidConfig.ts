import { createECDH } from 'node:crypto';

const BASE64_URL_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

function cleanKey(value: string | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  const unquoted = trimmed.replace(/^("|')(.*)\1$/s, '$2').trim();
  const withoutPadding = unquoted.replace(/=+$/, '');
  return withoutPadding || null;
}

function isBase64UrlKey(value: string | null, expectedBytes: number): value is string {
  if (!value || !BASE64_URL_KEY_PATTERN.test(value)) return false;
  return Buffer.from(value, 'base64url').length === expectedBytes;
}

function isMatchingKeyPair(publicKey: string | null, privateKey: string | null): boolean {
  if (!isBase64UrlKey(publicKey, 65) || !isBase64UrlKey(privateKey, 32)) return false;

  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    return ecdh.getPublicKey(undefined, 'uncompressed').equals(Buffer.from(publicKey, 'base64url'));
  } catch {
    return false;
  }
}

export function getVapidConfig(): {
  publicKey: string | null;
  privateKey: string | null;
  subject: string;
  publicKeyValid: boolean;
  privateKeyValid: boolean;
  keyPairValid: boolean;
} {
  const publicKey = cleanKey(process.env.VAPID_PUBLIC_KEY) ?? cleanKey(process.env.VITE_VAPID_PUBLIC_KEY);
  const privateKey = cleanKey(process.env.VAPID_PRIVATE_KEY) ?? cleanKey(process.env.VITE_VAPID_PRIVATE_KEY);
  const publicKeyBytes = publicKey ? Buffer.from(publicKey, 'base64url') : null;

  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT?.trim() || 'mailto:contato@zelopdv.com.br',
    publicKeyValid: isBase64UrlKey(publicKey, 65) && publicKeyBytes?.[0] === 4,
    privateKeyValid: isBase64UrlKey(privateKey, 32),
    keyPairValid: isMatchingKeyPair(publicKey, privateKey),
  };
}
