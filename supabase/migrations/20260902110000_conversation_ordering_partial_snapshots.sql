begin;

alter table public.zelomenu_cart_sessions
  add column if not exists requirements_snapshot jsonb not null default '[]',
  add column if not exists ready_for_confirmation boolean not null default false;

-- The defaults deliberately backfill every pre-existing session as not ready.
-- Only a future canonical materialization may promote an open WhatsApp draft;
-- no existing terminal state is changed or reopened by this migration.

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
