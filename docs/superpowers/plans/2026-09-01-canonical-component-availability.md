# Componentes canônicos e pausa global Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidar opções de grupos sob uma única identidade controlável sem criar produtos cadastrados extras e aplicar pausa global.

**Architecture:** Produtos existentes continuam como itens canônicos; itens sem produto correspondente passam a usar um componente canônico interno. Cada ocorrência de grupo aponta para exatamente um desses destinos e conserva seu próprio preço no vínculo. A disponibilidade pública resolve a pausa da identidade, e a busca administra identidades únicas em vez de ocorrências.

**Tech Stack:** React/TypeScript, Supabase/Postgres/RLS, Express, Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-09-01-canonical-component-availability-design.md`

## Global Constraints

- Não criar linhas em `produtos` para componentes somente de grupo.
- `price_override` deve receber o valor atual de cada `price_delta`, inclusive `0`.
- Cada vínculo deve ter exatamente um destino: produto ou componente.
- Pausa é global; a remoção local é a exclusão da ocorrência do grupo.
- Não excluir nem reescrever produtos, vendas ou comandas existentes.

---

### Task 1: Modelo e disponibilidade global

**Files:**
- Create: `supabase/migrations/<timestamp>_canonical_modifier_components.sql`
- Modify: `src/domain/zelomenuPublication.ts`
- Test: `src/domain/zelomenuPublication.test.ts`

**Interfaces:**
- Produces `zelomenu_modifier_components(id, id_usuario, nome, nome_chave, pausado_manualmente)`.
- Produces `zelomenu_modifier_option_products.id_componente` and exactly-one-destination constraint.

- [ ] **Step 1: Write a failing test for the product publication pause.**

```ts
expect(resolveZeloMenuLinkedOptionAvailability({
  controlar_estoque: false,
  estoque_atual: 0,
  publication: { pausado_manualmente: true },
})).toBe(false);
```

- [ ] **Step 2: Run `npm test -- src/domain/zelomenuPublication.test.ts` and confirm the test fails because the resolver ignores the publication pause.**

- [ ] **Step 3: Add the minimal resolver change and migration.**

```sql
alter table public.zelomenu_modifier_option_products
  add column id_componente uuid references public.zelomenu_modifier_components(id) on delete cascade;
alter table public.zelomenu_modifier_option_products
  add constraint zelomenu_modifier_option_products_exact_destination
  check (num_nonnulls(id_produto, id_componente) = 1);
```

The migration creates component rows for remaining unlinked options, writes each current `price_delta` to `price_override`, maps inactive options to the target pause and makes option rows active.

- [ ] **Step 4: Run `npm test -- src/domain/zelomenuPublication.test.ts` and verify it passes.**
- [ ] **Step 5: Commit this task with `git add supabase/migrations src/domain/zelomenuPublication.ts src/domain/zelomenuPublication.test.ts && git commit -m "feat: add canonical modifier components"`.**

### Task 2: Carregar e publicar identidades canônicas

**Files:**
- Modify: `src/hooks/useCatalogTypes.ts`
- Modify: `src/hooks/useCatalog.ts`
- Modify: `src/hooks/useCatalogModifiers.ts`
- Modify: `server/configStore.ts`
- Modify: `src/domain/zelomenuModifiers.ts`
- Test: `src/domain/zelomenuModifiers.test.ts`

**Interfaces:**
- Consumes `id_componente` from Task 1.
- Produces a union link `{ productId?: number; componentId?: string; priceOverride: number | null }` and component state.

- [ ] **Step 1: Write a failing component-price test.**

```ts
expect(resolveModifierOptionPrice(componentOption)).toBe(2);
expect(componentOption.linkedProduct?.available).toBe(false);
```

- [ ] **Step 2: Run `npm test -- src/domain/zelomenuModifiers.test.ts` and confirm it fails because a component destination is unknown.**
- [ ] **Step 3: Load components and union links in the client and server. Resolve a paused component as unavailable and retain the link override price.**
- [ ] **Step 4: Run `npm test -- src/domain/zelomenuModifiers.test.ts src/domain/zelomenuPublication.test.ts` and `npm run typecheck`.**
- [ ] **Step 5: Commit with `git commit -m "feat: resolve modifier availability from canonical items"`.**

### Task 3: Busca e controle globais

**Files:**
- Modify: `src/components/views/CatalogView.tsx`
- Modify: `src/pages/AdminPage.tsx`
- Modify: `src/domain/zelomenuCatalog.ts`
- Test: `src/domain/zelomenuCatalog.test.ts`

**Interfaces:**
- Consumes canonical components and union links from Task 2.
- Produces one admin search result per canonical identity and global pause actions.

- [ ] **Step 1: Write a failing deduplication test.**

```ts
expect(searchCatalogModifierOptions(repeatedOvoFrito)).toEqual([
  expect.objectContaining({ name: 'Ovo frito', usageCount: 5 }),
]);
```

- [ ] **Step 2: Run `npm test -- src/domain/zelomenuCatalog.test.ts` and confirm occurrences are still returned independently.**
- [ ] **Step 3: Render one component result with `…` pause/retomar. Replace the local pause action with `Editar grupo`, which opens the product editor so the occurrence can be removed.**
- [ ] **Step 4: Run `npm test -- src/domain/zelomenuCatalog.test.ts`.**
- [ ] **Step 5: Commit with `git commit -m "feat: manage canonical components from catalog search"`.**

### Task 4: Aplicar e verificar dados

**Files:**
- Create: generated migration snapshot only if `supabase db pull` produces one.

- [ ] **Step 1: Apply using `supabase db push --linked --yes`, then capture state with `supabase db pull canonical_modifier_components --local --yes`.**
- [ ] **Step 2: Verify `select count(*) from public.zelomenu_modifier_option_products where num_nonnulls(id_produto, id_componente) <> 1;` returns `0`.**
- [ ] **Step 3: Run available linked-project Supabase security and performance advisor commands after consulting `supabase --help`.**
- [ ] **Step 4: Commit a generated snapshot only if one was created.**

### Task 5: Full verification and deploy

**Files:** none expected beyond Tasks 1-4.

- [ ] **Step 1: Run `npm test`, `npm run typecheck`, `npm run typecheck:server`, and `npm run build`.**
- [ ] **Step 2: Run `git diff --check` and `git status --short`; leave unrelated scheduling/cart edits unstaged.**
- [ ] **Step 3: Commit only feature files and push `master`.**
- [ ] **Step 4: Verify Dokploy deployed the pushed commit and `curl.exe -i https://menu.zelopdv.com.br/api/health` reports that version.**
