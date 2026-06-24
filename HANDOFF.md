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

## O que JÁ está pronto (não refazer)

1. **Resolver de entitlement** em `src/domain/zelomenuEntitlements.ts` (15 testes vitest — `npm test`). API: `resolveZeloMenuCapabilities`, `hasZeloMenuAccess`, `hasOrderingReviewAccess`, `hasKitchenQueueAccess`, `hasZeloMenuCapability` + tipos. É a regra de "quem pode usar o cardápio"; PDV (`guards.js`) e Chat têm a cópia deles da mesma regra (sincronizadas à mão, como já era — não houve pacote separado).
2. **Este app** já existe e builda (`npm install && npm run build` verde). A **CONFIG foi migrada do ZeloChat com paridade** (copiada, não reescrita):
   - `src/components/views/CatalogView.tsx`, `src/components/views/catalog/CatalogModals.tsx`
   - `src/hooks/useCatalog.ts` (CRUD direto no Supabase — sem back-end), `src/hooks/useCatalogBulkController.ts`
   - `src/domain/zelomenuPublication.ts`, `zelomenuModifiers.ts`, `zelomenuPublicationImages.ts`
   - `src/services/zelomenuPublicationImages.ts`, `imageCompress.ts`, `errorMessages.ts`, `supabaseClient.ts` (novo)
   - `src/contexts/ToastContext.tsx`, `AuthContext.tsx`, `hooks/useZeloMenuEntitlement.ts`
   - Rota `/admin` gateada por sessão Supabase + `hasZeloMenuAccess` do pacote.
   - **TODO já marcado no código:** storage de auth em cookie `.zelopdv.com.br` (SSO) ainda não implementado — hoje usa localStorage, então sem sessão local cai no estado "Acesse pelo seu painel".

## O que falta (faça nesta ordem)

### A. Migrar a VITRINE pública (copiar do ZeloChat)
Copie e adapte imports (não reescreva). Arquivos no ZeloChat:
- `src/pages/ZeloMenuStorePage.tsx` (loja) e `src/pages/ZeloMenuCartPage.tsx` (carrinho/checkout)
- `src/domain/zelomenuStoreCartCache.ts` (carrinho em localStorage, TTL 12h)
- `src/domain/zelomenuCheckout.ts` (validação de checkout)
- `src/domain/zelomenuDelivery.ts` (taxa por bairro — depende de `normalizeComparableText` de `src/domain/pixReceipt.ts`; **copie só essa função**, não o pixReceipt inteiro)
- `src/services/zelomenuApi.ts` (consome o back-end `/api/public/zelomenu/*`)
- utils de telefone de `src/domain/chat.ts` (`maskBrazilianPhone`, `normalizePhoneNumber`) — **copie as funções**
- `zelomenuModifiers.ts` e `ToastContext.tsx` já existem aqui (reuse).
- Roteamento: loja em `/{slug}`, carrinho em `/menu/carrinho/:token`. **Reserve** `/admin`, `/cart`, etc. pra não colidir com `/{slug}`.

### B. Migrar o BACK-END da vitrine
A vitrine NÃO fala direto com o Supabase — usa o servidor Express do ZeloChat. Mapear e portar:
- Rotas `/api/public/zelomenu/*` em `/home/vinicius/code/zelochat/server/` (catálogo público, preço, carrinho, iniciar pedido, revalidação).
- Sistema de "link do carrinho": tabelas `zelomenu_cart_sessions` e `zelomenu_cart_tokens` (token emitido pelo back-end, expira).
- Este app vai precisar do seu próprio servidor (mesma forma do Chat: Vite + Express) ou funções serverless no Vercel. **Primeiro mapeie** o que existe, depois porte.

### C. Elevar a CONFIG a tier-S (mobile-first, premium)
Sobre a config já migrada, implementar:
- **Editor com swipe:** abre num produto e desliza pro próximo (prev/next) sem fechar.
- **Autosave:** texto com debounce; toggles/ordem/foto instantâneos; flush ao deslizar; indicador `Salvo ✓`; recarrega ao abrir (last-write-wins).
- **Crop de foto 1:1** opcional (zoom/reposição) + botão "Usar imagem inteira"; gera o arquivo no cliente. Pode usar lib madura React (ex. `react-easy-crop`).
- **Arrastar pra ordenar** (touch, ex. `dnd-kit`) em 2 níveis: categorias (`categorias.ordem`) e produtos dentro da categoria (`zelomenu_product_publications.ordem`).
- **Preview = card REAL da vitrine** (mesmo app → WYSIWYG de verdade).
- **Resumo** em chips clicáveis (filtros): publicados / pausados / não publicados / sem categoria / sem estoque.
- **Slug no header** (link público + copiar). Reusar o contrato do endpoint de slug do PDV (`/api/zelomenu/slug`) ou portar a lógica (precisa service-role pra checar unicidade entre tenants).

### D. Wiring final (PDV + Chat) e cutover
- **Auth SSO:** trocar o storage do cliente Supabase (neste app, no PDV e no Chat) pra cookie em `.zelopdv.com.br`. ⚠ migração arriscada: pode deslogar usuários uma vez — fazer com transição cuidadosa.
- **PDV** (`/home/vinicius/code/zelopdv`): remover config de menu de `gestao/produtos` (toggle/bulk/`ModalModificadores`) e de `gestao/extensoes` (editor de slug); deixar 1 botão "Configurar cardápio" → redirect; manter os guards de entitlement do próprio PDV (`guards.js`).
- **Chat** (`/home/vinicius/code/zelochat`): remover vitrine + config de menu; botão de redirect; manter o entitlement do próprio Chat.
- **Cutover:** apontar `menu.zelopdv.com.br` (DNS/Vercel) pra este app; Chat para de servir a vitrine.

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

- Config (referência): `zelochat/src/components/views/CatalogView.tsx`, `.../catalog/CatalogModals.tsx`, `zelochat/src/hooks/useCatalog.ts`
- Vitrine (a copiar): `zelochat/src/pages/ZeloMenuStorePage.tsx`, `ZeloMenuCartPage.tsx`
- Back-end vitrine: `zelochat/server/` (`/api/public/zelomenu/*`)
- Entitlement canônico: `zelochat/src/domain/zelomenuEntitlements.ts` (já no pacote) e `zelopdv/src/lib/guards.js`
- Slug: `zelopdv/src/routes/api/zelomenu/slug/+server.js`
- Plano completo: `zelopdv/docs/projects/zelomenu-app-plan.md`
