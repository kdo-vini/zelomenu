alter table public.zelomenu_modifier_groups
  add column if not exists minimo_total_quantidade integer not null default 0;

alter table public.zelomenu_modifier_groups
  add column if not exists maximo_total_quantidade integer null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'zelomenu_modifier_groups_minimo_total_quantidade_check'
      and conrelid = 'public.zelomenu_modifier_groups'::regclass
  ) then
    alter table public.zelomenu_modifier_groups
      add constraint zelomenu_modifier_groups_minimo_total_quantidade_check
      check (minimo_total_quantidade >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'zelomenu_modifier_groups_maximo_total_quantidade_check'
      and conrelid = 'public.zelomenu_modifier_groups'::regclass
  ) then
    alter table public.zelomenu_modifier_groups
      add constraint zelomenu_modifier_groups_maximo_total_quantidade_check
      check (
        maximo_total_quantidade is null
        or maximo_total_quantidade >= minimo_total_quantidade
      );
  end if;
end;
$$;
