# Recomendações de checkout ("Peça também") — spec de implementação

**Autor:** Tech lead (Claude) · **Data:** 2026-07-21 · **Executor:** SWE (outro agente)
**Tipo:** feature MVP · **Risco:** baixo-médio · **Não toca:** dinheiro, RPC de venda, pricing, cupons

---

## 1. Contexto e objetivo

O ZeloMenu já entrega operação no nível dos concorrentes. O gap é receita. Depois de cupons (entregue em `48cb941`), o próximo alavancador é **cross-sell no checkout** — sugerir produtos curados no fim da sacola pra aumentar o ticket médio. É o padrão iFood/WhatsMenu ("Peça também", "Vai uma bebida?").

**Objetivo:** o lojista marca no perfil uma lista de produtos "sugeridos no checkout" (tipicamente bebida, sobremesa, porção — itens de alta margem), com um toggle liga/desliga. Na vitrine, no fim da sacola (passo "Sua sacola"), aparece um carrossel horizontal com esses produtos; um toque adiciona ao pedido.

Este MVP é **curadoria manual global**: uma única lista, o mesmo carrossel pra qualquer carrinho. Heurística por categoria e "quem pediu isso também pediu" (data-driven) ficam como evolução futura sobre esta mesma fundação — **fora de escopo agora**.

## 2. Decisões travadas (não reabrir)

| Decisão | Escolha |
|---|---|
| Motor de recomendação | Curadoria manual, lista global única |
| Posição na vitrine | Fim da sacola (passo 1 do wizard, "Sua sacola"), antes de "Continuar" |
| Produto simples (sem opção obrigatória) | 1 toque adiciona 1 unidade direto |
| Produto com opção obrigatória | Abre o `ModifierModal` (extraído), mesma UX da vitrine |
| Config do lojista | Card gêmeo do de "Destaques", com toggle + seletor de produtos |
| Toggle default | **Desligado** (`default false`). Opt-in explícito, igual ao destaque. Nenhuma loja muda de comportamento no deploy. *(Decisão do PO: pode inverter pra `true` depois; não bloqueia.)* |

## 3. Arquitetura — o que reaproveitar

**A regra de ouro desta task: clonar o padrão de "Destaques" (`featured*`) que já existe e roda em produção.** Praticamente tudo tem um gêmeo. Onde a spec diz "espelhe o featured", siga o featured linha a linha, trocando `featured` → `recommendation`.

Padrão featured a espelhar (leia estes antes de começar):
- Colunas: `empresa_perfil.zelomenu_featured_enabled` + `zelomenu_featured_product_ids`
- Server settings: `getZeloMenuStoreSettings` / `updateZeloMenuStoreSettings` em `server/zelomenuCartSessions.ts:937-1001`
- Server público: mapeamento em `getPublicStoreBySlug` (`server/zelomenuCartSessions.ts:898-932`)
- Rota PATCH: `server/index.ts:209-223`
- API admin: `ZeloMenuStoreSettings` / `ZeloMenuSettingsPatch` em `src/services/zelomenuAdminApi.ts:12-29`
- API pública: `ZeloMenuPublicStoreResponse.business` em `src/services/zelomenuApi.ts:153-164`
- Card admin: `src/components/zelomenu/ZeloMenuSettingsCard.tsx` (bloco "Featured products", ~linha 167)

---

## 4. Tarefas por camada

Faça na ordem. Rode `npm run lint` ao fim de cada camada de código.

### 4.1 — Migration (banco)

Crie `supabase/migrations/20260721160000_zelomenu_recommendations.sql`.

Adicione duas colunas a `public.empresa_perfil`, espelhando exatamente o **tipo** das colunas featured:

```sql
-- ZeloMenu — recomendações de checkout (cross-sell). Curadoria manual global.
-- Espelha o padrão de zelomenu_featured_* na mesma tabela empresa_perfil.
alter table public.empresa_perfil
  add column if not exists zelomenu_recommendations_enabled boolean not null default false,
  add column if not exists zelomenu_recommendation_product_ids <TIPO> not null default <DEFAULT>;

comment on column public.empresa_perfil.zelomenu_recommendations_enabled is
  'ZeloMenu: liga o carrossel "Peça também" no checkout público.';
comment on column public.empresa_perfil.zelomenu_recommendation_product_ids is
  'ZeloMenu: IDs de produtos curados sugeridos no checkout. Curadoria manual global.';
```

**Ação obrigatória antes de escrever o SQL:** descubra o tipo real de `zelomenu_featured_product_ids` e use **o mesmo** em `<TIPO>`/`<DEFAULT>`. Provavelmente `jsonb` (default `'[]'::jsonb`) ou `integer[]` (default `'{}'`). Verifique com o MCP do Supabase (`list_tables` / introspecção da coluna) ou peça ao PO. **Não chute** — o código de leitura usa `Array.isArray(...)`, que funciona pros dois, mas a coluna precisa casar com o que o featured usa pra manter consistência.

> ⚠️ `empresa_perfil` é uma tabela **compartilhada** com ZeloPDV/ZeloChat (schema gerido upstream). Esta migration é aditiva (`add column if not exists`, colunas nuláveis com default) e segura, mas **quem aplica a migration no Supabase é o PO manualmente** (mesmo fluxo dos cupons). Não tente aplicar sozinho. Deixe o arquivo pronto e avise no final.

### 4.2 — Server: settings admin (`server/zelomenuCartSessions.ts`)

1. Em `ZeloMenuStoreSettings` (linha ~939): adicione `recommendationsEnabled: boolean` e `recommendationProductIds: number[]`.
2. Em `getZeloMenuStoreSettings` (~951): adicione as duas colunas ao `.select(...)` do `empresa_perfil` e mapeie no retorno, espelhando `featuredEnabled` / `featuredProductIds` (linha 981-982).
3. Em `updateZeloMenuStoreSettings` (~989): adicione `recommendationsEnabled` e `recommendationProductIds` ao `Pick<...>` e ao corpo do `update` (espelhe linhas 995-996).

### 4.3 — Server: resposta pública (`server/zelomenuCartSessions.ts`)

Em `getPublicStoreBySlug` (~898):
1. Adicione `zelomenu_recommendations_enabled, zelomenu_recommendation_product_ids` ao `.select(...)` (linha 902).
2. Adicione ao tipo `perfil` (linha 906) e ao `response.business` (após linha 928): `recommendationsEnabled` e `recommendationProductIds`, espelhando `featuredEnabled` / `featuredProductIds`.
3. Atualize o tipo `PublicStoreResponse['business']` correspondente (procure onde `featuredEnabled` está declarado nesse tipo).

> Atenção ao cache: `publicStoreCache` (linha 933) guarda a resposta por `PUBLIC_STORE_CACHE_MS`. Nenhuma mudança necessária, só saiba que a config nova só reflete na vitrine após o TTL expirar — comportamento idêntico ao featured hoje.

### 4.4 — Server: rota PATCH settings (`server/index.ts`)

Em `PATCH /api/admin/zelomenu/settings` (linha 209-223): adicione `recommendationsEnabled` e `recommendationProductIds` ao destructuring e ao objeto passado pra `updateZeloMenuStoreSettings`, espelhando o tratamento de `featuredEnabled` / `featuredProductIds` (linhas 212-217). Valide igual: `Boolean(...)` pro flag, `Array.isArray(...) && .map(Number).filter(Boolean)` pros ids.

### 4.5 — API client admin (`src/services/zelomenuAdminApi.ts`)

Espelhe featured em `ZeloMenuStoreSettings` (linha 12) e `ZeloMenuSettingsPatch` (linha 24): adicione `recommendationsEnabled` / `recommendationProductIds`. Nenhuma função nova — `getZeloMenuSettings` / `updateZeloMenuSettings` já trafegam o objeto inteiro.

### 4.6 — API client público (`src/services/zelomenuApi.ts`)

Em `ZeloMenuPublicStoreResponse.business` (linha ~153-164): adicione `recommendationsEnabled?: boolean` e `recommendationProductIds?: number[]`, espelhando `featuredEnabled` / `featuredProductIds`.

### 4.7 — Card admin (`src/components/zelomenu/ZeloMenuSettingsCard.tsx`)

Clone o bloco "Featured products" (a partir da ~linha 167) num bloco "Recomendações no checkout":
- Estado local `recommendationsEnabled` / `recommendationIds`, espelhando `featuredEnabled` / `featuredIds` (linhas 29-30, 44-45).
- Mesmo toggle visual (linhas 177-186) e mesmo seletor de produtos (`toggleProduct`, lista de `availableProducts`, chips de selecionados).
- Inclua os dois campos novos no `updateZeloMenuSettings({...})` do save (linha 103-107).
- Copy PT-BR: título **"Sugestões no checkout"**, subtítulo curto tipo *"Ofereça bebidas, sobremesas ou acompanhamentos na hora de fechar o pedido."*
- **Seletor de produtos:** liste **todos** os produtos disponíveis, idêntico ao featured. Não filtre por tipo — produtos com opção obrigatória também podem ser sugeridos, porque o carrossel abre o `ModifierModal` pra eles (ver 4.9). Sem regra de elegibilidade especial aqui.

### 4.8 — Extrair `ModifierModal` pra componente compartilhado

Hoje `ModifierModal` e `UnitPickerModal` vivem dentro de `src/pages/ZeloMenuStorePage.tsx` (`ModifierModal` em ~linha 863-960). O carrinho precisa do `ModifierModal`.

1. Mova `ModifierModal` pra `src/components/zelomenu/ZeloMenuModifierModal.tsx` (exporte-o), **sem mudar props nem comportamento**. Props atuais: `{ product, selections, onClose, onToggle, onConfirm }`.
2. Importe-o de volta em `ZeloMenuStorePage.tsx` — o uso na linha 458 deve continuar idêntico.
3. Rode `npm run lint` e confirme que a vitrine continua compilando. Se `UnitPickerModal` também for útil no carrinho pra produtos `unitBased`, extraia-o junto pelo mesmo processo; senão, deixe onde está.

> Regra: extração é **refactor puro**. Zero mudança de comportamento na vitrine. Se a vitrine mudar de aparência/comportamento, você errou.

### 4.9 — Carrossel no carrinho (`src/pages/ZeloMenuCartPage.tsx`)

Este é o único mecanismo genuinamente novo. O resto é clonagem.

**Onde:** no passo 0 do wizard (`STEP_TITLES[0]` = "Sua sacola", linha 853), logo **abaixo da lista de itens** e antes do rodapé "Continuar". Renderize só quando `step === 0`.

**Fonte dos dados:** a página já recebe o catálogo público e as settings (procure de onde vêm `business`/catálogo no `payload`/props). Use `recommendationsEnabled` + `recommendationProductIds` do `business`.

**Lógica de filtro (escreva como função pura, ver 4.10):** a partir de `recommendationProductIds`, resolva os produtos no catálogo e **remova**:
- os que já estão no `draft.items` (compare por `productId`);
- os indisponíveis / sem estoque / fora de horário (use os mesmos campos de disponibilidade que a vitrine usa pra esconder produto);
- os que não existem mais no catálogo.
- Cap: mostre no máximo **10**.
- Se sobrar **zero**, **não renderize** o carrossel (nem título).

Só renderize o carrossel se `recommendationsEnabled === true` **e** a lista filtrada for não-vazia.

**UI:** faixa horizontal com scroll (`overflow-x-auto`), cada cartão com foto (se houver), nome, preço e botão "+". Título "Peça também" (ou "Complete seu pedido"). Mobile-first, tap target ≥ 44px. Siga o visual dos cartões existentes (reaproveite classes/tokens `--color-*`).

**Adicionar ao pedido:**
- Produto **sem** modificador obrigatório → adicione direto: `setDraft(current => current ? { ...current, items: [...current.items, novoItem] } : current)`. O `novoItem` segue o shape de `DraftState.items` (linha 61-72): `productId`, `productName`, `quantity: 1`, `selectedOptions: []`, e os campos de preço que o draft usa. Modele o `novoItem` copiando como um item simples é montado hoje (veja `buildDraftFromPayload` ~linha 119 e o mapeamento de itens ~linha 246). O autosave existente (o `setDraft` dispara sync → `updatePublicCartSession`) revalida no servidor; **não** faça bypass de estoque/preço.
- Produto **com** modificador obrigatório → abra o `ModifierModal` (importado de 4.8). Replique o padrão de estado do `picker` da vitrine (`ZeloMenuStorePage.tsx:457-478`): estado local `{ product, selections }`, `onToggle` idêntico (linhas 462-475), e no `onConfirm` monte o item com `selectedOptions` derivados de `selections` (mesma transformação que a vitrine faz) e faça o `setDraft(...)` de append.
- Depois de adicionar: feche o modal e dê feedback via `ToastContext` (ex.: *"Adicionado ao pedido"*). Não abra dialog de confirmação (autosave é o padrão).

**Regra de consistência:** um item adicionado pelo carrossel é indistinguível de um item adicionado na vitrine. Ele passa pela mesma revalidação (`ZeloMenuCartRevalidation`), estoque, preço e cupom. Nenhum caminho especial no server.

### 4.10 — Lógica pura + teste

Extraia o filtro de sugestões pra uma função pura em `src/domain/`, ex.: `src/domain/zelomenuRecommendations.ts`:

```ts
export function resolveCheckoutSuggestions(input: {
  enabled: boolean;
  recommendationProductIds: number[];
  catalogProducts: Array<{ id: number; available: boolean; /* ...campos usados */ }>;
  cartProductIds: number[];
  max?: number; // default 10
}): CatalogProductLike[] { /* ... */ }
```

Regras: se `!enabled` → `[]`. Preserva a ordem de `recommendationProductIds`. Remove os já no carrinho, indisponíveis e inexistentes. Corta em `max`.

Crie `src/domain/zelomenuRecommendations.test.ts` (vitest) cobrindo: desabilitado → vazio; remove item já no carrinho; remove indisponível; remove id inexistente; respeita o cap; lista vazia após filtro → vazio; preserva ordem. Espelhe o estilo de `src/domain/zelomenuCoupon.test.ts`.

## 5. Escopo

**Dentro:** curadoria manual global, config no admin, carrossel no fim da sacola, add de item simples e com modificador, filtro de disponibilidade, toggle, testes da lógica pura.

**Fora (não faça):**
- Heurística por categoria ou data-driven ("quem pediu também pediu").
- Sugestões condicionais por gatilho ("se tem X, sugira Y").
- Recomendação por produto individual.
- Analytics/tracking de conversão do carrossel.
- Mudar pricing, cupom, RPC de venda ou qualquer coisa de dinheiro.
- Reescrever a vitrine além da extração do modal.

## 6. Bordas (todas devem estar cobertas)

- Toggle ligado, lista vazia → carrossel não aparece.
- Todos os sugeridos já no carrinho → carrossel não aparece.
- Sugerido saiu do catálogo / indisponível / sem estoque → filtrado, não quebra.
- Sugerido com modificador obrigatório → abre modal, nunca adiciona incompleto.
- Adicionar sugestão e o server revalidar (preço/estoque mudou) → segue o fluxo de aviso que já existe, sem tratamento especial.
- Cache público (`PUBLIC_STORE_CACHE_MS`): config nova reflete após o TTL — comportamento esperado, igual featured.

## 7. Portões de qualidade (obrigatório antes de commitar)

1. `npm run lint` — **zero erros** (é `tsc --noEmit`, é o linter do projeto).
2. `npm test` — todos os testes unitários passam, incluindo o novo `zelomenuRecommendations.test.ts`.
   - ⚠️ Ignore as falhas de `e2e/*.spec.ts`: são specs Playwright que o vitest captura por engano (config pré-existente, sem relação com esta task). O que importa é os testes unitários (`*.test.ts` em `src/`) passando.
3. Sanidade manual, se conseguir subir `npm run dev:all`: ligar o toggle no admin, escolher 2-3 produtos, abrir a vitrine, montar um carrinho e ver o carrossel no fim da sacola; adicionar um item simples e um com opção.

## 8. Commit e push (fim da task)

Trabalhe direto na branch `master` (é o fluxo do projeto; push em `master` → Dokploy deploya).

1. Confirme os portões da seção 7 verdes.
2. `git add -A` e revise `git status` — devem aparecer: a migration nova, `ZeloMenuModifierModal.tsx` novo, `zelomenuRecommendations.ts` + teste novos, e os arquivos modificados (server x2, index.ts, 2 services, SettingsCard, StorePage, CartPage).
3. Commit (mensagem PT-BR, conventional, com o trailer):

```
feat(recomendacoes): cross-sell "Peça também" no checkout (MVP)

Curadoria manual global: lojista escolhe produtos sugeridos no perfil
(toggle liga/desliga), e a vitrine mostra um carrossel no fim da sacola.
Item simples adiciona em 1 toque; item com opção obrigatória abre o modal.

- migration: zelomenu_recommendations_enabled + zelomenu_recommendation_product_ids
  em empresa_perfil (espelha o padrão featured)
- server: settings admin + resposta pública + rota PATCH
- admin: card "Sugestões no checkout" (gêmeo do de destaques)
- vitrine: ModifierModal extraído para componente compartilhado
- carrinho: carrossel no passo "Sua sacola" com filtro de disponibilidade
- domínio: resolveCheckoutSuggestions (lógica pura) + testes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

4. `git push origin master`.
5. **Avise explicitamente o PO no final que a migration `20260721160000_zelomenu_recommendations.sql` PRECISA ser aplicada no Supabase manualmente** (o PO faz isso; você não aplica). Enquanto não aplicada, as colunas não existem e as settings vão falhar — então o push só fica seguro de deployar depois que o PO aplicar a migration. Se possível, aplique a migration **antes** do deploy do Dokploy concluir, ou combine a ordem com o PO.

## 9. Notas de handoff

- Preferência do PO: revisão volta pro Claude (tech lead) depois da implementação. Deixe o diff limpo e commitado.
- Se algo na spec divergir do código real (nomes/linhas mudaram desde 2026-07-21), **siga o padrão featured no código atual** — ele é a fonte da verdade, não os números de linha aqui.
- Ponto mais delicado pra revisão: o append de item no `draft` do carrinho (4.9) e a extração do modal (4.8). O resto é clonagem de baixo risco.
