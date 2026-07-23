# Atribuição de sub-produto vinculado em estoque e relatório de vendas

Data: 2026-07-22

Este documento é o contrato de implementação. As decisões de escopo já foram
aprovadas (ver histórico de brainstorm); o que resta é código. Implementação
inteira no repo **zelopdv** (`C:\Users\Vinicius\orca\zelopdv\.ai\migrations\`)
— nenhum arquivo do zelomenu muda.

## Objetivo

Um grupo de complemento pode ter uma opção vinculada a um produto real do
catálogo (`zelomenu_modifier_option_products`, já existe — ver
`2026-07-22-modifier-produto-vinculado-design.md`). Exemplo: "Monte sua
Massa" com grupo obrigatório "Escolha a massa" (`modo_preco='substituir'`),
onde cada opção (Penne, Nhoque...) é um produto vinculado com preço próprio.

Hoje, quando esse combo é vendido pela loja online, dois problemas reais:

1. **Estoque do vinculado nunca decrementa de verdade.** `transition_zelo_order`
   decrementa estoque só pelo `product_id` direto do item do pedido (o
   container "Monte sua Massa"). O produto vinculado (Penne) nunca tem
   `estoque_atual` atualizado — pode vender sem parar mesmo com estoque zerado.
2. **Relatório de vendas nunca mostra o sub-produto.** O relatório
   (`src/routes/relatorios/+page.svelte` no zelopdv) lê e agrupa por
   `vendas_itens.id_produto`/`nome_produto_na_venda`. Hoje só existe 1 linha
   por item vendido, sempre com o nome do container — "Penne" nunca aparece
   como produto vendido, só como texto dentro do nome do combo.

## Escopo (IN)

- Decrementar estoque do produto vinculado (compartilhado com a venda avulsa
  dele) quando o pedido online é aceito, com o mesmo bloqueio de estoque
  insuficiente que já existe pro container.
- Estornar esse mesmo estoque em caso de cancelamento pós-aceite.
- Fazer o produto vinculado gerar sua própria linha em `vendas_itens` (nome +
  preço + quantidade), pra aparecer certo no relatório de vendas — sem
  duplicar faturamento.
- 100% aditivo: pedidos sem nenhum grupo de complemento, ou com só opções
  clássicas (sem vínculo), continuam gerando exatamente o mesmo resultado de
  hoje.

## Fora de escopo (OUT / YAGNI)

- Venda direta no caixa físico do PDV (`/app`, `/app/pedidos`,
  `saleOps.js`/`criar_venda_completa`): confirmado que essa tela não tem UI de
  seleção de modificador vinculado hoje (`ModalModificadores.svelte` é editor
  de configuração, não seletor de venda). Nada pra explodir nesse caminho —
  fica de fora até existir esse caso de uso.
- Mudança de schema em `criar_venda_completa` ou no relatório
  (`relatorios/+page.svelte`): nenhum dos dois precisa mudar. `criar_venda_completa`
  já insere 1 linha de `vendas_itens` por elemento do array `itens` recebido
  (suporta múltiplos `id_produto` por venda sem alteração); o relatório já
  agrupa genericamente por `id_produto`/`nome_produto_na_venda`. Uma vez que
  `vendas_itens` tenha a linha certa, os dois já funcionam.
- Mudança de schema no zelomenu: `optionId`, `groupId` e o preço já resolvido
  (`priceDelta`) já estão salvos em `zelo_order_items.modifiers` (jsonb) desde
  que o carrinho é confirmado — dado suficiente pra tudo abaixo.

---

## 1. Fórmula de atribuição de preço

Achado durante o levantamento que **simplifica** o que tinha sido combinado
verbalmente ("container fica com preço 0 se teve grupo substituir, preço
cheio senão"): não precisa nem olhar `modo_preco`. Basta decompor por
subtração, usando só o que já está gravado em `zelo_order_items`:

```
Para cada zelo_order_items (i), com i.modifiers = [{groupId, selectedOptions:[{optionId, optionName, priceDelta, quantity}]}]:

  linkedOptions = [ selectedOptions de qualquer grupo, filtrando as que têm
                     linha em zelomenu_modifier_option_products (id_opcao = optionId) ]

  linkedContribution = soma( opt.priceDelta * opt.quantity ) para cada opt em linkedOptions

  containerUnitPrice = i.unit_price - linkedContribution   -- preço por unidade do container
```

Por quê isso funciona sem olhar `modo_preco`: `i.unit_price` já é o
`finalUnitPrice` calculado no zelomenu
(`resolveModifierSelections`, `src/domain/zelomenuModifiers.ts:234`), que por
construção é `(baseOverride ?? basePrice) + addDeltaTotal`. Subtrair a
contribuição de **todas** as opções vinculadas (sejam elas de um grupo
`substituir` ou `somar`) sempre deixa como resto exatamente o que sobra pro
container: `0` quando uma opção vinculada substituiu a base (o `baseOverride`
é a própria `priceDelta` daquela opção), ou `basePrice` intacto quando nenhum
grupo vinculado usou `substituir` (nada foi subtraído dessa parte). Opção
clássica (sem vínculo) nunca entra em `linkedOptions` — sua contribuição de
preço permanece corretamente atribuída ao container, que é o produto real
que ela modifica.

**Linhas geradas em `vendas_itens` por item de pedido:**

- 1 linha do container: `id_produto = i.product_id`, `nome_produto_na_venda =
  i.name`, `preco_unitario_na_venda = containerUnitPrice`, `quantidade =
  i.quantity`. Gerada sempre, mesmo quando `containerUnitPrice = 0` (mantém
  rastreabilidade de quantos "Monte sua Massa" foram vendidos).
- 1 linha por opção vinculada selecionada: `id_produto` = produto vinculado
  (via `zelomenu_modifier_option_products.id_produto`), `nome_produto_na_venda
  = opt.optionName` (já é o nome do produto vinculado, resolvido no momento
  do carrinho), `preco_unitario_na_venda = opt.priceDelta`, `quantidade =
  opt.quantity * i.quantity`.

Conferência de consistência (soma bate com o total do pedido, sem duplicar
nem perder centavo, a menos de arredondamento de centavo já existente hoje):
`containerUnitPrice * i.quantity + soma(opt.priceDelta * opt.quantity *
i.quantity) = i.quantity * i.unit_price = i.subtotal`.

---

## 2. `close_zelo_order` — gerar as linhas na hora de fechar a venda

Arquivo novo: `C:\Users\Vinicius\orca\zelopdv\.ai\migrations\zelo_order_sub_item_attribution_2026_07_22.sql`.

`create or replace function public.close_zelo_order(...)` (mesma assinatura
da versão vigente em `canonical_online_orders_payment_mapping_2026_07_22.sql`
— essa migration substitui essa versão, não a original de 07-12). Único
trecho que muda é a construção do bloco `'itens'` dentro de `v_sale_payload`:
troca o `jsonb_agg` direto de `zelo_order_items` por uma subquery que expande
container + opções vinculadas conforme a fórmula da seção 1, usando
`jsonb_array_elements` sobre `i.modifiers` e `left join lateral` em
`zelomenu_modifier_option_products` por `id_opcao = (opt->>'optionId')::uuid`.
Resto da função (permissão, idempotência, `criar_venda_completa`, transição
pra `delivered`) fica idêntico.

---

## 3. `transition_zelo_order` — estoque do vinculado

Mesmo arquivo de migration, `create or replace function
public.transition_zelo_order(...)`. Os dois loops existentes (estoque
compartilhado por categoria, e estoque por produto — linhas 243-267 da
migration `canonical_online_orders_2026_07_12.sql`) e o bloco de estorno em
cancelamento (linhas 270-278) recebem uma segunda fonte de linhas na
subquery de agregação, via `union all`: além de `product_id = oi.product_id`
(container), soma também `product_id = lp.id_produto`, `quantity =
(opt->>'quantity')::integer * oi.quantity`, obtido explodindo
`oi.modifiers` e juntando com `zelomenu_modifier_option_products` do mesmo
jeito que na seção 2. O `group by product_id` já existente passa a agregar
container e vinculado juntos automaticamente (mesmo padrão de agregação em
duas fases já usado no zelomenu, `server/zelomenuCartSessions.ts`
`resolveSnapshots`) — sem duplicar decremento se o mesmo produto aparecer
tanto vinculado quanto vendido avulso no mesmo pedido.

Bloqueio de estoque insuficiente: mesmo comportamento hoje aplicado ao
container (`raise exception using errcode='ZL409',
message='PRODUCT_STOCK_EXCEEDED'`) — se o vinculado não tiver estoque
suficiente no momento do aceite, o aceite falha e o lojista vê o erro, mesmo
que o pedido já tenha sido confirmado/pago pelo cliente.

---

## 4. Testes

Não há framework de teste automatizado visível pra funções SQL deste repo
(`.ai/migrations/*.sql` são aplicadas direto via `supabase db query
--linked`, sem suíte pgTAP). Verificação será manual, via
`supabase db query --linked`, num pedido de teste real (dados já existentes
de Bem Servido): criar um pedido com "Monte sua Massa" + massa vinculada +
opção clássica de brinde, aceitar, fechar, e conferir:

- `produtos.estoque_atual` do produto vinculado decrementou a quantidade
  certa.
- `vendas_itens` tem 2 linhas para esse item (container com preço reduzido
  correto, vinculado com nome/preço/quantidade certos).
- Soma de `preco_unitario_na_venda * quantidade` das linhas geradas bate com
  `zelo_orders.total` do pedido.
- Cancelar um pedido já aceito devolve o estoque certo pros dois produtos.

---

## Ambiguidades resolvidas

- **Preço da linha do container**: não é uma regra fixa (0 ou preço cheio) —
  é o resto da subtração de todas as contribuições de opções vinculadas do
  `unit_price` já resolvido. Ver seção 1. Produz exatamente o resultado
  combinado (0 quando há substituição, preço base intacto quando não há),
  sem precisar consultar `modo_preco`.
- **Estoque insuficiente do vinculado no aceite**: bloqueia (mesmo
  comportamento do container hoje), mesmo que o pedido já esteja
  confirmado/pago pelo cliente.
- **Escopo do caixa físico direto (PDV)**: fora de escopo agora — não tem UI
  de seleção de modificador vinculado hoje, nada pra corrigir nesse caminho.
- **Onde vive a implementação**: 100% no repo zelopdv, migration nova. Zero
  mudança no zelomenu — o dado necessário (`optionId`, `priceDelta`,
  `quantity` por opção) já é gravado em `zelo_order_items.modifiers` desde
  antes deste trabalho.
