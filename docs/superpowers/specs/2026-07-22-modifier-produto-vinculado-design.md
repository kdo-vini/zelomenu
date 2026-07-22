# Grupo de complemento com opção = produto do catálogo ("Monte sua X")

Data: 2026-07-22

Este documento é o contrato de implementação. As decisões de escopo já foram
aprovadas; o que resta é código. Onde o brainstorming original deixava uma
lacuna, este documento fecha a lacuna e marca a decisão em **Ambiguidades
resolvidas**, no final.

Parte 1 de 3 do pacote "nível iFood/WhatsMenu" — ver também
`2026-07-22-modifier-quantidade-opcao-design.md` e
`2026-07-22-cross-sell-categoria-design.md`. As três são independentes entre
si (podem ser implementadas e deployadas em qualquer ordem).

## Objetivo

Hoje uma opção de modifier group é sempre um par `{ nome, preço adicional }`
digitado à mão no admin (`src/components/views/catalog/CatalogModals.tsx`,
`ModifierGroupEditor`). Não existe vínculo com um produto real do catálogo.

Isso impede o padrão "Monte sua massa": um grupo obrigatório "Escolha a massa"
onde cada opção JÁ é um produto vendável avulso (Penne R$20, Talharim R$20,
Nhoque R$25), com foto e preço próprios, sem o lojista redigitar nada.

## Escopo do MVP (IN)

- Vincular uma opção de modifier group a um produto existente do catálogo.
- A opção herda nome/foto/preço/disponibilidade do produto vinculado.
- Preço da opção pode **somar** ao preço base do produto-container ou
  **substituir** esse preço base — configurável por grupo.
- Override de preço opcional por opção vinculada (desconto de combo).
- Estoque do produto vinculado é compartilhado com a venda avulsa dele.
- Se o produto vinculado for excluído/pausado depois, a opção se desativa
  sozinha (não quebra o grupo nem o admin).
- 100% aditivo: nenhum grupo/opção clássico (texto+preço manual) muda de
  comportamento.

## Fora de escopo (OUT / YAGNI)

- O produto vinculado ter seus próprios modifier groups (ex.: Penne também
  ter "escolha o molho"). Isso é grupo-dentro-de-grupo — fica pra um épico
  separado se algum lojista pedir.
- Agregação de estoque entre carrinhos concorrentes de origens diferentes
  (combo vs. avulso). Hoje a checagem de estoque já só agrega dentro do
  mesmo carrinho — essa limitação pré-existente não piora nem melhora aqui.
- Múltiplos grupos do tipo "substituição" no mesmo produto (ver seção 3).

---

## 1. Modelo de dados

Duas migrações pequenas, seguindo **exatamente** o padrão de RLS já usado por
`zelomenu_modifier_groups`/`zelomenu_modifier_options`
(`zelopdv/.ai/migrations/zelomenu_publication_schema_2026_06_23.sql`, linhas
103–260): `id_usuario uuid not null references auth.users(id)`, RLS ligado, 4
políticas `authenticated` gated por `get_owner_user_id(auth.uid()) =
id_usuario`, revoke geral e grant explícito para `authenticated, service_role`.
A migration em si vai pro repo irmão `zelopdv/.ai/migrations/`, mesmo padrão
das anteriores relacionadas a ZeloMenu.

### 1.1 Nova coluna em `zelomenu_modifier_groups`

Confirmado ao vivo via `supabase db query --linked` (schema real do projeto
compartilhado, não só a migration de referência): a tabela usa nomes de
coluna e valores de enum em português (`tipo` com `check (tipo = any
(array['adicional','variacao']))`, `min_selecoes`, `max_selecoes`, `ativo`,
`ordem`, convenção de constraint `nome_da_tabela_coisa_check`). A coluna nova
segue a mesma convenção — não usa inglês solto:

```sql
alter table public.zelomenu_modifier_groups
  add column if not exists modo_preco text not null default 'somar'
    constraint zelomenu_modifier_groups_modo_preco_check
      check (modo_preco = any (array['somar'::text, 'substituir'::text]));
```

`modo_preco` é uma propriedade do **grupo inteiro**, não de opções
individuais — evita a inconsistência de duas opções do mesmo grupo somando
e substituindo ao mesmo tempo. Funciona tanto para grupos clássicos (opção
manual com `price_delta`) quanto para grupos com opção vinculada — é uma
generalização do cálculo de preço, não uma feature exclusiva de produto
vinculado (ver seção 3). No domain TypeScript, o campo vira
`pricingMode: 'somar' | 'substituir'` — mesmo padrão já usado por `kind:
'adicional' | 'variacao'` (os valores em português passam direto pro
TS, sem tradução).

### 1.2 Tabela nova `zelomenu_modifier_option_products` (sidecar)

```sql
create table if not exists public.zelomenu_modifier_option_products (
  id_opcao uuid primary key references public.zelomenu_modifier_options(id) on delete cascade,
  id_usuario uuid not null references auth.users(id) on delete cascade,
  id_produto bigint not null references public.produtos(id) on delete cascade,
  price_override numeric(10,2) null
    constraint zelomenu_modifier_option_products_price_override_check
      check (price_override is null or price_override >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zelomenu_modifier_option_products_produto_idx
  on public.zelomenu_modifier_option_products (id_produto);
create index if not exists zelomenu_modifier_option_products_user_idx
  on public.zelomenu_modifier_option_products (id_usuario);

alter table public.zelomenu_modifier_option_products enable row level security;
-- 4 políticas authenticated (select/insert/update/delete) gated por
-- get_owner_user_id(auth.uid()) = id_usuario, espelhando
-- zelomenu_modifier_groups_actor_* (linhas 142-193 da migration de referência).
-- revoke all + grant explícito authenticated, service_role.
```

Por que sidecar (1:1 opcional) em vez de coluna direta em
`zelomenu_modifier_options`: zero mudança de schema/constraint na tabela que
já está em produção com lojistas usando opções clássicas. A tabela nova é
100% aditiva e reversível (`drop table` não afeta nada existente). Uma opção
sem linha correspondente aqui é uma opção clássica, ponto final — sem branch
de "campo nulo significa X".

`price_override`: quando preenchido, é o preço final da opção (soma ou
substitui, conforme `modo_preco` do grupo). Quando `null`, usa o preço
vigente do produto vinculado (`produtos.preco` — ou preço específico do
publication overlay, mesma fonte que a loja pública já usa hoje).

### 1.3 Comportamento quando o produto vinculado some

`on delete cascade` na FK de `id_produto`: se o produto for **excluído**, a
linha sidecar some junto — a opção clássica (`zelomenu_modifier_options`)
continua existindo, mas vira uma opção "clássica" sem nome/preço próprios.
Trigger ou checagem em runtime (ver seção 4) marca essa opção como
`available: false` até o lojista preencher nome/preço manualmente de novo ou
vinculá-la a outro produto. Se o produto for só **pausado/despublicado**
(sem exclusão), a opção fica com `available: false` computado em tempo de
leitura (mesma lógica de disponibilidade que já existe pra produtos comuns
em `configStore.ts`), sem mexer na linha sidecar.

---

## 2. Domain (`src/domain/zelomenuModifiers.ts`)

`ZeloMenuModifierGroup` ganha `pricingMode: 'somar' | 'substituir'` (default
`'somar'` em todo grupo existente lido do banco antes da migration).

`ZeloMenuModifierOption` ganha um campo opcional só de leitura (montado no
server, nunca editado diretamente pelo client):

```ts
export type ZeloMenuLinkedModifierProduct = {
  productId: number;
  name: string;
  photoUrl: string | null;
  price: number;        // preço vigente do produto (já com priceOverride aplicado, se houver)
  available: boolean;    // false se produto pausado/sem estoque/excluído
};

export type ZeloMenuModifierOption = {
  id: string;
  name: string;
  priceDelta: number;
  active: boolean;
  order: number;
  linkedProduct?: ZeloMenuLinkedModifierProduct | null; // presente só se a opção estiver vinculada
};
```

Quando `linkedProduct` está presente, ele é a fonte de verdade de
nome/foto/preço/disponibilidade para exibição — `name`/`priceDelta` da opção
em si ficam ignorados/vazios (mantidos no tipo só por retrocompatibilidade
estrutural com o resto do código que já espera esses campos).

### 2.1 `resolveModifierSelections` — novo algoritmo de preço

```
baseOverride: number | null = null
addDeltaTotal = 0

para cada grupo ativo (na ordem já existente):
  resolve selectedOptions do grupo (validação de min/max não muda, ver 2.2)
  valorDaOpcao(option) = option.linkedProduct
    ? (option.linkedProduct.price)          // já reflete priceOverride se houver
    : roundCurrency(option.priceDelta)      // opção clássica, como hoje

  se group.pricingMode === 'substituir':
    // grupo de substituição — ver 2.2, é sempre single-select (maxSelections === 1)
    se selectedOptions.length > 0:
      baseOverride = valorDaOpcao(selectedOptions[0])
  senão: // 'somar' — comportamento atual, generalizado pra também cobrir opção vinculada
    para cada opção selecionada:
      addDeltaTotal += valorDaOpcao(opção)

precoFinal = (baseOverride ?? product.basePrice) + addDeltaTotal
```

`deltaTotal` (o campo hoje retornado por `resolveModifierSelections`) passa a
significar "quanto somar ou substituir sobre o preço base" — o chamador
(`useStoreCart.confirmSheet`, `ZeloMenuProductAddModal` footer,
`server/zelomenuCartSessions.ts resolveSnapshots`) troca
`product.basePrice + resolution.deltaTotal` por
`resolution.finalUnitPrice` (novo campo no retorno, já calculado pela função
— nenhum consumidor recalcula a fórmula por conta própria).

### 2.2 Validação nova

- Grupo com `pricingMode === 'substituir'` **precisa** ter `maxSelections === 1`.
  `validateModifierGroupDrafts` rejeita a combinação com mensagem "Grupo de
  substituição de preço precisa ser de escolha única (máximo = 1)."
- Só é permitido **um** grupo `pricingMode === 'substituir'` por produto — mesma
  função valida contra a lista completa de grupos do produto (ela já recebe
  todos os grupos de um produto de uma vez). Mensagem: "Só pode existir um
  grupo de substituição de preço por produto."
- Contagem de `minSelections`/`maxSelections` **não muda** — continua sendo
  `selectedOptions.length` (quantidade de opções distintas escolhidas),
  igual hoje. `pricingMode` só afeta a MATEMÁTICA do preço, não a validação
  de quantas opções podem ser escolhidas.
- Opção vinculada a produto indisponível (`linkedProduct.available === false`)
  é tratada como opção inativa — mesmo código-path de `option_missing` que já
  existe hoje pra opção desativada manualmente.

---

## 3. Admin (`src/components/views/catalog/CatalogModals.tsx`, `ModifierGroupEditor`)

- Novo campo no cabeçalho do grupo (ao lado de "Tipo": Adicional/Variação):
  **"Preço do grupo"** — select com "Somar ao preço base" (padrão) /
  "Substituir o preço base". Ao escolher "Substituir", o campo "Máximo" é
  travado em 1 automaticamente (com explicação inline: "grupos de
  substituição são de escolha única").
- Por opção, novo toggle **"Vincular a um produto do catálogo"**:
  - Desligado (padrão): UI de hoje, nome + preço digitados à mão.
  - Ligado: abre um seletor de produto reaproveitando o padrão de busca +
    lista já usado em `ZeloMenuSettingsCard.tsx` (linhas 222-320, hoje usado
    pra "produtos em destaque") — adaptado pra seleção única por opção. Ao
    escolher, mostra preview (foto mini + nome + preço vigente,
    reaproveitando `ProductCardPreview`, `CatalogModals.tsx:966-995`) e um
    campo opcional "Preço nesta opção (deixe em branco pra usar o preço do
    produto: R$X,XX)".
  - Se o produto vinculado foi excluído/pausado desde a última edição, a
    linha da opção mostra um badge "Produto vinculado indisponível" — não
    impede salvar o resto do grupo.
- Persistência: `replaceProductModifierGroups`
  (`src/hooks/useCatalogModifiers.ts`) ganha um upsert/delete adicional na
  tabela sidecar, no mesmo diff que já calcula grupos/opções a inserir,
  atualizar e remover — segue o padrão já existente (linhas 79-111), só
  estendido pra mais uma tabela.

---

## 4. Loja pública (`src/components/zelomenu/ZeloMenuProductAddModal.tsx`)

- Opção com `linkedProduct` renderiza como um card em vez do `<label>` de
  texto puro: mini-foto quadrada (~56px, fallback de ícone quando sem foto,
  mesmo padrão do resto da loja) + nome do produto vinculado + preço.
- Exibição de preço por opção:
  - `pricingMode === 'somar'`: `+ R$X,XX` (igual hoje).
  - `pricingMode === 'substituir'`: `R$X,XX` (preço final, sem o `+`, já que
    substitui em vez de somar).
- Rodapé do modal usa `resolution.finalUnitPrice * quantity` em vez da conta
  manual que existe hoje.
- Sem mudança nenhuma para grupos sem nenhuma opção vinculada.

---

## 5. Servidor

### 5.1 Leitura (`server/configStore.ts`)

Novo fetch em lote (5º, ao lado dos 4 já existentes em paralelo,
`configStore.ts:368`): `zelomenu_modifier_option_products` do lojista,
montado num `Map<optionId, {produto, priceOverride}>`. Ao montar cada
`ZeloMenuModifierOption`, se existir entrada no map, resolve
`linkedProduct` fazendo join em memória com o `Map` de produtos que
`configStore.ts` já constrói (mesmo padrão dos outros overlays de
publication/foto). Sem N+1 — é um fetch a mais por request de loja, não por
opção.

### 5.2 Escrita/validação (`server/zelomenuCartSessions.ts`, `resolveSnapshots`)

Reusa o mesmo `resolveModifierSelections` do domain (autoridade única,
já compartilhada entre client e server) — nenhuma duplicação de lógica de
preço. Checagem de estoque: quando uma opção selecionada tem `linkedProduct`
e o produto vinculado tem `stockControlled`, a validação de estoque
(`zelomenuCartSessions.ts:715-724`) roda para o produto vinculado da mesma
forma que já roda hoje pro produto principal do item — decremento
compartilhado com a venda avulsa dele, conforme decidido no escopo.

---

## 6. Testes

Estender `src/domain/zelomenuModifiers.test.ts` com casos novos:
- Grupo `pricingMode: 'somar'` com opção vinculada — preço soma corretamente.
- Grupo `pricingMode: 'substituir'` — preço final substitui a base, não soma.
- Opção vinculada com `priceOverride` — usa o override, não o preço do
  produto.
- Opção vinculada a produto indisponível — tratada como opção inativa
  (`option_missing`).
- `validateModifierGroupDrafts` rejeita `pricingMode: 'substituir'` com
  `maxSelections !== 1`.
- `validateModifierGroupDrafts` rejeita dois grupos `'substituir'` no mesmo
  produto.
- Grupos clássicos existentes (sem `linkedProduct`, `pricingMode: 'somar'`
  implícito) continuam passando exatamente como antes — teste de não-
  regressão explícito.

---

## Ambiguidades resolvidas

- **Preço soma ou substitui**: os dois, configurável por **grupo** (não por
  opção individual) via `modo_preco`. Default `'somar'` (comportamento atual
  preservado). `'substituir'` exige `maxSelections = 1` e no máximo um grupo
  desse tipo por produto.
- **Estoque do vinculado**: compartilhado com a venda avulsa (mesmo
  `estoque_atual`), sem controle de estoque próprio do combo.
- **Produto vinculado com seus próprios modifier groups**: fora de escopo do
  MVP — não suportado.
- **Preço editável na opção vinculada**: permitido via `price_override`
  opcional, não travado.
- **Produto vinculado a múltiplos grupos/produtos-container ao mesmo
  tempo**: permitido — a tabela sidecar é opção→produto, não produto→opção
  única, então nada impede o mesmo produto aparecer em vários grupos.
- **Produto vinculado excluído depois**: sidecar cai em cascade, opção vira
  "clássica vazia" e fica indisponível até o lojista reconfigurar — nunca
  quebra o grupo inteiro nem impede salvar o resto.
