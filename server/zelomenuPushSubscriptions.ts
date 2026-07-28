import { getServiceSupabase } from './supabaseServer.js';
import webpush from 'web-push';
import { getVapidConfig } from './vapidConfig.js';

const TABLE = 'zelomenu_push_subscriptions';

export interface ZeloMenuPushMessage {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  renotify?: boolean;
}

export interface PublicPushSubscriptionPayload {
  endpoint: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
}

export type PushChannel = 'order' | 'promotion';

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  client_id: string;
  subscription: webpush.PushSubscription;
  order_id: string | null;
  cart_token: string | null;
  last_order_revision: number | null;
  last_order_status: string | null;
};

function configureWebPush(): boolean {
  const { publicKey, privateKey, subject, publicKeyValid, privateKeyValid, keyPairValid } = getVapidConfig();
  if (!publicKey || !privateKey || !publicKeyValid || !privateKeyValid || !keyPairValid) return false;

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return true;
  } catch (error) {
    console.error('[ZeloMenu] invalid VAPID configuration:', error);
    return false;
  }
}

export async function savePublicPushSubscription(input: {
  clientId: string;
  subscription: PublicPushSubscriptionPayload;
  preferences?: { orderUpdates?: boolean; promotions?: boolean };
  orderId?: string;
  cartToken?: string;
  orderRevision?: number;
  orderStatus?: string;
}): Promise<void> {
  const endpoint = input.subscription.endpoint.trim().slice(0, 2048);
  const p256dh = input.subscription.keys?.p256dh?.trim();
  const auth = input.subscription.keys?.auth?.trim();
  const clientId = input.clientId.trim().slice(0, 120);
  const orderId = input.orderId?.trim().slice(0, 120) || null;
  const cartToken = input.cartToken?.trim().slice(0, 120) || null;
  if (!endpoint || !p256dh || !auth || !clientId) throw new Error('INVALID_PUSH_SUBSCRIPTION');
  if (orderId && !cartToken) throw new Error('INVALID_PUSH_ORDER');

  const { error } = await getServiceSupabase().from(TABLE).upsert({
    endpoint,
    client_id: clientId,
    subscription: input.subscription,
    order_id: orderId,
    cart_token: cartToken,
    last_order_revision: orderId && Number.isSafeInteger(input.orderRevision) ? input.orderRevision : null,
    last_order_status: orderId ? input.orderStatus?.trim().slice(0, 40) || null : null,
    order_updates: input.preferences?.orderUpdates !== false,
    promotions: input.preferences?.promotions !== false,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function removePublicPushSubscription(endpoint: string): Promise<void> {
  const { error } = await getServiceSupabase().from(TABLE).delete().eq('endpoint', endpoint.trim().slice(0, 2048));
  if (error) throw error;
}

export async function notifyPushSubscribers(message: ZeloMenuPushMessage, clientId?: string, channel: PushChannel = 'promotion', orderId?: string): Promise<void> {
  if (!configureWebPush()) return;

  let query = getServiceSupabase()
    .from(TABLE)
    .select('id, endpoint, client_id, subscription');
  if (clientId) query = query.eq('client_id', clientId);
  query = query.eq(channel === 'order' ? 'order_updates' : 'promotions', true);
  if (orderId) query = query.eq('order_id', orderId);
  const { data, error } = await query;
  if (error) throw error;

  await Promise.all((data ?? []).map(async (row) => {
    try {
      await webpush.sendNotification(row.subscription as webpush.PushSubscription, JSON.stringify(message));
    } catch (deliveryError) {
      const statusCode = (deliveryError as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await getServiceSupabase().from(TABLE).delete().eq('id', row.id);
        return;
      }
      console.warn('[ZeloMenu] push delivery failed:', deliveryError);
    }
  }));
}

const ORDER_STATUS_COPY: Record<string, { title: string; body: string }> = {
  pending_payment: {
    title: 'Pagamento pendente',
    body: 'Finalize o pagamento para a loja começar a preparar seu pedido.',
  },
  pending_review: {
    title: 'Pedido recebido',
    body: 'A loja recebeu seu pedido e vai confirmar os próximos passos.',
  },
  accepted: {
    title: 'Pedido confirmado',
    body: 'A loja confirmou seu pedido e já vai começar a preparar.',
  },
  preparing: {
    title: 'Pedido em preparo',
    body: 'Seu pedido está sendo preparado pela loja.',
  },
  ready: {
    title: 'Pedido pronto',
    body: 'Seu pedido está pronto para retirada ou entrega.',
  },
  out_for_delivery: {
    title: 'Pedido saiu para entrega',
    body: 'Seu pedido está a caminho.',
  },
  delivered: {
    title: 'Pedido entregue',
    body: 'Seu pedido foi concluído. Bom apetite!',
  },
  rejected: {
    title: 'Pedido não aceito',
    body: 'A loja não conseguiu aceitar seu pedido. Confira os detalhes.',
  },
  cancelled: {
    title: 'Pedido cancelado',
    body: 'Seu pedido foi cancelado. Confira os detalhes.',
  },
};

async function dispatchOrderStatusToSubscription(
  row: PushSubscriptionRow,
  order: { id: string; status: string; revision: number },
): Promise<void> {
  const copy = ORDER_STATUS_COPY[order.status] ?? {
    title: 'Pedido atualizado',
    body: 'O status do seu pedido foi atualizado.',
  };
  const url = row.cart_token ? `/menu/carrinho/${encodeURIComponent(row.cart_token)}` : '/';

  try {
    await webpush.sendNotification(row.subscription, JSON.stringify({
      ...copy,
      url,
      tag: `order-status-${order.id}-${order.status}`,
      renotify: true,
    }));
  } catch (deliveryError) {
    const statusCode = (deliveryError as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await getServiceSupabase().from(TABLE).delete().eq('id', row.id);
      return;
    }
    console.warn('[ZeloMenu] order status push delivery failed:', deliveryError);
    return;
  }

  const { error } = await getServiceSupabase()
    .from(TABLE)
    .update({
      last_order_revision: order.revision,
      last_order_status: order.status,
      last_seen_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('order_id', order.id);
  if (error) console.warn('[ZeloMenu] order status push checkpoint failed:', error);
}

export async function dispatchOrderStatusPushes(): Promise<void> {
  if (!configureWebPush()) return;

  const { data: subscriptionData, error: subscriptionError } = await getServiceSupabase()
    .from(TABLE)
    .select('id, endpoint, client_id, subscription, order_id, cart_token, last_order_revision, last_order_status')
    .eq('order_updates', true)
    .not('order_id', 'is', null)
    .limit(5000);
  if (subscriptionError) throw subscriptionError;

  const subscriptions = (subscriptionData ?? []) as PushSubscriptionRow[];
  const orderIds = [...new Set(subscriptions.map((row) => row.order_id).filter((id): id is string => Boolean(id)))];
  if (orderIds.length === 0) return;

  const { data: orderData, error: orderError } = await getServiceSupabase()
    .from('zelo_orders')
    .select('id, status, revision')
    .in('id', orderIds)
    .limit(5000);
  if (orderError) throw orderError;

  const orders = (orderData ?? []).map((row) => ({
    id: String(row.id),
    status: String(row.status),
    revision: Number(row.revision),
  })).filter((order) => Number.isSafeInteger(order.revision));
  const ordersById = new Map(orders.map((order) => [order.id, order]));

  await Promise.all(subscriptions.map(async (row) => {
    if (!row.order_id) return;
    const order = ordersById.get(row.order_id);
    if (!order) return;
    if (row.last_order_revision === order.revision && row.last_order_status === order.status) return;
    await dispatchOrderStatusToSubscription(row, order);
  }));
}

let orderStatusDispatcher: ReturnType<typeof setInterval> | null = null;
let orderStatusDispatchInFlight = false;

export function startOrderStatusPushDispatcher(intervalMs = 30_000): void {
  if (orderStatusDispatcher) return;
  const tick = () => {
    if (orderStatusDispatchInFlight) return;
    orderStatusDispatchInFlight = true;
    void dispatchOrderStatusPushes()
      .catch((error) => console.warn('[ZeloMenu] order status push dispatcher failed:', error))
      .finally(() => { orderStatusDispatchInFlight = false; });
  };
  tick();
  orderStatusDispatcher = setInterval(tick, intervalMs);
}
