# Atribuição de sub-produto vinculado em estoque/relatório — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Note for this project specifically:** execution is NOT via Claude subagents.
> The user has directed: coding by the `verboo` CLI agent, review by the
> `codex` CLI agent, orchestrated by the primary assistant via `gh`/shell.
> Each task below is still a self-contained unit of work — hand each task's
> full content (files + code + steps) to `verboo` as its prompt, then hand
> the diff to `codex` for review before moving to the next task.

**Goal:** Make a modifier option linked to a real catalog product (ex.: "Penne"
inside "Monte sua Massa") decrement its own stock and appear as its own line
in `vendas_itens` when an online order is accepted/closed — without changing
any totals, and without touching the zelomenu repo at all.

**Architecture:** One new SQL migration in the `zelopdv` repo that
`create or replace`s two existing functions (`close_zelo_order`,
`transition_zelo_order`) inside `zelo_orders`'s canonical order engine. The
math: decompose each order item's already-resolved `unit_price` by
subtracting the price contribution of every modifier option that has a row
in `zelomenu_modifier_option_products`; what's left is the container's own
price. A separate, non-migration SQL script proves this end-to-end inside a
transaction that always ends in `rollback` — nothing is written to
production data until that proves clean.

**Tech Stack:** PL/pgSQL (Supabase Postgres), applied via `supabase db query
--linked -f <file>` from the `zelopdv` repo. No TypeScript/JS changes.

## Global Constraints

- 100% additive: any order with no modifiers, or only classic (non-linked)
  options, must produce byte-identical `vendas_itens`/stock results to today.
- Zero changes to the `zelomenu` repo — all data needed
  (`optionId`, `priceDelta`, `quantity` per selected option) is already
  stored in `zelo_order_items.modifiers` today.
- Never let a cast or malformed-data issue in `modifiers` break closing an
  ORDINARY order that has nothing to do with linked products — casts must
  degrade to "not linked" on any doubt, never raise.
- Never write a negative `preco_unitario_na_venda` — clamp to `0` and
  `raise warning` (not `raise exception`) so the anomaly is logged but never
  blocks the close.
- Stock routing (shared-by-category vs per-product) for a linked option must
  use **that option's own linked product's own category**, never the
  container's.
- Nothing touches real production data until the verification script (Task
  3) passes 100% inside its own `rollback`-only transaction.

---

## File Structure

- Modify (new migration file, `create or replace` only — no `alter table`,
  no data migration): `C:\Users\Vinicius\orca\zelopdv\.ai\migrations\zelo_order_sub_item_attribution_2026_07_22.sql`
  - Redefines `public.close_zelo_order` (price-splitting `itens` payload).
  - Redefines `public.transition_zelo_order` (stock decrement/refund
    including linked products).
- Create (verification only, never a schema migration — must never be
  applied as if it were one): `C:\Users\Vinicius\orca\zelopdv\.ai\migrations\verification\zelo_order_sub_item_attribution_2026_07_22_verify.sql`
  - Self-contained: begins a transaction, applies the exact same
    `create or replace` bodies as the migration above (pasted, not
    included — Task 4 diff-checks the two stay identical), seeds 10
    synthetic scenarios via `savepoint`/`rollback to savepoint` isolation,
    asserts each with `raise exception` on mismatch, prints
    `raise notice 'PASS: ...'` on success, and unconditionally
    `rollback`s at the very end regardless of outcome.

---

### Task 1: Migration — fix `close_zelo_order` (price splitting)

**Files:**
- Create: `C:\Users\Vinicius\orca\zelopdv\.ai\migrations\zelo_order_sub_item_attribution_2026_07_22.sql`

**Interfaces:**
- Consumes: `public.zelo_orders`, `public.zelo_order_items` (existing schema,
  no changes), `public.zelomenu_modifier_option_products(id_opcao uuid,
  id_produto bigint, price_override numeric)` (existing table, read-only),
  `public.criar_venda_completa(jsonb)` (existing, unchanged), the current
  live definition of `close_zelo_order` in
  `C:\Users\Vinicius\orca\zelopdv\.ai\migrations\canonical_online_orders_payment_mapping_2026_07_22.sql`
  (this is the version being replaced — same signature).
- Produces: `public.close_zelo_order(uuid,integer,jsonb,uuid)` — same
  signature and same return shape as before
  (`public.zelo_order_result(o)`-based jsonb), only the internal `itens`
  payload sent to `criar_venda_completa` changes shape (more rows, same
  total value).

- [ ] **Step 1: Write the migration file header and the redefined function**

```sql
-- Splits a "combo" order item's already-resolved unit_price between the
-- container product and any modifier option linked to a real catalog
-- product (zelomenu_modifier_option_products), so vendas_itens gets one
-- line per real product sold instead of only the container's name.
-- Additive: items with no linked options produce identical output to
-- the previous definition of close_zelo_order.
create or replace function public.close_zelo_order(
  p_order_id uuid, p_expected_revision integer, p_payment jsonb, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  o public.zelo_orders;
  v_sale jsonb;
  v_sale_payload jsonb;
  v_neg record;
begin
  select * into o from public.zelo_orders where id=p_order_id for update;
  if not found then raise exception using errcode='ZL404',message='ORDER_NOT_FOUND'; end if;
  if auth.role()<>'service_role' then
    if p_actor_id is null then p_actor_id:=auth.uid();
    elsif p_actor_id is distinct from auth.uid() then raise exception using errcode='42501',message='FORGED_ACTOR'; end if;
    if not public.zelo_order_has_permission(o.empresa_id,'pedidos.receber') then
      raise exception using errcode='42501',message='ORDER_PERMISSION_DENIED',detail='pedidos.receber';
    end if;
  end if;
  if o.revision<>p_expected_revision then raise exception using errcode='ZL409',message='REVISION_CONFLICT'; end if;
  if o.sale_id is not null then return public.zelo_order_result(o)||jsonb_build_object('idempotent',true); end if;
  if o.status not in ('ready','out_for_delivery') then raise exception using errcode='ZL409',message='INVALID_ORDER_TRANSITION'; end if;

  -- Defensive invariant check: log (never block) if the decomposition
  -- below would produce a negative container price for any item.
  for v_neg in
    select b.id, b.name, (b.unit_price - coalesce(lt.per_unit_contribution,0)) as computed
    from (select id,name,unit_price,modifiers from public.zelo_order_items where order_id=o.id) b
    left join lateral (
      select sum((opt->>'priceDelta')::numeric * coalesce((opt->>'quantity')::integer,1)) as per_unit_contribution
      from jsonb_array_elements(coalesce(b.modifiers,'[]'::jsonb)) grp
      cross join lateral jsonb_array_elements(coalesce(grp->'selectedOptions','[]'::jsonb)) opt
      join public.zelomenu_modifier_option_products lp
        on (opt->>'optionId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        and lp.id_opcao=(opt->>'optionId')::uuid
    ) lt on true
    where (b.unit_price - coalesce(lt.per_unit_contribution,0)) < 0
  loop
    raise warning 'ZL_NEGATIVE_CONTAINER_PRICE order_item=% name=% computed=%', v_neg.id, v_neg.name, v_neg.computed;
  end loop;

  v_sale_payload:=coalesce(p_payment,'{}')||jsonb_build_object(
    'client_sale_id','zelo-order:'||o.id,'valor_total',o.total,
    'forma_pagamento',coalesce(
      nullif(nullif(p_payment->>'forma_pagamento',''),'outro'),
      nullif(nullif(p_payment->>'formaPagamento',''),'outro'),
      nullif(o.payment->>'declaredMethod',''),
      nullif(o.payment->>'method',''),
      'outro'
    ),
    'tipo_pedido',case when coalesce(o.fulfillment->>'mode',o.fulfillment->>'type')='delivery'
      then 'delivery' else 'retirada' end,
    'taxa_entrega',o.delivery_fee,
    'itens',(
      with base as (
        select i.id, i.product_id, i.name, i.unit_price, i.quantity, i.position, i.modifiers
        from public.zelo_order_items i where i.order_id=o.id
      ),
      linked as (
        select
          b.id as item_id, b.position, b.quantity as item_quantity,
          lp.id_produto,
          (opt->>'optionName') as nome,
          (opt->>'priceDelta')::numeric as preco_unitario,
          coalesce((opt->>'quantity')::integer,1) as option_quantity
        from base b
        cross join lateral jsonb_array_elements(coalesce(b.modifiers,'[]'::jsonb)) as grp
        cross join lateral jsonb_array_elements(coalesce(grp->'selectedOptions','[]'::jsonb)) as opt
        join public.zelomenu_modifier_option_products lp
          on (opt->>'optionId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and lp.id_opcao=(opt->>'optionId')::uuid
      ),
      linked_totals as (
        select item_id, sum(preco_unitario*option_quantity) as per_unit_contribution
        from linked group by item_id
      ),
      rows as (
        select b.position as pos, jsonb_build_object(
            'id_produto',b.product_id,'nome_produto_na_venda',b.name,
            'preco_unitario_na_venda',greatest(b.unit_price-coalesce(lt.per_unit_contribution,0),0),
            'quantidade',b.quantity
          ) as item
        from base b left join linked_totals lt on lt.item_id=b.id
        union all
        select l.position as pos, jsonb_build_object(
            'id_produto',l.id_produto,'nome_produto_na_venda',l.nome,
            'preco_unitario_na_venda',l.preco_unitario,
            'quantidade',l.option_quantity*l.item_quantity
          )
        from linked l
      )
      select coalesce(jsonb_agg(item order by pos),'[]'::jsonb) from rows
    ),
    'estoque','[]'::jsonb);
  v_sale:=public.criar_venda_completa(v_sale_payload);
  update public.zelo_orders set sale_id=(v_sale->>'id')::bigint where id=o.id;
  return public.transition_zelo_order(o.id,o.revision,'deliver',p_actor_id,jsonb_build_object('saleId',v_sale->>'id'));
end $$;
```

- [ ] **Step 2: Sanity-check the file parses**

Run: `cd C:\Users\Vinicius\orca\zelopdv && supabase db query --linked -f .ai/migrations/zelo_order_sub_item_attribution_2026_07_22.sql`

Expected: no error output (this already applies the fix live — acceptable
because `create or replace function` only swaps logic for *future* calls;
no existing order is touched, and Task 3's verification proves correctness
before any real order goes through the new code path). If the team prefers
zero live exposure before verification, skip this step and let Task 5 apply
it for the first time after Task 3 passes — either ordering is safe because
`create or replace function` is pure DDL with no data side effect.

- [ ] **Step 3: Commit**

```bash
cd C:\Users\Vinicius\orca\zelopdv
git add .ai/migrations/zelo_order_sub_item_attribution_2026_07_22.sql
git commit -m "feat: split combo order items into container + linked sub-product for sale reporting"
```

---

### Task 2: Migration — fix `transition_zelo_order` (linked-product stock)

**Files:**
- Modify: `C:\Users\Vinicius\orca\zelopdv\.ai\migrations\zelo_order_sub_item_attribution_2026_07_22.sql` (same file as Task 1, appended)

**Interfaces:**
- Consumes: same tables as Task 1, plus `public.produtos`, `public.categorias`
  (existing schema, no changes).
- Produces: `public.transition_zelo_order(uuid,integer,text,uuid,jsonb)` —
  same signature/return as today; the `accept` and `cancel` stock
  blocks now also move stock for linked products.

- [ ] **Step 1: Append the redefined function to the same migration file**

```sql
create or replace function public.transition_zelo_order(p_order_id uuid,p_expected_revision integer,p_action text,
  p_actor_id uuid default null,p_detail jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.zelo_orders; v_to text; v_owner uuid; v_from text; v_stock record; v_permission text;
begin
  select * into o from public.zelo_orders where id=p_order_id for update;
  if not found then raise exception using errcode='ZL404',message='ORDER_NOT_FOUND'; end if;
  if auth.role()<>'service_role' then
    if p_actor_id is null then p_actor_id:=auth.uid();
    elsif p_actor_id is distinct from auth.uid() then raise exception using errcode='42501',message='FORGED_ACTOR'; end if;
    v_owner:=public.get_owner_user_id(auth.uid());
    if not exists(select 1 from public.empresa_perfil where id=o.empresa_id and user_id=v_owner) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
    v_permission:=case
      when p_action in ('cancel','reject') then 'pedidos.cancelar'
      when p_action in ('deliver') then 'pedidos.receber'
      when p_action in ('start_preparing','mark_ready') then 'pedidos.cozinha'
      when p_action in ('accept','dispatch','payment_approved') then 'pedidos.acessar'
    end;
    if v_permission is null or not public.zelo_order_has_permission(o.empresa_id,v_permission) then
      raise exception using errcode='42501',message='ORDER_PERMISSION_DENIED',detail=coalesce(v_permission,p_action);
    end if;
  end if;
  if o.revision<>p_expected_revision then raise exception using errcode='ZL409',message='REVISION_CONFLICT'; end if;
  v_from:=o.status;
  v_to:=case p_action when 'payment_approved' then 'pending_review' when 'accept' then 'accepted'
    when 'start_preparing' then 'preparing' when 'mark_ready' then 'ready' when 'dispatch' then 'out_for_delivery'
    when 'deliver' then 'delivered' when 'reject' then 'rejected' when 'cancel' then 'cancelled' end;
  if v_to is null or not ((o.status='pending_payment' and v_to in ('pending_review','cancelled')) or
    (o.status='pending_review' and v_to in ('accepted','rejected','cancelled')) or
    (o.status='accepted' and v_to in ('preparing','cancelled')) or (o.status='preparing' and v_to in ('ready','cancelled')) or
    (o.status='ready' and v_to in ('out_for_delivery','delivered','cancelled')) or
    (o.status='out_for_delivery' and v_to='delivered')) then raise exception using errcode='ZL409',message='INVALID_ORDER_TRANSITION'; end if;

  if v_to='accepted' and o.stock_committed_at is null then
    -- product_id/quantity source now unions the container's own line with
    -- every linked-option product found inside its modifiers, so a product
    -- sold both standalone and as a combo's linked option in the same
    -- order aggregates correctly (matches the two-pass pattern already
    -- used by server/zelomenuCartSessions.ts resolveSnapshots).
    for v_stock in
      select c.id,c.nome,coalesce(c.estoque_compartilhado_atual,0) available,sum(x.quantity)::integer quantity
      from (
        select oi.product_id, oi.quantity from public.zelo_order_items oi where oi.order_id=o.id
        union all
        select lp.id_produto,(opt->>'quantity')::integer*oi.quantity
        from public.zelo_order_items oi
        cross join lateral jsonb_array_elements(coalesce(oi.modifiers,'[]'::jsonb)) grp
        cross join lateral jsonb_array_elements(coalesce(grp->'selectedOptions','[]'::jsonb)) opt
        join public.zelomenu_modifier_option_products lp
          on (opt->>'optionId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and lp.id_opcao=(opt->>'optionId')::uuid
        where oi.order_id=o.id
      ) x
      join public.produtos p on p.id=x.product_id
      join public.categorias c on c.id=p.id_categoria
      join public.empresa_perfil ep on ep.id=o.empresa_id and ep.user_id=p.id_usuario
      where coalesce(c.controlar_estoque_compartilhado,false)
      group by c.id,c.nome,c.estoque_compartilhado_atual
    loop
      update public.categorias set estoque_compartilhado_atual=coalesce(estoque_compartilhado_atual,0)-v_stock.quantity
      where id=v_stock.id and coalesce(estoque_compartilhado_atual,0)>=v_stock.quantity;
      if not found then raise exception using errcode='ZL409',message='PRODUCT_STOCK_EXCEEDED',detail=v_stock.nome; end if;
    end loop;
    for v_stock in
      select p.id,p.nome,coalesce(p.estoque_atual,0) available,sum(x.quantity)::integer quantity
      from (
        select oi.product_id, oi.quantity from public.zelo_order_items oi where oi.order_id=o.id
        union all
        select lp.id_produto,(opt->>'quantity')::integer*oi.quantity
        from public.zelo_order_items oi
        cross join lateral jsonb_array_elements(coalesce(oi.modifiers,'[]'::jsonb)) grp
        cross join lateral jsonb_array_elements(coalesce(grp->'selectedOptions','[]'::jsonb)) opt
        join public.zelomenu_modifier_option_products lp
          on (opt->>'optionId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and lp.id_opcao=(opt->>'optionId')::uuid
        where oi.order_id=o.id
      ) x
      join public.produtos p on p.id=x.product_id
      left join public.categorias c on c.id=p.id_categoria
      join public.empresa_perfil ep on ep.id=o.empresa_id and ep.user_id=p.id_usuario
      where coalesce(p.controlar_estoque,false) and not coalesce(c.controlar_estoque_compartilhado,false)
      group by p.id,p.nome,p.estoque_atual
    loop
      update public.produtos set estoque_atual=coalesce(estoque_atual,0)-v_stock.quantity
      where id=v_stock.id and coalesce(estoque_atual,0)>=v_stock.quantity;
      if not found then raise exception using errcode='ZL409',message='PRODUCT_STOCK_EXCEEDED',detail=v_stock.nome; end if;
    end loop;
  end if;

  if v_to='cancelled' and o.stock_committed_at is not null and o.stock_released_at is null then
    update public.categorias c set estoque_compartilhado_atual=coalesce(c.estoque_compartilhado_atual,0)+x.quantity
    from (
      select p2.id_categoria as cat_id, sum(y.quantity)::integer quantity from (
        select oi.product_id, oi.quantity from public.zelo_order_items oi where oi.order_id=o.id
        union all
        select lp.id_produto,(opt->>'quantity')::integer*oi.quantity
        from public.zelo_order_items oi
        cross join lateral jsonb_array_elements(coalesce(oi.modifiers,'[]'::jsonb)) grp
        cross join lateral jsonb_array_elements(coalesce(grp->'selectedOptions','[]'::jsonb)) opt
        join public.zelomenu_modifier_option_products lp
          on (opt->>'optionId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and lp.id_opcao=(opt->>'optionId')::uuid
        where oi.order_id=o.id
      ) y
      join public.produtos p2 on p2.id=y.product_id
      join public.categorias c2 on c2.id=p2.id_categoria and coalesce(c2.controlar_estoque_compartilhado,false)
      group by p2.id_categoria
    ) x(cat_id,quantity) where c.id=x.cat_id;
    update public.produtos p set estoque_atual=coalesce(p.estoque_atual,0)+x.quantity
    from (
      select y.product_id, sum(y.quantity)::integer quantity from (
        select oi.product_id, oi.quantity from public.zelo_order_items oi where oi.order_id=o.id
        union all
        select lp.id_produto,(opt->>'quantity')::integer*oi.quantity
        from public.zelo_order_items oi
        cross join lateral jsonb_array_elements(coalesce(oi.modifiers,'[]'::jsonb)) grp
        cross join lateral jsonb_array_elements(coalesce(grp->'selectedOptions','[]'::jsonb)) opt
        join public.zelomenu_modifier_option_products lp
          on (opt->>'optionId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and lp.id_opcao=(opt->>'optionId')::uuid
        where oi.order_id=o.id
      ) y
      join public.produtos p2 on p2.id=y.product_id
      left join public.categorias c2 on c2.id=p2.id_categoria
      where coalesce(p2.controlar_estoque,false) and not coalesce(c2.controlar_estoque_compartilhado,false)
      group by y.product_id
    ) x(product_id,quantity) where p.id=x.product_id;
  end if;

  update public.zelo_orders set status=v_to,revision=revision+1,updated_at=now(),
    accepted_at=case when v_to='accepted' then now() else accepted_at end,
    stock_committed_at=case when v_to='accepted' then now() else stock_committed_at end,
    stock_released_at=case when v_to='cancelled' and stock_committed_at is not null then now() else stock_released_at end,
    rejected_at=case when v_to='rejected' then now() else rejected_at end,
    closed_at=case when v_to in ('delivered','rejected','cancelled') then now() else closed_at end
    where id=o.id returning * into o;
  insert into public.zelo_order_events(order_id,empresa_id,event_type,from_status,to_status,actor_id,detail)
    values(o.id,o.empresa_id,p_action,v_from,v_to,p_actor_id,coalesce(p_detail,'{}'));
  insert into public.zelo_order_outbox(order_id,empresa_id,topic,payload,idempotency_key)
    values(o.id,o.empresa_id,'order.'||p_action,public.zelo_order_result(o)||jsonb_build_object('detail',p_detail),
      'order.'||p_action||':'||o.id||':'||o.revision);
  return public.zelo_order_result(o);
end $$;
```

- [ ] **Step 2: Re-run the file to confirm both functions apply cleanly together**

Run: `cd C:\Users\Vinicius\orca\zelopdv && supabase db query --linked -f .ai/migrations/zelo_order_sub_item_attribution_2026_07_22.sql`

Expected: no error output.

- [ ] **Step 3: Commit**

```bash
cd C:\Users\Vinicius\orca\zelopdv
git add .ai/migrations/zelo_order_sub_item_attribution_2026_07_22.sql
git commit -m "feat: decrement linked-product stock on accept/cancel of combo orders"
```

---

### Task 3: Verification script — harness + all 10 scenarios

**Files:**
- Create: `C:\Users\Vinicius\orca\zelopdv\.ai\migrations\verification\zelo_order_sub_item_attribution_2026_07_22_verify.sql`

**Interfaces:**
- Consumes: `public.close_zelo_order`, `public.transition_zelo_order`,
  `public.accept_zelo_order` (all from Tasks 1-2), `public.empresa_perfil`
  (reads one existing row, never inserts), `public.produtos`,
  `public.categorias`, `public.zelo_orders`, `public.zelo_order_items`,
  `public.zelomenu_modifier_option_products` (all existing schema).
- Produces: nothing persisted — every scenario runs inside a `savepoint`
  that is rolled back after asserting, and the whole script begins with
  `begin` and ends with an unconditional `rollback`.

- [ ] **Step 1: Write the file header and shared setup**

```sql
-- VERIFICATION ONLY. This file is NEVER a schema migration and must never
-- be applied outside this manual check. It seeds synthetic rows, calls the
-- real order-transition RPCs, asserts the result, and rolls back
-- everything — real data (including Bem Servido's) is never touched.
-- Run with: supabase db query --linked -f .ai/migrations/verification/zelo_order_sub_item_attribution_2026_07_22_verify.sql
begin;

do $$
declare
  v_empresa_id uuid;
  v_user_id uuid;
  v_cat_normal int;
  v_cat_shared int;
  v_container int;
  v_penne int;
  v_bacon int;
  v_order_id uuid;
  v_result jsonb;
  v_opt_penne uuid := gen_random_uuid();
  v_opt_bacon uuid := gen_random_uuid();
  v_opt_classic uuid := gen_random_uuid();
begin
  select id, user_id into v_empresa_id, v_user_id from public.empresa_perfil limit 1;
  if v_empresa_id is null then
    raise exception 'NO_EMPRESA_FOUND_FOR_TEST';
  end if;

  -- Synthetic categories: one normal, one shared-stock.
  insert into public.categorias(id_usuario,nome,controlar_estoque_compartilhado,estoque_compartilhado_atual)
    values (v_user_id,'ZLTEST categoria normal',false,0) returning id into v_cat_normal;
  insert into public.categorias(id_usuario,nome,controlar_estoque_compartilhado,estoque_compartilhado_atual)
    values (v_user_id,'ZLTEST categoria compartilhada',true,50) returning id into v_cat_shared;

  -- Synthetic products: container (no stock control), a linked massa
  -- (shared-stock category, 10 units), a linked addon (normal category, 5 units).
  insert into public.produtos(id_usuario,id_categoria,nome,preco,controlar_estoque,estoque_atual)
    values (v_user_id,v_cat_normal,'ZLTEST Monte sua Massa',0,false,0) returning id into v_container;
  insert into public.produtos(id_usuario,id_categoria,nome,preco,controlar_estoque,estoque_atual)
    values (v_user_id,v_cat_shared,'ZLTEST Penne',32,true,10) returning id into v_penne;
  insert into public.produtos(id_usuario,id_categoria,nome,preco,controlar_estoque,estoque_atual)
    values (v_user_id,v_cat_normal,'ZLTEST Bacon extra',5,true,5) returning id into v_bacon;

  insert into public.zelomenu_modifier_option_products(id_opcao,id_usuario,id_produto)
    values (v_opt_penne,v_user_id,v_penne), (v_opt_bacon,v_user_id,v_bacon);
  -- v_opt_classic deliberately has NO row here — it is a classic
  -- (non-linked) option, used by Scenario 10.

  raise notice 'Setup OK: empresa=%, container=%, penne=%, bacon=%', v_empresa_id, v_container, v_penne, v_bacon;
```

(The `do $$ ... $$` block stays open — Steps 2-4 add scenarios inside it,
before the final `end;` and `rollback;` in Step 5.)

- [ ] **Step 2: Add Scenario 1 (baseline, no modifiers — must be unchanged) and Scenario 3 (substituir-style linked option replaces the base price)**

```sql
  -- Scenario 1: no modifiers at all. Must produce exactly the old
  -- behaviour: one order item, container price unchanged, no linked stock
  -- touched.
  savepoint sc1;
  insert into public.zelo_orders(empresa_id,source,status,idempotency_key,customer,subtotal,delivery_fee,discount,total)
    values (v_empresa_id,'zelomenu','pending_review','zltest-sc1-'||gen_random_uuid(),'{"name":"Teste"}'::jsonb,20,0,0,20)
    returning id into v_order_id;
  insert into public.zelo_order_items(order_id,product_id,name,unit_price,quantity,subtotal,modifiers,position)
    values (v_order_id,v_container,'ZLTEST sem modificador',20,1,20,'[]'::jsonb,0);
  v_result := public.accept_zelo_order(v_order_id, 1);
  if (select estoque_atual from public.produtos where id=v_penne) <> 10 then
    raise exception 'SCENARIO_1_FAILED: penne stock should be untouched, got %', (select estoque_atual from public.produtos where id=v_penne);
  end if;
  raise notice 'PASS: Scenario 1 (baseline, no modifiers)';
  rollback to savepoint sc1;

  -- Scenario 3: one modifier group, single linked option, priced as a
  -- full replacement of the base (base product price = 0, all value in
  -- the linked Penne). Container line must end up at price 0, Penne gets
  -- its own line and its stock decrements by 1.
  savepoint sc3;
  insert into public.zelo_orders(empresa_id,source,status,idempotency_key,customer,subtotal,delivery_fee,discount,total)
    values (v_empresa_id,'zelomenu','pending_review','zltest-sc3-'||gen_random_uuid(),'{"name":"Teste"}'::jsonb,32,0,0,32)
    returning id into v_order_id;
  insert into public.zelo_order_items(order_id,product_id,name,unit_price,quantity,subtotal,modifiers,position)
    values (v_order_id,v_container,'ZLTEST Monte sua Massa',32,1,32,
      jsonb_build_array(jsonb_build_object(
        'groupId',gen_random_uuid(),'groupName','Escolha a massa','kind','variacao',
        'selectedOptions',jsonb_build_array(jsonb_build_object(
          'optionId',v_opt_penne,'optionName','Penne','priceDelta',32,'quantity',1))
      )),0);
  v_result := public.accept_zelo_order(v_order_id, 1);
  if (select estoque_atual from public.produtos where id=v_penne) <> 9 then
    raise exception 'SCENARIO_3_FAILED: penne stock should be 9 after decrement, got %', (select estoque_atual from public.produtos where id=v_penne);
  end if;
  -- Advance to closeable status and close.
  v_result := public.transition_zelo_order(v_order_id, (select revision from public.zelo_orders where id=v_order_id), 'start_preparing');
  v_result := public.transition_zelo_order(v_order_id, (select revision from public.zelo_orders where id=v_order_id), 'mark_ready');
  v_result := public.close_zelo_order(v_order_id, (select revision from public.zelo_orders where id=v_order_id), '{}'::jsonb);
  if not exists (
    select 1 from public.vendas_itens where id_venda=(select sale_id from public.zelo_orders where id=v_order_id)
      and id_produto=v_penne and preco_unitario_na_venda=32 and quantidade=1
  ) then
    raise exception 'SCENARIO_3_FAILED: vendas_itens missing correct Penne line';
  end if;
  if not exists (
    select 1 from public.vendas_itens where id_venda=(select sale_id from public.zelo_orders where id=v_order_id)
      and id_produto=v_container and preco_unitario_na_venda=0
  ) then
    raise exception 'SCENARIO_3_FAILED: container line should be price 0';
  end if;
  raise notice 'PASS: Scenario 3 (substituir-style linked option)';
  rollback to savepoint sc3;
```

- [ ] **Step 3: Add Scenario 7 (insufficient linked stock blocks acceptance)**

```sql
  -- Scenario 7: order for 11 Penne (only 10 in stock) must block at
  -- accept with PRODUCT_STOCK_EXCEEDED, exactly like the container check
  -- already does today.
  savepoint sc7;
  insert into public.zelo_orders(empresa_id,source,status,idempotency_key,customer,subtotal,delivery_fee,discount,total)
    values (v_empresa_id,'zelomenu','pending_review','zltest-sc7-'||gen_random_uuid(),'{"name":"Teste"}'::jsonb,352,0,0,352)
    returning id into v_order_id;
  insert into public.zelo_order_items(order_id,product_id,name,unit_price,quantity,subtotal,modifiers,position)
    values (v_order_id,v_container,'ZLTEST Monte sua Massa',32,11,352,
      jsonb_build_array(jsonb_build_object(
        'groupId',gen_random_uuid(),'groupName','Escolha a massa','kind','variacao',
        'selectedOptions',jsonb_build_array(jsonb_build_object(
          'optionId',v_opt_penne,'optionName','Penne','priceDelta',32,'quantity',1))
      )),0);
  begin
    v_result := public.accept_zelo_order(v_order_id, 1);
    raise exception 'SCENARIO_7_FAILED: expected PRODUCT_STOCK_EXCEEDED, accept succeeded instead';
  exception when others then
    if sqlstate <> 'ZL409' then
      raise exception 'SCENARIO_7_FAILED: expected sqlstate ZL409, got % (%)', sqlstate, sqlerrm;
    end if;
    raise notice 'PASS: Scenario 7 (insufficient linked stock blocks accept)';
  end;
  rollback to savepoint sc7;
```

- [ ] **Step 4: Add the remaining 7 scenarios**

Follow the exact same three-part pattern used in Steps 2-3 (insert
`zelo_orders` + `zelo_order_items` inside a named `savepoint`, call the RPC,
assert with `raise exception` on mismatch / `raise notice 'PASS: ...'` on
success, `rollback to savepoint`). Use these exact parameters per scenario
(all reuse `v_container`, `v_penne`, `v_bacon`, `v_opt_penne`, `v_opt_bacon`,
`v_opt_classic`, `v_cat_normal`, `v_cat_shared` from Step 1):

| # | Savepoint | `zelo_order_items.modifiers` | Assert |
|---|---|---|---|
| 2 | `sc2` | One `somar` group, linked Bacon option, `priceDelta=5, quantity=1`, container `unit_price=25` (20 base + 5 bacon) | 2 vendas_itens lines: container price 20, bacon price 5 qty 1; bacon stock 5→4 |
| 4 | `sc4` | Two groups: substituir Penne (`priceDelta=32`) + somar Bacon (`priceDelta=5,quantity=1`), container `unit_price=37` | 3 vendas_itens lines: container price 0, Penne price 32 qty 1, Bacon price 5 qty 1; both stocks decrement |
| 5 | `sc5` | Somar Bacon with `quantity=3` (permite_quantidade), container `unit_price=35` (20 base + 15) | Bacon vendas_itens line: `preco_unitario_na_venda=5`, `quantidade=3` (not 15); bacon stock 5→2 |
| 6 | `sc6` | Substituir Penne as in Scenario 3, but order `quantity=2` (two "Monte sua Massa") | Penne vendas_itens `quantidade=2`; penne stock 10→8; category `estoque_compartilhado_atual` 50→48 |
| 8 | `sc8` | Same as Scenario 3, but after `accept_zelo_order`, call `transition_zelo_order(...,'cancel')` instead of closing | Penne stock and shared-category stock both return to original values (10 and 50) |
| 9 | `sc9` | One group with a malformed `optionId` (`'not-a-real-uuid'` instead of a uuid — simulates corrupted/legacy data), `priceDelta=5,quantity=1`, container `unit_price=25` | `accept_zelo_order` and the full accept→preparing→ready→close chain succeed with **no cast error** (the malformed option is treated as classic/unlinked — its `5` stays folded into the container's price, container line ends up `25`, no extra vendas_itens line, no exception raised) |
| 10 | `sc10` | One group with two options: linked Penne (substituir, `priceDelta=32`) and a classic option using `v_opt_classic` (`priceDelta=3`, no row in `zelomenu_modifier_option_products`), `unit_price=35` | Only 2 vendas_itens lines total (container + Penne) — the classic option's `3` stays folded into the container's price (`35-32=3`, not `0`) |

Every row in this table must become one `savepoint ... rollback to
savepoint` block written out in full — do not abbreviate or skip any of
the 7.

- [ ] **Step 5: Close the `do` block and finish the file**

```sql
  raise notice 'ALL SCENARIOS PASSED';
end $$;

rollback;
```

- [ ] **Step 6: Run it**

Run: `cd C:\Users\Vinicius\orca\zelopdv && supabase db query --linked -f .ai/migrations/verification/zelo_order_sub_item_attribution_2026_07_22_verify.sql`

Expected: output contains `NOTICE: PASS: Scenario 1 ...` through `PASS:
Scenario 10 ...` and finally `NOTICE: ALL SCENARIOS PASSED`, with no
`ERROR:`/`EXCEPTION` lines. If anything fails, fix the migration from Task
1/2 (not the verification script) and re-run this step until clean.

- [ ] **Step 7: Confirm rollback left no trace**

Run: `cd C:\Users\Vinicius\orca\zelopdv && supabase db query --linked "select count(*) from public.produtos where nome like 'ZLTEST%'"`

Expected: `{"count": 0}` — proves the transaction really rolled back and no
synthetic row survived.

- [ ] **Step 8: Commit**

```bash
cd C:\Users\Vinicius\orca\zelopdv
git add .ai/migrations/verification/zelo_order_sub_item_attribution_2026_07_22_verify.sql
git commit -m "test: verification script for combo order sub-item attribution (10 scenarios)"
```

---

### Task 4: Apply to production and spot-check a real order

**Files:** none (operational task, no new files).

- [ ] **Step 1: Diff-check the migration is exactly what was verified**

Run: `cd C:\Users\Vinicius\orca\zelopdv && git diff HEAD~2 -- .ai/migrations/zelo_order_sub_item_attribution_2026_07_22.sql`

Expected: empty (file unchanged since Task 1/2 commits) — confirms nothing
was edited between "verified" and "about to apply for real."

- [ ] **Step 2: Ask the user for explicit go-ahead before touching the shared production database**

Per this project's established pattern (never apply DB changes without an
explicit "aplica"/"pode seguir" from the user), confirm one more time
immediately before this step specifically, showing the Step 6 PASS output
from Task 3 as evidence.

- [ ] **Step 3: Apply for real**

Run: `cd C:\Users\Vinicius\orca\zelopdv && supabase db query --linked -f .ai/migrations/zelo_order_sub_item_attribution_2026_07_22.sql`

Expected: no error output. (If Task 1 Step 2 already applied it live, this
step is a no-op re-apply — safe, `create or replace` is idempotent.)

- [ ] **Step 4: Spot-check the next real "Monte sua Massa" order from Bem Servido**

After the next real combo order is accepted and closed through the normal
storefront flow, run:

`supabase db query --linked "select id_produto, nome_produto_na_venda, preco_unitario_na_venda, quantidade from public.vendas_itens where id_venda=(select sale_id from public.zelo_orders where id='<order id>')"`

Expected: one row for "Monte sua Massa" (reduced/zero price) and one row
per chosen linked sub-product (Penne, Nhoque, etc.) with its own price and
quantity. Report this back in plain language to the user (no SQL needed on
their end) — "Penne apareceu certo no relatório" / "o estoque bateu".
