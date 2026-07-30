-- Migration: add scheduling columns to empresa_perfil for ZeloMenu
-- Idempotent: safe to run on any environment.

alter table empresa_perfil
  add column if not exists zelomenu_scheduling_enabled boolean not null default true,
  add column if not exists zelomenu_scheduling_lead_time_minutes integer not null default 60;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'zelomenu_scheduling_lead_time_check'
    and conrelid = 'empresa_perfil'::regclass
  ) then
    alter table empresa_perfil
      add constraint zelomenu_scheduling_lead_time_check
        check (zelomenu_scheduling_lead_time_minutes >= 0);
  end if;
end $$;
