-- Disposable PostgreSQL fixture. No auth/network/storage/provider integrations.
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$;
create table public.empresa_perfil(id uuid primary key, user_id uuid not null);
create table public.pessoas(id uuid primary key, id_usuario uuid not null);
create table public.produtos(id bigint primary key, id_usuario uuid not null);
create table public.zelomenu_cart_sessions(
  id uuid primary key, empresa_id uuid not null, context text, state text default 'cart_open',
  revision integer default 1, current_token_hash text, archived_at timestamptz,
  customer_snapshot jsonb, cart_snapshot jsonb, fulfillment_snapshot jsonb, pricing_snapshot jsonb,
  payment_snapshot jsonb, metadata jsonb default '{}', capability_id uuid, confirmed_at timestamptz,
  updated_at timestamptz default now()
);
create table public.zelomenu_cart_tokens(session_id uuid, token_hash text, revoked_at timestamptz, expires_at timestamptz);
create table public.zelo_orders(
  id uuid primary key default gen_random_uuid(), empresa_id uuid, source text, status text,
  zelomenu_session_id uuid unique, idempotency_key text, pessoa_id uuid, customer jsonb,
  fulfillment jsonb, payment jsonb, subtotal numeric, delivery_fee numeric, discount numeric, total numeric,
  sale_id uuid, observations text, stock_committed_at timestamptz, revision integer default 1, created_at timestamptz default now(),
  unique(empresa_id, idempotency_key)
);
create table public.zelo_order_items(order_id uuid references public.zelo_orders(id), product_id bigint,
  name text, unit_price numeric, quantity integer, subtotal numeric, modifiers jsonb, position integer);
create table public.zelo_order_events(order_id uuid, empresa_id uuid, event_type text, to_status text, detail jsonb);
create table public.zelo_order_outbox(order_id uuid, empresa_id uuid, topic text, payload jsonb, idempotency_key text);
create function public.zelo_order_result(p_order public.zelo_orders) returns jsonb language sql stable set search_path='public' as $$ select jsonb_build_object('orderId',p_order.id,'status',p_order.status,'revision',p_order.revision,'total',p_order.total,'saleId',p_order.sale_id) $$;
create table public.zelomenu_coupons(id uuid primary key default gen_random_uuid(), id_usuario uuid,
  code text, discount_type text, discount_value numeric, min_order_value numeric, active boolean default true,
  starts_at timestamptz, expires_at timestamptz);
create table public.zelomenu_coupon_redemptions(id uuid primary key default gen_random_uuid(),
  coupon_id uuid references public.zelomenu_coupons(id), id_usuario uuid, customer_phone text,
  order_id uuid references public.zelo_orders(id), unique(coupon_id, customer_phone));

create table public.zelomenu_push_subscriptions(id uuid primary key, order_id text, order_updates boolean default true, last_order_revision integer, last_order_status text);

alter table zelomenu_cart_sessions add column last_revalidated_at timestamptz, add column last_revalidation jsonb;
create table public.zelomenu_delivery_quote_requests(id uuid primary key, company_id uuid, session_id uuid, status text default 'pending', resolved_fee numeric, resolved_snapshot jsonb, resolved_at timestamptz, updated_at timestamptz);
-- Existing service-only ACL is part of the live baseline preserved by CREATE OR REPLACE.
create function resolve_zelomenu_delivery_quote_request(uuid,uuid,numeric,jsonb default '{}'::jsonb) returns table(request_id uuid, session_id uuid, next_revision bigint) language sql as $$select null::uuid,null::uuid,0::bigint$$;
revoke all on function resolve_zelomenu_delivery_quote_request(uuid,uuid,numeric,jsonb) from public,anon,authenticated;
grant execute on function resolve_zelomenu_delivery_quote_request(uuid,uuid,numeric,jsonb) to service_role;
