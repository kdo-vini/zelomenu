-- Executar somente depois de publicar o ZeloMenu com o suporte a quantidade total.
-- A migration de colunas deve estar aplicada antes deste rollout.

update public.zelomenu_modifier_groups
set
  nome = 'Escolha 3 coberturas ou confeitos incluídos',
  permite_quantidade = true,
  minimo_total_quantidade = 3,
  maximo_total_quantidade = 3,
  maximo_por_opcao = 2,
  min_selecoes = 0,
  max_selecoes = 3,
  updated_at = now()
where id = 'fbe11313-bf62-4ca2-95e1-b4608ca9184f'
  and id_produto = 1043
  and id_usuario = '39192d38-507c-443c-b075-85998abde740';

-- Apenas sinaliza duplicidades para revisão manual; nenhuma opção é removida.
select id, id_grupo, nome, ordem, ativo
from public.zelomenu_modifier_options
where id_grupo in (
    select id
    from public.zelomenu_modifier_groups
    where id_produto = 1043
      and id_usuario = '39192d38-507c-443c-b075-85998abde740'
  )
  and lower(trim(nome)) = 'amendoim'
order by ordem, id;

-- Conferência do grupo atualizado. Os grupos pagos não fazem parte deste update.
select id, id_produto, nome, permite_quantidade, minimo_total_quantidade,
       maximo_total_quantidade, maximo_por_opcao, min_selecoes, max_selecoes
from public.zelomenu_modifier_groups
where id = 'fbe11313-bf62-4ca2-95e1-b4608ca9184f';
