-- F1: stable conversational line identity and authoritative confirmation readiness.
-- This additive migration is the latest effective definition for ZeloMenu.

create or replace function public.zelomenu_whatsapp_order_is_ready_v1(
  p_context text,
  p_state text,
  p_source_ref text,
  p_customer jsonb,
  p_fulfillment jsonb,
  p_payment jsonb,
  p_revalidation jsonb,
  p_requirements jsonb,
  p_ready_for_confirmation boolean
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce((p_context = 'whatsapp_order'
     and p_state = 'cart_open'
     and p_ready_for_confirmation = true
     and jsonb_typeof(p_customer) = 'object'
     and jsonb_typeof(p_fulfillment) = 'object'
     and jsonb_typeof(p_payment) = 'object'
     and jsonb_typeof(p_revalidation) = 'object'
     and jsonb_typeof(coalesce(p_requirements, 'null'::jsonb)) = 'array'
     and not exists (
       select 1
         from jsonb_array_elements(
           case when jsonb_typeof(p_requirements) = 'array' then p_requirements else '[]'::jsonb end
         ) requirement
        where jsonb_typeof(requirement) <> 'object'
           or coalesce(jsonb_typeof(requirement->'blocking') = 'boolean', false) = false
           or requirement->'blocking' is distinct from 'false'::jsonb
      )
     and jsonb_typeof(p_revalidation->'checkedAt') = 'string'
     and nullif(btrim(p_revalidation->>'checkedAt'), '') is not null
     and jsonb_typeof(p_revalidation->'ok') = 'boolean'
     and p_revalidation->'ok' = 'true'::jsonb
     and jsonb_typeof(p_revalidation->'issues') = 'array'
     and jsonb_array_length(
       case when jsonb_typeof(p_revalidation->'issues') = 'array'
         then p_revalidation->'issues' else '[]'::jsonb end
     ) = 0
     and jsonb_typeof(p_fulfillment->'deliveryFeeToConfirm') = 'boolean'
     and p_fulfillment->'deliveryFeeToConfirm' = 'false'::jsonb
     and jsonb_typeof(p_customer->'name') = 'string'
     and nullif(btrim(p_customer->>'name'), '') is not null
     and p_customer->>'phone' = public.zelomenu_whatsapp_phone_from_source_ref_v1(p_source_ref)
     and jsonb_typeof(p_payment->'declaredMethod') = 'string'
     and nullif(btrim(p_payment->>'declaredMethod'), '') is not null
     and jsonb_typeof(p_fulfillment->'type') = 'string'
     and p_fulfillment->>'type' in ('pickup', 'delivery')
     and (
       p_fulfillment->>'type' <> 'delivery'
       or (
         (
           (jsonb_typeof(p_fulfillment->'deliveryAddress') = 'string'
             and nullif(btrim(p_fulfillment->>'deliveryAddress'), '') is not null)
           or (jsonb_typeof(p_fulfillment->'deliveryStreet') = 'string'
             and nullif(btrim(p_fulfillment->>'deliveryStreet'), '') is not null)
         )
         and jsonb_typeof(p_fulfillment->'deliveryNumber') = 'string'
         and nullif(btrim(p_fulfillment->>'deliveryNumber'), '') is not null
         and jsonb_typeof(p_fulfillment->'deliveryNeighborhood') = 'string'
         and nullif(btrim(p_fulfillment->>'deliveryNeighborhood'), '') is not null
       )
     )
     and jsonb_typeof(p_fulfillment->'asap') = 'boolean'
     and (
       p_fulfillment->'asap' = 'true'::jsonb
       or (
          jsonb_typeof(p_fulfillment->'pickupDate') = 'string'
          and nullif(btrim(p_fulfillment->>'pickupDate'), '') is not null
         and jsonb_typeof(p_fulfillment->'pickupTime') = 'string'
         and nullif(btrim(p_fulfillment->>'pickupTime'), '') is not null
       )
     ), false)
$$;

revoke all on function public.zelomenu_whatsapp_order_is_ready_v1(text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.zelomenu_whatsapp_order_is_ready_v1(text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean)
  to service_role;

create or replace function public.issue_whatsapp_zelo_confirmation_token(
  p_token_hash text,
  p_empresa_id uuid,
  p_source_ref text,
  p_session_id uuid,
  p_expected_revision integer,
  p_expires_at timestamptz
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
begin
  if not v_service_role then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if nullif(trim(p_token_hash), '') is null
     or lower(p_token_hash) !~ '^[0-9a-f]{64}$'
     or p_empresa_id is null
     or nullif(trim(p_source_ref), '') is null
     or p_session_id is null
     or p_expected_revision is null
     or p_expected_revision <= 0
     or p_expires_at is null
     or p_expires_at <= now() then
    raise exception using errcode = 'ZL400', message = 'CONFIRMATION_TOKEN_ISSUANCE_INVALID';
  end if;

  -- First lock in the universal order. It serializes duplicate emissions for
  -- a session before touching the unique token hash.
  select * into s
    from public.zelomenu_cart_sessions
   where id = p_session_id
   for update;
  if not found then
    raise exception using errcode = 'ZL404', message = 'CONFIRMATION_SESSION_NOT_FOUND';
  end if;
  if s.context <> 'whatsapp_order' then
    raise exception using errcode = 'ZL400', message = 'CONFIRMATION_SESSION_CONTEXT_INVALID';
  end if;
  if s.state <> 'cart_open' then
    raise exception using errcode = 'ZL409', message = 'CONFIRMATION_SESSION_NOT_OPEN';
  end if;
  if s.empresa_id <> p_empresa_id or s.source_ref <> p_source_ref then
    raise exception using errcode = 'ZL403', message = 'CONFIRMATION_TOKEN_BINDING_MISMATCH';
  end if;
  if s.revision <> p_expected_revision then
    raise exception using errcode = 'ZL409', message = 'CONFIRMATION_TOKEN_REVISION_CONFLICT';
  end if;
  if public.zelomenu_whatsapp_order_is_ready_v1(
    s.context, s.state, s.source_ref, s.customer_snapshot, s.fulfillment_snapshot,
    s.payment_snapshot, s.last_revalidation, s.requirements_snapshot, s.ready_for_confirmation
  ) is not true then
    raise exception using errcode = 'ZL409', message = 'ORDER_NOT_READY';
  end if;

  -- A deterministic hash can be replayed by two ZeloMenu replicas. Returning
  -- the one live, exactly-bound row avoids invalidating it or leaking a raw
  -- unique_violation. A non-live row is never resurrected.
  select * into v_token
    from public.zelomenu_whatsapp_confirmation_tokens
   where token_hash = lower(p_token_hash)
   for update;
  if found then
    if v_token.empresa_id = p_empresa_id
       and v_token.session_id = s.id
       and v_token.source_ref = p_source_ref
       and v_token.revision = p_expected_revision
       and v_token.consumed_at is null
       and v_token.invalidated_at is null
       and v_token.expires_at > now() then
      return jsonb_build_object(
        'tokenId', v_token.id,
        'sessionId', v_token.session_id,
        'revision', v_token.revision,
        'expiresAt', v_token.expires_at
      );
    end if;
    if v_token.empresa_id = p_empresa_id
       and v_token.session_id = s.id
       and v_token.source_ref = p_source_ref
       and v_token.revision = p_expected_revision then
      raise exception using errcode = 'ZL409', message = 'CONFIRMATION_TOKEN_REISSUE_REQUIRES_NEW_REVISION';
    end if;
    raise exception using errcode = 'ZL409', message = 'CONFIRMATION_TOKEN_HASH_REUSE_CONFLICT';
  end if;

  begin
    -- Expired rows are intentionally invalidated when a *different* current
    -- summary is issued, so the one-live-token index remains usable. Keeping
    -- this inside the subtransaction rolls it back if another binding wins the
    -- global hash uniqueness race.
    update public.zelomenu_whatsapp_confirmation_tokens
       set invalidated_at = now()
     where session_id = s.id
       and consumed_at is null
       and invalidated_at is null;
    insert into public.zelomenu_whatsapp_confirmation_tokens (
      token_hash, empresa_id, session_id, source_ref, revision, expires_at
    ) values (
      lower(p_token_hash), p_empresa_id, s.id, p_source_ref, p_expected_revision, p_expires_at
    )
    returning * into v_token;
  exception when unique_violation then
    -- A concurrent request from another session used this opaque hash. Read
    -- the winner after its commit and return only an exact live binding.
    select * into v_token
      from public.zelomenu_whatsapp_confirmation_tokens
     where token_hash = lower(p_token_hash)
     for update;
    if found
       and v_token.empresa_id = p_empresa_id
       and v_token.session_id = s.id
       and v_token.source_ref = p_source_ref
       and v_token.revision = p_expected_revision
       and v_token.consumed_at is null
       and v_token.invalidated_at is null
       and v_token.expires_at > now() then
      return jsonb_build_object(
        'tokenId', v_token.id,
        'sessionId', v_token.session_id,
        'revision', v_token.revision,
        'expiresAt', v_token.expires_at
      );
    end if;
    if found
       and v_token.empresa_id = p_empresa_id
       and v_token.session_id = s.id
       and v_token.source_ref = p_source_ref
       and v_token.revision = p_expected_revision then
      raise exception using errcode = 'ZL409', message = 'CONFIRMATION_TOKEN_REISSUE_REQUIRES_NEW_REVISION';
    end if;
    raise exception using errcode = 'ZL409', message = 'CONFIRMATION_TOKEN_HASH_REUSE_CONFLICT';
  end;

  return jsonb_build_object(
    'tokenId', v_token.id,
    'sessionId', v_token.session_id,
    'revision', v_token.revision,
    'expiresAt', v_token.expires_at
  );
end
$$;

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
  if p_empresa_id is null or p_session_id is null
     or nullif(trim(p_source_ref), '') is null
     or p_expected_revision is null or p_expected_revision <= 0
     or nullif(trim(p_message_id), '') is null
     or nullif(trim(p_idempotency_key), '') is null
     or (p_token_hash is not null and lower(p_token_hash) !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = 'ZL400', message = 'WHATSAPP_CONFIRMATION_INPUT_INVALID';
  end if;

  -- Universal lock order: cart session before optional confirmation token.
  select * into s
    from public.zelomenu_cart_sessions
   where id = p_session_id
   for update;
  if not found or s.context <> 'whatsapp_order'
     or s.empresa_id <> p_empresa_id or s.source_ref <> p_source_ref then
    return jsonb_build_object('outcome', 'conflict', 'revision', coalesce(s.revision, null), 'snapshot', to_jsonb(s));
  end if;

  select * into v_order
    from public.zelo_orders
   where zelomenu_session_id = s.id
   for update;
  if found then
    return jsonb_build_object(
      'outcome', 'confirmed', 'alreadyConfirmed', true,
      'orderId', v_order.id, 'revision', s.revision, 'snapshot', to_jsonb(s)
    );
  end if;
  if s.state <> 'cart_open' or s.revision <> p_expected_revision then
    return jsonb_build_object('outcome', 'conflict', 'revision', s.revision, 'snapshot', to_jsonb(s));
  end if;

  if p_token_hash is not null then
    select * into v_token
      from public.zelomenu_whatsapp_confirmation_tokens
     where token_hash = lower(p_token_hash)
       and session_id = s.id
     for update;
    if not found or v_token.empresa_id <> p_empresa_id or v_token.source_ref <> p_source_ref
       or v_token.revision <> p_expected_revision or v_token.consumed_at is not null
       or v_token.invalidated_at is not null or v_token.expires_at <= now() then
      raise exception using errcode = 'ZL409', message = 'CONFIRMATION_TOKEN_INVALID';
    end if;
  end if;

  if public.zelomenu_whatsapp_order_is_ready_v1(
    s.context, s.state, s.source_ref, s.customer_snapshot, s.fulfillment_snapshot,
    s.payment_snapshot, s.last_revalidation, s.requirements_snapshot, s.ready_for_confirmation
  ) is not true then
    raise exception using errcode = 'ZL409', message = 'ORDER_NOT_READY';
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
  if p_token_hash is not null then
    update public.zelomenu_whatsapp_confirmation_tokens
       set consumed_at = coalesce(consumed_at, now())
     where id = v_token.id;
  end if;
  return jsonb_build_object(
    'outcome', 'confirmed',
    'alreadyConfirmed', coalesce((v_result->>'alreadyConfirmed')::boolean, false),
    'orderId', v_result->>'orderId',
    'revision', s.revision
  );
end
$$;
comment on function public.zelomenu_whatsapp_order_is_ready_v1(text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) is
  'Predicado server-only de prontidão sem efeitos; callers devem bloquear a sessão antes de avaliar.';

comment on function public.issue_whatsapp_zelo_confirmation_token(text, uuid, text, uuid, integer, timestamptz) is
  'Emite/substitui token SHA-256 somente para revisão WhatsApp completa e pronta; replay do mesmo hash e binding vivo devolve o mesmo token.';

comment on function public.confirm_whatsapp_zelo_order_atomic_v1(uuid, text, uuid, integer, text, text, uuid, text) is
  'Confirmação WhatsApp atômica server-only com validação semântica de prontidão sob lock antes da materialização e criação canônica.';

revoke all on function public.issue_whatsapp_zelo_confirmation_token(text, uuid, text, uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.issue_whatsapp_zelo_confirmation_token(text, uuid, text, uuid, integer, timestamptz)
  to service_role;

revoke all on function public.confirm_whatsapp_zelo_order_atomic_v1(uuid, text, uuid, integer, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.confirm_whatsapp_zelo_order_atomic_v1(uuid, text, uuid, integer, text, text, uuid, text)
  to service_role;
