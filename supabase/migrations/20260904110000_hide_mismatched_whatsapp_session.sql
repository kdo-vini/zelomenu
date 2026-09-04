-- ZM2 finding 6: scoped lookup failures must not return another tenant's
-- session row. This supersedes the replay-token migration without changing
-- the function signature.

-- ZM1 step 3: confirm_draft must require a confirmation token bound to the
-- revision the customer saw (ultra-review ZM-I2 / CT "confirm token").
--
-- Previously `confirm_whatsapp_zelo_order_atomic_v1` accepted
-- `p_token_hash = null` and skipped the token/binding check entirely,
-- confirming purely on readiness + revision. That let ANY caller (or a
-- replayed/forged text "sim") confirm an order without ever proving it saw
-- the exact summary/revision being confirmed. The token is now REQUIRED:
-- a null or malformed token fails the same early input-validation branch as
-- every other malformed parameter (`WHATSAPP_CONFIRMATION_INPUT_INVALID`,
-- which server/supabaseConversationOrderingAdapter.ts's rpcError already maps
-- to CONFIRMACAO_INVALIDA via its `/TOKEN|CONFIRMATION/` regex — no adapter
-- change needed).
--
-- This is additive-only (create or replace, same signature) and copies the
-- full existing function body from
-- 20260902140000_harden_conversation_confirmation_authority.sql verbatim,
-- changing only the two `if p_token_hash is not null then ... end if;`
-- conditionals into unconditional checks, tightening the top input
-- validation to reject a null/malformed token, and swapping the readiness
-- check to run BEFORE the token-validity check (was after). A genuinely
-- not-ready session can never have a live issued token (issuance runs this
-- same readiness predicate first), so checking readiness first keeps every
-- existing "not ready" scenario failing with ORDER_NOT_READY exactly as
-- before, instead of masking it behind CONFIRMATION_TOKEN_INVALID once a
-- token became mandatory.
--
-- G1 (local pgTAP via `supabase test db`) is still blocked by Docker in this
-- environment -- this migration and the companion test-file update in
-- supabase/tests/conversation_order_confirmation_integrity.sql could not be
-- executed locally. Both are written to the same conventions as the
-- existing suite; run pgTAP in CI/staging before this reaches production.

create or replace function public.confirm_whatsapp_zelo_order_atomic_v1(
  p_empresa_id uuid,
  p_source_ref text,
  p_session_id uuid,
  p_expected_revision integer,
  p_message_id text,
  p_idempotency_key text,
  p_pessoa_id uuid,
  p_token_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_service_role boolean := coalesce(current_setting('role', true) = 'service_role', false);
  s public.zelomenu_cart_sessions;
  v_token public.zelomenu_whatsapp_confirmation_tokens;
  v_order public.zelo_orders;
  v_lock record;
  v_materialized jsonb;
  v_fulfillment_result jsonb;
  v_cart jsonb;
  v_fulfillment jsonb;
  v_pricing jsonb;
  v_issues jsonb := '[]'::jsonb;
  v_subtotal numeric(14,2);
  v_delivery_fee numeric(14,2);
  v_discount numeric(14,2);
  v_result jsonb;
  v_message_ids jsonb;
  v_changed boolean;
  v_updated integer;
  v_revalidation jsonb;
  v_requirements jsonb;
  v_ready boolean;
  v_review_marker jsonb;
begin
  if not v_service_role then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  -- FIX 2026-09-04: p_token_hash was optional, so any caller could confirm
  -- purely on readiness+revision with no proof it saw the summary being
  -- confirmed -> the token is now mandatory and validated up front, in the
  -- same branch as every other malformed-input case.
  if p_empresa_id is null or p_session_id is null
     or nullif(trim(p_source_ref), '') is null
     or p_expected_revision is null or p_expected_revision <= 0
     or nullif(trim(p_message_id), '') is null
     or nullif(trim(p_idempotency_key), '') is null
     or p_token_hash is null or lower(p_token_hash) !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'ZL400', message = 'WHATSAPP_CONFIRMATION_INPUT_INVALID';
  end if;

  -- Universal lock order: cart session before the (now mandatory) confirmation token.
  select * into s
    from public.zelomenu_cart_sessions
   where id = p_session_id
   for update;
  if not found or s.context <> 'whatsapp_order'
     or s.empresa_id <> p_empresa_id or s.source_ref <> p_source_ref then
    -- Never disclose the row selected by UUID when its tenant/conversation
    -- binding does not match the caller's scope.
    return jsonb_build_object('outcome', 'conflict');
  end if;

  select * into v_token
    from public.zelomenu_whatsapp_confirmation_tokens
   where token_hash = lower(p_token_hash)
     and session_id = s.id
   for update;

  select * into v_order
    from public.zelo_orders
   where zelomenu_session_id = s.id
   for update;
  if found then
    -- A consumed token is expected on genuine replay. The token must still be
    -- the issued, non-invalidated, unexpired token for this exact binding.
    if v_token.id is null or v_token.empresa_id <> p_empresa_id or v_token.source_ref <> p_source_ref
       or v_token.revision <> p_expected_revision
       or v_token.invalidated_at is not null or v_token.expires_at <= now() then
      raise exception using errcode = 'ZL409', message = 'CONFIRMATION_TOKEN_INVALID';
    end if;
    return jsonb_build_object(
      'outcome', 'confirmed', 'alreadyConfirmed', true,
      'orderId', v_order.id, 'revision', s.revision, 'snapshot', to_jsonb(s)
    );
  end if;
  if s.state <> 'cart_open' or s.revision <> p_expected_revision then
    return jsonb_build_object('outcome', 'conflict', 'revision', s.revision, 'snapshot', to_jsonb(s));
  end if;

  -- Readiness is checked BEFORE the token lookup (swapped vs. the pre-ZM1
  -- ordering, which only ever checked token validity when a token happened
  -- to be provided). A session that is genuinely not ready can never have a
  -- live issued token in the first place (issue_whatsapp_zelo_confirmation_token
  -- runs this same predicate), so checking readiness first preserves the
  -- existing ORDER_NOT_READY contract for every not-ready session instead of
  -- masking it behind CONFIRMATION_TOKEN_INVALID.
  if public.zelomenu_whatsapp_order_is_ready_v1(
    s.context, s.state, s.source_ref, s.customer_snapshot, s.fulfillment_snapshot,
    s.payment_snapshot, s.last_revalidation, s.requirements_snapshot, s.ready_for_confirmation
  ) is not true then
    raise exception using errcode = 'ZL409', message = 'ORDER_NOT_READY';
  end if;

  if v_token.id is null or v_token.empresa_id <> p_empresa_id or v_token.source_ref <> p_source_ref
     or v_token.revision <> p_expected_revision or v_token.consumed_at is not null
     or v_token.invalidated_at is not null or v_token.expires_at <= now() then
    raise exception using errcode = 'ZL409', message = 'CONFIRMATION_TOKEN_INVALID';
  end if;

  -- Lock every mutable fact consumed below. Each table is locked in a stable
  -- table/id order; the profile lock covers hours, scheduling and delivery config.
  perform 1 from public.empresa_perfil where id = p_empresa_id for update;
  -- Relation rows are locked before deriving the publication set. This keeps
  -- the reachable-link set stable and gives every confirmation the same lock
  -- order, including carts whose products are linked to one another.
  for v_lock in
    select modifier_group.id
      from public.zelomenu_modifier_groups modifier_group
      join jsonb_array_elements(coalesce(s.cart_snapshot->'items', '[]'::jsonb)) item
        on item->>'productId' ~ '^\d+$' and modifier_group.id_produto = (item->>'productId')::bigint
     where modifier_group.id_usuario = (select user_id from public.empresa_perfil where id = p_empresa_id)
     order by modifier_group.id for update of modifier_group
  loop null; end loop;
  for v_lock in
    select modifier_option.id
      from public.zelomenu_modifier_options modifier_option
      join public.zelomenu_modifier_groups modifier_group on modifier_group.id = modifier_option.id_grupo
      join jsonb_array_elements(coalesce(s.cart_snapshot->'items', '[]'::jsonb)) item
        on item->>'productId' ~ '^\d+$' and modifier_group.id_produto = (item->>'productId')::bigint
     where modifier_option.id_usuario = (select user_id from public.empresa_perfil where id = p_empresa_id)
     order by modifier_option.id for update of modifier_option
  loop null; end loop;
  for v_lock in
    select link.id_opcao
      from public.zelomenu_modifier_option_products link
      join public.zelomenu_modifier_options modifier_option on modifier_option.id = link.id_opcao
      join public.zelomenu_modifier_groups modifier_group on modifier_group.id = modifier_option.id_grupo
      join jsonb_array_elements(coalesce(s.cart_snapshot->'items', '[]'::jsonb)) item
        on item->>'productId' ~ '^\d+$' and modifier_group.id_produto = (item->>'productId')::bigint
     where link.id_usuario = (select user_id from public.empresa_perfil where id = p_empresa_id)
     order by link.id_opcao for update of link
  loop null; end loop;
  for v_lock in
    select linked_product.id
      from public.produtos linked_product
      join public.zelomenu_modifier_option_products link on link.id_produto = linked_product.id
      join public.zelomenu_modifier_options modifier_option on modifier_option.id = link.id_opcao
      join public.zelomenu_modifier_groups modifier_group on modifier_group.id = modifier_option.id_grupo
      join jsonb_array_elements(coalesce(s.cart_snapshot->'items', '[]'::jsonb)) item
        on item->>'productId' ~ '^\d+$' and modifier_group.id_produto = (item->>'productId')::bigint
     where linked_product.id_usuario = (select user_id from public.empresa_perfil where id = p_empresa_id)
     order by linked_product.id for update of linked_product
  loop null; end loop;
  for v_lock in
    select p.id
      from public.produtos p
      join public.empresa_perfil ep on ep.id = p_empresa_id and ep.user_id = p.id_usuario
      join jsonb_array_elements(coalesce(s.cart_snapshot->'items', '[]'::jsonb)) item
        on item->>'productId' ~ '^\d+$' and p.id = (item->>'productId')::bigint
     order by p.id for update of p
  loop null; end loop;
  for v_lock in
    select category.id
      from public.categorias category
      join public.produtos p on p.id_categoria = category.id and p.id_usuario = category.id_usuario
      join jsonb_array_elements(coalesce(s.cart_snapshot->'items', '[]'::jsonb)) item
        on item->>'productId' ~ '^\d+$' and p.id = (item->>'productId')::bigint
     order by category.id for update of category
  loop null; end loop;
  -- There is deliberately one publication phase. The UNION is deduplicated,
  -- then rows are locked by publication id before the materializer reads pause.
  for v_lock in
    select publication.id
      from public.zelomenu_product_publications publication
     where publication.id_usuario = (select user_id from public.empresa_perfil where id = p_empresa_id)
       and publication.id_produto in (
         select (item->>'productId')::bigint
           from jsonb_array_elements(coalesce(s.cart_snapshot->'items', '[]'::jsonb)) item
          where item->>'productId' ~ '^\d+$'
         union
         select link.id_produto
           from public.zelomenu_modifier_option_products link
           join public.zelomenu_modifier_options modifier_option on modifier_option.id = link.id_opcao
           join public.zelomenu_modifier_groups modifier_group on modifier_group.id = modifier_option.id_grupo
           join jsonb_array_elements(coalesce(s.cart_snapshot->'items', '[]'::jsonb)) item
             on item->>'productId' ~ '^\d+$' and modifier_group.id_produto = (item->>'productId')::bigint
          where link.id_usuario = (select user_id from public.empresa_perfil where id = p_empresa_id)
            and link.id_produto is not null
       )
     order by publication.id for update of publication
  loop null; end loop;
  for v_lock in select id from public.zelomenu_delivery_ranges where company_id = p_empresa_id order by id for update loop null; end loop;
  for v_lock in select id from public.zelomenu_delivery_pricing_rules where company_id = p_empresa_id order by id for update loop null; end loop;
  for v_lock in
    select rule_range.id
      from public.zelomenu_delivery_pricing_rule_ranges rule_range
      join public.zelomenu_delivery_pricing_rules rule on rule.id = rule_range.pricing_rule_id
     where rule.company_id = p_empresa_id order by rule_range.id for update of rule_range
  loop null; end loop;
  for v_lock in select id from public.zelomenu_delivery_distance_cache where company_id = p_empresa_id order by id for update loop null; end loop;
  if coalesce(s.fulfillment_snapshot->>'deliveryQuoteRequestId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    perform 1 from public.zelomenu_delivery_quote_requests
     where id = (s.fulfillment_snapshot->>'deliveryQuoteRequestId')::uuid
       and company_id = p_empresa_id
       and session_id = s.id
     for update;
  end if;

  v_materialized := public.zelomenu_whatsapp_materialize_cart_v1(p_empresa_id, s.cart_snapshot);
  v_cart := v_materialized->'cart';
  v_subtotal := coalesce((v_materialized->>'subtotal')::numeric, 0);
  v_issues := v_issues || coalesce(v_materialized->'issues', '[]'::jsonb);

  v_fulfillment_result := public.zelomenu_whatsapp_fulfillment_v1(
    p_empresa_id, s.id, s.fulfillment_snapshot, now()
  );
  v_fulfillment := v_fulfillment_result->'fulfillment';
  v_delivery_fee := coalesce((v_fulfillment_result->>'deliveryFee')::numeric, 0);
  v_issues := v_issues || coalesce(v_fulfillment_result->'issues', '[]'::jsonb);

  v_discount := case
    when coalesce(s.pricing_snapshot->>'discount', '') ~ '^\d+(?:\.\d+)?$'
      then (s.pricing_snapshot->>'discount')::numeric
    else 0
  end;
  v_pricing := jsonb_build_object(
    'subtotal', round(v_subtotal, 2),
    'deliveryFee', round(v_delivery_fee, 2),
    'discount', round(v_discount, 2),
    'couponCode', case when s.pricing_snapshot ? 'couponCode' then s.pricing_snapshot->'couponCode' else 'null'::jsonb end,
    'couponDiscountType', case when s.pricing_snapshot ? 'couponDiscountType' then s.pricing_snapshot->'couponDiscountType' else 'null'::jsonb end,
    'couponDiscountValue', case when s.pricing_snapshot ? 'couponDiscountValue' then s.pricing_snapshot->'couponDiscountValue' else 'null'::jsonb end,
    'total', round(v_subtotal + v_delivery_fee - v_discount, 2)
  );
  v_changed := s.cart_snapshot is distinct from v_cart
    or s.fulfillment_snapshot is distinct from v_fulfillment
    or s.pricing_snapshot is distinct from v_pricing
    or jsonb_array_length(v_issues) > 0;
  if v_changed then
    v_message_ids := coalesce(s.metadata->'processedMessageIds', '[]'::jsonb) || to_jsonb(p_message_id);
    v_revalidation := jsonb_build_object(
      'checkedAt', now(), 'ok', jsonb_array_length(v_issues) = 0, 'issues', v_issues,
      'previewCart', v_cart, 'previewFulfillment', v_fulfillment, 'previewPricing', v_pricing
    );
    v_requirements := case when jsonb_array_length(v_issues) > 0 then '[]'::jsonb else s.requirements_snapshot end;
    v_ready := case when jsonb_array_length(v_issues) > 0 then false else public.zelomenu_whatsapp_order_is_ready_v1(
      s.context, s.state, s.source_ref, s.customer_snapshot, v_fulfillment,
      s.payment_snapshot, v_revalidation, v_requirements, true
    ) end;
    v_review_marker := jsonb_build_object('required', true, 'revision', s.revision + 1,
      'messageId', p_message_id, 'cause', case when jsonb_array_length(v_issues) > 0 then 'issues' else 'snapshot_changed' end);
    update public.zelomenu_cart_sessions
       set cart_snapshot = v_cart,
           fulfillment_snapshot = v_fulfillment,
           pricing_snapshot = v_pricing,
           last_revalidated_at = now(),
           last_revalidation = v_revalidation,
           requirements_snapshot = v_requirements,
           ready_for_confirmation = v_ready,
           metadata = (coalesce(s.metadata, '{}'::jsonb) - 'conversationReview') || jsonb_build_object('processedMessageIds', v_message_ids, 'conversationReview', v_review_marker),
           revision = s.revision + 1,
           updated_at = now()
     where id = s.id and revision = s.revision;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      return jsonb_build_object('outcome', 'conflict', 'revision', s.revision, 'snapshot', to_jsonb(s));
    end if;
    update public.zelomenu_whatsapp_confirmation_tokens
       set invalidated_at = now()
     where session_id = s.id and revision < s.revision + 1
       and invalidated_at is null and consumed_at is null;
    return jsonb_build_object(
      'outcome', 'requires_review', 'alreadyConfirmed', false,
      'revision', s.revision + 1, 'issues', v_issues,
      'cart', v_cart, 'fulfillment', v_fulfillment, 'pricing', v_pricing
    );
  end if;

  v_result := public.create_zelo_order(s.id, s.revision, p_idempotency_key, '{}'::jsonb, p_pessoa_id);
  update public.zelomenu_cart_sessions
     set metadata = (coalesce(metadata, '{}'::jsonb) - 'conversationReview') || jsonb_build_object(
           'processedMessageIds', coalesce(metadata->'processedMessageIds', '[]'::jsonb) || to_jsonb(p_message_id)
         ), updated_at = now()
   where id = s.id;
  update public.zelomenu_whatsapp_confirmation_tokens
     set consumed_at = coalesce(consumed_at, now())
   where id = v_token.id;
  return jsonb_build_object(
    'outcome', 'confirmed',
    'alreadyConfirmed', coalesce((v_result->>'alreadyConfirmed')::boolean, false),
    'orderId', v_result->>'orderId',
    'revision', s.revision
  );
end
$$;

revoke all on function public.confirm_whatsapp_zelo_order_atomic_v1(uuid, text, uuid, integer, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.confirm_whatsapp_zelo_order_atomic_v1(uuid, text, uuid, integer, text, text, uuid, text)
  to service_role;

comment on function public.confirm_whatsapp_zelo_order_atomic_v1(uuid, text, uuid, integer, text, text, uuid, text) is
  'ZM1: confirmation token is now mandatory (never accepts p_token_hash = null); bound to session_id + revision, so a token issued for revision N can never confirm revision N+1. Preserves the canonical component-aware materializer and every existing idempotency/review semantic.';




