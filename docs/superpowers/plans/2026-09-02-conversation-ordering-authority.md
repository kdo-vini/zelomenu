# Canonical Conversation Ordering Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o ZeloMenu persistir e validar pedidos conversacionais parciais, devolver requisitos estruturados e garantir que prévia e confirmação tenham o mesmo preço, disponibilidade, estoque e proteção contra tomada humana.

**Architecture:** A camada `conversationOrdering` continua sendo o caso de uso, mas recebe um materializador parcial que valida a hierarquia produto/grupo/opção e produz `requirements` e `readyForConfirmation`. O adapter Supabase persiste esses snapshots e executa mutações com permit de conversa validado atomicamente. A materialização SQL de confirmação passa a resolver produtos vinculados e componentes canônicos com paridade ao Node.

**Tech Stack:** TypeScript, Express, Vitest, Supabase CLI, PostgreSQL/PLpgSQL, Vite.

**Spec:** `docs/superpowers/specs/2026-09-02-conversation-ordering-authority-design.md`

## Global Constraints

- Usar a Supabase CLI local antes de qualquer alternativa; não executar `db push --linked` neste plano.
- Toda mudança de produção nasce de um teste que falha pelo motivo esperado.
- IDs válidos são relacionais por linha (`productId -> groupId -> optionId`), nunca allowlists globais.
- `controlar_estoque = false` ignora estoque zero; `controlar_estoque = true` não pode ficar negativo.
- `id_produto` e `id_componente` são destinos mutuamente exclusivos e ambos participam da viabilidade do grupo.
- Nenhum rascunho incompleto recebe token de confirmação.
- Nenhuma ausência de modalidade vira retirada implicitamente.
- Erros consumidos pelo cliente ficam em português simples e sem nomes de fornecedores.
- A fixture Bem Servido não contém UUIDs reais, IDs de usuário/empresa/pessoa, URLs, telefones, pedidos ou timestamps.
- Não alterar a interface administrativa do catálogo fora do necessário para manter os contratos existentes.

---

### Task 1: Congelar a fixture anônima e modelar requisitos de grupos

**Files:**
- Create: `server/fixtures/bemServidoConversationCatalog.ts`
- Create: `server/conversationOrderRequirements.ts`
- Create: `server/conversationOrderRequirements.test.ts`

**Interfaces:**
- Produces `ConversationModifierGroupDefinition` with `kind`, `pricingMode`, distinct and total quantity limits, `allowsQuantity`, `maxPerOption`, and priced available options.
- Produces `OrderingRequirement` and `deriveModifierRequirements(lines, products)`.
- Consumed by Tasks 2–4 and by the ZeloChat contract.

- [ ] **Step 1: Add the frozen fixture with artificial IDs.**

Use products `1001`–`1007`, groups `g001`–`g005`, and options `o001+`. Include six available Coke SKUs and `Monte Sua Massa` with required mass/sauce, optional proteins/accompaniments/paid extra. Encode the minimum complete mass price as R$ 22 and `Bife acebolado` as +R$ 12. Add a recursive assertion that rejects UUID-shaped strings, phone-shaped strings and keys containing `empresa`, `usuario`, `pessoa`, `customer` or `remoteJid`.

- [ ] **Step 2: Write failing tests for required, optional and quantity-aware requirements.**

```ts
expect(deriveModifierRequirements([emptyMassLine], catalog)).toMatchObject([
  { id: 'line-1:g001', blocking: true, minSelections: 1, maxSelections: 1 },
  { id: 'line-1:g002', blocking: true, minSelections: 1, maxSelections: 1 },
  { id: 'line-1:g003', blocking: false, maxSelections: 2 },
]);
expect(() => deriveModifierRequirements([threeProteinsLine], catalog))
  .toThrowError('MODIFIER_TOTAL_QUANTITY_EXCEEDED:g003');
```

- [ ] **Step 3: Run `npm test -- server/conversationOrderRequirements.test.ts` and confirm failure because the module does not exist.**
- [ ] **Step 4: Implement pure derivation and validation.** Return requirements in catalog display order, omit unavailable options, distinguish distinct-count from total-quantity limits, and expose `autoSelectableOptionId` only for exactly one available required choice.
- [ ] **Step 5: Run `npm test -- server/conversationOrderRequirements.test.ts` and verify all fixture, ordering and cardinality cases pass.**
- [ ] **Step 6: Commit with `git commit -m "test: define conversational ordering requirements"`.**

### Task 2: Expose the complete canonical catalog contract

**Files:**
- Modify: `server/internalCatalogSearch.ts`
- Modify: `server/internalCatalogSearch.test.ts`
- Modify: `server/configStore.ts`
- Test: `server/internalCatalogSearch.test.ts`

**Interfaces:**
- Consumes `ConversationModifierGroupDefinition` from Task 1.
- Produces catalog results with group `kind`, `pricingMode`, all four cardinality limits, `allowsQuantity`, `maxPerOption`, and option `currentPrice`, `priceDelta`, `available`.
- Produces `displayPrice: { kind: 'fixed' | 'from'; amount: number }` for each product.

- [ ] **Step 1: Add a failing search test for `Monte Sua Massa`.**

```ts
expect(result.results[0].displayPrice).toEqual({ kind: 'from', amount: 22 });
expect(result.results[0].modifierGroups[0]).toMatchObject({
  pricingMode: 'substituir', minTotalQuantity: 1, maxTotalQuantity: 1,
});
expect(result.results[0].modifierGroups[0].options[0]).toHaveProperty('currentPrice');
```

- [ ] **Step 2: Add a failing search test proving a paused SKU and a stock-controlled zero SKU are absent, while a zero-stock SKU with control disabled remains.**
- [ ] **Step 3: Run `npm test -- server/internalCatalogSearch.test.ts` and observe missing fields/wrong display price.**
- [ ] **Step 4: Extend the query mapping and price resolver without broadening the existing maximum of 12 results.** Compute `from` from the cheapest satisfiable required substitution path; do not mutate cached tenant configuration.
- [ ] **Step 5: Run `npm test -- server/internalCatalogSearch.test.ts server/conversationOrderRequirements.test.ts`.**
- [ ] **Step 6: Commit with `git commit -m "feat: expose canonical modifier rules to conversations"`.**

### Task 3: Add stable lines and readiness to the ordering domain

**Files:**
- Modify: `server/conversationOrdering.ts`
- Modify: `server/conversationOrdering.test.ts`
- Modify: `src/domain/zelomenuCartSchema.ts`

**Interfaces:**
- Adds required `lineId: string` to `ConversationOrderItemSelection` and persisted cart items.
- Adds `requirements: OrderingRequirement[]` and `readyForConfirmation: boolean` to materialization, record and snapshot.
- `confirmationAction` exists only when ready, revalidation is okay, and delivery fee is settled.

- [ ] **Step 1: Write a failing test that creates two lines of product 1001 and updates only `line-2`.** Assert `line-1` and both stable IDs survive.
- [ ] **Step 2: Write a failing test that materializes a draft with a blocking requirement and expects `confirmationAction === null` and `readyForConfirmation === false`.**
- [ ] **Step 3: Write a failing test that omits fulfillment and expects a `fulfillment_type` requirement instead of implicit pickup.**
- [ ] **Step 4: Run `npm test -- server/conversationOrdering.test.ts` and confirm the old domain issues a token/default snapshot prematurely.**
- [ ] **Step 5: Extend types and `withConfirmationAction`.** Validate `lineId` with `/^[A-Za-z0-9_-]{1,64}$/`, reject duplicates, preserve idempotency and issue a token only when the materialization is ready.
- [ ] **Step 6: Run `npm test -- server/conversationOrdering.test.ts` and `npm run typecheck:server`.**
- [ ] **Step 7: Commit with `git commit -m "feat: track partial order readiness by stable line"`.**

### Task 4: Materialize partial selections without weakening validation

**Files:**
- Modify: `server/zelomenuCartSessions.ts`
- Modify: `server/conversationOrderingMaterialization.test.ts`
- Modify: `server/conversationOrdering.ts`
- Modify: `server/conversationOrderRequirements.ts`

**Interfaces:**
- `materializeWhatsAppOrderDraft` accepts missing required groups and missing fulfillment for an open conversation draft.
- Invalid product/group/option relationships still throw deterministic `MODIFIER_INVALID:*` errors.
- Returns provisional cart/pricing plus canonical requirements.

- [ ] **Step 1: Add a failing partial-mass test.** A line with only `Talharim` must persist, price R$ 25, and return required sauce plus non-blocking optional groups.
- [ ] **Step 2: Add a failing hierarchy test.** Reuse an option ID that exists under another product and expect `MODIFIER_INVALID:OPTION_OUTSIDE_PRODUCT`.
- [ ] **Step 3: Add failing cardinality tests for distinct choice count, total quantity and `maxPerOption`; assert no silent truncation.**
- [ ] **Step 4: Add a failing no-fulfillment test.** Assert `fulfillment.type` remains `null` in the partial representation and the requirement is blocking.
- [ ] **Step 5: Run `npm test -- server/conversationOrderingMaterialization.test.ts` and observe the current all-or-nothing/default-pickup behavior.**
- [ ] **Step 6: Split selection validation from final checkout validation.** Build each cart line from available canonical data, calculate known price, derive missing requirements, and reserve final strict materialization for confirmation.
- [ ] **Step 7: Run `npm test -- server/conversationOrderingMaterialization.test.ts server/conversationOrderRequirements.test.ts` and `npm run typecheck:server`.**
- [ ] **Step 8: Commit with `git commit -m "feat: materialize partial conversational drafts"`.**

### Task 5: Persist requirements and readiness through the Supabase adapter

**Files:**
- Create: `supabase/migrations/20260902110000_conversation_ordering_partial_snapshots.sql`
- Modify: `server/supabaseConversationOrderingAdapter.ts`
- Modify: `server/supabaseConversationOrderingAdapter.test.ts`

**Interfaces:**
- Adds non-null `requirements_snapshot jsonb default '[]'` and `ready_for_confirmation boolean default false` to `zelomenu_cart_sessions`.
- Adapter reads/writes both fields on create and revisioned update.

- [ ] **Step 1: Add failing adapter tests that inspect selected columns and create/update payloads for requirements/readiness.**
- [ ] **Step 2: Run `npm test -- server/supabaseConversationOrderingAdapter.test.ts` and confirm the fields are absent.**
- [ ] **Step 3: Add the additive migration with a backfill.** Existing `cart_open` rows remain not-ready until next materialization; terminal rows remain unchanged. Add JSON-array and ready-state check constraints.
- [ ] **Step 4: Update row mapping and persistence payloads.** A conflict reload must preserve the current requirements.
- [ ] **Step 5: Run `npm test -- server/supabaseConversationOrderingAdapter.test.ts server/conversationOrdering.test.ts` and `npm run typecheck:server`.**
- [ ] **Step 6: Run `supabase db lint --local` if a local stack is running; otherwise record the exact unavailable prerequisite in the task report without using the linked project.**
- [ ] **Step 7: Commit with `git commit -m "feat: persist conversational order requirements"`.**

### Task 6: Make SQL confirmation resolve canonical components

**Files:**
- Create: `supabase/migrations/20260902120000_whatsapp_materializer_component_parity.sql`
- Create: `supabase/tests/conversation_order_component_parity.sql`
- Modify: `server/conversationOrderingMaterialization.test.ts`

**Interfaces:**
- Replaces `zelomenu_whatsapp_materialize_cart_v1` without changing its external return shape.
- Resolves exactly one of `zelomenu_modifier_option_products.id_produto` or `.id_componente`.
- `confirm_whatsapp_zelo_order_atomic_v1` continues to call the corrected materializer.

- [ ] **Step 1: Add a failing source-contract test proving the effective materializer joins `zelomenu_modifier_components`, reads component pause, and counts component choices for required-group viability.**
- [ ] **Step 2: Create a pgTAP regression that inserts a required component option, confirms it while active, then pauses it before a second confirmation and expects review/rejection.**
- [ ] **Step 3: Run `npm test -- server/conversationOrderingMaterialization.test.ts`; confirm the source-contract test fails on the current SQL.**
- [ ] **Step 4: Recreate the function from its latest effective definition.** Lock component rows, resolve component name and `price_override`, omit component-only rows from product stock requirements, and preserve existing grants/security definer/search path.
- [ ] **Step 5: Run the focused Vitest test. Start the local Supabase stack with `supabase start` only if available, then run `supabase test db supabase/tests/conversation_order_component_parity.sql`.**
- [ ] **Step 6: Inspect `supabase db diff --local` and verify no unplanned schema change appears. Do not push linked.**
- [ ] **Step 7: Commit with `git commit -m "fix: confirm orders with canonical components"`.**

### Task 7: Aggregate linked-product stock identically in Node and SQL

**Files:**
- Modify: `server/zelomenuCartSessions.ts`
- Modify: `server/conversationOrderingMaterialization.test.ts`
- Modify: `supabase/tests/conversation_order_component_parity.sql`

**Interfaces:**
- Required linked stock per product is `sum(parentLine.quantity * optionSelection.quantity)` across every line and group.
- Preview and transaction reject the same insufficient quantity.

- [ ] **Step 1: Add a failing test with two parent lines selecting the same stock-controlled linked product in quantities 2×2 and 3×1; expect required stock 7.**
- [ ] **Step 2: Add a failing test where stock 6 rejects the preview and stock 7 passes.**
- [ ] **Step 3: Extend the pgTAP fixture with the same aggregation and expected result.**
- [ ] **Step 4: Run `npm test -- server/conversationOrderingMaterialization.test.ts` and confirm the current `Map.get() ?? item.quantity` behavior undercounts.**
- [ ] **Step 5: Change the accumulator to add every contribution and retain overflow/integer guards.**
- [ ] **Step 6: Run the focused Vitest test and, when local Supabase is available, the pgTAP file.**
- [ ] **Step 7: Commit with `git commit -m "fix: aggregate linked modifier stock across order lines"`.**

### Task 8: Fence every AI mutation with the conversation epoch

**Files:**
- Create: `supabase/migrations/20260902130000_fence_conversation_ordering_with_ai_epoch.sql`
- Modify: `server/conversationOrdering.ts`
- Modify: `server/conversationOrdering.test.ts`
- Modify: `server/supabaseConversationOrderingAdapter.ts`
- Modify: `server/supabaseConversationOrderingAdapter.test.ts`
- Modify: `server/internalOrdering.ts`
- Modify: `server/internalOrdering.test.ts`
- Create: `supabase/tests/conversation_order_ai_epoch.sql`

**Interfaces:**
- Adds `conversationControlId: string` and decimal-string `conversationEpoch: string` to all AI commands.
- Adapter mutation methods execute service-role-only RPCs that verify company, canonical JID, control ID, epoch and AI mode under row lock before writing.
- Produces stable internal error `AI_TURN_REVOKED` with no customer data.

- [ ] **Step 1: Add failing HTTP validation tests for missing, numeric, negative and oversized epochs.**
- [ ] **Step 2: Add failing domain/adapter tests: epoch current applies; takeover just before create/update/cancel/confirm produces no write.**
- [ ] **Step 3: Add a pgTAP race fixture that advances the control epoch before each mutation RPC and asserts snapshots/orders remain unchanged.**
- [ ] **Step 4: Run the three focused TypeScript tests and confirm the permit is not currently part of the boundary.**
- [ ] **Step 5: Add atomic RPCs for open/update/cancel and a confirmation wrapper/version that locks `zelochat_conversation_control`, compares text epoch exactly, then calls existing transactional behavior.** Revoke public/browser execution; grant service role only.
- [ ] **Step 6: Thread permit fields through command parsing and adapter methods. Map a revoked permit to `ConversationOrderingError('AI_TURN_REVOKED', ...)`.**
- [ ] **Step 7: Run `npm test -- server/internalOrdering.test.ts server/conversationOrdering.test.ts server/supabaseConversationOrderingAdapter.test.ts` and `npm run typecheck:server`.**
- [ ] **Step 8: Run `supabase test db supabase/tests/conversation_order_ai_epoch.sql` when local Supabase is available.**
- [ ] **Step 9: Commit with `git commit -m "fix: atomically fence conversational order mutations"`.**

### Task 9: Verify the public internal contract and document delivery

**Files:**
- Modify: `server/internalOrdering.test.ts`
- Modify: `server/internalCatalogSearch.test.ts`
- Modify: `CURRENT.md`
- Modify: `FIXES_PROGRESS.md`
- Modify: `INCIDENTS.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Freezes the JSON consumed by ZeloChat: rich catalog fields, stable line IDs, requirements, readiness, nullable confirmation action, revision conflict and revoked permit.

- [ ] **Step 1: Add exact HTTP response snapshots for partial mass, complete mass, duplicate message and stale revision.** Assert errors redact internals.
- [ ] **Step 2: Run `npm test -- server/internalOrdering.test.ts server/internalCatalogSearch.test.ts` and fix only contract serialization discrepancies.**
- [ ] **Step 3: Add the required P0/P1 documentation entries.** Document the SQL component mismatch as an incident, add `// FIX 2026-09-02: ...` at the critical materializer/confirmation boundary, and update current sprint/progress.
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run typecheck:server`, `npm run build`, and `git diff --check`.**
- [ ] **Step 5: If local Supabase is available, run all `supabase test db` files and `supabase db lint --local`; otherwise report the skipped gate explicitly.**
- [ ] **Step 6: Confirm `git status --short` contains only intended branch work and no real customer identifiers with `rg -n "Bem Servido|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}" server/fixtures docs` and manually review every match.** The business name may exist only in design/test descriptions; no real UUID may remain.
- [ ] **Step 7: Commit with `git commit -m "docs: record canonical conversation ordering safeguards"`. Do not push, deploy or apply linked migrations.**
