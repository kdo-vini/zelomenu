const PUSH_CLIENT_ID_KEY = 'zelomenu.push.client-id';
const PUSH_ENABLED_KEY = 'zelomenu.push.enabled';
const PUSH_PUBLIC_KEY_KEY = 'zelomenu.push.public-key';

type PushConfig = { enabled: boolean; publicKey: string | null; error?: string | null };

function getClientId(): string {
  if (typeof window === 'undefined') return '';
  const existing = window.localStorage.getItem(PUSH_CLIENT_ID_KEY);
  if (existing) return existing;
  const next = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(PUSH_CLIENT_ID_KEY, next);
  return next;
}

export function getPushClientId(): string {
  return getClientId();
}

function supportsPush(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('A chave pública VAPID contém caracteres inválidos.');
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const decoded = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  if (decoded.length !== 65 || decoded[0] !== 4) {
    throw new Error('A chave pública VAPID não tem o formato esperado.');
  }
  return decoded;
}

function getApplicationServerKey(value: string): ArrayBuffer {
  const bytes = decodeBase64Url(value);
  return (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function normalizePublicKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const unquoted = trimmed.replace(/^("|')(.*)\1$/s, '$2').trim();
  const withoutPadding = unquoted.replace(/=+$/, '');
  if (!withoutPadding) return null;

  try {
    decodeBase64Url(withoutPadding);
    return withoutPadding;
  } catch {
    return null;
  }
}

async function getPushConfig(): Promise<PushConfig> {
  const response = await fetch('/api/public/push/config', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Não foi possível verificar as notificações.');
  const body = await response.json() as { enabled?: unknown; publicKey?: unknown; error?: unknown };
  const publicKey = normalizePublicKey(body.publicKey);
  return {
    enabled: body.enabled === true && Boolean(publicKey),
    publicKey,
    error: typeof body.error === 'string' ? body.error : null,
  };
}

async function getPushServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return await navigator.serviceWorker.ready;
  } catch (error) {
    throw new Error('Não foi possível carregar o service worker das notificações. Confirme que /sw.js está publicado e tente novamente.', { cause: error });
  }
}

function getPushConfigurationError(config: PushConfig): string {
  if (config.error === 'VAPID_KEYS_MISSING') {
    return 'As VAPID keys não foram carregadas pelo servidor. Configure VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY no ambiente de execução do Dokploy e faça um novo deploy.';
  }
  if (config.error === 'VAPID_PUBLIC_KEY_INVALID') {
    return 'A VAPID_PUBLIC_KEY do servidor é inválida. Cole a chave pública completa, sem espaços ou quebras de linha.';
  }
  if (config.error === 'VAPID_PRIVATE_KEY_INVALID') {
    return 'A VAPID_PRIVATE_KEY do servidor é inválida. Confira se ela tem 32 bytes e pertence ao mesmo par da chave pública.';
  }
  if (config.error === 'VAPID_KEY_PAIR_INVALID') {
    return 'As VAPID keys do servidor não pertencem ao mesmo par. Gere ou copie novamente a chave pública e a privada juntas.';
  }
  return 'As notificações ainda não estão configuradas neste ambiente.';
}

export function isPushSupported(): boolean {
  return supportsPush();
}

export async function getPushStatus(): Promise<'unsupported' | 'disabled' | 'enabled' | 'blocked'> {
  if (!supportsPush()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const config = await getPushConfig();
  if (!config.enabled || !config.publicKey) return 'disabled';
  const registration = await getPushServiceWorkerRegistration();
  const subscription = await registration.pushManager.getSubscription();
  const registeredKey = window.localStorage.getItem(PUSH_PUBLIC_KEY_KEY);
  return subscription && registeredKey === config.publicKey ? 'enabled' : 'disabled';
}

export async function enablePushNotifications(options: { orderId?: string; cartToken?: string } = {}): Promise<void> {
  if (!supportsPush()) throw new Error('Este navegador não oferece notificações push.');

  const config = await getPushConfig();
  if (!config.enabled || !config.publicKey) {
    throw new Error(getPushConfigurationError(config));
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permissão para notificações não concedida.');

  const registration = await getPushServiceWorkerRegistration();
  let subscription = await registration.pushManager.getSubscription();
  const registeredKey = window.localStorage.getItem(PUSH_PUBLIC_KEY_KEY);
  if (subscription && registeredKey !== config.publicKey) {
    await subscription.unsubscribe().catch(() => undefined);
    subscription = null;
  }

  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: getApplicationServerKey(config.publicKey),
      });
    } catch (error) {
      await registration.update().catch(() => undefined);
      throw new Error(getSubscriptionErrorMessage(error), { cause: error });
    }
  }

  const response = await fetch('/api/public/push/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      clientId: getClientId(),
      subscription: subscription.toJSON(),
      orderId: options.orderId ?? null,
      cartToken: options.cartToken ?? null,
      preferences: { orderUpdates: true, promotions: true },
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    if (body?.error === 'PUSH_SUBSCRIPTION_UNAVAILABLE') {
      throw new Error('O navegador criou a inscrição, mas o servidor não conseguiu salvá-la. Confira a migration zelomenu_push_subscriptions no Supabase.');
    }
    throw new Error('Não foi possível ativar as notificações.');
  }
  window.localStorage.setItem(PUSH_ENABLED_KEY, 'true');
  window.localStorage.setItem(PUSH_PUBLIC_KEY_KEY, config.publicKey);
}

function getSubscriptionErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'InvalidAccessError') {
    return 'A chave VAPID publicada pelo servidor é inválida. Confira se VAPID_PUBLIC_KEY contém a chave pública completa, sem espaços ou quebras de linha.';
  }
  if (name === 'NotAllowedError') {
    return 'O navegador bloqueou o push. Verifique a permissão de notificações e confirme que o site está aberto em HTTPS.';
  }
  if (name === 'InvalidStateError') {
    return 'O service worker ainda não terminou de carregar. Atualize a página e tente novamente.';
  }
  if (name === 'AbortError') {
    return 'O serviço de push não respondeu. Confirme a conexão e tente novamente em alguns segundos.';
  }
  return 'O navegador não conseguiu registrar o push. Confirme o HTTPS, a permissão de notificações e as VAPID keys do servidor.';
}

export async function disablePushNotifications(): Promise<void> {
  if (!supportsPush()) return;
  const registration = await getPushServiceWorkerRegistration();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await fetch('/api/public/push/subscriptions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe();
  window.localStorage.removeItem(PUSH_ENABLED_KEY);
  window.localStorage.removeItem(PUSH_PUBLIC_KEY_KEY);
}
