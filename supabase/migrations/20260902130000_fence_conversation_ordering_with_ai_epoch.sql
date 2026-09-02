begin;

-- ZeloChat owns the shared conversation control. Production calls resolve its
-- actual checked-in table dynamically; a standalone ZeloMenu database can run
-- this migration, but every mutation fails closed until the shared contract is
-- present. The dynamic lookup intentionally avoids inventing a local shadow.
create or replace function public.zelomenu_assert_ai_conversation_permit_v1(
  p_empresa_id uuid,
  p_source_ref text,
  p_conversation_control_id uuid,
  p_conversation_epoch text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_mode text;
  v_epoch text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception using errcode = 'ZL403', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_empresa_id is null
     or nullif(p_source_ref, '') is null
     or p_conversation_control_id is null
     or p_conversation_epoch is null
     or p_conversation_epoch !~ '^(0|[1-9][0-9]{0,18})$'
     or length(p_conversation_epoch) > 19
     or (length(p_conversation_epoch) = 19 and p_conversation_epoch > '9223372036854775807') then
    raise exception using errcode = 'ZL409', message = 'AI_TURN_REVOKED';
  end if;

  if to_regclass('public.zelochat_conversation_ai_control') is null
     or to_regclass('public.zelochat_sessions') is null
     or to_regprocedure('public.zelochat_conversation_control_lock_gate()') is null then
    raise exception using errcode = 'ZL409', message = 'AI_TURN_REVOKED';
  end if;

  -- Match ZeloChat's global gate -> control-row lock order. This closes the
  -- check/write race with takeover, inbound epoch advance, and resume.
  execute 'select public.zelochat_conversation_control_lock_gate()';

  execute $sql$
    select c.mode::text, c.epoch::text
      from public.zelochat_conversation_ai_control c
     where c.empresa_id = $1
       and c.id = $2
       and exists (
         select 1
           from public.zelochat_sessions s
          where s.empresa_id = $1
            and s.remote_jid = $3
            and s.conversation_control_id = c.id
       )
     for update of c
  $sql$
  into v_mode, v_epoch
  using p_empresa_id, p_conversation_control_id, p_source_ref;

  -- Dynamic EXECUTE does not update PL/pgSQL's FOUND flag. A missing row leaves
  -- these nullable targets empty, so the exact comparisons are the fail-closed
  -- existence test as well as the epoch/mode test.
  if v_epoch is distinct from p_conversation_epoch
     or v_mode is distinct from 'ai' then
    raise exception using errcode = 'ZL409', message = 'AI_TURN_REVOKED';
  end if;
end;
$function$;

create or replace function public.zelomenu_open_whatsapp_order_with_ai_epoch_v1(
  p_empresa_id uuid,
  p_source_ref text,
  p_conversation_control_id uuid,
  p_conversation_epoch text,
  p_customer_snapshot jsonb,
  p_cart_snapshot jsonb,
  p_fulfillment_snapshot jsonb,
  p_pricing_snapshot jsonb,
  p_payment_snapshot jsonb,
  p_metadata jsonb,
  p_last_revalidated_at timestamptz,
  p_last_revalidation jsonb,
  p_requirements_snapshot jsonb,
  p_ready_for_confirmation boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_ordering_id uuid;
begin
  perform public.zelomenu_assert_ai_conversation_permit_v1(
    p_empresa_id,
    p_source_ref,
    p_conversation_control_id,
    p_conversation_epoch
  );

  if p_customer_snapshot is null
     or p_cart_snapshot is null
     or p_fulfillment_snapshot is null
     or p_pricing_snapshot is null
     or p_payment_snapshot is null
     or p_metadata is null
     or p_last_revalidation is null
     or jsonb_typeof(p_requirements_snapshot) is distinct from 'array'
     or p_ready_for_confirmation is null then
    raise exception using errcode = 'ZL400', message = 'INVALID_ORDER_SNAPSHOT';
  end if;

  insert into public.zelomenu_cart_sessions (
    empresa_id,
    context,
    state,
    source_ref,
    customer_snapshot,
    cart_snapshot,
    fulfillment_snapshot,
    pricing_snapshot,
    payment_snapshot,
    metadata,
    revision,
    last_revalidated_at,
    last_revalidation,
    requirements_snapshot,
    ready_for_confirmation,
    updated_at
  ) values (
    p_empresa_id,
    'whatsapp_order',
    'cart_open',
    p_source_ref,
    p_customer_snapshot,
    p_cart_snapshot,
    p_fulfillment_snapshot,
    p_pricing_snapshot,
    p_payment_snapshot,
    p_metadata,
    1,
    p_last_revalidated_at,
    p_last_revalidation,
    p_requirements_snapshot,
    p_ready_for_confirmation,
    now()
  )
  returning ordering_id into v_ordering_id;

  return jsonb_build_object('outcome', 'applied', 'orderingId', v_ordering_id);
end;
$function$;

create or replace function public.zelomenu_update_whatsapp_order_with_ai_epoch_v1(
  p_empresa_id uuid,
  p_source_ref text,
  p_conversation_control_id uuid,
  p_conversation_epoch text,
  p_session_id uuid,
  p_expected_revision integer,
  p_message_id text,
  p_customer_snapshot jsonb,
  p_cart_snapshot jsonb,
  p_fulfillment_snapshot jsonb,
  p_pricing_snapshot jsonb,
  p_payment_snapshot jsonb,
  p_last_revalidated_at timestamptz,
  p_last_revalidation jsonb,
  p_requirements_snapshot jsonb,
  p_ready_for_confirmation boolean,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  perform public.zelomenu_assert_ai_conversation_permit_v1(
    p_empresa_id,
    p_source_ref,
    p_conversation_control_id,
    p_conversation_epoch
  );

  if p_session_id is null
     or p_expected_revision is null
     or p_expected_revision < 1
     or nullif(trim(coalesce(p_message_id, '')), '') is null
     or p_customer_snapshot is null
     or p_cart_snapshot is null
     or p_fulfillment_snapshot is null
     or p_pricing_snapshot is null
     or p_payment_snapshot is null
     or p_last_revalidation is null
     or jsonb_typeof(p_requirements_snapshot) is distinct from 'array'
     or p_ready_for_confirmation is null
     or p_metadata is null then
    raise exception using errcode = 'ZL400', message = 'INVALID_ORDER_MUTATION';
  end if;

  update public.zelomenu_cart_sessions
     set customer_snapshot = p_customer_snapshot,
         cart_snapshot = p_cart_snapshot,
         fulfillment_snapshot = p_fulfillment_snapshot,
         pricing_snapshot = p_pricing_snapshot,
         payment_snapshot = p_payment_snapshot,
         metadata = p_metadata,
         revision = revision + 1,
         last_revalidated_at = p_last_revalidated_at,
         last_revalidation = p_last_revalidation,
         requirements_snapshot = p_requirements_snapshot,
         ready_for_confirmation = p_ready_for_confirmation,
         updated_at = now()
   where id = p_session_id
     and empresa_id = p_empresa_id
     and source_ref = p_source_ref
     and context = 'whatsapp_order'
     and state = 'cart_open'
     and revision = p_expected_revision;

  if found then
    return jsonb_build_object('outcome', 'applied');
  end if;
  return jsonb_build_object('outcome', 'conflict');
end;
$function$;

create or replace function public.zelomenu_cancel_whatsapp_order_with_ai_epoch_v1(
  p_empresa_id uuid,
  p_source_ref text,
  p_conversation_control_id uuid,
  p_conversation_epoch text,
  p_session_id uuid,
  p_expected_revision integer,
  p_message_id text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  perform public.zelomenu_assert_ai_conversation_permit_v1(
    p_empresa_id,
    p_source_ref,
    p_conversation_control_id,
    p_conversation_epoch
  );

  if p_session_id is null
     or p_expected_revision is null
     or p_expected_revision < 1
     or nullif(trim(coalesce(p_message_id, '')), '') is null
     or p_metadata is null then
    raise exception using errcode = 'ZL400', message = 'INVALID_ORDER_MUTATION';
  end if;

  update public.zelomenu_cart_sessions
     set state = 'cancelled',
         metadata = p_metadata,
         revision = revision + 1,
         ready_for_confirmation = false,
         archived_at = now(),
         updated_at = now()
   where id = p_session_id
     and empresa_id = p_empresa_id
     and source_ref = p_source_ref
     and context = 'whatsapp_order'
     and state = 'cart_open'
     and revision = p_expected_revision;

  if found then
    return jsonb_build_object('outcome', 'applied');
  end if;
  return jsonb_build_object('outcome', 'conflict');
end;
$function$;

create or replace function public.issue_whatsapp_zelo_confirmation_token_with_ai_epoch_v1(
  p_token_hash text,
  p_empresa_id uuid,
  p_source_ref text,
  p_conversation_control_id uuid,
  p_conversation_epoch text,
  p_session_id uuid,
  p_expected_revision integer,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb;
begin
  perform public.zelomenu_assert_ai_conversation_permit_v1(
    p_empresa_id,
    p_source_ref,
    p_conversation_control_id,
    p_conversation_epoch
  );

  if to_regprocedure('public.issue_whatsapp_zelo_confirmation_token(text,uuid,text,uuid,integer,timestamp with time zone)') is null then
    raise exception using errcode = 'ZL503', message = 'CONFIRMATION_TOKEN_RPC_UNAVAILABLE';
  end if;

  execute $sql$
    select public.issue_whatsapp_zelo_confirmation_token(
      $1, $2, $3, $4, $5, $6
    )
  $sql$
  into v_result
  using
    p_token_hash,
    p_empresa_id,
    p_source_ref,
    p_session_id,
    p_expected_revision,
    p_expires_at;

  return v_result;
end;
$function$;

create or replace function public.confirm_whatsapp_zelo_order_with_ai_epoch_v1(
  p_empresa_id uuid,
  p_source_ref text,
  p_conversation_control_id uuid,
  p_conversation_epoch text,
  p_session_id uuid,
  p_expected_revision integer,
  p_message_id text,
  p_idempotency_key text,
  p_pessoa_id uuid,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb;
begin
  perform public.zelomenu_assert_ai_conversation_permit_v1(
    p_empresa_id,
    p_source_ref,
    p_conversation_control_id,
    p_conversation_epoch
  );

  if p_session_id is null
     or p_expected_revision is null
     or p_expected_revision < 1
     or nullif(trim(coalesce(p_message_id, '')), '') is null
     or nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception using errcode = 'ZL400', message = 'INVALID_ORDER_MUTATION';
  end if;

  if to_regprocedure('public.confirm_whatsapp_zelo_order_atomic_v1(uuid,text,uuid,integer,text,text,uuid,text)') is null then
    raise exception using errcode = 'ZL503', message = 'CONFIRMATION_RPC_UNAVAILABLE';
  end if;

  -- FIX 2026-09-02: o materializador SQL ignorava id_componente e divergia da prévia Node → a confirmação cercada preserva o materializador canônico com componentes.
  -- Preserve the Task 6 canonical, component-aware materializer and every
  -- existing token/idempotency/review semantic inside its original RPC.
  execute $sql$
    select public.confirm_whatsapp_zelo_order_atomic_v1(
      $1, $2, $3, $4, $5, $6, $7, $8
    )
  $sql$
  into v_result
  using
    p_empresa_id,
    p_source_ref,
    p_session_id,
    p_expected_revision,
    p_message_id,
    p_idempotency_key,
    p_pessoa_id,
    p_token_hash;

  return v_result;
end;
$function$;

revoke all on function public.zelomenu_assert_ai_conversation_permit_v1(uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.zelomenu_open_whatsapp_order_with_ai_epoch_v1(uuid, text, uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz, jsonb, jsonb, boolean)
  from public, anon, authenticated;
revoke all on function public.zelomenu_update_whatsapp_order_with_ai_epoch_v1(uuid, text, uuid, text, uuid, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz, jsonb, jsonb, boolean, jsonb)
  from public, anon, authenticated;
revoke all on function public.zelomenu_cancel_whatsapp_order_with_ai_epoch_v1(uuid, text, uuid, text, uuid, integer, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.issue_whatsapp_zelo_confirmation_token_with_ai_epoch_v1(text, uuid, text, uuid, text, uuid, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.confirm_whatsapp_zelo_order_with_ai_epoch_v1(uuid, text, uuid, text, uuid, integer, text, text, uuid, text)
  from public, anon, authenticated;

grant execute on function public.zelomenu_assert_ai_conversation_permit_v1(uuid, text, uuid, text)
  to service_role;
grant execute on function public.zelomenu_open_whatsapp_order_with_ai_epoch_v1(uuid, text, uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz, jsonb, jsonb, boolean)
  to service_role;
grant execute on function public.zelomenu_update_whatsapp_order_with_ai_epoch_v1(uuid, text, uuid, text, uuid, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz, jsonb, jsonb, boolean, jsonb)
  to service_role;
grant execute on function public.zelomenu_cancel_whatsapp_order_with_ai_epoch_v1(uuid, text, uuid, text, uuid, integer, text, jsonb)
  to service_role;
grant execute on function public.issue_whatsapp_zelo_confirmation_token_with_ai_epoch_v1(text, uuid, text, uuid, text, uuid, integer, timestamptz)
  to service_role;
grant execute on function public.confirm_whatsapp_zelo_order_with_ai_epoch_v1(uuid, text, uuid, text, uuid, integer, text, text, uuid, text)
  to service_role;

comment on function public.zelomenu_assert_ai_conversation_permit_v1(uuid, text, uuid, text) is
  'Locks and verifies the shared ZeloChat conversation AI control for one exact tenant/JID/control/decimal epoch permit; fails closed when the shared contract is absent.';

commit;
