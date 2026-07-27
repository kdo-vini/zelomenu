const PUSH_CLIENT_ID_KEY = 'zelomenu.push.client-id';
const PUSH_ENABLED_KEY = 'zelomenu.push.enabled';
const PUSH_PUBLIC_KEY_KEY = 'zelomenu.push.public-key';

type PushConfig = { enabled: boolean; publicKey: string | null };

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
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function getPushConfig(): Promise<PushConfig> {
  const response = await fetch('/api/public/push/config', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Não foi possível verificar as notificações.');
  return response.json() as Promise<PushConfig>;
}

export function isPushSupported(): boolean {
  return supportsPush();
}

export async function getPushStatus(): Promise<'unsupported' | 'disabled' | 'enabled' | 'blocked'> {
  if (!supportsPush()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const config = await getPushConfig();
  if (!config.enabled || !config.publicKey) return 'disabled';
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  const registeredKey = window.localStorage.getItem(PUSH_PUBLIC_KEY_KEY);
  return subscription && registeredKey === config.publicKey ? 'enabled' : 'disabled';
}

export async function enablePushNotifications(options: { orderId?: string; cartToken?: string } = {}): Promise<void> {
  if (!supportsPush()) throw new Error('Este navegador não oferece notificações push.');

  const config = await getPushConfig();
  if (!config.enabled || !config.publicKey) {
    throw new Error('As notificações ainda não estão configuradas neste ambiente.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permissão para notificações não concedida.');

  const registration = await navigator.serviceWorker.ready;
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
        applicationServerKey: decodeBase64Url(config.publicKey),
      });
    } catch (error) {
      await registration.update().catch(() => undefined);
      throw new Error('O navegador não conseguiu registrar o push. Atualize a página e tente novamente.', { cause: error });
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
  if (!response.ok) throw new Error('Não foi possível ativar as notificações.');
  window.localStorage.setItem(PUSH_ENABLED_KEY, 'true');
  window.localStorage.setItem(PUSH_PUBLIC_KEY_KEY, config.publicKey);
}

export async function disablePushNotifications(): Promise<void> {
  if (!supportsPush()) return;
  const registration = await navigator.serviceWorker.ready;
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
