# Componentes canônicos e pausa global

## Decisão aprovada

Cada item de cardápio terá uma única identidade controlável. A identidade pode
ser um produto já existente ou, para itens usados somente em complementos, um
componente canônico interno. Os vínculos com grupos de uma marmita, massa ou
combo não são produtos e não ganham controles próprios de pausa.

## Objetivos

- Não criar linhas adicionais em `produtos` para opções que hoje só existem em
  grupos; o número exibido de produtos cadastrados não pode aumentar por esta
  consolidação.
- Mostrar cada nome apenas uma vez na busca administrativa, com seus usos
  listados como contexto.
- Fazer `Pausar no cardápio` valer globalmente para todos os usos do item.
- Manter preço, categoria do produto-pai, grupo e regra `somar`/`substituir`
  próprios de cada uso.
- Para remover somente um uso, remover a opção daquele grupo; não pausar uma
  ocorrência isolada.

## Modelo de dados

`produtos` continua sendo a fonte canônica para itens que já são produtos. A
nova tabela `zelomenu_modifier_components` representa somente identidades que
não possuem produto correspondente; ela contém `nome`, uma chave normalizada e
`pausado_manualmente`. Ela não aparece no contador de `produtos`.

`zelomenu_modifier_option_products` passa a ser o vínculo de uma ocorrência de
grupo para exatamente uma destas identidades: `id_produto` **ou**
`id_componente`. O `price_override` permanece no vínculo. Durante a migração,
todo valor atual de `price_delta` é copiado para `price_override`, inclusive
zero, para que preço do cardápio não mude.

As linhas de `zelomenu_modifier_options` permanecem como ocorrências de grupo.
O campo legado `ativo` deixa de participar da disponibilidade pública. Linhas
atualmente inativas são migradas para a pausa da identidade canônica e então
reativadas, removendo a noção de pausa local sem apagar nenhum uso.

## Migração de dados

Para cada opção ainda sem vínculo, a migração faz correspondência por chave de
nome normalizada com um produto existente do mesmo usuário. Havendo uma única
correspondência, cria o vínculo ao produto. Sem correspondência, cria ou
reutiliza um componente interno com a mesma chave e o vincula. Nomes com mais
de um produto correspondente não são mesclados automaticamente: recebem um
componente interno, preservando todos os produtos e o histórico.

Não serão excluídos produtos, categorias, vendas ou comandas. O caso de dois
produtos com o mesmo nome (por exemplo, `Omelete simples`) fica preservado para
uma limpeza explícita posterior, pois excluir/mesclar mudaria referências de
histórico.

## Disponibilidade e interface

Para produto canônico, a disponibilidade de complemento considera estoque e
`product_publications.pausado_manualmente`, mas não exige
`visivel_online=true`: um produto pode ser somente complemento e ainda ser
pausado globalmente. Para componente interno, considera apenas sua pausa
manual.

A busca deixa de renderizar ocorrências de opção como resultados independentes.
Produtos vinculados aparecem uma vez; componentes internos aparecem uma vez,
com a contagem e a lista de grupos onde são usados. O menu `…` pausa/retoma a
identidade; para componentes ele também abre a edição do grupo onde o uso deve
ser removido. Não haverá mais ação de pausar uma opção de grupo.

## Segurança, compatibilidade e validação

RLS para componentes e vínculos seguirá o mesmo proprietário e permissão
`produtos.gerenciar` das tabelas atuais. A constraint do vínculo exigirá
exatamente um destino. O servidor público passará a resolver ambos os destinos
antes de expor uma opção e continuará aceitando dados antigos enquanto a
migração é aplicada.

Testes cobrirão pausa global do produto, pausa global de componente, preservação
de preço por vínculo e deduplicação da busca. Antes do deploy serão executados
testes, typechecks, build e as verificações de banco recomendadas pelo Supabase.
