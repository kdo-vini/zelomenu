import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  upsert: vi.fn(async () => ({ error: null })),
  send: vi.fn(async () => undefined),
  orders: [] as Array<Record<string, unknown>>,
  patches: [] as Record<string, unknown>[],
  rpc: vi.fn(async () => ({ data: 'lease-1', error: null })),
}));
vi.mock('./supabaseServer.js', () => ({ getServiceSupabase: () => ({
  rpc: mocks.rpc,
  from: (table: string) => {
    let cursor = '';
    let limit = 200;
    const query = {
      select: () => query, eq: () => query, order: () => query, not: () => query, in: () => query,
      limit: (value: number) => { limit = value; return query; },
      gt: (_key: string, value: string) => { cursor = value; return query; },
      update: (patch: Record<string, unknown>) => { mocks.patches.push(patch); return query; },
      upsert: mocks.upsert,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: (table === 'zelo_orders' ? mocks.orders : mocks.rows.filter((row) => String(row.id) > cursor)).slice(0, limit), error: null }).then(resolve),
    };
    return query;
  },
}) }));
vi.mock('./vapidConfig.js', () => ({ getVapidConfig: () => ({
  publicKey: 'public', privateKey: 'private', subject: 'mailto:test@example.com',
  publicKeyValid: true, privateKeyValid: true, keyPairValid: true,
}) }));
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: mocks.send } }));

import { dispatchOrderStatusPushes, notifyPushSubscribers, savePublicPushSubscription } from './zelomenuPushSubscriptions';

const subscription = (endpoint: string) => ({ endpoint, keys: { p256dh: 'key', auth: 'auth' } });
beforeEach(() => { vi.clearAllMocks(); mocks.rows = []; mocks.orders = []; mocks.patches = []; mocks.rpc.mockResolvedValue({ data: 'lease-1', error: null }); });

describe('push endpoint security', () => {
  it.each([
    'https://127.0.0.1/private', 'https://[::1]/private', 'https://169.254.169.254/latest',
    'https://attacker.example/push', 'http://fcm.googleapis.com/push',
    'https://fcm.googleapis.com.attacker.example/push', 'https://fcm.googleapis.com:444/push',
    'https://user:password@fcm.googleapis.com/push',
  ])('rejeita destino não confiável %s antes de persistir', async (endpoint) => {
    await expect(savePublicPushSubscription({ clientId: 'client', subscription: subscription(endpoint) }))
      .rejects.toThrow('INVALID_PUSH_SUBSCRIPTION');
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it.each(['https://fcm.googleapis.com/fcm/send/token', 'https://updates.push.services.mozilla.com/wpush/v2/token',
    'https://web.push.apple.com/token', 'https://region.push.apple.com/token', 'https://wns2-par02p.notify.windows.com/token'])('aceita provedor conhecido %s', async (endpoint) => {
    await savePublicPushSubscription({ clientId: 'client', subscription: subscription(endpoint) });
    expect(mocks.upsert).toHaveBeenCalledOnce();
  });

  it('não envia para destino arbitrário já persistido e limita a duração do envio válido', async () => {
    mocks.rows = [
      { id: 'invalid', subscription: subscription('https://127.0.0.1/private') },
      { id: 'valid', subscription: subscription('https://fcm.googleapis.com/fcm/send/token') },
    ];
    await notifyPushSubscribers({ title: 'Pedido', body: 'Recebido' }, 'client', 'order');
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith(mocks.rows[1].subscription, expect.any(String), { timeout: 10_000 });
  });
});

it('paginates beyond one page while limiting sends to eight in flight', async () => {
  mocks.rows = Array.from({ length: 405 }, (_, n) => ({ id: String(n).padStart(5, '0'), subscription: subscription('https://fcm.googleapis.com/fcm/send/token') }));
  let active = 0; let maximum = 0;
  mocks.send.mockImplementation(async () => { active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; });
  await notifyPushSubscribers({ title: 'Fixture', body: 'Fixture' });
  expect(mocks.send).toHaveBeenCalledTimes(405);
  expect(maximum).toBe(8);
});

it('requires a lease before sending and disables terminal polling after acknowledgment', async () => {
  mocks.rows = [{ id: 'sub-1', order_id: 'order-1', subscription: subscription('https://fcm.googleapis.com/fcm/send/token') }];
  mocks.orders = [{ id: 'order-1', status: 'delivered', revision: 3 }];
  mocks.rpc.mockResolvedValueOnce({ data: null as any, error: null });
  await dispatchOrderStatusPushes();
  expect(mocks.send).not.toHaveBeenCalled();
  await dispatchOrderStatusPushes();
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(mocks.patches[0]).toMatchObject({ order_updates: false, last_order_revision: 3, dispatch_lease_id: null });
});
