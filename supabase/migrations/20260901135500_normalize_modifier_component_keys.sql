begin;

-- Keep the database key identical to `normalizeCatalogSearchText`: punctuation
-- and repeated whitespace do not create a second canonical component.
with grouped as (
  select
    component.id_usuario,
    btrim(regexp_replace(lower(translate(component.nome,
      'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOoooooUUUUuuuuCc')), '[^a-z0-9]+', ' ', 'g')) as nome_chave,
    min(component.id::text)::uuid as canonical_id,
    bool_or(component.pausado_manualmente) as pausado_manualmente
  from public.zelomenu_modifier_components component
  group by component.id_usuario,
    btrim(regexp_replace(lower(translate(component.nome,
      'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOoooooUUUUuuuuCc')), '[^a-z0-9]+', ' ', 'g'))
)
update public.zelomenu_modifier_components component
set pausado_manualmente = grouped.pausado_manualmente,
    updated_at = now()
from grouped
where component.id = grouped.canonical_id
  and component.pausado_manualmente is distinct from grouped.pausado_manualmente;

with normalized as (
  select
    component.id,
    component.id_usuario,
    btrim(regexp_replace(lower(translate(component.nome,
      'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOoooooUUUUuuuuCc')), '[^a-z0-9]+', ' ', 'g')) as nome_chave,
    min(component.id::text) over (
      partition by component.id_usuario,
      btrim(regexp_replace(lower(translate(component.nome,
        'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç',
        'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOoooooUUUUuuuuCc')), '[^a-z0-9]+', ' ', 'g'))
    )::uuid as canonical_id
  from public.zelomenu_modifier_components component
)
update public.zelomenu_modifier_option_products link
set id_componente = normalized.canonical_id,
    updated_at = now()
from normalized
where link.id_componente = normalized.id
  and normalized.id <> normalized.canonical_id;

with normalized as (
  select
    component.id,
    component.id_usuario,
    min(component.id::text) over (
      partition by component.id_usuario,
      btrim(regexp_replace(lower(translate(component.nome,
        'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç',
        'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOoooooUUUUuuuuCc')), '[^a-z0-9]+', ' ', 'g'))
    )::uuid as canonical_id
  from public.zelomenu_modifier_components component
)
delete from public.zelomenu_modifier_components component
using normalized
where component.id = normalized.id
  and normalized.id <> normalized.canonical_id;

update public.zelomenu_modifier_components component
set nome_chave = btrim(regexp_replace(lower(translate(component.nome,
      'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOoooooUUUUuuuuCc')), '[^a-z0-9]+', ' ', 'g')),
    updated_at = now();

commit;
