begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

select plan(9);

insert into auth.users (
  id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'b6000000-0000-4000-8000-000000000001',
  'component-parity@invalid.local',
  'authenticated', 'authenticated', '{}', '{}', now(), now()
);

insert into public.empresa_perfil (
  id, user_id, nome_exibicao, timezone, horario_semanal,
  delivery_config, zelomenu_scheduling_enabled, zelomenu_scheduling_lead_time_minutes
) values (
  'b6000000-0000-4000-8000-000000000002',
  'b6000000-0000-4000-8000-000000000001',
  'Loja do teste de componentes',
  'America/Sao_Paulo',
  '{"sun":[{"start":"00:00","end":"24:00"}],"mon":[{"start":"00:00","end":"24:00"}],"tue":[{"start":"00:00","end":"24:00"}],"wed":[{"start":"00:00","end":"24:00"}],"thu":[{"start":"00:00","end":"24:00"}],"fri":[{"start":"00:00","end":"24:00"}],"sat":[{"start":"00:00","end":"24:00"}]}'::jsonb,
  '{"enabled":false,"timezone":"America/Sao_Paulo"}'::jsonb,
  true,
  0
);

insert into public.categorias (id, id_usuario, nome)
values (
  2147482600,
  'b6000000-0000-4000-8000-000000000001',
  'Categoria do teste'
);

insert into public.produtos (
  id, id_usuario, id_categoria, nome, preco, controlar_estoque, estoque_atual
) values (
  2147482601,
  'b6000000-0000-4000-8000-000000000001',
  2147482600,
  'Produto base interno',
  10,
  false,
  0
);

insert into public.produtos (
  id, id_usuario, id_categoria, nome, preco, controlar_estoque, estoque_atual
) values (
  2147482602,
  'b6000000-0000-4000-8000-000000000001',
  2147482600,
  'Produto vinculado com estoque',
  5,
  true,
  6
);

insert into public.zelomenu_product_publications (
  id, id_usuario, id_produto, nome_publico, visivel_online, pausado_manualmente
) values (
  'b6000000-0000-4000-8000-000000000011',
  'b6000000-0000-4000-8000-000000000001',
  2147482601,
  'Produto base público',
  true,
  false
);

insert into public.zelomenu_product_publications (
  id, id_usuario, id_produto, nome_publico, visivel_online, pausado_manualmente
) values (
  'b6000000-0000-4000-8000-000000000012',
  'b6000000-0000-4000-8000-000000000001',
  2147482602,
  'Produto vinculado público',
  true,
  false
);

insert into public.zelomenu_modifier_groups (
  id, id_usuario, id_produto, nome, tipo, min_selecoes, max_selecoes,
  ativo, ordem, modo_preco, permite_quantidade, maximo_por_opcao,
  minimo_total_quantidade, maximo_total_quantidade
) values (
  'b6000000-0000-4000-8000-000000000021',
  'b6000000-0000-4000-8000-000000000001',
  2147482601,
  'Escolha obrigatória',
  'adicional',
  1,
  1,
  true,
  0,
  'somar',
  false,
  null,
  0,
  null
);

insert into public.zelomenu_modifier_groups (
  id, id_usuario, id_produto, nome, tipo, min_selecoes, max_selecoes,
  ativo, ordem, modo_preco, permite_quantidade, maximo_por_opcao,
  minimo_total_quantidade, maximo_total_quantidade
) values
(
  'b6000000-0000-4000-8000-000000000022',
  'b6000000-0000-4000-8000-000000000001',
  2147482601,
  'Primeiro grupo de estoque',
  'adicional',
  0,
  1,
  true,
  1,
  'somar',
  true,
  5,
  0,
  5
),
(
  'b6000000-0000-4000-8000-000000000023',
  'b6000000-0000-4000-8000-000000000001',
  2147482601,
  'Segundo grupo de estoque',
  'adicional',
  0,
  1,
  true,
  2,
  'somar',
  true,
  5,
  0,
  5
);

insert into public.zelomenu_modifier_options (
  id, id_usuario, id_grupo, nome, price_delta, ativo, ordem
) values (
  'b6000000-0000-4000-8000-000000000031',
  'b6000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000021',
  'Nome local antigo',
  99,
  true,
  0
);

insert into public.zelomenu_modifier_options (
  id, id_usuario, id_grupo, nome, price_delta, ativo, ordem
) values
(
  'b6000000-0000-4000-8000-000000000032',
  'b6000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000022',
  'Primeira opção vinculada',
  5,
  true,
  0
),
(
  'b6000000-0000-4000-8000-000000000033',
  'b6000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000023',
  'Segunda opção vinculada',
  5,
  true,
  0
);

insert into public.zelomenu_modifier_components (
  id, id_usuario, nome, nome_chave, pausado_manualmente
) values (
  'b6000000-0000-4000-8000-000000000041',
  'b6000000-0000-4000-8000-000000000001',
  'Queijo canônico',
  'queijo canonico',
  false
);

insert into public.zelomenu_modifier_option_products (
  id_opcao, id_usuario, id_componente, price_override
) values (
  'b6000000-0000-4000-8000-000000000031',
  'b6000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000041',
  2.50
);

insert into public.zelomenu_modifier_option_products (
  id_opcao, id_usuario, id_produto, price_override
) values
(
  'b6000000-0000-4000-8000-000000000032',
  'b6000000-0000-4000-8000-000000000001',
  2147482602,
  5
),
(
  'b6000000-0000-4000-8000-000000000033',
  'b6000000-0000-4000-8000-000000000001',
  2147482602,
  5
);

create temporary table component_parity_results (
  materialized jsonb,
  active_confirmation jsonb,
  paused_confirmation jsonb,
  stock_materialized jsonb,
  stock_six_confirmation jsonb,
  stock_seven_confirmation jsonb
) on commit drop;

grant select, insert, update on component_parity_results to service_role;

set local role service_role;

insert into component_parity_results (materialized)
select public.zelomenu_whatsapp_materialize_cart_v1(
  'b6000000-0000-4000-8000-000000000002',
  jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object(
      'lineId', 'component-active-line',
      'productId', 2147482601,
      'quantity', 1,
      'notes', null,
      'selectedModifiers', jsonb_build_array(jsonb_build_object(
        'groupId', 'b6000000-0000-4000-8000-000000000021',
        'selectedOptions', jsonb_build_array(jsonb_build_object(
          'optionId', 'b6000000-0000-4000-8000-000000000031',
          'quantity', 1
        ))
      ))
    )),
    'observations', null
  )
);

reset role;

select is(
  (select jsonb_array_length(materialized->'issues') from component_parity_results),
  0,
  'required component option is viable while its canonical component is active'
);

select is(
  (select materialized#>>'{cart,items,0,selectedModifiers,0,selectedOptions,0,optionName}'
     from component_parity_results),
  'Queijo canônico',
  'materialization resolves the canonical component name'
);

select is(
  (select (materialized#>>'{cart,items,0,selectedModifiers,0,selectedOptions,0,priceDelta}')::numeric
     from component_parity_results),
  2.50::numeric,
  'materialization retains the option-link price override for this component use'
);

select is(
  (select jsonb_array_length(materialized->'requirements') from component_parity_results),
  1,
  'component-only selection adds no product stock demand'
);

set local role service_role;

update component_parity_results
set stock_materialized = public.zelomenu_whatsapp_materialize_cart_v1(
  'b6000000-0000-4000-8000-000000000002',
  jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object(
        'lineId', 'stock-line-1',
        'productId', 2147482601,
        'quantity', 2,
        'notes', null,
        'selectedModifiers', jsonb_build_array(
          jsonb_build_object(
            'groupId', 'b6000000-0000-4000-8000-000000000021',
            'selectedOptions', jsonb_build_array(jsonb_build_object(
              'optionId', 'b6000000-0000-4000-8000-000000000031',
              'quantity', 1
            ))
          ),
          jsonb_build_object(
            'groupId', 'b6000000-0000-4000-8000-000000000022',
            'selectedOptions', jsonb_build_array(jsonb_build_object(
              'optionId', 'b6000000-0000-4000-8000-000000000032',
              'quantity', 2
            ))
          )
        )
      ),
      jsonb_build_object(
        'lineId', 'stock-line-2',
        'productId', 2147482601,
        'quantity', 3,
        'notes', null,
        'selectedModifiers', jsonb_build_array(
          jsonb_build_object(
            'groupId', 'b6000000-0000-4000-8000-000000000021',
            'selectedOptions', jsonb_build_array(jsonb_build_object(
              'optionId', 'b6000000-0000-4000-8000-000000000031',
              'quantity', 1
            ))
          ),
          jsonb_build_object(
            'groupId', 'b6000000-0000-4000-8000-000000000023',
            'selectedOptions', jsonb_build_array(jsonb_build_object(
              'optionId', 'b6000000-0000-4000-8000-000000000033',
              'quantity', 1
            ))
          )
        )
      )
    ),
    'observations', null
  )
);

reset role;

select is(
  (
    select issue->>'requiredQuantity'
    from component_parity_results results
    cross join lateral jsonb_array_elements(results.stock_materialized->'issues') issue
    where issue->>'code' = 'stock_unavailable'
      and issue->>'productId' = '2147482602'
  ),
  '7',
  'SQL materialization sums linked demand as 2x2 plus 3x1 across lines and groups'
);

insert into public.zelomenu_cart_sessions (
  id, empresa_id, context, state, source_ref, customer_snapshot, cart_snapshot,
  fulfillment_snapshot, pricing_snapshot, payment_snapshot, revision,
  requirements_snapshot, ready_for_confirmation
)
select
  session_id,
  'b6000000-0000-4000-8000-000000000002',
  'whatsapp_order',
  'cart_open',
  source_ref,
  '{"name":"Ana"}'::jsonb,
  results.materialized->'cart',
  '{"type":"pickup","asap":true,"pickupDate":null,"pickupTime":null,"deliveryAddress":null,"deliveryNeighborhood":null,"deliveryFee":0,"deliveryFeeToConfirm":false}'::jsonb,
  jsonb_build_object(
    'subtotal', (results.materialized->>'subtotal')::numeric,
    'deliveryFee', 0,
    'discount', 0,
    'couponCode', null,
    'couponDiscountType', null,
    'couponDiscountValue', null,
    'total', (results.materialized->>'subtotal')::numeric
  ),
  '{"declaredMethod":"dinheiro","pixReceiptRequired":false,"pixReceiptApproved":false}'::jsonb,
  1,
  '[]'::jsonb,
  true
from component_parity_results results
cross join (values
  ('b6000000-0000-4000-8000-000000000051'::uuid, 'component-active@s.whatsapp.net'),
  ('b6000000-0000-4000-8000-000000000052'::uuid, 'component-paused@s.whatsapp.net')
) sessions(session_id, source_ref);

insert into public.zelomenu_cart_sessions (
  id, empresa_id, context, state, source_ref, customer_snapshot, cart_snapshot,
  fulfillment_snapshot, pricing_snapshot, payment_snapshot, revision,
  requirements_snapshot, ready_for_confirmation
)
select
  session_id,
  'b6000000-0000-4000-8000-000000000002',
  'whatsapp_order',
  'cart_open',
  source_ref,
  '{"name":"Ana"}'::jsonb,
  results.stock_materialized->'cart',
  '{"type":"pickup","asap":true,"pickupDate":null,"pickupTime":null,"deliveryAddress":null,"deliveryNeighborhood":null,"deliveryFee":0,"deliveryFeeToConfirm":false}'::jsonb,
  jsonb_build_object(
    'subtotal', (results.stock_materialized->>'subtotal')::numeric,
    'deliveryFee', 0,
    'discount', 0,
    'couponCode', null,
    'couponDiscountType', null,
    'couponDiscountValue', null,
    'total', (results.stock_materialized->>'subtotal')::numeric
  ),
  '{"declaredMethod":"dinheiro","pixReceiptRequired":false,"pixReceiptApproved":false}'::jsonb,
  1,
  '[]'::jsonb,
  true
from component_parity_results results
cross join (values
  ('b6000000-0000-4000-8000-000000000053'::uuid, 'stock-six@s.whatsapp.net'),
  ('b6000000-0000-4000-8000-000000000054'::uuid, 'stock-seven@s.whatsapp.net')
) sessions(session_id, source_ref);

set local role service_role;

update component_parity_results
set active_confirmation = public.confirm_whatsapp_zelo_order_atomic_v1(
  'b6000000-0000-4000-8000-000000000002',
  'component-active@s.whatsapp.net',
  'b6000000-0000-4000-8000-000000000051',
  1,
  'message-component-active',
  'idem-component-active',
  null,
  null
);

reset role;

select ok(
  (select active_confirmation->>'outcome' = 'confirmed' from component_parity_results)
  and exists (
    select 1 from public.zelo_orders
    where zelomenu_session_id = 'b6000000-0000-4000-8000-000000000051'
  ),
  'atomic confirmation accepts an active canonical component'
);

set local role service_role;

update component_parity_results
set stock_six_confirmation = public.confirm_whatsapp_zelo_order_atomic_v1(
  'b6000000-0000-4000-8000-000000000002',
  'stock-six@s.whatsapp.net',
  'b6000000-0000-4000-8000-000000000053',
  1,
  'message-stock-six',
  'idem-stock-six',
  null,
  null
);

reset role;

select ok(
  (select stock_six_confirmation->>'outcome' = 'requires_review'
     and exists (
       select 1
       from jsonb_array_elements(stock_six_confirmation->'issues') issue
       where issue->>'code' = 'stock_unavailable'
         and issue->>'productId' = '2147482602'
         and issue->>'requiredQuantity' = '7'
     )
   from component_parity_results)
  and not exists (
    select 1 from public.zelo_orders
    where zelomenu_session_id = 'b6000000-0000-4000-8000-000000000053'
  ),
  'atomic confirmation rejects stock 6 for aggregate linked demand 7'
);

update public.produtos
set estoque_atual = 7
where id = 2147482602;

set local role service_role;

update component_parity_results
set stock_seven_confirmation = public.confirm_whatsapp_zelo_order_atomic_v1(
  'b6000000-0000-4000-8000-000000000002',
  'stock-seven@s.whatsapp.net',
  'b6000000-0000-4000-8000-000000000054',
  1,
  'message-stock-seven',
  'idem-stock-seven',
  null,
  null
);

reset role;

select ok(
  (select stock_seven_confirmation->>'outcome' = 'confirmed' from component_parity_results)
  and exists (
    select 1 from public.zelo_orders
    where zelomenu_session_id = 'b6000000-0000-4000-8000-000000000054'
  ),
  'atomic confirmation accepts stock 7 for aggregate linked demand 7'
);

update public.zelomenu_modifier_components
set pausado_manualmente = true,
    updated_at = now()
where id = 'b6000000-0000-4000-8000-000000000041';

set local role service_role;

update component_parity_results
set paused_confirmation = public.confirm_whatsapp_zelo_order_atomic_v1(
  'b6000000-0000-4000-8000-000000000002',
  'component-paused@s.whatsapp.net',
  'b6000000-0000-4000-8000-000000000052',
  1,
  'message-component-paused',
  'idem-component-paused',
  null,
  null
);

reset role;

select ok(
  (select paused_confirmation->>'outcome' = 'requires_review'
     and exists (
       select 1
       from jsonb_array_elements(paused_confirmation->'issues') issue
       where issue->>'code' in ('required_group_unavailable', 'modifier_unavailable')
     )
   from component_parity_results)
  and not exists (
    select 1 from public.zelo_orders
    where zelomenu_session_id = 'b6000000-0000-4000-8000-000000000052'
  ),
  'pausing the component after summary forces transactional review and creates no order'
);

select * from finish();

rollback;
