begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

select plan(38);

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
  'valid-text@s.whatsapp.net',
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
  'not-ready@s.whatsapp.net',
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
  'blank-name@s.whatsapp.net',
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
  'null-payment@s.whatsapp.net',
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
  'blocking-requirement@s.whatsapp.net',
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
  'delivery-incomplete@s.whatsapp.net',
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
  'scheduled-incomplete@s.whatsapp.net',
  '{"name":"Ana","phone":null}'::jsonb,
  '{"items":[{"lineId":"line-ready","productId":2147482801,"productName":"Produto de integridade","baseUnitPrice":10,"selectedModifiers":[],"modifierDeltaTotal":0,"quantity":1,"unitPrice":10,"lineTotal":10,"notes":null}],"observations":null}'::jsonb,
  '{"type":"pickup","asap":false,"pickupDate":null,"pickupTime":null,"deliveryAddress":null,"deliveryNeighborhood":null,"deliveryFee":0,"deliveryFeeToConfirm":false}'::jsonb,
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
    ('c1000000-0000-4000-8000-000000000108'::uuid, 'c1000000-0000-4000-8000-000000000208'::uuid, 'missing-blocking@s.whatsapp.net', '[{"id":"bad"}]'::jsonb, '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb),
    ('c1000000-0000-4000-8000-000000000109'::uuid, 'c1000000-0000-4000-8000-000000000209'::uuid, 'null-blocking@s.whatsapp.net', '[{"blocking":null}]'::jsonb, '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb),
    ('c1000000-0000-4000-8000-000000000110'::uuid, 'c1000000-0000-4000-8000-000000000210'::uuid, 'string-blocking@s.whatsapp.net', '[{"blocking":"false"}]'::jsonb, '{"checkedAt":"2026-09-02T12:00:00Z","ok":true,"issues":[]}'::jsonb),
    ('c1000000-0000-4000-8000-000000000111'::uuid, 'c1000000-0000-4000-8000-000000000211'::uuid, 'string-revalidation@s.whatsapp.net', '[]'::jsonb, '{"checkedAt":"2026-09-02T12:00:00Z","ok":"true","issues":[]}'::jsonb)
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
      'invalid-line@s.whatsapp.net',
      '{"items":[{"lineId":"bad id","productId":2147482801,"quantity":1,"selectedModifiers":[]}],"observations":null}'::jsonb
    ),
    (
      'c1000000-0000-4000-8000-000000000115'::uuid,
      'c1000000-0000-4000-8000-000000000215'::uuid,
      'missing-line@s.whatsapp.net',
      '{"items":[{"productId":2147482801,"quantity":1,"selectedModifiers":[]}],"observations":null}'::jsonb
    ),
    (
      'c1000000-0000-4000-8000-000000000116'::uuid,
      'c1000000-0000-4000-8000-000000000216'::uuid,
      'duplicate-line@s.whatsapp.net',
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

insert into public.zelomenu_cart_sessions (
  id, ordering_id, empresa_id, context, state, source_ref,
  customer_snapshot, cart_snapshot, fulfillment_snapshot, pricing_snapshot,
  payment_snapshot, metadata, revision, last_revalidated_at, last_revalidation,
  requirements_snapshot, ready_for_confirmation
)
select
  'c1000000-0000-4000-8000-000000000112', 'c1000000-0000-4000-8000-000000000212',
  empresa_id, context, state, 'button@s.whatsapp.net', customer_snapshot,
  cart_snapshot, fulfillment_snapshot, pricing_snapshot, payment_snapshot,
  metadata, revision, last_revalidated_at, last_revalidation,
  requirements_snapshot, ready_for_confirmation
from public.zelomenu_cart_sessions
where id = 'c1000000-0000-4000-8000-000000000101';

set local role service_role;

select lives_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    'f77e3ef1c60015a3bce4d2f81401f549a8b3b56f30c7f4b4e20d1607f63e9480', 'c1000000-0000-4000-8000-000000000002',
    'valid-text@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000101', 1, now() + interval '10 minutes'
  ) $sql$,
  'complete ready revision issues a confirmation token'
);

select is(
  (select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'valid-text@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000101', 1, 'message-valid', 'idem-valid', null, null
  )->>'outcome'),
  'confirmed',
  'complete ready revision confirms without a token for text confirmation'
);

select ok(
  exists (select 1 from public.zelo_orders where zelomenu_session_id = 'c1000000-0000-4000-8000-000000000101')
  and (select state <> 'cart_open' from public.zelomenu_cart_sessions where id = 'c1000000-0000-4000-8000-000000000101'),
  'successful confirmation creates one order and closes the cart'
);

select lives_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '1617eac6dadb9bdcb2004d85fd9c8b9d0a11f85ca19b50c6d67f5b04968d5705', 'c1000000-0000-4000-8000-000000000002',
    'button@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000112', 1, now() + interval '10 minutes'
  ) $sql$,
  'complete ready revision issues a live button token'
);
select is(
  (select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'button@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000112', 1, 'message-button', 'idem-button', null, '1617eac6dadb9bdcb2004d85fd9c8b9d0a11f85ca19b50c6d67f5b04968d5705'
  )->>'outcome'),
  'confirmed',
  'matching live button token confirms the ready revision'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    'a08663301e123a40d1162222e94854078f06ec383c60789455e0a4698d534dca', 'c1000000-0000-4000-8000-000000000002',
    'not-ready@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000102', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY',
  'stored false readiness blocks token issuance'
);

select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'not-ready@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000102', 1, 'message-not-ready', 'idem-not-ready', null, null
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY',
  'stored false readiness blocks tokenless confirmation'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    'e0f67bbda9022940293d103c2a6a83cc1133da9c9f36f418cdbf83a8aa204d26', 'c1000000-0000-4000-8000-000000000002',
    'blank-name@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000103', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'blank customer name blocks token issuance'
);

select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'blank-name@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000103', 1, 'message-blank-name', 'idem-blank-name', null, null
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY',
  'blank customer name cannot bypass the readiness predicate'
);

select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'null-payment@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000104', 1, 'message-null-payment', 'idem-null-payment', null, null
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY',
  'null payment method cannot bypass the readiness predicate'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '771080a5b60047c896f6f2c2ef8ce4061e661f14d3252150f0908401018d191a', 'c1000000-0000-4000-8000-000000000002',
    'null-payment@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000104', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'null payment method blocks token issuance'
);

select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'blocking-requirement@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000105', 1, 'message-blocking', 'idem-blocking', null, null
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY',
  'blocking requirement cannot bypass the readiness predicate'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '73c02b534d1f0456191965ac51576bfde31b61a79f7744d796ea1324cac88749', 'c1000000-0000-4000-8000-000000000002',
    'blocking-requirement@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000105', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'blocking requirement blocks token issuance'
);

select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'delivery-incomplete@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000106', 1, 'message-delivery', 'idem-delivery', null, null
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY',
  'incomplete delivery address cannot bypass the readiness predicate'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    'cea9702a5ca49f4fdd01fad4afe21cbce52b8bebc64de73b7652c31f62fe5491', 'c1000000-0000-4000-8000-000000000002',
    'delivery-incomplete@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000106', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'incomplete delivery address blocks token issuance'
);

select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'scheduled-incomplete@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000107', 1, 'message-schedule', 'idem-schedule', null, null
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY',
  'missing scheduled date/time cannot bypass the readiness predicate'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '3ff76f900f3b75cd4a3980a394b39b2c417710ccbbecb2e445bdeb78002bf219', 'c1000000-0000-4000-8000-000000000002',
    'scheduled-incomplete@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000107', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'missing scheduled date/time blocks token issuance'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    'e8c815f844e7e6b76c19264b41f4591ec46bb388855ca75d308e3d06c21a9b8f', 'c1000000-0000-4000-8000-000000000002',
    'missing-blocking@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000108', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'missing blocking flag blocks token issuance'
);
select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'missing-blocking@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000108', 1, 'message-missing-blocking', 'idem-missing-blocking', null, null
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'missing blocking flag blocks tokenless confirmation'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '1f22ea5c029bf889f1b92f1831267ea8077fa512590cb3404135d08d7b66b01b', 'c1000000-0000-4000-8000-000000000002',
    'null-blocking@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000109', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'null blocking flag blocks token issuance'
);
select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'null-blocking@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000109', 1, 'message-null-blocking', 'idem-null-blocking', null, null
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'null blocking flag blocks tokenless confirmation'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '30481b27bfbbfef6bfac8c7f1dd4a7df464ec46cd27ad9c782015da84694ef5b', 'c1000000-0000-4000-8000-000000000002',
    'string-blocking@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000110', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'string blocking flag blocks token issuance'
);
select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'string-blocking@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000110', 1, 'message-string-blocking', 'idem-string-blocking', null, null
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'string blocking flag blocks tokenless confirmation'
);

select throws_ok(
  $sql$ select public.issue_whatsapp_zelo_confirmation_token(
    '2299babab22153f37214e4b583007f2f84cc3199b22fa6bf47a58118a57bfa54', 'c1000000-0000-4000-8000-000000000002',
    'string-revalidation@s.whatsapp.net', 'c1000000-0000-4000-8000-000000000111', 1, now() + interval '10 minutes'
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'string revalidation flag blocks token issuance without a cast error'
);
select throws_ok(
  $sql$ select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'string-revalidation@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000111', 1, 'message-string-revalidation', 'idem-string-revalidation', null, null
  ) $sql$,
  'ZL409', 'ORDER_NOT_READY', 'string revalidation flag blocks tokenless confirmation without a cast error'
);

select ok(
  (select count(*) from public.zelomenu_whatsapp_confirmation_tokens where session_id in (
    'c1000000-0000-4000-8000-000000000102', 'c1000000-0000-4000-8000-000000000103',
    'c1000000-0000-4000-8000-000000000104', 'c1000000-0000-4000-8000-000000000105',
    'c1000000-0000-4000-8000-000000000106', 'c1000000-0000-4000-8000-000000000107',
    'c1000000-0000-4000-8000-000000000108', 'c1000000-0000-4000-8000-000000000109',
    'c1000000-0000-4000-8000-000000000110', 'c1000000-0000-4000-8000-000000000111'
  )) = 0
  and (select count(*) from public.zelo_orders where empresa_id = 'c1000000-0000-4000-8000-000000000002') = 2
  and (select estoque_atual from public.produtos where id = 2147482801) = 0
  and not exists (select 1 from public.zelomenu_cart_sessions where id in (
    'c1000000-0000-4000-8000-000000000102', 'c1000000-0000-4000-8000-000000000103',
    'c1000000-0000-4000-8000-000000000104', 'c1000000-0000-4000-8000-000000000105',
    'c1000000-0000-4000-8000-000000000106', 'c1000000-0000-4000-8000-000000000107',
    'c1000000-0000-4000-8000-000000000108', 'c1000000-0000-4000-8000-000000000109',
    'c1000000-0000-4000-8000-000000000110', 'c1000000-0000-4000-8000-000000000111'
  ) and (state <> 'cart_open' or revision <> 1))
  , 'all malformed readiness cases are write-free (token/order/stock/state/revision)'
);

select is(
  (select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'invalid-line@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000114', 1, 'message-invalid-line', 'idem-invalid-line', null, null
  )->>'outcome'),
  'requires_review', 'invalid lineId cannot create an order'
);
select is(
  (select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'missing-line@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000115', 1, 'message-missing-line', 'idem-missing-line', null, null
  )->>'outcome'),
  'requires_review', 'missing lineId cannot create an order'
);
select is(
  (select public.confirm_whatsapp_zelo_order_atomic_v1(
    'c1000000-0000-4000-8000-000000000002', 'duplicate-line@s.whatsapp.net',
    'c1000000-0000-4000-8000-000000000116', 1, 'message-duplicate-line', 'idem-duplicate-line', null, null
  )->>'outcome'),
  'requires_review', 'duplicate lineId cannot create an order'
);
-- Invalid line identities update the review snapshot/revision by design. They
-- must not create an order or token, consume stock, or close the cart.
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
  ))
  and (select estoque_atual from public.produtos where id = 2147482801) = 0
  and not exists (select 1 from public.zelomenu_cart_sessions where id in (
    'c1000000-0000-4000-8000-000000000114',
    'c1000000-0000-4000-8000-000000000115',
    'c1000000-0000-4000-8000-000000000116'
  ) and state <> 'cart_open'),
  'invalid lineIds are no-order and write-free for token, stock, and terminal state'
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
