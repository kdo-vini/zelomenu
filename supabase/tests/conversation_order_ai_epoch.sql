begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

-- ZeloMenu's migration must compile without ZeloChat and fail closed at
-- runtime. A fresh local Menu test database therefore lacks the shared
-- objects. Recreate only the checked-in 063/064 contract needed by this test,
-- inside this transaction; the final rollback removes the test-only bootstrap.
do $bootstrap$
begin
  if to_regclass('public.zelochat_conversation_ai_control') is null then
    execute $ddl$
      create table public.zelochat_conversation_ai_control (
        id uuid primary key default gen_random_uuid(),
        empresa_id uuid not null references public.empresa_perfil(id) on delete cascade,
        identity_key text not null,
        mode text not null default 'ai' check (mode in ('ai', 'human')),
        epoch bigint not null default 0 check (epoch >= 0),
        changed_source text not null default 'bootstrap',
        unique (empresa_id, id),
        unique (empresa_id, identity_key)
      )
    $ddl$;
  end if;

  if to_regclass('public.zelochat_sessions') is null then
    execute $ddl$
      create table public.zelochat_sessions (
        id uuid primary key default gen_random_uuid(),
        empresa_id uuid not null references public.empresa_perfil(id) on delete cascade,
        remote_jid text not null,
        conversation_control_id uuid,
        unique (empresa_id, remote_jid),
        foreign key (empresa_id, conversation_control_id)
          references public.zelochat_conversation_ai_control(empresa_id, id)
          on update cascade on delete restrict
      )
    $ddl$;
  end if;

  if to_regprocedure('public.zelochat_conversation_control_lock_gate()') is null then
    execute $ddl$
      create function public.zelochat_conversation_control_lock_gate()
      returns void
      language plpgsql
      security definer
      set search_path = public, pg_temp
      as $gate$
      begin
        perform pg_advisory_xact_lock(
          hashtextextended('zelochat:conversation_control:lock_gate:v1', 0)
        );
      end;
      $gate$
    $ddl$;
  end if;
end;
$bootstrap$;

revoke all on table public.zelochat_conversation_ai_control, public.zelochat_sessions
  from public, anon, authenticated;
grant all on table public.zelochat_conversation_ai_control, public.zelochat_sessions
  to service_role;
revoke all on function public.zelochat_conversation_control_lock_gate()
  from public, anon, authenticated;
grant execute on function public.zelochat_conversation_control_lock_gate()
  to service_role;

select plan(14);

insert into auth.users (
  id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'b8000000-0000-4000-8000-000000000001',
  'conversation-epoch@invalid.local',
  'authenticated', 'authenticated', '{}', '{}', now(), now()
);

insert into public.empresa_perfil (id, user_id, nome_exibicao)
values (
  'b8000000-0000-4000-8000-000000000002',
  'b8000000-0000-4000-8000-000000000001',
  'Loja do teste de epoch'
);

-- This is the real shared ZeloChat contract from migrations 063/064. The
-- ZeloMenu migration deliberately does not create a standalone substitute.
insert into public.zelochat_conversation_ai_control (
  id, empresa_id, identity_key, mode, epoch, changed_source
) values (
  'b8000000-0000-4000-8000-000000000003',
  'b8000000-0000-4000-8000-000000000002',
  'phone:11888888888',
  'ai',
  10,
  'pgtap'
);

insert into public.zelochat_sessions (
  id, empresa_id, remote_jid, conversation_control_id
) values (
  'b8000000-0000-4000-8000-000000000004',
  'b8000000-0000-4000-8000-000000000002',
  '5511888888888@s.whatsapp.net',
  'b8000000-0000-4000-8000-000000000003'
);

select is(
  (select conversation_control_id
    from public.zelochat_sessions
    where id = 'b8000000-0000-4000-8000-000000000004'),
  'b8000000-0000-4000-8000-000000000003'::uuid,
  'shared bridge preserves exact seeded control binding'
);

set local role service_role;

select lives_ok(
  $sql$
    select public.zelomenu_assert_ai_conversation_permit_v1(
      'b8000000-0000-4000-8000-000000000002',
      '5511888888888@s.whatsapp.net',
      'b8000000-0000-4000-8000-000000000003',
      '10'
    )
  $sql$,
  'current AI permit succeeds'
);

select throws_ok(
  $sql$
    select public.zelomenu_assert_ai_conversation_permit_v1(
      'b8000000-0000-4000-8000-000000000002',
      '5511888888888@s.whatsapp.net',
      'b8000000-0000-4000-8000-000000000003',
      '9'
    )
  $sql$,
  'ZL409',
  'AI_TURN_REVOKED',
  'stale epoch is rejected while control remains in AI mode'
);

-- A takeover advances the control immediately before create.
update public.zelochat_conversation_ai_control
set mode = 'human', epoch = 11, changed_source = 'pgtap_takeover'
where id = 'b8000000-0000-4000-8000-000000000003';

select throws_ok(
  $sql$
    select public.zelomenu_open_whatsapp_order_with_ai_epoch_v1(
      'b8000000-0000-4000-8000-000000000002',
      '5511888888888@s.whatsapp.net',
      'b8000000-0000-4000-8000-000000000003',
      '10',
      '{"name":"Cliente teste","phone":null}'::jsonb,
      '{"items":[],"observations":null}'::jsonb,
      '{"type":"pickup","asap":true,"deliveryFee":0,"deliveryFeeToConfirm":false}'::jsonb,
      '{"subtotal":0,"deliveryFee":0,"discount":0,"total":0}'::jsonb,
      '{"declaredMethod":"dinheiro","pixReceiptRequired":false,"pixReceiptApproved":false}'::jsonb,
      '{"pessoaId":null,"processedMessageIds":["message-create"]}'::jsonb,
      now(),
      '{"checkedAt":"2026-09-02T12:00:00.000Z","ok":true,"issues":[]}'::jsonb,
      '[]'::jsonb,
      true
    )
  $sql$,
  'ZL409',
  'AI_TURN_REVOKED',
  'takeover immediately before create revokes the AI turn'
);

select is(
  (select count(*)::integer from public.zelomenu_cart_sessions
    where empresa_id = 'b8000000-0000-4000-8000-000000000002'),
  0,
  'revoked create leaves no cart session'
);

-- Restore AI only to prepare the next independent race, then create one cart
-- outside the RPC. Every tested mutation receives the now-stale prior epoch.
update public.zelochat_conversation_ai_control
set mode = 'ai', changed_source = 'pgtap_reset'
where id = 'b8000000-0000-4000-8000-000000000003';

reset role;

insert into public.zelomenu_cart_sessions (
  id, ordering_id, empresa_id, context, state, source_ref,
  metadata, requirements_snapshot, ready_for_confirmation
) values (
  'b8000000-0000-4000-8000-000000000010',
  'b8000000-0000-4000-8000-000000000011',
  'b8000000-0000-4000-8000-000000000002',
  'whatsapp_order',
  'cart_open',
  '5511888888888@s.whatsapp.net',
  '{"pessoaId":null,"processedMessageIds":["message-open"]}'::jsonb,
  '[]'::jsonb,
  false
);

create temporary table conversation_epoch_before as
select to_jsonb(session_row) as session_snapshot
from public.zelomenu_cart_sessions session_row
where id = 'b8000000-0000-4000-8000-000000000010';

grant select on conversation_epoch_before to service_role;

set local role service_role;

update public.zelochat_conversation_ai_control
set mode = 'human', epoch = 12, changed_source = 'pgtap_takeover'
where id = 'b8000000-0000-4000-8000-000000000003';

select throws_ok(
  $sql$
    select public.issue_whatsapp_zelo_confirmation_token_with_ai_epoch_v1(
      repeat('a', 64),
      'b8000000-0000-4000-8000-000000000002',
      '5511888888888@s.whatsapp.net',
      'b8000000-0000-4000-8000-000000000003',
      '11',
      'b8000000-0000-4000-8000-000000000010',
      1,
      now() + interval '10 minutes'
    )
  $sql$,
  'ZL409',
  'AI_TURN_REVOKED',
  'takeover immediately before token issuance revokes the AI turn'
);

select is(
  (select count(*)::integer from public.zelomenu_whatsapp_confirmation_tokens
    where session_id = 'b8000000-0000-4000-8000-000000000010'),
  0,
  'revoked token issuance writes no confirmation capability'
);

update public.zelochat_conversation_ai_control
set mode = 'ai', changed_source = 'pgtap_reset'
where id = 'b8000000-0000-4000-8000-000000000003';
update public.zelochat_conversation_ai_control
set mode = 'human', epoch = 13, changed_source = 'pgtap_takeover'
where id = 'b8000000-0000-4000-8000-000000000003';

select throws_ok(
  $sql$
    select public.zelomenu_update_whatsapp_order_with_ai_epoch_v1(
      'b8000000-0000-4000-8000-000000000002',
      '5511888888888@s.whatsapp.net',
      'b8000000-0000-4000-8000-000000000003',
      '12',
      'b8000000-0000-4000-8000-000000000010',
      1,
      'message-update',
      '{"name":"Alterado","phone":null}'::jsonb,
      '{"items":[],"observations":"alterado"}'::jsonb,
      '{"type":"pickup","asap":true,"deliveryFee":0,"deliveryFeeToConfirm":false}'::jsonb,
      '{"subtotal":0,"deliveryFee":0,"discount":0,"total":0}'::jsonb,
      '{"declaredMethod":"dinheiro","pixReceiptRequired":false,"pixReceiptApproved":false}'::jsonb,
      now(),
      '{"checkedAt":"2026-09-02T12:01:00.000Z","ok":true,"issues":[]}'::jsonb,
      '[]'::jsonb,
      true,
      '{"pessoaId":null,"processedMessageIds":["message-open","message-update"]}'::jsonb
    )
  $sql$,
  'ZL409',
  'AI_TURN_REVOKED',
  'takeover immediately before update revokes the AI turn'
);

select is(
  (select to_jsonb(session_row) from public.zelomenu_cart_sessions session_row
    where id = 'b8000000-0000-4000-8000-000000000010'),
  (select session_snapshot from conversation_epoch_before),
  'revoked update leaves the complete snapshot unchanged'
);

update public.zelochat_conversation_ai_control
set mode = 'ai', changed_source = 'pgtap_reset'
where id = 'b8000000-0000-4000-8000-000000000003';
update public.zelochat_conversation_ai_control
set mode = 'human', epoch = 14, changed_source = 'pgtap_takeover'
where id = 'b8000000-0000-4000-8000-000000000003';

select throws_ok(
  $sql$
    select public.zelomenu_cancel_whatsapp_order_with_ai_epoch_v1(
      'b8000000-0000-4000-8000-000000000002',
      '5511888888888@s.whatsapp.net',
      'b8000000-0000-4000-8000-000000000003',
      '13',
      'b8000000-0000-4000-8000-000000000010',
      1,
      'message-cancel',
      '{"pessoaId":null,"processedMessageIds":["message-open","message-cancel"],"cancellationReason":"explicit_command"}'::jsonb
    )
  $sql$,
  'ZL409',
  'AI_TURN_REVOKED',
  'takeover immediately before cancel revokes the AI turn'
);

select is(
  (select to_jsonb(session_row) from public.zelomenu_cart_sessions session_row
    where id = 'b8000000-0000-4000-8000-000000000010'),
  (select session_snapshot from conversation_epoch_before),
  'revoked cancel leaves the complete snapshot unchanged'
);

update public.zelochat_conversation_ai_control
set mode = 'ai', changed_source = 'pgtap_reset'
where id = 'b8000000-0000-4000-8000-000000000003';
update public.zelochat_conversation_ai_control
set mode = 'human', epoch = 15, changed_source = 'pgtap_takeover'
where id = 'b8000000-0000-4000-8000-000000000003';

select throws_ok(
  $sql$
    select public.confirm_whatsapp_zelo_order_with_ai_epoch_v1(
      'b8000000-0000-4000-8000-000000000002',
      '5511888888888@s.whatsapp.net',
      'b8000000-0000-4000-8000-000000000003',
      '14',
      'b8000000-0000-4000-8000-000000000010',
      1,
      'message-confirm',
      'whatsapp:epoch-race:message-confirm',
      null,
      null
    )
  $sql$,
  'ZL409',
  'AI_TURN_REVOKED',
  'takeover immediately before confirm revokes the AI turn'
);

select is(
  (select to_jsonb(session_row) from public.zelomenu_cart_sessions session_row
    where id = 'b8000000-0000-4000-8000-000000000010'),
  (select session_snapshot from conversation_epoch_before),
  'revoked confirm leaves the complete snapshot unchanged'
);

select is(
  (select count(*)::integer from public.zelo_orders
    where zelomenu_session_id = 'b8000000-0000-4000-8000-000000000010'),
  0,
  'revoked confirm creates no canonical order'
);

select * from finish();

rollback;
