# Storefront Credibilidade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan task-by-task. Every task below is already implemented in the isolated worktree and checked off after its test cycle.

**Goal:** Tornar horário, atendimento, endereço e contato acessíveis no primeiro toque do cardápio, sem alterar checkout, preços, pedidos ou publicação.

**Architecture:** Um view model puro deriva os três estados operacionais a partir do payload público do servidor. O cabeçalho e os sheets ficam em componentes focados; o checklist administrativo continua advisory e consulta delivery de forma independente.

**Tech Stack:** React, TypeScript, Tailwind tokens existentes, Vitest e Playwright.

**Spec:** Requisitos de credibilidade ZeloMenu no pedido de 2026-09-05.

## Global Constraints

- Não criar migration, endpoint, flag de publicação ou novo sistema de status.
- Não alterar checkout, precificação, pedidos, autenticação ou publicação do catálogo.
- Usar horários calculados pelo servidor; não recalcular fuso no cliente.
- Manter contraste WCAG AA, `prefers-reduced-motion` e áreas interativas mínimas de 44 × 44 px.

---

## Objetivo

Tornar as informações que reduzem a incerteza antes do pedido acessíveis no primeiro toque, sem alterar checkout, preços, pedidos ou publicação do catálogo.

## Tasks

- [x] **Task 1: Contrato público e view model** — `src/domain/storefrontOperations.ts` e teste dedicado.
   - `whatsapp` foi tipado no payload público.
   - `buildStorefrontOperations` centraliza estado de horário, entrega/retirada e informações.
   - O view model usa os horários e formatadores entregues pelo servidor.

- [x] **Task 2: Cabeçalho público e sheets** — `StorefrontHeader.tsx`, `StorefrontOperationSheet.tsx` e `ZeloMenuStorePage.tsx`.
   - Capa compacta responsiva de 144/160 px, com alt e sem placeholder artificial.
   - Identidade, boas-vindas e três ações de operação em área de toque mínima de 52 px.
   - Busca e categorias são a única faixa sticky.
   - Horários: estado atual, semana, hoje e próxima abertura.
   - Entrega/retirada: prazo, bairros/taxas ou aviso de cálculo no endereço.
   - Informações: endereço, Google Maps codificado e WhatsApp quando disponível.
   - O componente `Modal` mantém Escape, backdrop, fechamento explícito e restauração de foco.

- [x] **Task 3: Ergonomia e acessibilidade** — controles de `ZeloMenuStorePage.tsx` e `ZeloMenuProductAddModal.tsx`.
   - Controles públicos de busca, categorias, quantidade, fechar e adicionais têm área mínima de 44 px.
   - Labels acessíveis foram adicionados sem ampliar visualmente os ícones.

- [x] **Task 4: Prontidão administrativa** — `ZeloMenuReadinessCard.tsx` e teste de domínio/componente.
   - Checklist separado para logo, capa, horários, fotos e modo de atendimento.
   - Entrega exige endereço geocodificado, prazo válido e faixa/regra de preço ativa.
   - Falha na consulta de entrega é não bloqueante e oferece retry.

- [x] **Task 5: Regressão pública** — fixtures determinísticas e `e2e/storefront.spec.ts`.
   - Fixtures públicos aceitam estados determinísticos de horário, entrega, identidade e WhatsApp.
   - E2E cobre ações, sheets, foco, touch targets, loja fechada, catálogo e viewport estreito.

### Validation commands

```bash
npm run typecheck
npm run typecheck:server
npm test
npm run test:e2e
npm run build
```

Resultado da execução neste worktree: typechecks, 61 arquivos/681 testes unitários, 52 E2E com 4 cenários de login pulados, storefront final com 11 testes e build Vite concluído.

Nenhum schema, endpoint, preço, autenticação, checkout ou pedido é alterado por este plano.
