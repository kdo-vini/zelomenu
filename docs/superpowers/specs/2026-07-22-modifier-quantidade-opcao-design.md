# Quantidade por opção em grupo de complemento (2x bacon)

Data: 2026-07-22

> Atualização 2026-08-26: o limite total de unidades passou a fazer parte do
> contrato implementado. A migration
> `supabase/migrations/20260826115934_modifier_total_quantity_limits.sql`
> adiciona `minimo_total_quantidade` e `maximo_total_quantidade`; esses campos
> complementam, sem alterar, os limites de opções distintas descritos abaixo.
> A seção “Fora de escopo” sobre soma de quantidades está supersedida por essa
> decisão.

Este documento é o contrato de implementação. As decisões de escopo já foram
aprovadas; o que resta é código. Onde o brainstorming original deixava uma
lacuna, este documento fecha a lacuna e marca a decisão em **Ambiguidades
resolvidas**, no final.

Parte 2 de 3 do pacote "nível iFood/WhatsMenu" — ver também
`2026-07-22-modifier-produto-vinculado-design.md` e
`2026-07-22-cross-sell-categoria-design.md`. As três são independentes entre
si (podem ser implementadas e deployadas em qualquer ordem).

## Objetivo

Hoje cada opção dentro de um grupo multi-select (checkbox) só pode ser
marcada uma vez — `ZeloMenuModifierSelectionInput.optionIds: string[]` é uma
lista de IDs, sem quantidade. Não dá pra pedir "2x bacon" dentro de um grupo
"Adicionais", só dá pra marcar "Bacon" uma vez. Queremos permitir quantidade
por opção (estilo iFood/WhatsMenu), cobrando `price_delta` (ou o preço do
produto vinculado, se a spec de "Monte sua X" também estiver ativa) uma vez
por unidade.

## Escopo do MVP (IN)

- Quantidade por opção dentro de grupos multi-select (`kind: 'adicional'`
  apenas), opt-in por grupo via um novo toggle no admin.
- Limite opcional de "máximo por opção" (ex.: no máximo 5x do mesmo
  adicional), independente do `min_selecoes`/`max_selecoes` do grupo.
- `min_selecoes`/`max_selecoes` do grupo continuam contando **opções
  distintas escolhidas**, não a soma das quantidades — nenhuma mudança de
  significado pros grupos que já usam esses campos hoje.
- 100% opt-in: grupo existente nasce com quantidade desligada, comportamento
  idêntico a hoje.

## Fora de escopo (OUT / YAGNI)

- Contar `min_selecoes`/`max_selecoes` como soma de quantidades (modelo
  alternativo considerado e descartado — ver Ambiguidades resolvidas).
- Quantidade em grupos `kind: 'variacao'` (ex.: "2x tamanho grande" não faz
  sentido).
- Suporte a formato antigo de seleção (`optionIds: string[]`) em paralelo ao
  novo formato — ver seção 4 sobre carrinhos abertos no deploy.

---

## 1. Modelo de dados

Migration aditiva em `zelomenu_modifier_groups` (mesmo padrão de nomes já
confirmado ao vivo via `supabase db query --linked` — colunas em português,
constraint com sufixo `_check`):

```sql
alter table public.zelomenu_modifier_groups
  add column if not exists permite_quantidade boolean not null default false;

alter table public.zelomenu_modifier_groups
  add column if not exists maximo_por_opcao integer null
    constraint zelomenu_modifier_groups_maximo_por_opcao_check
      check (maximo_por_opcao is null or maximo_por_opcao >= 1);

alter table public.zelomenu_modifier_groups
  add constraint zelomenu_modifier_groups_permite_quantidade_check
    check (not permite_quantidade or max_selecoes is null or max_selecoes <> 1);
```

A última constraint impede salvar um grupo com `permite_quantidade = true` e
`max_selecoes = 1` (rádio/escolha única) direto no banco — é a mesma regra
que a validação client-side (`validateModifierGroupDrafts`) já vai aplicar
antes de chegar até aqui, mas o banco garante que nenhum outro caminho de
escrita (script, admin de outro produto Zelo, etc.) deixe o dado inconsistente.

Esta migration não conflita com a de
`2026-07-22-modifier-produto-vinculado-design.md` (`modo_preco`) — são
colunas independentes na mesma tabela, podem ser aplicadas em qualquer
ordem ou juntas.

---

## 2. Domain (`src/domain/zelomenuModifiers.ts`)

### 2.1 Tipos

```ts
export type ZeloMenuModifierGroup = {
  id: string;
  productId: number;
  name: string;
  kind: ZeloMenuModifierGroupKind;
  minSelections: number;
  maxSelections: number | null;
  allowsQuantity: boolean;       // novo — default false
  maxPerOption: number | null;   // novo — null = sem limite
  active: boolean;
  order: number;
  options: ZeloMenuModifierOption[];
};

// Substitui optionIds: string[]
export type ZeloMenuModifierSelectionInput = {
  groupId: string;
  optionSelections: Array<{ optionId: string; quantity: number }>;
};

export type ZeloMenuSelectedModifierOption = {
  optionId: string;
  optionName: string;
  priceDelta: number;
  quantity: number; // novo — sempre 1 quando allowsQuantity é false
};
```

Essa é uma mudança de **contrato**, não aditiva — todo ponto que hoje produz
ou consome `optionIds: string[]` precisa mudar junto (ver seção 4).

### 2.2 `resolveModifierSelections` — mudanças

- Quantidade 0 é filtrada antes de entrar em `selectedOptions` (equivalente a
  "não selecionada" — mesmo comportamento de hoje pra checkbox desmarcado).
- Preço: `deltaTotal += roundCurrency(option.priceDelta) * quantity` (ou o
  preço do produto vinculado × quantidade, se a opção também tiver
  `linkedProduct` da outra spec — as duas features compõem sem conflito,
  porque `modo_preco: 'substituir'` exige `max_selecoes = 1`, e
  `permite_quantidade` exige `max_selecoes <> 1` — nunca coexistem no mesmo
  grupo).
- Validação de `minSelections`/`maxSelections`: **sem mudança** — continua
  comparando `selectedOptions.length` (quantidade de opções distintas), que
  já é exatamente o que o código faz hoje. Modelo escolhido: contar
  variedade, não volume (ver Ambiguidades resolvidas).
- Validação nova: se `group.allowsQuantity && group.maxPerOption != null`,
  cada `optionSelections[i].quantity` maior que `maxPerOption` retorna erro
  novo `option_quantity_exceeded` ("Você pode escolher no máximo N unidades
  de {nome da opção}.").
- Sanitização defensiva (client e server): `quantity` precisa ser inteiro
  positivo; qualquer valor não-inteiro, negativo, ou `NaN` é tratado como
  seleção inválida (mesmo tratamento que `option_missing` hoje dá pra opção
  desconhecida) — nunca confiar em quantidade vinda de fora sem validar tipo
  e sinal antes de multiplicar por preço.

### 2.3 `validateModifierGroupDrafts` — regras novas

- `allowsQuantity && maxSelections === 1` → erro "Grupo de escolha única não
  pode permitir quantidade."
- `maxPerOption != null && maxPerOption < 1` → erro de valor inválido.
- `allowsQuantity && kind === 'variacao'` → erro "Quantidade só é permitida
  em grupos do tipo Adicional." (reforça a decisão de escopo, não só UI).

---

## 3. Admin (`src/components/views/catalog/CatalogModals.tsx`, `ModifierGroupEditor`)

- Novo toggle **"Permite quantidade por opção (ex.: 2x, 3x)"**, ao lado de
  "Grupo ativo no link" — habilitado só quando `maxSelections !== 1` e
  `kind === 'adicional'`. Se o lojista mudar `maxSelections` pra `1` com o
  toggle já ligado, o editor desliga o toggle automaticamente (nunca deixa
  estado inconsistente sair do form).
- Campo condicional **"Máximo por opção"** (número, opcional), visível só
  quando o toggle está ligado.
- Nenhuma mudança na lista de opções em si (nome + preço + ativo continuam
  como hoje) — quantidade é uma propriedade da seleção do cliente, não da
  opção.

---

## 4. Loja pública (`src/components/zelomenu/ZeloMenuProductAddModal.tsx`)

- Grupos com `allowsQuantity === true`: cada opção troca o
  `<input type="checkbox">` por um mini-stepper `− / N / +` no mesmo lugar,
  **visualmente menor e mais discreto** que o stepper de quantidade do
  produto no rodapé do modal (ex.: botões `h-7 w-7` outline, sem
  preenchimento sólido) — para não parecer "outro produto dentro do
  produto". Quantidade 0 = estado neutro (equivalente a não marcado); tocar
  "+" de 0 vai direto pra 1.
- `toggleOption` vira `setOptionQuantity(groupId, optionId, quantity)`, com
  trava no `+` quando `maxPerOption` é atingido, e trava adicional (não deixa
  passar de `maxSelections` variedades diferentes) reaproveitando a mesma
  checagem que hoje desabilita novos checkboxes quando o grupo bate o teto.
- Preço por opção exibido: `+ {toBRL(priceDelta * quantity)}` quando
  `quantity > 1`, senão igual a hoje.
- Grupos sem `allowsQuantity`: nenhuma mudança visual.

---

## 5. Carrinho e chave de dedup

Pontos que hoje assumem seleção binária e precisam mudar juntos (é a parte
de maior risco desta spec — qualquer um esquecido quebra preço final em
produção):

- `src/hooks/useStoreCart.ts` (`confirmSheet`): monta `optionSelections`
  a partir do estado local do modal, não mais `optionIds`.
- `src/domain/zelomenuCartItemKey.ts` (`buildModifierSignature`/
  `buildCartItemKey`): hoje é `optionIds.sort().join(',')` por grupo — a
  assinatura precisa incluir quantidade (ex.: `optionId:quantity` em vez de
  só `optionId`), senão duas seleções com quantidades diferentes da mesma
  opção colidem na mesma linha de carrinho por engano.
- `src/domain/zelomenuStoreCartCache.ts` (`ZeloMenuStoreCartItem.
  selectedOptions`): tipo muda junto com `ZeloMenuModifierSelectionInput`.
- `server/zelomenuCartSessions.ts` (`normalizeIncomingModifierSelections`):
  parser do payload de rede aceita o novo formato
  `{ groupId, optionSelections }`.

---

## 6. Testes

Estender `src/domain/zelomenuModifiers.test.ts`:
- Preço escala corretamente com quantidade (`priceDelta * quantity`).
- `maxPerOption` rejeita quantidade acima do limite.
- `allowsQuantity` com `maxSelections === 1` é rejeitado por
  `validateModifierGroupDrafts`.
- `minSelections`/`maxSelections` continuam contando opções distintas,
  ignorando quantidade (teste de não-regressão explícito).
- Grupos existentes (sem `allowsQuantity`, todo `quantity` implícito = 1)
  continuam passando exatamente como antes.
- Quantidade inválida (0, negativa, fracionária, string) é rejeitada tanto
  no client quanto no `resolveModifierSelections` chamado pelo servidor.

---

## Ambiguidades resolvidas

- **Contagem de mínimo/máximo do grupo**: conta **opções distintas**
  escolhidas, não a soma de quantidades. Motivo: não redefine o que
  "máximo N" já significa pros lojistas que configuraram grupos antes desta
  feature existir. Quantidade ganha seu próprio limite independente
  (`maximo_por_opcao`).
- **Toggle por grupo, não automático**: `permite_quantidade` é opt-in
  manual — nenhum grupo existente muda de comportamento sem o lojista pedir.
- **Escopo por `kind`**: só `'adicional'`. `'variacao'` nunca permite
  quantidade.
- **Carrinhos abertos no momento do deploy**: aceitamos que um carrinho aberto
  com seleção no formato antigo (`optionIds`) possa precisar ser recriado —
  o carrinho expira em 12h de qualquer forma (`zelomenuStoreCartCache.ts`,
  `CART_TTL_MS`) e o volume de pedidos em andamento no exato instante do
  deploy é baixo o suficiente pra não justificar suportar os dois formatos em
  paralelo. Recomenda-se fazer o deploy fora de horário de pico.
- **Limite agregado por grupo além de `maximo_por_opcao`**: não incluído no
  MVP (ex.: "no máximo 10 adicionais no total, distribuídos como quiser") —
  adiciona-se depois se algum lojista pedir.
