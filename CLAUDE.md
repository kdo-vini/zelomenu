# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ZeloMenu** is a unified menu management and publication system for the Zelo ecosystem (ZeloPDV + ZeloChat). It centralizes menu configuration (categories, products, modifiers, pricing, stock) and serves both an owner admin panel (`/admin`) and a public storefront (`/{slug}`).

The app is hosted at `menu.zelopdv.com.br`. All UI copy and error messages must be in **Portuguese (PT-BR)**.

## Visibilidade por canal

`produtos.ocultar_no_pdv` pertence exclusivamente ao canal interno do
ZeloPDV, usado pela empresa para venda manual. Nunca use essa flag para
publicar, despublicar ou pausar um item no cardápio digital. O storefront e a
publicação administrativa devem usar `zelomenu_product_publications.visivel_online`
e `pausado_manualmente`; estoque, categoria e complementos são validações
online separadas. Um produto pode estar visível no PDV e continuar despublicado
no ZeloMenu.

## Development Commands

```bash
npm run dev:all       # Start both Vite dev server (:3100) + Express backend (:3101)
npm run dev           # Vite frontend only
npm run dev:server    # Express backend only (tsx watch)

npm run build         # Build frontend + compiled server + BUILD_INFO.json from Git SHA
npm run lint          # TypeScript type-check (tsc --noEmit) — no ESLint
npm test              # vitest unit tests

npm run clean         # Remove dist/
npm run preview       # Serve built dist locally
npm start             # Run Express in production mode
```

The Vite dev server proxies `/api` requests to `:3101`. Always run both processes during development.

## Architecture

### Stack
- **Frontend:** React 19 + Vite 6 + TypeScript (strict) + Tailwind CSS 4 + React Router v7
- **Backend:** Express 4 on Node 24 (port 3101), serving both the API and the built SPA as static fallback
- **Database:** Supabase PostgreSQL (shared with ZeloPDV and ZeloChat). All new database migrations are canonical in ZeloPDV. This repository retains historical migrations only for reference/contract tests; do not run db push from Menu. See supabase/README.md and verify the linked ledger using the authenticated CLI first.
- **Auth:** Supabase SSR with cookies at `.zelopdv.com.br` for cross-subdomain session sharing

### Key Directories

| Path | Purpose |
|------|---------|
| `src/pages/` | Route-level components: `AdminPage`, `ZeloMenuStorePage`, `ZeloMenuCartPage`, `AuthCallbackPage` |
| `src/components/views/` | `CatalogView` and its modals — the product/category editor |
| `src/components/zelomenu/` | Admin sub-panels: settings, slug editor, image crop, sortable lists |
| `src/hooks/useCatalog.ts` | Catalog loading/state facade; product, category and modifier CRUD delegate to adjacent hooks |
| `src/domain/` | Pure business logic with no React/DB/network dependencies |
| `src/services/` | Supabase client, API fetch wrappers, image helpers |
| `src/contexts/` | `AuthContext` (session), `ToastContext` (notifications) |
| `server/` | Express routes, cart session logic, Supabase service-role client |

### Entitlements & Access Control

The canonical entitlement resolver is `src/domain/zelomenuEntitlements.ts`. **Any change to access rules must be manually synced to copies in ZeloPDV and ZeloChat.**

Access rules:
- `chat` or `bundle` tier → full access
- `pdv` tier + `has_zelo_menu = true` (flag on `subscriptions` table) → menu publication access
- `pdv` tier without flag → upsell screen at `/admin`
- `ordering_review` follows ZeloMenu access; `kitchen_queue` also accepts the Mesas add-on. Retired `has_pedidos_addon` is not an entitlement input.

Unit tests for this logic live in `src/domain/zelomenuEntitlements.test.ts`.

Product photo uploads are drafts: uploading or removing a photo in the editor must not delete the published object. `upsertProductPublication` cleans the previous owned image only after the new reference is acknowledged by the database. On failed/ambiguous saves, retain both images for retry; do not assume a failed HTTP response means the write was rolled back.

### Data Patterns

- Catalog queries use `id_usuario`; company/subscription records use `user_id` or company ID. Browser queries rely on RLS. Express uses a service-role client that bypasses RLS, so explicit tenant filters and Bearer-token owner resolution are mandatory there.
- No GraphQL — pure Supabase SDK or custom Express handlers
- State management is React hooks only (no Redux/Zustand)
- `useCatalog.ts` uses optimistic updates: change local state immediately, show toast on error, refresh on success
- Cart state is cached in localStorage with 12h TTL (`src/domain/zelomenuStoreCartCache.ts`)

### Image Handling

- Bucket: `logos`, path pattern: `zelomenu-products/{ownerUserId}/{productId}-{uuid}-{safeName}.jpg`
- Max size: 3MB, auto-downscale to 1920px, JPEG q0.85, 1:1 crop enforced in UI
- Upload/delete via `src/services/zelomenuPublicationImages.ts`

### Server Routes (Express)

Public:
- `GET /api/public/zelomenu/store/:slug` — catalog + settings for storefront
- `POST /api/public/zelomenu/store/:slug/cart` — create order session
- `GET|PATCH /api/public/zelomenu/cart/:token` — cart state
- `POST /api/public/zelomenu/cart/:token/confirm` — checkout

Admin (requires Supabase session):
- `GET|PUT /api/admin/zelomenu/slug` — public URL management
- `GET|PATCH /api/admin/zelomenu/settings` — welcome text, featured products, category order
- `POST /api/admin/zelomenu/welcome` — OpenAI-generated welcome text
- `POST /api/admin/zelomenu/product-description` — OpenAI-generated product description

### Runtime Environment

The server injects `window.__ENV__` into `<head>` on `/`, `/index.html` and SPA routes, with HTML marked `no-store`; hashed assets keep immutable caching. Build-time values take precedence over this runtime fallback, so rebuild when replacing previously baked-in values. Unknown `/api` and `/internal` routes return JSON 404. See `server/index.ts`. For local dev, use `.env.example`; frontend-only variables are insufficient to boot Express.

Required env vars:
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY= # server-only; also required by delivery hashing at startup
```

Optional:
```
PORT=3101
OPENAI_API_KEY=   # for AI-generated descriptions/welcome text
ZELO_INTERNAL_API_KEY= # server-only key for internal catalog discovery
ZELO_CONFIRMATION_TOKEN_SECRET= # server-only, mínimo 32 caracteres; confirmação WhatsApp
```

### Descoberta interna de catálogo

`POST /internal/catalog/search` atende a integração interna do ZeloChat. Exige
`x-zelo-internal-key` igual a `ZELO_INTERNAL_API_KEY`; sem uma chave configurada
ou válida, falha fechada. O corpo é `{ empresaId, query, limit? }` e a resposta
traz no máximo 12 candidatos com produto-pai, categoria, preço vigente,
complementos válidos e motivo/confiança do match. Todos os erros incluem
`requestId` e usam texto seguro para consumo.

Há um guard failure-only por origem antes do parser JSON: chave ausente ou
inválida reserva a falha imediatamente, impedindo que tentativas concorrentes
evitem o limite. Para chave válida, ele só registra 4xx/5xx depois que a resposta
termina; buscas 2xx em voo não consomem quota global. O limite por empresa e
origem continua depois da validação, para que
uma única origem do ZeloChat não esgote a cota de outras empresas. O servidor
instala `requestId` antes do parser JSON: JSON inválido ou grande demais também
recebe resposta JSON segura e correlacionável.

A descoberta consome apenas `catalogHierarchy`, a projeção pública canônica de
`configStore`: publicação online, pausa manual, estoque e grupos obrigatórios já
foram resolvidos ali. `ocultar_no_pdv` nunca entra nessa decisão. Resultados de
grupo ou opção preservam o produto-pai; opções não são itens avulsos.

### Pedidos conversacionais internos

`POST /internal/ordering/commands` e
`GET /internal/ordering/:orderingId?empresaId=<uuid>&remoteJid=<validated-jid>`
expõem o módulo profundo `ConversationOrdering` ao ZeloChat. As duas rotas usam
`x-zelo-internal-key`/`ZELO_INTERNAL_API_KEY`, falham fechadas, devolvem
`requestId`, aplicam limite coarse de falhas e quota por empresa. Erros para o
chamador são sempre amigáveis em PT-BR.

A interface pública do módulo é somente `apply(command)` +
`getSnapshot({ orderingId, empresaId, remoteJid })`. O adapter Supabase é injetável; sessões deste fluxo
são exclusivamente `context='whatsapp_order'` e `state='cart_open'`. Itens de
entrada carregam somente IDs, quantidades e observações. Nomes, preços,
complementos, estoque, taxa/cobertura, horário e totais são reconstruídos pela
mesma projeção e pelas mesmas invariantes canônicas do checkout público.

Retries são buscados também nas sessões históricas por
empresa/JID/`metadata.processedMessageIds`; uma mensagem antiga nunca abre um
segundo draft depois do fechamento, enquanto uma `messageId` nova pode iniciar
o próximo pedido.

Texto e botão confirmam exclusivamente pela RPC server-only transacional
`confirm_whatsapp_zelo_order_atomic_v1`. Não existe fallback app-side de
“revalidar e depois criar”: a RPC deve bloquear a sessão, validar binding,
revisão e token opcional, rematerializar catálogo/modificadores/estoque,
entrega/taxa/horário e, na mesma transação, persistir um novo resumo ou chamar o
write-path canônico `create_zelo_order`. A comparação dos snapshots JSONB é
semântica (objetos independem da ordem recursiva de chaves; arrays preservam
ordem). O contrato exato é:

```text
confirm_whatsapp_zelo_order_atomic_v1(
  p_empresa_id uuid, p_source_ref text, p_session_id uuid,
  p_expected_revision integer, p_message_id text, p_idempotency_key text,
  p_pessoa_id uuid|null, p_token_hash text|null
) -> jsonb {
  outcome: "confirmed" | "requires_review" | "conflict",
  alreadyConfirmed?: boolean
}
```

`confirmed` exige `alreadyConfirmed`, cria/reutiliza um único pedido, fecha a
sessão e persiste `p_message_id`; `requires_review` persiste snapshots,
revalidação e `p_message_id`, incrementa a revisão e não cria pedido;
`conflict` não escreve. Ausência ou resposta fora desse contrato falha fechada.
Depois de `confirmed`, `pessoa_id` e o valor original de `alreadyConfirmed` são
preservados durante `zelomenu_auto_accept_orders`.

A fronteira materializador/confirmação é crítica: o wrapper cercado por epoch
deve somente validar o permit e delegar para
`confirm_whatsapp_zelo_order_atomic_v1`; ele não pode copiar nem simplificar a
rematerialização. A função efetiva
`zelomenu_whatsapp_materialize_cart_v1` resolve exatamente um destino por
opção (`id_produto` ou `id_componente`), respeita pausa de componente,
considera componentes na viabilidade de grupo obrigatório e reserva estoque
somente para produtos vinculados. Demanda de produto vinculado é agregada
entre todas as linhas antes da comparação com estoque. As migrations
`20260902120000_whatsapp_materializer_component_parity.sql` e
`20260902130000_fence_conversation_ordering_with_ai_epoch.sql` devem ser
validadas juntas em Postgres/Supabase local antes de qualquer deploy; nunca
substituir esse gate por execução no projeto linked.

O token bruto nunca é persistido: o servidor deriva o valor opaco com
`ZELO_CONFIRMATION_TOKEN_SECRET` sobre empresa/JID/sessão/revisão/expiração e
envia somente SHA-256 ao banco. A expiração nasce do `updated_at` da revisão,
então qualquer réplica reconstrói exatamente o mesmo token. A RPC de emissão
deve ser idempotente quando hash + binding + revisão já estiverem vivos. Resumo
expirado não é reemitido/ressuscitado: retorna `RESUMO_EXPIRADO` com snapshot
`requiresReview` e requer update com nova revisão/`messageId`. Corrida CAS na
emissão relê e devolve o snapshot atual. Este fluxo não usa
`zelomenu_cart_tokens`, não cria link público e não toca o carrinho legado do
ZeloChat.

## Important Conventions

### Verification scope (2026-09-04)

See [the engineering audit](docs/audits/2026-09-04-zelomenu.md) for current findings and evidence.
`npm test` includes a local HTTP server test with fake credentials and no database writes.
`npm run test:e2e` starts a local Vite frontend automatically on its default URL. Store/cart/delivery tests use
deterministic API fixtures by default; Google OAuth verifies the outgoing URL at
an intercepted provider boundary. They do not validate live Supabase transactions
or successful OAuth login. Store/cart support `E2E_LIVE_API=true` for an explicitly
prepared test backend/dataset. Email login scenarios require `TEST_EMAIL` and
`TEST_PASSWORD`. Never point mutation/load tests at customer data to obtain green CI.

Push delivery accepts HTTPS endpoints from FCM, Apple Push, Mozilla Push and WNS,
with a 10-second transport timeout. Unknown endpoint hosts are rejected on save
and ignored on dispatch, including existing rows. Update this allowlist only after
verifying a browser vendor's endpoint contract.

- **Mobile-first:** 44px minimum tap targets, Tailwind responsive classes throughout
- **Autosave:** Product edits save immediately and show a toast on error — don't add confirmation dialogs where autosave is already the pattern
- **Toast feedback:** Use `ToastContext` for all user-facing feedback (success/error/info); use `console.warn/error` for debugging
- **Deployment:** Push to `master` → Dokploy auto-deploys. Ask before pushing.
- **Type checking is the linter:** Run `npm run lint` (tsc --noEmit) to catch errors — there is no ESLint

## Invariantes da confirmacao conversacional (Fix 1)

F2-F5 preservam replay de revisao, pausa de produtos vinculados sob lock unico,
patches por presenca e telefone derivado do JID. O GET exige a tupla completa
`{ orderingId, empresaId, remoteJid }`; rollout depende do consumidor ZeloChat.

Linhas do carrinho conversacional preservam o `lineId` opaco fornecido pelo chamador.
O materializador SQL valida formato e unicidade e nunca reconstrói a identidade pela
posição no array. Em qualquer confirmação, emissão de token e RPC atômica exigem,
sob o lock da sessão, prontidão semântica: nome do cliente, forma de pagamento,
modalidade explícita, endereço/agendamento aplicável, revalidação sem erros,
nenhuma exigência bloqueante e taxa de entrega já resolvida.

## Checkout, publicação e operação — atualização 2026-09-04

- Confirmação pública usa `confirm_public_zelo_order_atomic`: sessão/token/revisão, snapshots revalidados, pedido canônico e resgate do cupom fazem parte do mesmo commit. Nunca compensar/liberar cupom depois de timeout HTTP. Replay autenticado recupera o pedido da mesma sessão antes de comparar a revisão antiga.
- Cotação alterada ou pendente usa CAS de revisão + token + estado e incrementa revisão. A cotação manual só pode resolver a solicitação ainda apontada por `deliveryQuoteRequestId` no carrinho. PATCH recalcula fulfillment e remove o vínculo antigo; erro `QUOTE_REQUEST_STALE` é 409 e tem mensagem PT-BR.
- Publicação usa CAS `updated_at` monótono; criação concorrente retorna conflito. Reordenação escreve somente ordem/identidade/data. Upload não apaga foto publicada até o acknowledgement da referência, e falha de save preserva o draft para retry. Não coletar imagem de resultado ambíguo.
- Catálogos/admin/métricas/subscriptions usam páginas de 500 com ordenação estável. Diretório avança páginas de 50 perfis antes do filtro de entitlement e busca apenas produtos destacados. Não existe corte silencioso de 50 lojas ou 5.000 pedidos.
- Cache compartilhado de catálogo: 100 empresas, com snapshot mantido por escopo de requisição; mapas pequenos de identidade: 1.000; vitrine/config de entrega: 200. O escopo HTTP evita que a evicção por outro tenant afete a requisição em andamento.
- Supabase e OpenAI têm deadline de 15 s; chamadas admin usam 20 s e erro legível. Isso limita cada transporte, não promete um deadline global do checkout composto.
- Push: páginas de 200, oito transportes concorrentes, timeout de 10 s e lease de dois minutos via `claim_zelomenu_order_push`. Checkpoint exige o lease atual. Entrega continua pelo menos uma vez após crash/ack incerto; status final desliga polling. Não tratar como exactly-once.
- Expiração das solicitações de cotação roda a cada minuto no servidor com predicate `pending AND expires_at < now`, além do endpoint manual. Health usa contagem exata e `null` quando indisponível.
- Métricas globais: `/internal/metrics/delivery`, `x-metrics-key` contra `ZELOMENU_METRICS_KEY` dedicada; vazia desabilita. Lojistas continuam com métricas por empresa em `/api/admin/zelomenu/metrics`.
- Docker/CI usam Node 24. O build Docker exige Git limpo, incluindo arquivos untracked, gera frontend e backend juntos, e copia somente `dist`, `server-build`, manifesto e dependências de produção. Runtime executa Node compilado como usuário `node`; não usa tsx.
- `PUBLIC_APP_VERSION` deve ficar vazio no Dokploy; se definido como build arg, precisa coincidir com SHA40 do checkout. Runtime não pode alterar a identidade do artefato. `/api/health.version`, `sourceCommit`, `x-app-version` e frontend provêm do mesmo build. Builds locais sujos recebem `-dirty` e são recusados no Docker.
- CI executa unit, typechecks, E2E Chromium, PostgreSQL descartável com dois backends, build compilado, audit e imagem Docker/smoke. As migrations efetivas são mantidas no PDV e os testes Menu usam espelhos com SHA256 em `supabase/tests/fixtures`.
- Após push em `master`, o job `production` espera até 12 minutos por `/api/health` e HTML/JS servidos no domínio com o SHA40 esperado. Valida `x-app-version`, HTML `no-store` e todos os chunks JS/CSS referenciados, inclusive lazy; HTTP e corpo têm deadline de 5 s. Falta de convergência deixa a CI vermelha sem reenviar deploy nem alterar dados. Branches de validação não aguardam produção.
- O mesmo verificador roda contra o servidor compilado e o container antes de publicar; URLs de chunks preservam query/fragment. Falhas de transporte indicam endpoint, fase e causa. Testes HTTP reais cobrem desconexão/recuperação, versões misturadas, 4xx, bundle antigo e corpo travado. CI usa token somente leitura e cancela runs substituídos no mesmo ref; problemas de rede não dispensam as assertions de publicação.


## Pizzas montáveis (2026-09-05)

`produtos.tipo_produto = pizza` e `pizza_config` são cadastrados exclusivamente no PDV. O editor genérico do Menu é somente leitura para esses produtos; exclusão e alteração de produto/complementos são bloqueadas nos hooks. Publicar somente depois da migration canônica do PDV e dos consumidores atualizados.

O catálogo expõe `productType` e `pizza`. A montagem envia apenas `pizzaSelection` (revisão, tamanho, IDs dos sabores). `src/domain/pizza.js` é cópia literal do contrato puro do PDV; sincronizar ambas em qualquer alteração. Valores dos sabores são preços de pizzas inteiras. Extras usam o resolvedor existente sobre a base calculada; `substituir` não é permitido para pizza.

O servidor resolve valores e composição, armazena `pizza` e acrescenta as projeções de apresentação `__pizza_size`/`__pizza_flavors` a `selectedModifiers`. Essas projeções nunca devem voltar ao resolvedor genérico como `selectedOptions`. Cache, edição, autosave e revalidação preservam a montagem. Revalidação consulta a configuração atual; alteração de valor segue o aceite de preço existente.

Estoque por tamanho substitui o principal; sabores não consomem estoque. O mapa interno de produtos inclui alvos de estoque não publicados e valida a quantidade agregada de todas as linhas. Conversação sem `pizzaSelection` falha com orientação para montar no cardápio digital. Pizzas não podem ser componentes de complementos genéricos.

Validação: testes de domínio e servidor em `pizza.test.ts`/`pizzaOrdering.test.ts`; fluxo Playwright `e2e/pizza-flow.spec.ts` cobre meio a meio, preço, reload do cache e edição/autosave em desktop e celular. Nenhum teste grava pedido em produção.

Na confirmação QR de mesa, quando a revisão/composição da pizza mudou sem alterar preço, o servidor atualiza os snapshots resolvidos antes de chamar `confirm_zelomenu_cart`. A escrita usa CAS de revisão, titular/empresa, token e estado aberto, incrementando a revisão entregue ao RPC. Concorrência aborta com `REVISION_CONFLICT`; alteração de preço permanece aguardando aceite e não regrava o carrinho nessa etapa.
