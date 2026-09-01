begin;

create table public.zelomenu_modifier_components (
  id uuid primary key default gen_random_uuid(),
  id_usuario uuid not null references auth.users(id) on delete cascade,
  nome text not null check (length(btrim(nome)) > 0),
  nome_chave text not null check (length(btrim(nome_chave)) > 0),
  pausado_manualmente boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id_usuario, nome_chave)
);

create index zelomenu_modifier_components_user_name_idx
  on public.zelomenu_modifier_components (id_usuario, nome_chave);

alter table public.zelomenu_modifier_components enable row level security;

create policy zelomenu_modifier_components_actor_select
  on public.zelomenu_modifier_components for select
  using (get_owner_user_id(auth.uid()) = id_usuario);

create policy zelomenu_modifier_components_actor_insert
  on public.zelomenu_modifier_components for insert
  with check (
    get_owner_user_id(auth.uid()) = id_usuario
    and fiado_actor_can('produtos.gerenciar', id_usuario)
  );

create policy zelomenu_modifier_components_actor_update
  on public.zelomenu_modifier_components for update
  using (
    get_owner_user_id(auth.uid()) = id_usuario
    and fiado_actor_can('produtos.gerenciar', id_usuario)
  )
  with check (
    get_owner_user_id(auth.uid()) = id_usuario
    and fiado_actor_can('produtos.gerenciar', id_usuario)
  );

create policy zelomenu_modifier_components_actor_delete
  on public.zelomenu_modifier_components for delete
  using (
    get_owner_user_id(auth.uid()) = id_usuario
    and fiado_actor_can('produtos.gerenciar', id_usuario)
  );

alter table public.zelomenu_modifier_option_products
  alter column id_produto drop not null,
  add column id_componente uuid references public.zelomenu_modifier_components(id) on delete cascade;

-- Existing option-to-product links keep their destination. Every unlinked
-- occurrence is assigned one canonical product (when unique by normalized
-- name) or one internal component shared by all equal names.
with unlinked as (
  select
    o.id,
    o.id_usuario,
    o.price_delta,
    btrim(regexp_replace(lower(translate(o.nome,
      'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOoooooUUUUuuuuCc')), '[^a-z0-9]+', ' ', 'g')) as nome_chave
  from public.zelomenu_modifier_options o
  left join public.zelomenu_modifier_option_products link
    on link.id_opcao = o.id
  where link.id_opcao is null
), matches as (
  select u.id, u.id_usuario, u.price_delta, min(p.id) as id_produto, count(p.id) as quantidade
  from unlinked u
  left join public.produtos p
    on p.id_usuario = u.id_usuario
   and btrim(regexp_replace(lower(translate(p.nome,
      'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOoooooUUUUuuuuCc')), '[^a-z0-9]+', ' ', 'g')) = u.nome_chave
  group by u.id, u.id_usuario, u.price_delta
)
insert into public.zelomenu_modifier_option_products (id_opcao, id_usuario, id_produto, price_override)
select id, id_usuario, id_produto, price_delta
from matches
where quantidade = 1;

with remaining as (
  select
    o.id_usuario,
    o.nome,
    btrim(regexp_replace(lower(translate(o.nome,
      'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOoooooUUUUuuuuCc')), '[^a-z0-9]+', ' ', 'g')) as nome_chave
  from public.zelomenu_modifier_options o
  left join public.zelomenu_modifier_option_products link
    on link.id_opcao = o.id
  where link.id_opcao is null
)
insert into public.zelomenu_modifier_components (id_usuario, nome, nome_chave)
select id_usuario, min(nome), nome_chave
from remaining
group by id_usuario, nome_chave
on conflict (id_usuario, nome_chave) do nothing;

insert into public.zelomenu_modifier_option_products (id_opcao, id_usuario, id_componente, price_override)
select o.id, o.id_usuario, component.id, o.price_delta
from public.zelomenu_modifier_options o
join public.zelomenu_modifier_components component
  on component.id_usuario = o.id_usuario
 and component.nome_chave = btrim(regexp_replace(lower(translate(o.nome,
      'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOoooooUUUUuuuuCc')), '[^a-z0-9]+', ' ', 'g'))
left join public.zelomenu_modifier_option_products link
  on link.id_opcao = o.id
where link.id_opcao is null;

-- A local inactive flag used to mean "pause this item". Convert that state to
-- the new canonical identity and reactivate the group occurrence.
update public.zelomenu_modifier_components component
set pausado_manualmente = true,
    updated_at = now()
from public.zelomenu_modifier_option_products link
join public.zelomenu_modifier_options option_row on option_row.id = link.id_opcao
where link.id_componente = component.id
  and option_row.ativo = false;

insert into public.zelomenu_product_publications (
  id_usuario,
  id_produto,
  visivel_online,
  pausado_manualmente,
  ordem
)
select distinct link.id_usuario, link.id_produto, false, true, 0
from public.zelomenu_modifier_option_products link
join public.zelomenu_modifier_options option_row on option_row.id = link.id_opcao
where link.id_produto is not null
  and option_row.ativo = false
on conflict (id_usuario, id_produto) do update
set pausado_manualmente = true,
    updated_at = now();

update public.zelomenu_modifier_options
set ativo = true,
    updated_at = now()
where ativo = false;

alter table public.zelomenu_modifier_option_products
  add constraint zelomenu_modifier_option_products_exact_destination
  check (num_nonnulls(id_produto, id_componente) = 1) not valid;

alter table public.zelomenu_modifier_option_products
  validate constraint zelomenu_modifier_option_products_exact_destination;

drop policy zelomenu_modifier_option_products_actor_insert
  on public.zelomenu_modifier_option_products;
drop policy zelomenu_modifier_option_products_actor_update
  on public.zelomenu_modifier_option_products;

create policy zelomenu_modifier_option_products_actor_insert
  on public.zelomenu_modifier_option_products for insert
  with check (
    get_owner_user_id(auth.uid()) = id_usuario
    and fiado_actor_can('produtos.gerenciar', id_usuario)
    and exists (
      select 1 from public.zelomenu_modifier_options option_row
      where option_row.id = id_opcao and option_row.id_usuario = zelomenu_modifier_option_products.id_usuario
    )
    and (
      (id_produto is not null and exists (
        select 1 from public.produtos product_row
        where product_row.id = id_produto and product_row.id_usuario = zelomenu_modifier_option_products.id_usuario
      ))
      or
      (id_componente is not null and exists (
        select 1 from public.zelomenu_modifier_components component_row
        where component_row.id = id_componente and component_row.id_usuario = zelomenu_modifier_option_products.id_usuario
      ))
    )
  );

create policy zelomenu_modifier_option_products_actor_update
  on public.zelomenu_modifier_option_products for update
  using (
    get_owner_user_id(auth.uid()) = id_usuario
    and fiado_actor_can('produtos.gerenciar', id_usuario)
  )
  with check (
    get_owner_user_id(auth.uid()) = id_usuario
    and fiado_actor_can('produtos.gerenciar', id_usuario)
    and exists (
      select 1 from public.zelomenu_modifier_options option_row
      where option_row.id = id_opcao and option_row.id_usuario = zelomenu_modifier_option_products.id_usuario
    )
    and (
      (id_produto is not null and exists (
        select 1 from public.produtos product_row
        where product_row.id = id_produto and product_row.id_usuario = zelomenu_modifier_option_products.id_usuario
      ))
      or
      (id_componente is not null and exists (
        select 1 from public.zelomenu_modifier_components component_row
        where component_row.id = id_componente and component_row.id_usuario = zelomenu_modifier_option_products.id_usuario
      ))
    )
  );

commit;
