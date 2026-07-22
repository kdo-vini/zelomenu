# Grupos de complemento — levantamento do estado atual e comparação com concorrência

Data: 2026-07-22

Este documento é um **levantamento factual**, não uma proposta de solução. Objetivo:
mapear o que o ZeloMenu já suporta hoje em "grupos de complemento" (o que o iFood
chama de "Grupos de complementos"), comparar com iFood e WhatsMenu, e nomear os
gaps para decidirmos juntos o escopo da próxima etapa antes de desenhar qualquer
coisa.

---

## Resumo executivo

O ZeloMenu **já tem um sistema de modifier groups funcional e completo de ponta a
ponta** — schema, CRUD no admin, modal de seleção na loja, e validação de preço/
obrigatoriedade no servidor (autoridade final, não confia no client). Isso cobre
boa parte do que iFood/WhatsMenu fazem para complementos simples (ex.: "escolha o
molho", "adicione bacon").

Faltam três coisas, em ordem de impacto:

1. **Card de confirmação do produto antes de adicionar ao carrinho** (nome, foto,
   descrição, campo de observação livre) — hoje só existe pra produtos *com*
   modificador. Produto sem modificador: clique no "+" adiciona direto, sem
   nenhuma tela. É o gap que você citou com o print da Água com Gás do iFood.
2. **"Monte sua X" com opções que são produtos reais do catálogo** (cada opção com
   seu próprio preço/estoque/foto, não um texto+preço digitado à mão no grupo) —
   é o caso "Escolha a massa: Penne R$22 / Talharim R$20 / Nhoque R$25". Hoje
   **não existe** — cada opção de grupo é sempre nome + delta de preço avulso.
3. **Quantidade por opção dentro de um grupo** (ex.: "2x bacon") — não existe;
   cada opção é binária (marcada ou não).

O campo de observação por item, especificamente, é um caso à parte: **existe no
schema e é validado no servidor, mas não tem nenhuma tela que o preencha** — é
"dado morto" hoje.

---

## 1. O que já existe hoje

### 1.1 Modelo de dados

`src/domain/zelomenuModifiers.ts:1-21`:

```ts
export type ZeloMenuModifierGroupKind = 'adicional' | 'variacao';

export type ZeloMenuModifierOption = {
  id: string;
  name: string;
  priceDelta: number;   // delta aditivo sobre o preço base, >= 0
  active: boolean;
  order: number;
};

export type ZeloMenuModifierGroup = {
  id: string;
  productId: number;
  name: string;
  kind: ZeloMenuModifierGroupKind;
  minSelections: number;        // 0 = opcional, >0 = obrigatório (nº mínimo)
  maxSelections: number | null; // null = sem limite; 1 = vira radio na UI
  active: boolean;
  order: number;
  options: ZeloMenuModifierOption[];
};
```

Tabelas Supabase (via `server/configStore.ts` e `src/hooks/useCatalogModifiers.ts`):
`zelomenu_modifier_groups (id, id_produto, nome, tipo, min_selecoes, max_selecoes,
ativo, ordem)` e `zelomenu_modifier_options (id, id_grupo, nome, price_delta,
ativo, ordem)`.

Confirmado (paridade com iFood):
- **Obrigatório/opcional**: `minSelections` (0 = opcional). É exatamente como o
  iFood modela ("Obrigatório" no card do print é `minSelections >= 1`).
- **Min/máx seleções**: `minSelections` / `maxSelections`.
- **Single vs. multi-select**: inferido — `maxSelections === 1` vira `radio`,
  qualquer outro valor vira `checkbox` (`ZeloMenuModifierModal.tsx:82`).
- **Preço por opção**: `priceDelta`.
- **Múltiplos grupos por produto**: sim, um produto tem `modifierGroups: []`,
  cada grupo renderiza como uma seção separada no mesmo modal.

Não existe (gap):
- **Quantidade por opção** (ex. "2x bacon" dentro do mesmo grupo). Cada opção é
  binária.
- **Opção vinculada a um produto real do catálogo** (com seu próprio preço,
  estoque, foto) — ver seção 3.3.

Item de carrinho persistido (`src/domain/zelomenuCartSchema.ts:3-13`) já tem um
campo `notes?: string | null` por item — ver seção 1.4 sobre por que ele está
"morto" na prática.

### 1.2 Admin: criação/edição de grupos (CRUD completo)

Existe UI completa no admin — **não é dado só-leitura vindo do banco**. Em
`src/components/views/catalog/CatalogModals.tsx`, seção "Adicionais e variações"
(linha 852) dentro do `ProductPublicationModal`, com botão "Novo grupo" (linha
863) e `ModifierGroupEditor` (linha 997) por grupo, contendo:

- Nome do grupo
- Tipo: `Adicional` / `Variação` (rótulo visual — sem diferença de comportamento
  no código; `resolveModifierSelections` trata os dois kinds de forma idêntica)
- Mínimo / Máximo de seleções
- Toggle "Grupo ativo no link"
- Lista de opções: nome, "Adicional (R$)", ativa/inativa, remover
- Botão "Nova opção" (linha 1091)

Validação client-side antes de salvar (`validateModifierGroupDrafts`, em
`zelomenuModifiers.ts:195-220`): nome obrigatório, min/máx coerentes, pelo menos
1 opção, preços >= 0, opções ativas suficientes pra cobrir o mínimo.

Persistência: `replaceProductModifierGroups` (`src/hooks/useCatalogModifiers.ts`)
faz upsert/delete em `zelomenu_modifier_groups`/`zelomenu_modifier_options`.

### 1.3 Loja pública: modal de seleção

`src/components/zelomenu/ZeloMenuModifierModal.tsx` — abre quando
`product.modifierGroups.length > 0` (`useStoreCart.ts:74-82`). Suporta múltiplos
grupos, radio/checkbox conforme `maxSelections`, mensagem "Obrigatório · mínimo N"
ou "Opcional", desabilita "Adicionar" enquanto a seleção não é válida.

O que esse modal **não tem**: foto do produto, descrição, e campo de observação
livre. É só nome do produto + lista de grupos + preço + botão. Compare com o
print do iFood ("Detalhes do produto"): lá aparece foto grande, nome, preço,
textarea "Alguma observação?" e stepper de quantidade — tudo isso pra **qualquer**
produto, mesmo sem grupo de complemento nenhum (caso da Água com Gás, que não tem
nenhum modificador e ainda assim abre esse card).

### 1.4 Precificação e validação

**Client** (`resolveModifierSelections`, `zelomenuModifiers.ts:94-176`): valida
grupo/opção existente e ativa, `group_required` se seleção < mínimo,
`selection_bounds` se seleção > máximo, soma `deltaTotal`. Usado em tempo real no
modal (preview de preço + botão habilitado/desabilitado) e em
`useStoreCart.ts:89-101` ao confirmar.

**Servidor — autoridade final** (`server/zelomenuCartSessions.ts:695-799`,
função `resolveSnapshots`, chamada em toda atualização/confirmação de carrinho):
recalcula tudo a partir do catálogo do banco, **ignora qualquer preço vindo do
client**, roda o mesmo `resolveModifierSelections` com os dados server-side, e
lança `MODIFIER_INVALID:<mensagem>` se a seleção não bate (grupo obrigatório
vazio, seleção fora dos limites, opção/grupo inativo ou inexistente). Também
detecta mudança de preço entre visitas (`price_changed`) comparando assinatura de
modificadores salva vs. recalculada.

**Conclusão desta seção**: a parte "chata" de fazer direito — validação
server-side, sanitização, revalidação de preço — já está pronta e correta. Não é
gambiarra nem prova de conceito; dá pra construir em cima com segurança.

### 1.5 Campo de observação — existe no schema, mas está morto

`ZeloMenuCartItem.notes` (`zelomenuCartSchema.ts:12`) existe e o backend
sanitiza/aceita (`sanitizeText(item.notes, 200)`,
`server/zelomenuCartSessions.ts:667`). Mas em todo ponto onde um item é criado no
draft do carrinho (`ZeloMenuCartPage.tsx:1251`, `:1653`) o valor é hard-coded como
`notes: ''`. Não existe, em lugar nenhum da loja pública ou do admin, um input
que escreva nesse campo. Ele existe "pronto pra usar" no contrato, só falta UI.

Separado disso, existe um campo de **observação do pedido inteiro** (não por
item) em `ZeloMenuCartPage.tsx` — um pra pedido em mesa (linha 1274) e outro no
fluxo normal de delivery/pickup no passo de pagamento (linha 1498), tipo "Ex.: sem
cebola, troco para R$ 100, deixar na portaria". Isso já existe e funciona, mas é
um campo só, para o pedido todo — não resolve "quero registrar uma observação
só nesse item específico".

### 1.6 Cross-sell / "adicional pra sua massa" — já existe, mas é outro mecanismo

O ZeloMenu já tem uma feature de recomendações "Peça também" no checkout
(`ZeloMenuCartPage.tsx:1203-1206`, controlada por
`payload.business.recommendationsEnabled`, shipped em commit anterior). É
cross-sell, mas funciona **no nível do carrinho inteiro** (baseado no que já está
no carrinho), não no nível do item recém-adicionado nem filtrado por categoria do
produto. O padrão do iFood que você mostrou ("Adicional pra sua massa" oferecendo
bife/frango específico pra quem tá comprando massa) é dentro do próprio fluxo de
"monte seu prato", contextual à categoria — mecanismo diferente do que já existe.

---

## 2. Comparação com a concorrência (iFood / WhatsMenu)

| Recurso | ZeloMenu hoje | iFood / WhatsMenu | Gap |
|---|---|---|---|
| Grupos de complemento (múltiplos por produto) | ✅ | ✅ | — |
| Obrigatório vs. opcional, min/máx seleções | ✅ | ✅ | — |
| Single-select (radio) vs. multi-select (checkbox) | ✅ | ✅ | — |
| Preço adicional por opção | ✅ | ✅ | — |
| CRUD de grupos no admin do lojista | ✅ | ✅ | — |
| Validação de preço/obrigatoriedade no servidor | ✅ | ✅ | — |
| Card "Detalhes do produto" (foto + nome + preço) ao clicar em **qualquer** item | ❌ (só abre modal se tiver modificador) | ✅ (sempre) | **Alto** |
| Campo de observação livre por item | ⚠️ existe no schema, sem UI | ✅ | **Alto** |
| Opção de grupo = produto real do catálogo (preço/estoque/foto próprios) — "monte sua massa" | ❌ | ✅ | **Alto** (é o pedido central) |
| Quantidade por opção dentro do grupo (ex. 2x bacon) | ❌ | ✅ (parcial, depende do lojista) | Médio |
| Cross-sell contextual por categoria dentro do item ("adicional pra sua massa") | ⚠️ existe cross-sell, mas no carrinho, não por categoria/item | ✅ | Médio |

---

## 3. Gaps priorizados (para decidir escopo depois)

1. **Card de produto antes de adicionar** — afeta 100% dos produtos, é o mais
   visível pro cliente final e provavelmente o de menor esforço (reaproveita o
   layout do `ModifierModal` já existente, adiciona foto + textarea de
   observação + sempre abre, mesmo sem modificador).
2. **"Monte sua X" com opções = produtos do catálogo** — é uma mudança de
   modelagem (schema novo: opção vinculada a `produtos.id`, com preço/estoque
   próprios em vez de `priceDelta` avulso) e de UI (o grupo passa a listar
   produtos com foto, não só nome+preço). É o gap estrutural mais profundo.
3. **Observação por item** — schema e validação já prontos; falta só o input na
   UI e passar o valor real em vez de `notes: ''` hard-coded.
4. **Quantidade por opção** — mudança de schema média (opção precisa carregar
   quantidade selecionada, não só booleano).
5. **Cross-sell por categoria dentro do item** — pode ser resolvido reusando o
   `ModifierGroupKind` existente ou precisar de um conceito novo; a decidir.

---

## Conclusão

A fundação (schema, CRUD admin, validação server-side) está sólida e não precisa
ser refeita. O trabalho real está em (a) UX do card de produto — gap rápido de
fechar — e (b) modelagem de "opção = produto do catálogo" pra viabilizar o "monte
sua massa" — gap estrutural que precisa de brainstorm/design próprio antes de
codar, já que muda schema (nova FK opção→produto), preço (puxar do produto
vinculado em vez de campo fixo), estoque (a opção herda `stockControlled` do
produto vinculado?) e a UI do admin (grupo passa a ter um seletor de produtos do
catálogo, não só um form de nome+preço).

Este documento não decide nada — é o "aqui está o terreno" pra gente conversar o
que entra no escopo da próxima etapa.
