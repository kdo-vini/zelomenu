begin;

alter table public.zelomenu_cart_sessions
  add column if not exists requirements_snapshot jsonb not null default '[]',
  add column if not exists ready_for_confirmation boolean not null default false;

-- The defaults deliberately backfill every pre-existing session as not ready.
-- Only a future canonical materialization may promote an open WhatsApp draft;
-- no existing terminal state is changed or reopened by this migration.

create or replace function public.zelomenu_clear_conversation_readiness_on_terminal_state()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if new.context <> 'whatsapp_order' or new.state <> 'cart_open' then
    new.ready_for_confirmation := false;
  end if;
  return new;
end;
$function$;

create trigger zelomenu_cart_sessions_clear_terminal_readiness
before update on public.zelomenu_cart_sessions
for each row execute function public.zelomenu_clear_conversation_readiness_on_terminal_state();

revoke all on function public.zelomenu_clear_conversation_readiness_on_terminal_state() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'zelomenu_cart_sessions_requirements_snapshot_array_check'
      and conrelid = 'public.zelomenu_cart_sessions'::regclass
  ) then
    alter table public.zelomenu_cart_sessions
      add constraint zelomenu_cart_sessions_requirements_snapshot_array_check
      check (jsonb_typeof(requirements_snapshot) = 'array');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'zelomenu_cart_sessions_ready_for_confirmation_state_check'
      and conrelid = 'public.zelomenu_cart_sessions'::regclass
  ) then
    alter table public.zelomenu_cart_sessions
      add constraint zelomenu_cart_sessions_ready_for_confirmation_state_check
      check (
        not ready_for_confirmation
        or (context = 'whatsapp_order' and state = 'cart_open')
      );
  end if;
end;
$$;

commit;
