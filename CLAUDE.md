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

npm run build         # Production build → dist/
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
- **Backend:** Express 4 on Node 20 (port 3101), serving both the API and the built SPA as static fallback
- **Database:** Supabase PostgreSQL (shared with ZeloPDV and ZeloChat) — no local migrations, schema managed upstream
- **Auth:** Supabase SSR with cookies at `.zelopdv.com.br` for cross-subdomain session sharing

### Key Directories

| Path | Purpose |
|------|---------|
| `src/pages/` | Route-level components: `AdminPage`, `ZeloMenuStorePage`, `ZeloMenuCartPage`, `AuthCallbackPage` |
| `src/components/views/` | `CatalogView` and its modals — the product/category editor |
| `src/components/zelomenu/` | Admin sub-panels: settings, slug editor, image crop, sortable lists |
| `src/hooks/useCatalog.ts` | Main state machine for product/category CRUD (~800 lines) |
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
- Legacy `has_pedidos_addon` → kitchen/ordering only, never menu publication

Unit tests for this logic live in `src/domain/zelomenuEntitlements.test.ts` (15 tests).

### Data Patterns

- All queries are owner-scoped: frontend uses `supabase.from(...).eq('user_id', userId)`, RLS enforces it again server-side
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

The server injects `window.__ENV__` into `<head>` at runtime so the frontend doesn't require build-time env vars baked in. See `server/index.ts` for how this is handled. For local dev, use a `.env` file based on `.env.example`.

Required env vars:
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Optional:
```
PORT=3101
OPENAI_API_KEY=   # for AI-generated descriptions/welcome text
ZELO_INTERNAL_API_KEY= # server-only key for internal catalog discovery
```

### Descoberta interna de catálogo

`POST /internal/catalog/search` atende a integração interna do ZeloChat. Exige
`x-zelo-internal-key` igual a `ZELO_INTERNAL_API_KEY`; sem uma chave configurada
ou válida, falha fechada. O corpo é `{ empresaId, query, limit? }` e a resposta
traz no máximo 12 candidatos com produto-pai, categoria, preço vigente,
complementos válidos e motivo/confiança do match. Todos os erros incluem
`requestId` e usam texto seguro para consumo.

Há um limite coarse por origem antes do parser JSON para absorver chaves e
payloads inválidos; ele não consome respostas 2xx. O limite por empresa e
origem continua depois da validação, para que uma única origem do ZeloChat não
esgote a cota de outras empresas. O servidor instala `requestId` antes do
parser JSON: JSON inválido ou grande demais também recebe resposta JSON segura e
correlacionável.

A descoberta consome apenas `catalogHierarchy`, a projeção pública canônica de
`configStore`: publicação online, pausa manual, estoque e grupos obrigatórios já
foram resolvidos ali. `ocultar_no_pdv` nunca entra nessa decisão. Resultados de
grupo ou opção preservam o produto-pai; opções não são itens avulsos.

## Important Conventions

- **Mobile-first:** 44px minimum tap targets, Tailwind responsive classes throughout
- **Autosave:** Product edits save immediately and show a toast on error — don't add confirmation dialogs where autosave is already the pattern
- **Toast feedback:** Use `ToastContext` for all user-facing feedback (success/error/info); use `console.warn/error` for debugging
- **Deployment:** Push to `master` → Dokploy auto-deploys. Ask before pushing.
- **Type checking is the linter:** Run `npm run lint` (tsc --noEmit) to catch errors — there is no ESLint
