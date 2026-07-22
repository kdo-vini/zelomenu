# Cross-sell contextual por categoria ("Adicional pra sua massa")

Data: 2026-07-22

Este documento é o contrato de implementação. As decisões de escopo já foram
aprovadas; o que resta é código. Onde o brainstorming original deixava uma
lacuna, este documento fecha a lacuna e marca a decisão em **Ambiguidades
resolvidas**, no final.

Parte 3 de 3 do pacote "nível iFood/WhatsMenu" — ver também
`2026-07-22-modifier-produto-vinculado-design.md` e
`2026-07-22-modifier-quantidade-opcao-design.md`. As três são independentes
entre si (podem ser implementadas e deployadas em qualquer ordem). Esta é a
mais enxuta das três — o corte de MVP já está definido abaixo, não é um
esboço a se decidir depois.

## Objetivo

O ZeloMenu já tem cross-sell "Peça também" no **carrinho** (`recommendationsEnabled`/
`recommendationProductIds` em `empresa_perfil`, lista global, mostrada só na
tela de checkout — `src/pages/ZeloMenuCartPage.tsx:1203-1214`). Falta o
padrão iFood de sugestão **contextual**, dentro do card do produto, filtrada
pela categoria do item que o cliente está adicionando (ex.: proteína extra
pra quem pega massa, bebida pra quem pega lanche).

## Escopo do MVP (IN)

- Mapa categoria → lista de produtos sugeridos (até 3), configurado pelo
  lojista no admin.
- Renderizado dentro do `ProductAddModal`, entre os grupos de modificador e
  o campo de observação.
- Adicionar uma sugestão é sempre rápido (qty 1, sem observação, sem abrir
  modal novo) — nunca recursivo.
- **Convive** com a recomendação de carrinho já existente — momentos
  diferentes do funil, nenhuma substitui a outra.
- Categoria identificada por **nome** (não por ID) — mesmo padrão que
  `zelomenu_category_order` já usa hoje.

## Fora de escopo (OUT / YAGNI)

- Override de sugestão por produto individual (só por categoria no MVP).
- Sugestão recursiva quando o produto sugerido tem modificador obrigatório —
  nesse caso ele simplesmente **não aparece** na lista de sugestões rápidas.
- `id_categoria` como chave (seguiria o padrão mais "correto", mas
  `categorias.id` não está exposto no payload público hoje e não vale a
  mudança de endpoint só pra esta feature — ver Ambiguidades resolvidas).
- Limite configurável de quantas sugestões aparecem — fixo em 3.
- Desativar a recomendação de carrinho existente.

---

## 1. Modelo de dados

Confirmado ao vivo via `supabase db query --linked`: `empresa_perfil` já tem
`zelomenu_recommendations_enabled boolean not null default false` e
`zelomenu_recommendation_product_ids jsonb not null default '[]'::jsonb`.
Nova coluna, mesmo padrão:

```sql
alter table public.empresa_perfil
  add column if not exists zelomenu_category_suggestions jsonb not null default '{}'::jsonb;
```

Formato: `Record<string, number[]>` — chave é o **nome da categoria**
(exatamente como aparece em `ZeloMenuCatalogGroup.nome` no payload público),
valor é uma lista ordenada de até 3 IDs de produto. Sem tabela relacional
nova — é uma coluna a mais na mesma linha de perfil que já guarda a
recomendação de carrinho, seguindo `server/zelomenuCartSessions.ts:1092-1105`
(`updateZeloMenuStoreSettings`) como precedente direto de leitura/escrita.

**Risco aceito**: se o lojista renomear uma categoria, a config daquela
chave "solta" (vira uma entrada morta no jsonb, sem produto nenhum
associado até o lojista reconfigurar). Mesmo risco que
`zelomenu_category_order` já carrega hoje — não é uma regressão nova.

---

## 2. Server

### 2.1 Leitura/escrita (`server/zelomenuCartSessions.ts`)

- `ZeloMenuStoreSettings` (linha ~1055) ganha `categorySuggestions:
  Record<string, number[]>`.
- Leitura (linhas 972-976, 1035-1039, 1082-1087): mesmo padrão de fallback
  `Array.isArray(...) ? ... : []` já usado pros outros campos jsonb, aqui
  virando `typeof x === 'object' && x !== null ? x : {}`.
- `updateZeloMenuStoreSettings` (linha 1092+): aceita `categorySuggestions`
  no patch, grava em `zelomenu_category_suggestions`.
- `GET|PATCH /api/admin/zelomenu/settings` (`server/index.ts:199-225`):
  desestrutura e repassa `categorySuggestions` do body, mesmo padrão dos
  campos irmãos.

### 2.2 Payload público

`GET /api/public/zelomenu/store/:slug` (`ZeloMenuPublicStoreResponse.business`,
`src/services/zelomenuApi.ts:161-177`) ganha
`categorySuggestions?: Record<string, number[]>`, ao lado de
`recommendationProductIds`. **Não** precisa ir no payload do carrinho
(`getPublicCart`) — esta feature só é consumida na tela de vitrine/adicionar
produto, nunca na tela de carrinho.

---

## 3. Admin (`src/components/zelomenu/ZeloMenuSettingsCard.tsx`)

Estender o card "Sugestões no checkout" existente (linhas 330-458) com uma
segunda seção **"Sugestões por categoria"**, reaproveitando o mesmo
componente de busca+checkbox+pills já usado pra recomendação global — um
picker por categoria do lojista (lista vem do próprio catálogo dele), cada
um limitado a 3 seleções. Sem painel novo do zero.

---

## 4. Loja pública

### 4.1 Domain puro (novo arquivo/função, espelhando `zelomenuRecommendations.ts`)

```ts
// src/domain/zelomenuCategorySuggestions.ts
export function resolveCategorySuggestions(
  catalog: ZeloMenuCatalogGroup[],
  cartProductIds: number[],
  categoryName: string,
  suggestionsByCategory: Record<string, number[]>,
): ZeloMenuCatalogProduct[] {
  const ids = suggestionsByCategory[categoryName] ?? [];
  const byId = new Map(/* achatar catalog, igual getFeaturedProducts em ZeloMenuStorePage.tsx */);
  return ids
    .map((id) => byId.get(id))
    .filter((p): p is ZeloMenuCatalogProduct =>
      p != null &&
      p.available !== false &&
      p.modifierGroups.length === 0 &&           // sem modificador obrigatório no MVP
      !cartProductIds.includes(p.id))
    .slice(0, 3);
}
```

Mesmo formato de teste que `zelomenuRecommendations.test.ts` já usa —
função pura, sem React, fácil de testar isolada.

### 4.2 `ZeloMenuProductAddModal.tsx`

- Novas props: `categoryName: string`, `categorySuggestions:
  Record<string, number[]>`, `catalog: ZeloMenuCatalogGroup[]`,
  `cartProductIds: number[]`, `onQuickAdd: (product:
  ZeloMenuCatalogProduct) => void`.
- `ZeloMenuStorePage.tsx` já tem `store.catalog` e `cart.items` disponíveis
  no escopo onde o modal é aberto — passar esses dados pra baixo não exige
  estado novo, só threading de props.
- Seção nova, entre os grupos de modificador e o campo de observação:
  título curto (ex.: "Adicional pra sua {categoria}"), carrossel horizontal
  de até 3 cards pequenos (mesmo visual do carrossel "Complete seu pedido"
  já existente em `ZeloMenuCartPage.tsx:1218-1268` — foto, nome, preço,
  botão "Adicionar"). Se a lista resolvida estiver vazia, a seção inteira não
  renderiza (sem título vazio, sem espaço em branco).
- Clique em "Adicionar" de uma sugestão: chama `onQuickAdd`, que soma 1
  unidade direto no carrinho (mesmo `addPlainProduct`-like path que produto
  simples já usa) e mostra toast de confirmação — **não fecha nem abre**
  outro `ProductAddModal`.

---

## 5. Testes

- `resolveCategorySuggestions`: filtra indisponível, filtra já-no-carrinho,
  filtra produto com modificador obrigatório, respeita ordem configurada,
  corta em 3, categoria sem config retorna lista vazia.
- Admin: salvar/ler o mapa por categoria via `ZeloMenuSettingsCard` (mesmo
  padrão de teste que a recomendação global já deve ter, se existir).

---

## Ambiguidades resolvidas

- **Por categoria ou por produto**: só por categoria no MVP. Override por
  produto fica pra depois, se pedido.
- **Coexistência com recomendação de carrinho**: sim, convivem — momentos
  diferentes do funil (montando o item vs. fechando o pedido).
- **Categoria por nome vs. ID**: por nome, aceitando o risco de quebra em
  rename (mesmo risco que `categoryOrder` já tem). Expor `id_categoria` no
  payload público fica como upgrade futuro se o risco virar problema real.
- **Quantidade de sugestões**: fixo em 3, sem configuração.
- **Produto sugerido com modificador obrigatório**: não aparece na lista no
  MVP — sem fluxo recursivo de modal.
- **Produto sugerido indisponível/sem estoque**: escondido silenciosamente,
  igual ao comportamento já existente da recomendação de carrinho.
