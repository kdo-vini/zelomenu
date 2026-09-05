begin;

create or replace function public.zelomenu_whatsapp_materialize_cart_v1(
  p_empresa_id uuid,
  p_cart jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_item jsonb;
  v_line_id text;
  v_item_quantity integer;
  v_product record;
  v_group record;
  v_group_input jsonb;
  v_option record;
  v_component record;
  v_selected_options jsonb;
  v_selected_groups jsonb;
  v_cart jsonb := jsonb_build_object(
    'items', '[]'::jsonb,
    'observations', case when p_cart ? 'observations' then p_cart->'observations' else 'null'::jsonb end
  );
  v_requirements jsonb := '[]'::jsonb;
  v_issues jsonb := '[]'::jsonb;
  v_item_issues integer;
  v_distinct_count integer;
  v_total_quantity integer;
  v_option_count integer;
  v_additions numeric(14,2);
  v_base_override numeric(14,2);
  v_base_price numeric(14,2);
  v_unit_price numeric(14,2);
  v_line_total numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_stock record;
begin
  select user_id into v_owner from public.empresa_perfil where id = p_empresa_id;
  if not found then
    return jsonb_build_object('cart', v_cart, 'subtotal', 0, 'issues',
      jsonb_build_array(jsonb_build_object('code', 'store_config_unavailable')), 'requirements', v_requirements);
  end if;
  if jsonb_typeof(p_cart->'items') <> 'array'
     or jsonb_array_length(p_cart->'items') not between 1 and 50 then
    return jsonb_build_object('cart', v_cart, 'subtotal', 0, 'issues',
      jsonb_build_array(jsonb_build_object('code', 'items_invalid')), 'requirements', v_requirements);
  end if;

  -- Lock every component that can affect the selected parent products before
  -- reading pause/name state. During atomic confirmation this makes a pause
  -- either visible to this materialization or wait until the order commits.
  for v_component in
    select component.id
      from public.zelomenu_modifier_components component
      join (
        select distinct link.id_componente
          from jsonb_array_elements(p_cart->'items') item
          join public.zelomenu_modifier_groups modifier_group
            on item->>'productId' ~ '^\d+$'
           and modifier_group.id_produto = (item->>'productId')::bigint
           and modifier_group.id_usuario = v_owner
          join public.zelomenu_modifier_options modifier_option
            on modifier_option.id_grupo = modifier_group.id
           and modifier_option.id_usuario = v_owner
          join public.zelomenu_modifier_option_products link
            on link.id_opcao = modifier_option.id
           and link.id_usuario = v_owner
         where link.id_componente is not null
      ) targeted on targeted.id_componente = component.id
     where component.id_usuario = v_owner
     order by component.id
     for update of component
  loop null; end loop;

  for v_item in select value from jsonb_array_elements(p_cart->'items') loop
    v_item_issues := jsonb_array_length(v_issues);
    v_line_id := nullif(v_item->>'lineId', '');
    if coalesce(jsonb_typeof(v_item->'lineId') = 'string', false) = false
       or v_line_id is null
       or v_line_id !~ '^[A-Za-z0-9_-]{1,64}$'
       or (
         select count(*)
           from jsonb_array_elements(p_cart->'items') duplicate_item
          where duplicate_item->>'lineId' = v_line_id
       ) > 1 then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'line_id_invalid',
        'lineId', v_item->>'lineId'
      ));
      continue;
    end if;
    if coalesce(v_item->>'productId', '') !~ '^\d+$'
       or coalesce(v_item->>'quantity', '') !~ '^[1-9]\d{0,2}$' then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'item_invalid'));
      continue;
    end if;
    v_item_quantity := (v_item->>'quantity')::integer;

    select p.id, p.preco, p.controlar_estoque, p.estoque_atual,
           coalesce(nullif(btrim(pub.nome_publico), ''), p.nome) as public_name
      into v_product
      from public.produtos p
      join public.empresa_perfil profile on profile.id = p_empresa_id and profile.user_id = p.id_usuario
      join public.categorias category on category.id = p.id_categoria and category.id_usuario = p.id_usuario
      join public.zelomenu_product_publications pub
        on pub.id_produto = p.id and pub.id_usuario = p.id_usuario
       and pub.visivel_online = true and pub.pausado_manualmente = false
     where p.id = (v_item->>'productId')::bigint;
    if not found or (coalesce(v_product.controlar_estoque, false) and coalesce(v_product.estoque_atual, 0) <= 0) then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'product_unavailable', 'productId', v_item->>'productId'
      ));
      continue;
    end if;

    if jsonb_typeof(coalesce(v_item->'selectedModifiers', '[]'::jsonb)) <> 'array' then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'modifier_invalid', 'productId', v_product.id));
      continue;
    end if;
    if exists (
      select 1
        from jsonb_array_elements(coalesce(v_item->'selectedModifiers', '[]'::jsonb)) chosen
        left join public.zelomenu_modifier_groups known
          on known.id = case
            when chosen->>'groupId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              then (chosen->>'groupId')::uuid
            else null
          end
         and known.id_produto = v_product.id and known.id_usuario = v_owner and known.ativo = true
       where known.id is null or jsonb_typeof(chosen->'selectedOptions') <> 'array'
    ) then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'modifier_unavailable', 'productId', v_product.id));
      continue;
    end if;

    if exists (
      select 1
        from public.zelomenu_modifier_groups required_group
       where required_group.id_produto = v_product.id
         and required_group.id_usuario = v_owner
         and required_group.ativo = true
         and required_group.min_selecoes > 0
         and (
           select count(*)
             from public.zelomenu_modifier_options available_option
             left join public.zelomenu_modifier_option_products link
               on link.id_opcao = available_option.id and link.id_usuario = v_owner
             left join public.produtos linked_product
               on linked_product.id = link.id_produto and linked_product.id_usuario = v_owner
             left join public.zelomenu_product_publications linked_publication
               on linked_publication.id_produto = linked_product.id and linked_publication.id_usuario = v_owner
             left join public.zelomenu_modifier_components linked_component
               on linked_component.id = link.id_componente
              and linked_component.id_usuario = v_owner
            where available_option.id_grupo = required_group.id
              and available_option.id_usuario = v_owner
              and available_option.ativo = true
              and (
                link.id_opcao is null
                or (
                  link.id_produto is not null
                  and linked_product.id is not null
                  and not coalesce(linked_publication.pausado_manualmente, false)
                  and (not coalesce(linked_product.controlar_estoque, false) or coalesce(linked_product.estoque_atual, 0) > 0)
                )
                or (
                  link.id_componente is not null
                  and linked_component.id is not null
                  and not coalesce(linked_component.pausado_manualmente, false)
                )
              )
         ) < required_group.min_selecoes
    ) then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'required_group_unavailable', 'productId', v_product.id
      ));
      continue;
    end if;

    v_selected_groups := '[]'::jsonb;
    v_additions := 0;
    v_base_override := null;
    for v_group in
      select g.*
        from public.zelomenu_modifier_groups g
       where g.id_produto = v_product.id and g.id_usuario = v_owner and g.ativo = true
       order by g.ordem, g.id
    loop
      select jsonb_build_object('selectedOptions', coalesce(jsonb_agg(option_input order by group_ord, option_ord), '[]'::jsonb))
        into v_group_input
        from (
          select option_input, group_ord, option_ord
            from jsonb_array_elements(coalesce(v_item->'selectedModifiers', '[]'::jsonb)) with ordinality chosen(group_input, group_ord)
            cross join lateral jsonb_array_elements(chosen.group_input->'selectedOptions') with ordinality options(option_input, option_ord)
           where chosen.group_input->>'groupId' = v_group.id::text
        ) selected;

      if exists (
        select 1
          from jsonb_array_elements(v_group_input->'selectedOptions') raw(option_input)
          left join public.zelomenu_modifier_options o
            on o.id = case
              when raw.option_input->>'optionId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                then (raw.option_input->>'optionId')::uuid
              else null
            end
           and o.id_grupo = v_group.id and o.id_usuario = v_owner and o.ativo = true
          left join public.zelomenu_modifier_option_products link
            on link.id_opcao = o.id and link.id_usuario = v_owner
          left join public.produtos linked_product
            on linked_product.id = link.id_produto and linked_product.id_usuario = v_owner
          left join public.zelomenu_product_publications linked_publication
            on linked_publication.id_produto = linked_product.id and linked_publication.id_usuario = v_owner
          left join public.zelomenu_modifier_components linked_component
            on linked_component.id = link.id_componente
           and linked_component.id_usuario = v_owner
         where o.id is null
            or coalesce(raw.option_input->>'quantity', '') !~ '^[1-9]\d{0,8}$'
            or (not v_group.permite_quantidade and case
              when coalesce(raw.option_input->>'quantity', '') ~ '^[1-9]\d{0,8}$'
                then (raw.option_input->>'quantity')::integer <> 1
              else true
            end)
            or (link.id_opcao is not null and (
              (link.id_produto is null and link.id_componente is null)
              or (link.id_produto is not null and (
                linked_product.id is null
                or coalesce(linked_publication.pausado_manualmente, false)
                or (coalesce(linked_product.controlar_estoque, false) and coalesce(linked_product.estoque_atual, 0) <= 0)
              ))
              or (link.id_componente is not null and (
                linked_component.id is null
                or coalesce(linked_component.pausado_manualmente, false)
              ))
            ))
      ) then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'modifier_unavailable', 'productId', v_product.id));
        exit;
      end if;

      select count(distinct option_input->>'optionId')
        into v_distinct_count
        from jsonb_array_elements(v_group_input->'selectedOptions') raw(option_input);
      if v_distinct_count < v_group.min_selecoes
         or (v_group.max_selecoes is not null and v_distinct_count > v_group.max_selecoes) then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'modifier_selection_bounds', 'productId', v_product.id));
        exit;
      end if;

      select coalesce(sum((option_input->>'quantity')::integer), 0)::integer
        into v_total_quantity
        from jsonb_array_elements(v_group_input->'selectedOptions') selected(option_input);
      if v_total_quantity < v_group.minimo_total_quantidade
         or (v_group.maximo_total_quantidade is not null
             and v_total_quantity > v_group.maximo_total_quantidade) then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'code', 'modifier_total_quantity_bounds', 'productId', v_product.id,
          'groupId', v_group.id, 'selectedQuantity', v_total_quantity,
          'minimumQuantity', v_group.minimo_total_quantidade,
          'maximumQuantity', v_group.maximo_total_quantidade
        ));
        exit;
      end if;

      v_selected_options := '[]'::jsonb;
      v_option_count := 0;
      for v_option in
        with raw as (
          select option_input, ordinality
            from jsonb_array_elements(v_group_input->'selectedOptions') with ordinality input(option_input, ordinality)
        )
        select o.id,
               coalesce(nullif(publication.nome_publico, ''), linked_product.nome, linked_component.nome, o.nome) as option_name,
               coalesce(link.price_override, linked_product.preco, o.price_delta)::numeric(10,2) as resolved_price,
               sum((raw.option_input->>'quantity')::integer)::integer as quantity,
               min(raw.ordinality) as first_ordinality,
               linked_product.id as linked_product_id
          from raw
          join public.zelomenu_modifier_options o
            on o.id = (raw.option_input->>'optionId')::uuid
           and o.id_grupo = v_group.id and o.id_usuario = v_owner and o.ativo = true
          left join public.zelomenu_modifier_option_products link
            on link.id_opcao = o.id and link.id_usuario = v_owner
          left join public.produtos linked_product
            on linked_product.id = link.id_produto and linked_product.id_usuario = v_owner
          left join public.zelomenu_modifier_components linked_component
            on linked_component.id = link.id_componente
           and linked_component.id_usuario = v_owner
          left join public.zelomenu_product_publications publication
            on publication.id_produto = linked_product.id and publication.id_usuario = v_owner
         group by o.id, publication.nome_publico, linked_product.nome, linked_component.nome, o.nome,
                  link.price_override, linked_product.preco, o.price_delta, linked_product.id
         order by min(raw.ordinality)
      loop
        if (not v_group.permite_quantidade and v_option.quantity <> 1)
           or (v_group.maximo_por_opcao is not null and v_option.quantity > v_group.maximo_por_opcao) then
          v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'modifier_quantity_invalid', 'productId', v_product.id));
          exit;
        end if;
        v_selected_options := v_selected_options || jsonb_build_array(jsonb_build_object(
          'optionId', v_option.id,
          'optionName', v_option.option_name,
          'priceDelta', v_option.resolved_price,
          'quantity', v_option.quantity
        ));
        v_option_count := v_option_count + 1;
        if v_group.modo_preco = 'substituir' then
          v_base_override := v_option.resolved_price;
        else
          v_additions := v_additions + v_option.resolved_price * v_option.quantity;
        end if;
        if v_option.linked_product_id is not null then
          v_requirements := v_requirements || jsonb_build_array(jsonb_build_object(
            'product_id', v_option.linked_product_id,
            'linked_product_id', v_option.linked_product_id,
            'required_quantity', v_option.quantity * v_item_quantity
          ));
        end if;
      end loop;
      if jsonb_array_length(v_issues) > v_item_issues then exit; end if;
      if v_option_count > 0 then
        v_selected_groups := v_selected_groups || jsonb_build_array(jsonb_build_object(
          'groupId', v_group.id,
          'groupName', v_group.nome,
          'kind', v_group.tipo,
          'selectedOptions', v_selected_options
        ));
      end if;
    end loop;
    if jsonb_array_length(v_issues) > v_item_issues then continue; end if;

    v_base_price := v_product.preco;
    v_unit_price := round(coalesce(v_base_override, v_base_price) + v_additions, 2);
    v_line_total := round(v_unit_price * v_item_quantity, 2);
    v_cart := jsonb_set(v_cart, '{items}', (v_cart->'items') || jsonb_build_array(jsonb_build_object(
      'lineId', v_line_id,
      'productId', v_product.id,
      'productName', v_product.public_name,
      'baseUnitPrice', v_base_price,
      'selectedModifiers', v_selected_groups,
      'modifierDeltaTotal', round(v_unit_price - v_base_price, 2),
      'quantity', v_item_quantity,
      'unitPrice', v_unit_price,
      'lineTotal', v_line_total,
      'notes', nullif(btrim(left(v_item->>'notes', 200)), '')
    )));
    v_subtotal := v_subtotal + v_line_total;
    v_requirements := v_requirements || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'linked_product_id', null,
      'required_quantity', v_item_quantity
    ));
  end loop;

  for v_stock in
    select p.id, p.controlar_estoque, p.estoque_atual,
           sum(requirement.required_quantity)::numeric as required_quantity,
           bool_or(requirement.linked_product_id is not null) as includes_linked
      from jsonb_to_recordset(v_requirements) as requirement(
        product_id bigint,
        linked_product_id bigint,
        required_quantity numeric
      )
      join public.produtos p on p.id = requirement.product_id and p.id_usuario = v_owner
     group by p.id, p.controlar_estoque, p.estoque_atual
  loop
    if coalesce(v_stock.controlar_estoque, false)
       and coalesce(v_stock.estoque_atual, 0) < v_stock.required_quantity then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'stock_unavailable',
        'productId', v_stock.id,
        'requiredQuantity', v_stock.required_quantity,
        'availableQuantity', coalesce(v_stock.estoque_atual, 0),
        'linked', v_stock.includes_linked
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'cart', v_cart,
    'subtotal', round(v_subtotal, 2),
    'issues', v_issues,
    'requirements', v_requirements
  );
end
$$;

comment on function public.zelomenu_whatsapp_materialize_cart_v1(uuid, jsonb) is
  'Rematerializa o carrinho WhatsApp por IDs vivos, incluindo componentes canônicos, linked products e requisitos de estoque agregáveis.';

revoke all on function public.zelomenu_whatsapp_materialize_cart_v1(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.zelomenu_whatsapp_materialize_cart_v1(uuid, jsonb) to service_role;

commit;
