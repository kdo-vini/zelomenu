begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

select plan(48);

insert into auth.users (
  id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c1000000-0000-4000-8000-000000000001',
  'confirmation-integrity@invalid.local',
  'authenticated', 'authenticated', '{}', '{}', now(), now()
);

insert into public.empresa_perfil (id, user_id, nome_exibicao, timezone, horario_semanal)
values (
  'c1000000-0000-4000-8000-000000000002',
  'c1000000-0000-4000-8000-000000000001',
  'Loja de integridade',
  'America/Sao_Paulo',
  '{"sun":[{"start":"00:00","end":"24:00"}],"mon":[{"start":"00:00","end":"24:00"}],"tue":[{"start":"00:00","end":"24:00"}],"wed":[{"start":"00:00","end":"24:00"}],"thu":[{"start":"00:00","end":"24:00"}],"fri":[{"start":"00:00","end":"24:00"}],"sat":[{"start":"00:00","end":"24:00"}]}'::jsonb
);

insert into public.categorias (id, id_usuario, nome)
values (2147482800, 'c1000000-0000-4000-8000-000000000001', 'Categoria de integridade');

insert into public.produtos (
  id, id_usuario, id_categoria, nome, preco, controlar_estoque, estoque_atual
) values (
  2147482801, 'c1000000-0000-4000-8000-000000000001', 2147482800,
  'Produto de integridade', 10, false, 0
);

insert into public.zelomenu_product_publications (
  id, id_usuario, id_produto, nome_publico, visivel_online, pausado_manualmente
) values (
  'c1000000-0000-4000-8000-000000000011',
  'c1000000-0000-4000-8000-000000000001',
  2147482801, 'Produto de integridade', true, false
);

-- This cart is intentionally written independently of the materializer. The
-- two equal-product lines prove that SQL preserves opaque identity and order.
select is(
  public.zelomenu_whatsapp_materialize_cart_v1(
    'c1000000-0000-4000-8000-000000000002',
    $cart$
    {"items":[
      {"lineId":"line-1","productId":2147482801,"quantity":1,"notes":null,"selectedModifiers":[]},
      {"lineId":"line-2","productId":2147482801,"quantity":1,"notes":"segunda linha","selectedModifiers":[]}
    ],"observations":null}
    $cart$::jsonb
  )#>'{cart,items}'->0->>'lineId',
  'line-1',
  'materialization echoes the first independently supplied stable lineId'
);

select is(
  public.zelomenu_whatsapp_materialize_cart_v1(
    'c1000000-0000-4000-8000-000000000002',
    $cart$
    {"items":[
      {"lineId":"line-1","productId":2147482801,"quantity":1,"notes":null,"selectedModifiers":[]},
      {"lineId":"line-2","productId":2147482801,"quantity":1,"notes":"segunda linha","selectedModifiers":[]}
    ],"observations":null}
    $cart$::jsonb
  )#>'{cart,items}'->1->>'lineId',
  'line-2',
  'materialization preserves order for two equal products'
);

select is(
  jsonb_path_query_array(
    public.zelomenu_whatsapp_materialize_cart_v1(
      'c1000000-0000-4000-8000-000000000002',
      '{"items":[{"lineId":"line 1","productId":2147482801,"quantity":1}],"observations":null}'::jsonb
    ),
    '$.issues[*].code'
  ),
  '["line_id_invalid"]'::jsonb,
  'invalid lineId is rejected by the materializer'
);

select is(
  jsonb_path_query_array(
    public.zelomenu_whatsapp_materialize_cart_v1(
      'c1000000-0000-4000-8000-000000000002',
      '{"items":[{"productId":2147482801,"quantity":1}],"observations":null}'::jsonb
    ),
    '$.issues[*].code'
  ),
  '["line_id_invalid"]'::jsonb,
  'missing lineId is rejected by the materializer'
);

select is(
  jsonb_path_query_array(
    public.zelomenu_whatsapp_materialize_cart_v1(
      'c1000000-0000-4000-8000-000000000002',
      '{"items":[{"lineId":"same","productId":2147482801,"quantity":1},{"lineId":"same","productId":2147482801,"quantity":1}],"observations":null}'::jsonb
    ),
    '$.issues[*].code'
  ),
  '["line_id_invalid","line_id_invalid"]'::jsonb,
  'duplicate lineIds are rejected for every affected input line'
);

insert into public.zelomenu_cart_sessions (
  id, ordering_id, empresa_id, context, state, source_ref,
  customer_snapshot, cart_snapshot, fulfillment_snapshot, pricing_snapshot,
  payment_snapshot, metadata, revision, last_revalidated_at, last_revalidation,
  requirements_snapshot, ready_for_confirmation
) values
(
  'c1000000-0000-4000-8000-000000000101',
  'c1000000-0000-4000-8000-000000000201',
  'c1000000-0000-4000-8000-000000000002', 'whatsapp_order', 'cart_open',
  '5511900000011@s.whatsapp.net',
  '{"name":"Ana","phone":null}'::jsonb,
  '{"items":[{"lineId":"line-1","productId":2147482801,"productName":"Produto de integridade","baseUnitPrice":10,"selectedModifiers":[],"modifierDeltaTotal":0,"quantity":1,"unitPrice":10,"lineTotal":10,"notes":null},{"lineId":"line-2","productId":2147482801,"productName":"Produto de integridade","baseUnitPrice":10,"selectedModifiers":[],"modifierDeltaTotal":0,"quantity":1,"unitPrice":10,"lineTotal":10,"notes":"segunda linha"}],"observations":null}'::jsonb,
  '{"type":"pickup","asap":true,"pickupDate":null,"pickupTime":null,"deliveryAddress":null,"deliveryNeighborhood":null,"deliveryFee":0,"deliveryFeeToConfirm":false}'::jsonb,
  '{"subtotal":20,"deliveryFee":0,"discount":0,"couponCode":null,"couponDiscountType":null,"couponDiscountValue":null,"total":20}'::jsonb,
  '{"declaredMethod":"dinheiro","pixReceiptRequired":false,"pixReceiptApproved":false}'::jsonb,
  '{"processedMessageIds":[]}'::jsonb, 1, now(),
  '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb,
  '[]'::jsonb, true
),
(
  'c1000000-0000-4000-8000-000000000102',
  'c1000000-0000-4000-8000-000000000202',
  'c1000000-0000-4000-8000-000000000002', 'whatsapp_order', 'cart_open',
  '5511900000012@s.whatsapp.net',
  '{"name":"Ana","phone":null}'::jsonb,
  '{"items":[{"lineId":"line-ready","productId":2147482801,"productName":"Produto de integridade","baseUnitPrice":10,"selectedModifiers":[],"modifierDeltaTotal":0,"quantity":1,"unitPrice":10,"lineTotal":10,"notes":null}],"observations":null}'::jsonb,
  '{"type":"pickup","asap":true,"pickupDate":null,"pickupTime":null,"deliveryAddress":null,"deliveryNeighborhood":null,"deliveryFee":0,"deliveryFeeToConfirm":false}'::jsonb,
  '{"subtotal":10,"deliveryFee":0,"discount":0,"total":10}'::jsonb,
  '{"declaredMethod":"dinheiro","pixReceiptRequired":false,"pixReceiptApproved":false}'::jsonb,
  '{"processedMessageIds":[]}'::jsonb, 1, now(),
  '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb,
  '[]'::jsonb, false
),
(
  'c1000000-0000-4000-8000-000000000103',
  'c1000000-0000-4000-8000-000000000203',
  'c1000000-0000-4000-8000-000000000002', 'whatsapp_order', 'cart_open',
  '5511900000013@s.whatsapp.net',
  '{"name":"   ","phone":null}'::jsonb,
  '{"items":[{"lineId":"line-ready","productId":2147482801,"productName":"Produto de integridade","baseUnitPrice":10,"selectedModifiers":[],"modifierDeltaTotal":0,"quantity":1,"unitPrice":10,"lineTotal":10,"notes":null}],"observations":null}'::jsonb,
  '{"type":"pickup","asap":true,"pickupDate":null,"pickupTime":null,"deliveryAddress":null,"deliveryNeighborhood":null,"deliveryFee":0,"deliveryFeeToConfirm":false}'::jsonb,
  '{"subtotal":10,"deliveryFee":0,"discount":0,"total":10}'::jsonb,
  '{"declaredMethod":"dinheiro","pixReceiptRequired":false,"pixReceiptApproved":false}'::jsonb,
  '{"processedMessageIds":[]}'::jsonb, 1, now(),
  '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb,
  '[]'::jsonb, true
),
(
  'c1000000-0000-4000-8000-000000000104',
  'c1000000-0000-4000-8000-000000000204',
  'c1000000-0000-4000-8000-000000000002', 'whatsapp_order', 'cart_open',
  '5511900000014@s.whatsapp.net',
  '{"name":"Ana","phone":null}'::jsonb,
  '{"items":[{"lineId":"line-ready","productId":2147482801,"productName":"Produto de integridade","baseUnitPrice":10,"selectedModifiers":[],"modifierDeltaTotal":0,"quantity":1,"unitPrice":10,"lineTotal":10,"notes":null}],"observations":null}'::jsonb,
  '{"type":"pickup","asap":true,"pickupDate":null,"pickupTime":null,"deliveryAddress":null,"deliveryNeighborhood":null,"deliveryFee":0,"deliveryFeeToConfirm":false}'::jsonb,
  '{"subtotal":10,"deliveryFee":0,"discount":0,"total":10}'::jsonb,
  '{"declaredMethod":null,"pixReceiptRequired":false,"pixReceiptApproved":false}'::jsonb,
  '{"processedMessageIds":[]}'::jsonb, 1, now(),
  '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb,
  '[]'::jsonb, true
),
(
  'c1000000-0000-4000-8000-000000000105',
  'c1000000-0000-4000-8000-000000000205',
  'c1000000-0000-4000-8000-000000000002', 'whatsapp_order', 'cart_open',
  '5511900000015@s.whatsapp.net',
  '{"name":"Ana","phone":null}'::jsonb,
  '{"items":[{"lineId":"line-ready","productId":2147482801,"productName":"Produto de integridade","baseUnitPrice":10,"selectedModifiers":[],"modifierDeltaTotal":0,"quantity":1,"unitPrice":10,"lineTotal":10,"notes":null}],"observations":null}'::jsonb,
  '{"type":"pickup","asap":true,"pickupDate":null,"pickupTime":null,"deliveryAddress":null,"deliveryNeighborhood":null,"deliveryFee":0,"deliveryFeeToConfirm":false}'::jsonb,
  '{"subtotal":10,"deliveryFee":0,"discount":0,"total":10}'::jsonb,
  '{"declaredMethod":"dinheiro","pixReceiptRequired":false,"pixReceiptApproved":false}'::jsonb,
  '{"processedMessageIds":[]}'::jsonb, 1, now(),
  '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb,
  '[{"id":"customer_name","type":"customer_name","name":"Informe o nome.","blocking":true}]'::jsonb, true
),
(
  'c1000000-0000-4000-8000-000000000106',
  'c1000000-0000-4000-8000-000000000206',
  'c1000000-0000-4000-8000-000000000002', 'whatsapp_order', 'cart_open',
  '5511900000016@s.whatsapp.net',
  '{"name":"Ana","phone":null}'::jsonb,
  '{"items":[{"lineId":"line-ready","productId":2147482801,"productName":"Produto de integridade","baseUnitPrice":10,"selectedModifiers":[],"modifierDeltaTotal":0,"quantity":1,"unitPrice":10,"lineTotal":10,"notes":null}],"observations":null}'::jsonb,
  '{"type":"delivery","asap":true,"pickupDate":null,"pickupTime":null,"deliveryAddress":null,"deliveryNeighborhood":null,"deliveryNumber":null,"deliveryFee":0,"deliveryFeeToConfirm":false}'::jsonb,
  '{"subtotal":10,"deliveryFee":0,"discount":0,"total":10}'::jsonb,
  '{"declaredMethod":"dinheiro","pixReceiptRequired":false,"pixReceiptApproved":false}'::jsonb,
  '{"processedMessageIds":[]}'::jsonb, 1, now(),
  '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb,
  '[]'::jsonb, true
),
(
  'c1000000-0000-4000-8000-000000000107',
  'c1000000-0000-4000-8000-000000000207',
  'c1000000-0000-4000-8000-000000000002', 'whatsapp_order', 'cart_open',
  '5511900000017@s.whatsapp.net',
  '{"name":"Ana","phone":null}'::jsonb,
  '{"items":[{"lineId":"line-ready","productId":2147482801,"productName":"Produto de integridade","baseUnitPrice":10,"selectedModifiers":[],"modifierDeltaTotal":0,"quantity":1,"unitPrice":10,"lineTotal":10,"notes":null}],"observations":null}'::jsonb,
  '{"type":"pickup","asap":false,"pickupDate":null,"pickupTime":null,"deliveryAddress":null,"deliveryNeighborhood":null,"deliveryFee":0,"deliveryFeeToConfirm":false}'::jsonb,
  '{"subtotal":10,"deliveryFee":0,"discount":0,"total":10}'::jsonb,
  '{"declaredMethod":"dinheiro","pixReceiptRequired":false,"pixReceiptApproved":false}'::jsonb,
  '{"processedMessageIds":[]}'::jsonb, 1, now(),
  '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb,
  '[]'::jsonb, true
);

-- Canonical conversation fixtures never trust caller phone data; derive it from
-- each scoped JID exactly as the open/update wrappers do.
update public.zelomenu_cart_sessions
   set customer_snapshot = jsonb_set(
     customer_snapshot,
     '{phone}',
     to_jsonb(public.zelomenu_whatsapp_phone_from_source_ref_v1(source_ref)),
     true
   );

insert into public.zelomenu_cart_sessions (
  id, ordering_id, empresa_id, context, state, source_ref,
  customer_snapshot, cart_snapshot, fulfillment_snapshot, pricing_snapshot,
  payment_snapshot, metadata, revision, last_revalidated_at, last_revalidation,
  requirements_snapshot, ready_for_confirmation
) values (
  'c1000000-0000-4000-8000-000000000117',
  'c1000000-0000-4000-8000-000000000217',
  'c1000000-0000-4000-8000-000000000002', 'whatsapp_order', 'cart_open',
  '5511900000026@s.whatsapp.net',
  '{"name":"Ana","phone":"5511900000999"}'::jsonb,
  '{"items":[{"lineId":"line-ready","productId":2147482801,"productName":"Produto de integridade","baseUnitPrice":10,"selectedModifiers":[],"modifierDeltaTotal":0,"quantity":1,"unitPrice":10,"lineTotal":10,"notes":null}],"observations":null}'::jsonb,
  '{"type":"pickup","asap":true,"pickupDate":null,"pickupTime":null,"deliveryAddress":null,"deliveryNeighborhood":null,"deliveryFee":0,"deliveryFeeToConfirm":false}'::jsonb,
  '{"subtotal":10,"deliveryFee":0,"discount":0,"total":10}'::jsonb,
  '{"declaredMethod":"dinheiro","pixReceiptRequired":false,"pixReceiptApproved":false}'::jsonb,
  '{"processedMessageIds":[]}'::jsonb, 1, now(),
  '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb,
  '[]'::jsonb, true
);

-- Corrupt JSON facts are independent rows so both authority entry points can
-- be exercised without changing the baseline complete revision.
with corrupt_cases(id, ordering_id, source_ref, requirements_snapshot, last_revalidation) as (
  values
    ('c1000000-0000-4000-8000-000000000108'::uuid, 'c1000000-0000-4000-8000-000000000208'::uuid, '5511900000018@s.whatsapp.net', '[{"id":"bad"}]'::jsonb, '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb),
    ('c1000000-0000-4000-8000-000000000109'::uuid, 'c1000000-0000-4000-8000-000000000209'::uuid, '5511900000019@s.whatsapp.net', '[{"blocking":null}]'::jsonb, '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb),
    ('c1000000-0000-4000-8000-000000000110'::uuid, 'c1000000-0000-4000-8000-000000000210'::uuid, '5511900000020@s.whatsapp.net', '[{"blocking":"false"}]'::jsonb, '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb),
    ('c1000000-0000-4000-8000-000000000111'::uuid, 'c1000000-0000-4000-8000-000000000211'::uuid, '5511900000021@s.whatsapp.net', '[]'::jsonb, '{"checkedAt":"2026-09-02T12:00:00Z","ok":"true","issues":[]}'::jsonb)
)
insert into public.zelomenu_cart_sessions (
  id, ordering_id, empresa_id, context, state, source_ref,
  customer_snapshot, cart_snapshot, fulfillment_snapshot, pricing_snapshot,
  payment_snapshot, metadata, revision, last_revalidated_at, last_revalidation,
  requirements_snapshot, ready_for_confirmation
)
select c.id, c.ordering_id, s.empresa_id, s.context, s.state, c.source_ref,
  s.customer_snapshot, s.cart_snapshot, s.fulfillment_snapshot, s.pricing_snapshot,
  s.payment_snapshot, s.metadata, s.revision, s.last_revalidated_at, c.last_revalidation,
  c.requirements_snapshot, true
from corrupt_cases c
cross join lateral (
  select * from public.zelomenu_cart_sessions
   where id = 'c1000000-0000-4000-8000-000000000102'
) s;

with line_cases(id, ordering_id, source_ref, cart_snapshot) as (
  values
    (
      'c1000000-0000-4000-8000-000000000114'::uuid,
      'c1000000-0000-4000-8000-000000000214'::uuid,
      '5511900000022@s.whatsapp.net',
      '{"items":[{"lineId":"bad id","productId":2147482801,"quantity":1,"selectedModifiers":[]}],"observations":null}'::jsonb
    ),
    (
      'c1000000-0000-4000-8000-000000000115'::uuid,
      'c1000000-0000-4000-8000-000000000215'::uuid,
      '5511900000023@s.whatsapp.net',
      '{"items":[{"productId":2147482801,"quantity":1,"selectedModifiers":[]}],"observations":null}'::jsonb
    ),
    (
      'c1000000-0000-4000-8000-000000000116'::uuid,
      'c1000000-0000-4000-8000-000000000216'::uuid,
      '5511900000024@s.whatsapp.net',
      '{"items":[{"lineId":"same","productId":2147482801,"quantity":1,"selectedModifiers":[]},{"lineId":"same","productId":2147482801,"quantity":1,"selectedModifiers":[]}],"observations":null}'::jsonb
    )
)
insert into public.zelomenu_cart_sessions (
  id, ordering_id, empresa_id, context, state, source_ref,
  customer_snapshot, cart_snapshot, fulfillment_snapshot, pricing_snapshot,
  payment_snapshot, metadata, revision, last_revalidated_at, last_revalidation,
  requirements_snapshot, ready_for_confirmation
)
select c.id, c.ordering_id, 'c1000000-0000-4000-8000-000000000002'::uuid,
  'whatsapp_order', 'cart_open', c.source_ref,
  '{"name":"Ana","phone":null}'::jsonb, c.cart_snapshot,
  '{"type":"pickup","asap":true,"pickupDate":null,"pickupTime":null,"deliveryAddress":null,"deliveryNeighborhood":null,"deliveryNumber":null,"deliveryFee":0,"deliveryFeeToConfirm":false}'::jsonb,
  '{"subtotal":20,"deliveryFee":0,"discount":0,"couponCode":null,"couponDiscountType":null,"couponDiscountValue":null,"total":20}'::jsonb,
  '{"declaredMethod":"dinheiro","pixReceiptRequired":false,"pixReceiptApproved":false}'::jsonb,
  '{"processedMessageIds":[]}'::jsonb, 1, now(),
  '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb,
  '[]'::jsonb, true
from line_cases c;

update public.zelomenu_cart_sessions
   set customer_snapshot = jsonb_set(
     customer_snapshot,
     '{phone}',
     to_jsonb(public.zelomenu_whatsapp_phone_from_source_ref_v1(source_ref)),
     true
   )
 where id in (
   'c1000000-0000-4000-8000-000000000114',
   'c1000000-0000-4000-8000-000000000115',
   'c1000000-0000-4000-8000-000000000116'
 );

insert into public.zelomenu_cart_sessions (
  id, ordering_id, empresa_id, context, state, source_ref,
  customer_snapshot, cart_snapshot, fulfillment_snapshot, pricing_snapshot,
  payment_snapshot, metadata, revision, last_revalidated_at, last_revalidation,
  requirements_snapshot, ready_for_confirmation
)
select
  'c1000000-0000-4000-8000-000000000112', 'c1000000-0000-4000-8000-000000000212',
  empresa_id, context, state, '5511900000025@s.whatsapp.net', customer_snapshot,
  cart_snapshot, fulfillment_snapshot, pricing_snapshot, payment_snapshot,
  metadata, revision, last_revalidated_at, last_revalidation,
  requirements_snapshot, ready_for_confirmation
from public.zelomenu_cart_sessions
where id = 'c1000000-0000-4000-8000-000000000101';

update public.zelomenu_cart_sessions
   set customer_snapshot = jsonb_set(customer_snapshot, '{phone}', to_jsonb(public.zelomenu_whatsapp_phone_from_source_ref_v1(source_ref)), true)
 where id = 'c1000000-0000-4000-8000-000000000112';

-- Otherwise-ready copies dedicated to token-integrity failures. Keeping each
-- case on its own session proves the failure comes from token validation, not
-- from readiness or state mutated by a previous case.
insert into public.zelomenu_cart_sessions (
  id, ordering_id, empresa_id, context, state, source_ref,
  customer_snapshot, cart_snapshot, fulfillment_snapshot, pricing_snapshot,
  payment_snapshot, metadata, revision, last_revalidated_at, last_revalidation,
  requirements_snapshot, ready_for_confirmation
)
select cases.id, cases.ordering_id, baseline.empresa_id, baseline.context, baseline.state,
  cases.source_ref,
  jsonb_set(baseline.customer_snapshot, '{phone}', to_jsonb(public.zelomenu_whatsapp_phone_from_source_ref_v1(cases.source_ref)), true),
  baseline.cart_snapshot, baseline.fulfillment_snapshot, baseline.pricing_snapshot,
  baseline.payment_snapshot, baseline.metadata, baseline.revision,
  baseline.last_revalidated_at, baseline.last_revalidation,
  baseline.requirements_snapshot, baseline.ready_for_confirmation
from public.zelomenu_cart_sessions baseline
cross join (values
  ('c1000000-0000-4000-8000-000000000118'::uuid, 'c1000000-0000-4000-8000-000000000218'::uuid, '5511900000028@s.whatsapp.net'),
  ('c1000000-0000-4000-8000-000000000119'::uuid, 'c1000000-0000-4000-8000-000000000219'::uuid, '5511900000029@s.whatsapp.net'),
  ('c1000000-0000-4000-8000-000000000120'::uuid, 'c1000000-0000-4000-8000-000000000220'::uuid, '5511900000030@s.whatsapp.net'),
  ('c1000000-0000-4000-8000-000000000121'::uuid, 'c1000000-0000-4000-8000-000000000221'::uuid, '5511900000031@s.whatsapp.net'),
  ('c1000000-0000-4000-8000-000000000122'::uuid, 'c1000000-0000-4000-8000-000000000222'::uuid, '5511900000032@s.whatsapp.net')
) cases(id, ordering_id, source_ref)
where baseline.id = 'c1000000-0000-4000-8000-000000000101';

set local role service_role;

select is(
  public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000003', '5511900000011@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000101', 1,
    'message-cross-tenant', 'idem-cross-tenant', null,
    '9999999999999999999999999999999999999999999999999999999999999999'
  ),
  '{"outcome":"conflict"}'::jsonb,
  'tenant mismatch returns conflict without the selected session payload'
);

select lives_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    'f77e3ef1c60015a3bce4d2f81401f549a8b3b56f30c7f4b4e20d1607f63e9480', 'c1000000-0000-4000-8000-000000000002',
    '5511900000011@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000101', 1, now() + interval '10 minutes'
  ) $sql$,
  'complete ready revision issues a confirmation token'
);

-- ZM1: confirmation token is now mandatory (see 20260904090000). Text
-- confirmation and button confirmation share the exact same requirement --
-- both must present the token already visible to them via confirmationAction
-- (a text "sim" reuses the same token the customer's summary carried).
select is(
  (select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000011@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000101', 1, 'message-valid', 'idem-valid', null,
    'f77e3ef1c60015a3bce4d2f81401f549a8b3b56f30c7f4b4e20d1607f63e9480'
  )->>'outcome'),
  'confirmed',
  'complete ready revision confirms with the previously issued token for text confirmation'
);

select ok(
  exists (select 1 from public.zelo_orders where zelomenu_session_id = 'c1000000-0000-4000-8000-000000000101')
  and (select state <> 'cart_open' from public.zelomenu_cart_sessions where id = 'c1000000-0000-4000-8000-000000000101'),
  'successful confirmation creates one order and closes the cart'
);

select is(
  (select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000011@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000101', 1, 'message-valid-replay', 'idem-valid-replay', null,
    'f77e3ef1c60015a3bce4d2f81401f549a8b3b56f30c7f4b4e20d1607f63e9480'
  )->>'alreadyConfirmed'),
  'true',
  'confirmed-order replay with the issued token remains idempotent'
);

select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000011@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000101', 1, 'message-valid-forged', 'idem-valid-forged', null,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ) $sql$,
  'ZL409', 'CONFIRMATION_TOKEN_INVALID',
  'confirmed-order replay rejects a different well-formed token'
);

select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000028@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000118', 1, 'message-token-missing', 'idem-token-missing', null, null
  ) $sql$,
  'ZL400', 'WHATSAPP_CONFIRMATION_INPUT_INVALID',
  'otherwise-ready order rejects a missing confirmation token'
);

select public.issue_whatsapp_zelo_confirmation_token(
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'c1000000-0000-4000-8000-000000000002', '5511900000029@s.whatsapp.net',
  'c1000000-0000-4000-8000-000000000119', 1, now() + interval '10 minutes'
);
select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000029@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000119', 1, 'message-token-wrong', 'idem-token-wrong', null,
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  ) $sql$,
  'ZL409', 'CONFIRMATION_TOKEN_INVALID',
  'otherwise-ready order rejects a different well-formed token'
);

select public.issue_whatsapp_zelo_confirmation_token(
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'c1000000-0000-4000-8000-000000000002', '5511900000030@s.whatsapp.net',
  'c1000000-0000-4000-8000-000000000120', 1, now() + interval '10 minutes'
);
update public.zelomenu_whatsapp_confirmation_tokens
   set expires_at = now() - interval '1 second'
 where token_hash = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000030@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000120', 1, 'message-token-expired', 'idem-token-expired', null,
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
  ) $sql$,
  'ZL409', 'CONFIRMATION_TOKEN_INVALID',
  'otherwise-ready order rejects an expired token'
);

select public.issue_whatsapp_zelo_confirmation_token(
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  'c1000000-0000-4000-8000-000000000002', '5511900000031@s.whatsapp.net',
  'c1000000-0000-4000-8000-000000000121', 1, now() + interval '10 minutes'
);
update public.zelomenu_whatsapp_confirmation_tokens
   set consumed_at = now()
 where token_hash = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000031@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000121', 1, 'message-token-consumed', 'idem-token-consumed', null,
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  ) $sql$,
  'ZL409', 'CONFIRMATION_TOKEN_INVALID',
  'otherwise-ready open order rejects an already-consumed token'
);

select public.issue_whatsapp_zelo_confirmation_token(
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  'c1000000-0000-4000-8000-000000000002', '5511900000032@s.whatsapp.net',
  'c1000000-0000-4000-8000-000000000122', 1, now() + interval '10 minutes'
);
update public.zelomenu_cart_sessions
   set revision = 2
 where id = 'c1000000-0000-4000-8000-000000000122';
select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000032@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000122', 2, 'message-token-revision', 'idem-token-revision', null,
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  ) $sql$,
  'ZL409', 'CONFIRMATION_TOKEN_INVALID',
  'otherwise-ready order rejects a token issued for another revision'
);

select lives_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '1617eac6dadb9bdcb2004d85fd9c8b9d0a11f85ca19b50c6d67f5b04968d5705', 'c1000000-0000-4000-8000-000000000002',
    '5511900000025@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000112', 1, now() + interval '10 minutes'
  ) $sql$,
  'complete ready revision issues a live button token'
);
select is(
  (select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000025@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000112', 1, 'message-button', 'idem-button', null, '1617eac6dadb9bdcb2004d85fd9c8b9d0a11f85ca19b50c6d67f5b04968d5705'
  )->>'outcome'),
  'confirmed',
  'matching live button token confirms the ready revision'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    'a08663301e123a40d1162222e94854078f06ec383c60789455e0a4698d534dca', 'c1000000-0000-4000-8000-000000000002',
    '5511900000012@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000102', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY',
  'stored false readiness blocks token issuance'
);

select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000012@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000102', 1, 'message-not-ready', 'idem-not-ready', null,
    'a08663301e123a40d1162222e94854078f06ec383c60789455e0a4698d534dca'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY',
  'stored false readiness blocks tokenless confirmation'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    'e0f67bbda9022940293d103c2a6a83cc1133da9c9f36f418cdbf83a8aa204d26', 'c1000000-0000-4000-8000-000000000002',
    '5511900000013@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000103', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'blank customer name blocks token issuance'
);

select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000013@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000103', 1, 'message-blank-name', 'idem-blank-name', null,
    'e0f67bbda9022940293d103c2a6a83cc1133da9c9f36f418cdbf83a8aa204d26'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY',
  'blank customer name cannot bypass the readiness predicate'
);

select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000014@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000104', 1, 'message-null-payment', 'idem-null-payment', null,
    '771080a5b60047c896f6f2c2ef8ce4061e661f14d3252150f0908401018d191a'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY',
  'null payment method cannot bypass the readiness predicate'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '771080a5b60047c896f6f2c2ef8ce4061e661f14d3252150f0908401018d191a', 'c1000000-0000-4000-8000-000000000002',
    '5511900000014@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000104', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'null payment method blocks token issuance'
);

select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000015@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000105', 1, 'message-blocking', 'idem-blocking', null,
    '73c02b534d1f0456191965ac51576bfde31b61a79f7744d796ea1324cac88749'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY',
  'blocking requirement cannot bypass the readiness predicate'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '73c02b534d1f0456191965ac51576bfde31b61a79f7744d796ea1324cac88749', 'c1000000-0000-4000-8000-000000000002',
    '5511900000015@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000105', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'blocking requirement blocks token issuance'
);

select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000016@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000106', 1, 'message-delivery', 'idem-delivery', null,
    'cea9702a5ca49f4fdd01fad4afe21cbce52b8bebc64de73b7652c31f62fe5491'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY',
  'incomplete delivery address cannot bypass the readiness predicate'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    'cea9702a5ca49f4fdd01fad4afe21cbce52b8bebc64de73b7652c31f62fe5491', 'c1000000-0000-4000-8000-000000000002',
    '5511900000016@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000106', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'incomplete delivery address blocks token issuance'
);

select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000017@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000107', 1, 'message-schedule', 'idem-schedule', null,
    '3ff76f900f3b75cd4a3980a394b39b2c417710ccbbecb2e445bdeb78002bf219'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY',
  'missing scheduled date/time cannot bypass the readiness predicate'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '3ff76f900f3b75cd4a3980a394b39b2c417710ccbbecb2e445bdeb78002bf219', 'c1000000-0000-4000-8000-000000000002',
    '5511900000017@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000107', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'missing scheduled date/time blocks token issuance'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '42f7befeb0f14ce8d7d05fe3c6c0442360e8a9bb512cc84dbf1a2d7ef2658c03', 'c1000000-0000-4000-8000-000000000002',
    '5511900000026@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000117', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'phone divergent from scoped JID blocks token issuance'
);
select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000026@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000117', 1, 'message-phone-mismatch', 'idem-phone-mismatch', null,
    '42f7befeb0f14ce8d7d05fe3c6c0442360e8a9bb512cc84dbf1a2d7ef2658c03'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'phone divergent from scoped JID blocks tokenless confirmation'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    'e8c815f844e7e6b76c19264b41f4591ec46bb388855ca75d308e3d06c21a9b8f', 'c1000000-0000-4000-8000-000000000002',
    '5511900000018@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000108', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'missing blocking flag blocks token issuance'
);
select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000018@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000108', 1, 'message-missing-blocking', 'idem-missing-blocking', null,
    'e8c815f844e7e6b76c19264b41f4591ec46bb388855ca75d308e3d06c21a9b8f'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'missing blocking flag blocks tokenless confirmation'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '1f22ea5c029bf889f1b92f1831267ea8077fa512590cb3404135d08d7b66b01b', 'c1000000-0000-4000-8000-000000000002',
    '5511900000019@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000109', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'null blocking flag blocks token issuance'
);
select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000019@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000109', 1, 'message-null-blocking', 'idem-null-blocking', null,
    '1f22ea5c029bf889f1b92f1831267ea8077fa512590cb3404135d08d7b66b01b'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'null blocking flag blocks tokenless confirmation'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '30481b27bfbbfef6bfac8c7f1dd4a7df464ec46cd27ad9c782015da84694ef5b', 'c1000000-0000-4000-8000-000000000002',
    '5511900000020@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000110', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'string blocking flag blocks token issuance'
);
select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000020@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000110', 1, 'message-string-blocking', 'idem-string-blocking', null,
    '30481b27bfbbfef6bfac8c7f1dd4a7df464ec46cd27ad9c782015da84694ef5b'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'string blocking flag blocks tokenless confirmation'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '2299babab22153f37214e4b583007f2f84cc3199b22fa6bf47a58118a57bfa54', 'c1000000-0000-4000-8000-000000000002',
    '5511900000021@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000111', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'string revalidation flag blocks token issuance without a cast error'
);
select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000021@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000111', 1, 'message-string-revalidation', 'idem-string-revalidation', null,
    '2299babab22153f37214e4b583007f2f84cc3199b22fa6bf47a58118a57bfa54'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'string revalidation flag blocks tokenless confirmation without a cast error'
);

select ok(
  (select count(*) from public.zelomenu_whatsapp_confirmation_tokens where session_id in (
    'c1000000-0000-4000-8000-000000000102', 'c1000000-0000-4000-8000-000000000103',
    'c1000000-0000-4000-8000-000000000104', 'c1000000-0000-4000-8000-000000000105',
    'c1000000-0000-4000-8000-000000000106', 'c1000000-0000-4000-8000-000000000107',
    'c1000000-0000-4000-8000-000000000108', 'c1000000-0000-4000-8000-000000000109',
    'c1000000-0000-4000-8000-000000000110', 'c1000000-0000-4000-8000-000000000111',
    'c1000000-0000-4000-8000-000000000117'
  )) = 0
  and (select count(*) from public.zelo_orders where empresa_id = 'c1000000-0000-4000-8000-000000000002') = 2
  and (select estoque_atual from public.produtos where id = 2147482801) = 0
  and not exists (select 1 from public.zelomenu_cart_sessions where id in (
    'c1000000-0000-4000-8000-000000000102', 'c1000000-0000-4000-8000-000000000103',
    'c1000000-0000-4000-8000-000000000104', 'c1000000-0000-4000-8000-000000000105',
    'c1000000-0000-4000-8000-000000000106', 'c1000000-0000-4000-8000-000000000107',
    'c1000000-0000-4000-8000-000000000108', 'c1000000-0000-4000-8000-000000000109',
    'c1000000-0000-4000-8000-000000000110', 'c1000000-0000-4000-8000-000000000111',
    'c1000000-0000-4000-8000-000000000117'
  ) and (state <> 'cart_open' or revision <> 1))
  , 'all malformed readiness cases are write-free (token/order/stock/state/revision)'
);

-- ZM1: confirm now requires a token, so each of these otherwise-ready
-- sessions (the lineId problem only surfaces later, during materialization)
-- needs one legitimately issued first. Issuance is a bare fixture-setup
-- statement here (not a pgTAP assertion), matching the plan(40) below.
select public.issue_whatsapp_zelo_confirmation_token(
  '6d9baf59c9bec7c3bedbaa9e62001bff06686468b9a0490cb9647fb3cda921cc', 'c1000000-0000-4000-8000-000000000002',
  '5511900000022@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000114', 1, now() + interval '10 minutes'
);
select public.issue_whatsapp_zelo_confirmation_token(
  'a4d53767b1e12100a0df679b28f9ff02eed09ff4764d6cd9fda0c80497767be4', 'c1000000-0000-4000-8000-000000000002',
  '5511900000023@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000115', 1, now() + interval '10 minutes'
);
select public.issue_whatsapp_zelo_confirmation_token(
  '6b05c18aae1696a9b35ec8121ed654500c1ff1ce91d6209c3d8fb2a6c9d6498c', 'c1000000-0000-4000-8000-000000000002',
  '5511900000024@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000116', 1, now() + interval '10 minutes'
);

select is(
  (select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000022@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000114', 1, 'message-invalid-line', 'idem-invalid-line', null,
    '6d9baf59c9bec7c3bedbaa9e62001bff06686468b9a0490cb9647fb3cda921cc'
  )->>'outcome'),
  'requires_review', 'invalid lineId cannot create an order'
);
select is(
  (select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000023@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000115', 1, 'message-missing-line', 'idem-missing-line', null,
    'a4d53767b1e12100a0df679b28f9ff02eed09ff4764d6cd9fda0c80497767be4'
  )->>'outcome'),
  'requires_review', 'missing lineId cannot create an order'
);
select is(
  (select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', '5511900000024@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000116', 1, 'message-duplicate-line', 'idem-duplicate-line', null,
    '6b05c18aae1696a9b35ec8121ed654500c1ff1ce91d6209c3d8fb2a6c9d6498c'
  )->>'outcome'),
  'requires_review', 'duplicate lineId cannot create an order'
);
-- Invalid line identities update the review snapshot/revision by design. They
-- must not create an order, consume stock, or close the cart. The token each
-- session needed to even attempt confirmation is left invalidated (folded
-- into the same revision-bump cleanup that always invalidates the confirming
-- revision's token once a review snapshot is written) but never consumed --
-- proving the requires_review path still cannot forge an order.
select ok(
  (select count(*) from public.zelomenu_cart_sessions where id in (
    'c1000000-0000-4000-8000-000000000114',
    'c1000000-0000-4000-8000-000000000115',
    'c1000000-0000-4000-8000-000000000116'
  )) = 3
  and not exists (select 1 from public.zelo_orders where zelomenu_session_id in (
    'c1000000-0000-4000-8000-000000000114',
    'c1000000-0000-4000-8000-000000000115',
    'c1000000-0000-4000-8000-000000000116'
  ))
  and not exists (select 1 from public.zelomenu_whatsapp_confirmation_tokens where session_id in (
    'c1000000-0000-4000-8000-000000000114',
    'c1000000-0000-4000-8000-000000000115',
    'c1000000-0000-4000-8000-000000000116'
  ) and consumed_at is not null)
  and (select count(*) from public.zelomenu_whatsapp_confirmation_tokens where session_id in (
    'c1000000-0000-4000-8000-000000000114',
    'c1000000-0000-4000-8000-000000000115',
    'c1000000-0000-4000-8000-000000000116'
  ) and invalidated_at is not null) = 3
  and (select estoque_atual from public.produtos where id = 2147482801) = 0
  and not exists (select 1 from public.zelomenu_cart_sessions where id in (
    'c1000000-0000-4000-8000-000000000114',
    'c1000000-0000-4000-8000-000000000115',
    'c1000000-0000-4000-8000-000000000116'
  ) and state <> 'cart_open'),
  'invalid lineIds are no-order and consumption-free; each issued token ends up invalidated, never consumed'
);
select is(
  (select count(*)::integer from public.zelo_orders where empresa_id = 'c1000000-0000-4000-8000-000000000002'),
  2,
  'invalid, missing, and duplicate lineId cases create no additional order'
);

select is(
  (select count(*)::integer from public.zelo_orders
    where empresa_id = 'c1000000-0000-4000-8000-000000000002'),
  2,
  'all incomplete confirmation attempts create no additional order'
);

select is(
  (select revision from public.zelomenu_cart_sessions where id = 'c1000000-0000-4000-8000-000000000104'),
  1,
  'readiness rejection does not mutate revision'
);

select * from finish();

rollback;
