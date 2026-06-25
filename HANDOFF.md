# Handoff — App ZeloMenu (cardápio único: config + vitrine)

> **Como usar:** cole este arquivo (ou aponte para ele) como prompt inicial de um agente novo nesta IDE.
> Repo de trabalho: `/home/vinicius/orca/zelomenu` (este — repo único, sem pacote separado).
> Fontes para COPIAR (não reescrever do zero): ZeloChat `/home/vinicius/code/zelochat`, ZeloPDV `/home/vinicius/code/zelopdv`.
> Plano canônico completo: `/home/vinicius/code/zelopdv/docs/projects/zelomenu-app-plan.md`.

## Missão

Construir **um app único de cardápio** que centraliza TODA a configuração de menu (hoje espalhada no ZeloPDV e no ZeloChat) e também serve a vitrine pública. Mora em `menu.zelopdv.com.br` → loja do cliente em `/{slug}`, painel do dono em `/admin`. PDV e Chat **perdem** suas telas de menu e só **redirecionam** pra cá. Regra de ouro do dono: **uma fonte única, copiar-e-colar do ZeloChat em vez de refazer**.

## Decisões já fechadas (não reabrir sem motivo)

| Tema | Decisão |
| --- | --- |
| Forma | App externo React 19 + Vite + TS + Tailwind 4 (espelha o stack do ZeloChat) |
| Hospedagem | `menu.zelopdv.com.br` — `/{slug}` (loja) + `/admin` (config) |
| Auth | SEM login novo. Sessão Supabase compartilhada por cookie em `.zelopdv.com.br`; quem está logado no PDV/Chat cai logado no `/admin` |
| Entitlement | Resolver vive em `src/domain/zelomenuEntitlements.ts` (testes vitest). PDV/Chat mantêm a cópia deles da regra, como já é hoje (decisão: repo único > pacote separado, surface mínima) |
| Entitlement | `hasZeloMenuAccess` do pacote; sem direito → estado bloqueado/upsell PT-BR |
| Centralização | Tirar config de menu do PDV e do Chat; cada um vira botão "Configurar cardápio" → redirect |
| Banco | SEM schema novo. Tabelas: `zelomenu_product_publications`, `zelomenu_modifier_groups`, `zelomenu_modifier_options`, `empresa_perfil.zelomenu_slug`, `subscriptions.has_zelo_menu`. Tudo owner-scoped por RLS |
| Ordem | Categorias: `categorias.ordem` (compartilhada c/ PDV). Produtos: `zelomenu_product_publications.ordem` (só do cardápio) |

## Estado atual (auditado 2026-06-25)

Legenda: ✅ feito e em produção · 🟡 parcial · ❌ não feito.
**No ar:** `https://menu.zelopdv.com.br` (Docker Swarm no VPS do ZeloChat — `2.24.66.12`, Dokploy). Container único Express servindo API (`/api/*`) + SPA estática. **Auto-deploy via Dokploy + GitHub**: cada push no `master` dispara build automático. Dockerfile com `ARG` defaults para `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (não precisa mais de `--build-arg` manual). Servidor Express injeta `window.__ENV__` em runtime como fallback.

### ✅ Feito (não refazer)

1. **Resolver de entitlement** — `src/domain/zelomenuEntitlements.ts` (15 testes vitest). Agora **lê a coluna `subscriptions.has_zelo_menu`** (publicada) + addons `has_pedidos_addon`/`has_mesas_addon`/`has_acessos_addon` via `useZeloMenuEntitlement`. Acesso liberado para: `chat`, `bundle`, OU `has_zelo_menu=true` (inclui `pdv` puro). Senão → estado de upsell PT-BR.
2. **Vitrine pública** — `ZeloMenuStorePage` (`/:slug`) e `ZeloMenuCartPage` (`/menu/carrinho/:token`). Catálogo, destaques, busca, modais de unidade/modificadores, carrinho flutuante, cache 12h localStorage, checkout 3-passos. Consome `src/services/zelomenuApi.ts`.
3. **Back-end da vitrine** — `server/` próprio (Express :3101, não depende mais do ZeloChat). `supabaseServer.ts` (service-role + `ws`), `configStore.ts` (carrega catálogo das mesmas tabelas), `zelomenuCartSessions.ts` (sessões/tokens de carrinho, revalidação, confirmação → materializa `zelochat_orders` + baixa estoque). Rotas `/api/public/zelomenu/*` e `/api/admin/zelomenu/slug`. `Dockerfile` multi-stage.
4. **CatalogView (config de produtos)** — `src/components/views/CatalogView.tsx` + `catalog/CatalogModals.tsx` + `useCatalog.ts`/`useCatalogBulkController.ts`. **Imagem #1** (CRUD categorias/subcategorias/produtos, métricas de publicação publicados/não-publicados/pausados/sem-estoque/sem-categoria, "Ajustes pendentes", bulk). Upload de foto wired (`uploadProductPublicationImage`).
5. **Auth** — `@supabase/ssr` com cookie em `.zelopdv.com.br` (sessão compartilhada cross-subdomínio). Formulário de login direto (email+senha) + **login com Google** (`signInWithOAuth`) no `/admin`. Rota **`/auth/callback`** (`AuthCallbackPage`) trata PKCE/OAuth (`?code=`) e SSO handoff (`#access_token`/`#refresh_token`).

### ✅ Feito (adicional — jun/2025)

- **Store-settings panel** (Item A) — `ZeloMenuSettingsCard` portado do ZeloChat no `/admin`. Welcome text com IA, destaques toggle+multi-select, drag-ordering de categorias.
- **Slug editor no /admin** (Item B) — campo "Link público do cardápio" com salvar + copiar. Back-end adaptado para resolver empresaId da sessão.
- **Catalog edit tier-S** (Item C) — swipe, autosave, crop 1:1, drag-ordering dnd-kit, preview real. ✅ Em produção.
- **Auto-deploy Dokploy + GitHub** — push no master → build automático. Dockerfile com ARG defaults para env vars.
- **Supabase env vars fix** — `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` embutidas no Dockerfile com valores default. Fallback via `window.__ENV__` em runtime.

### 🟡 Parcial

- **Slug no admin** — back-end pronto, UI pronta. Slug editor funcional.

### ❌ Não feito (prioridade)

#### D. Wiring final (PDV + Chat) e cutover — não feito
- **SSO de verdade:** o PDV/Chat ainda não gravam o cookie em `.zelopdv.com.br` nem redirecionam pro `/auth/callback` com tokens. Hoje o usuário loga manualmente no `/admin`. Adicionar botão "Configurar cardápio" no PDV/Chat que faz o handoff.
- **PDV** (`/home/vinicius/code/zelopdv`): remover config de menu de `gestao/produtos` e o editor de slug de `gestao/extensoes`; deixar 1 botão "Configurar cardápio" → redirect.
- **Chat** (`/home/vinicius/code/zelochat`): remover vitrine + config de menu; botão de redirect.
- **Cutover:** o DNS de `menu.zelopdv.com.br` JÁ aponta pra este app (Traefik). Falta o ZeloChat parar de servir a vitrine e PDV/Chat virarem só redirect.

## Regras inquebráveis

- **Copiar, não reescrever.** Sempre que existir no ZeloChat, copie e adapte imports.
- **Owner-scoping + RLS:** toda query/mutation por `id_usuario` do dono (resolver sub-user→owner quando aplicável). RLS já escopa por `get_owner_user_id`. Entitlement é gate de UI (RLS só checa owner).
- **Contrato de foto (idêntico ao ZeloChat):** bucket `logos`, path `zelomenu-products/{ownerUserId}/{productId}-{uuid}-{safeName}.jpg`, `upsert:false`; downscale máx **1920px** preservando aspecto, **JPEG q0.85**, pula <200KB/GIF; **≤3MB**; apaga o objeto anterior (URL parseada, guardada pelo prefixo). Crop é aditivo (recortado = quadrado preenche o card; "imagem inteira" = aspecto preservado, card faz contain 1:1 em branco).
- **Entitlement:** a regra vive em `src/domain/zelomenuEntitlements.ts` (neste app) + cópias no PDV/Chat. Se mudar a regra, sincronize os três (decisão consciente: repo único, surface mínima).
- **UI:** mobile-first, tier-S, PT-BR. Sem hardcode de segredo (use `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`).
- Não publicar/empurrar (git push) nem mexer em deploy sem pedir.

## Como verificar

```
cd /home/vinicius/orca/zelomenu
npm install && npm run build      # tem que passar
npx tsc --noEmit                  # zero erros de tipo
npm run dev                       # /admin e /{slug}
```

## Mapa rápido de fontes

- **Store-settings (FALTA — imagem #2):** `zelochat/src/components/zelomenu/ZeloMenuSettingsCard.tsx`; contrato API em `zelochat/src/services/waApi.ts` (`getZeloMenuSettings`/`updateZeloMenuSettings`/`generateZeloMenuWelcome`); back-end em `zelochat/server/zelomenuCartSessions.ts` (`getZeloMenuStoreSettings`/`updateZeloMenuStoreSettings`) e rotas `zelochat/server/router.ts` (`/api/zelomenu/settings`).
- Config produtos (já portado): `zelochat/src/components/views/CatalogView.tsx`, `.../catalog/CatalogModals.tsx`, `zelochat/src/hooks/useCatalog.ts`
- Vitrine (já portado): `zelochat/src/pages/ZeloMenuStorePage.tsx`, `ZeloMenuCartPage.tsx`
- Back-end vitrine (já portado): `zelochat/server/` (`/api/public/zelomenu/*`)
- Entitlement canônico: `zelochat/src/domain/zelomenuEntitlements.ts` e `zelopdv/src/lib/guards.js`
- Slug (back-end já portado; falta UI): `zelopdv/src/routes/api/zelomenu/slug/+server.js`
- Plano completo: `zelopdv/docs/projects/zelomenu-app-plan.md`
