# Design: Integração ZeloMenu × ZeloPDV — Módulo de Mesas

**Data:** 2026-06-25
**Status:** Aprovado
**Escopo:** ZeloMenu (storefront + server) + ZeloPDV (QR code + fila de cozinha)

---

## Contexto

O ZeloPDV tem um módulo de mesas completo e em produção (Sprint 4, Abril/2026) com schema:
`mesas`, `comandas`, `comanda_itens`, `comanda_pagamentos`.

O ZeloMenu tem o tipo `table_order` definido no cart context mas sem lógica conectada. As migrations
`pedidos_origem_zelomenu_2026_06_23.sql` e `zelomenu_pedido_status_sync_2026_06_23.sql` foram aplicadas
em 23/06/2026, confirmando a intenção de integração já existente no banco.

O objetivo é permitir que clientes de um estabelecimento escaneiem um QR code estático na mesa e
adicionem itens à comanda aberta pelo garçom, sem que o garçom precise intervir no processo de pedido.

---

## Decisões de Design

- **D-1:** Abordagem B — ZeloMenu cria `pedidos` com `origem='zelomenu'` e `id_comanda`. O garçom
  aprova na fila de cozinha. Não escrita direta em `comanda_itens` (evita acoplamento com RPCs internas
  do ZeloPDV).
- **D-2:** QR code estático por mesa (`/{slug}/mesa/{mesa_id}`). A comanda ativa é resolvida no servidor
  no momento do acesso, não embutida no QR.
- **D-3:** Garçom abre a comanda no ZeloPDV antes de o cliente poder pedir. Mesa sem comanda aberta
  mostra vitrine read-only.
- **D-4:** Status flow da cozinha: `aberto → preparando → pronto` (não `aberto → pronto`).
- **D-5:** Snapshot do `comanda_id` no momento de abertura do carrinho + validação dupla no confirm,
  para impedir que sessões de browser desatualizadas contaminem a comanda de outro grupo.
- **D-6:** Sem migrations novas — toda a infraestrutura de banco já existe.

---

## Fluxo de Ponta a Ponta

```
[ZeloPDV — Garçom]
  1. Abre comanda para Mesa 5
  2. Clica "QR da Mesa" → modal com QR code
     URL: https://menu.zelopdv.com.br/{slug}/mesa/{mesa_id}
     QR impresso e colado na mesa (permanente)

[Cliente — Celular]
  3. Escaneia QR → abre /{slug}/mesa/{mesa_id} no ZeloMenu
  4. ZeloMenu server busca comanda aberta para esse mesa_id
     → Sem comanda: vitrine read-only + mensagem de aguardo
     → Com comanda: vitrine + carrinho habilitado, comanda_id guardado na cart session
  5. Cliente navega, adiciona itens, confirma

[ZeloMenu — Server]
  6. Validação dupla:
     a. comanda_id da sessão ainda está com status='aberta'?
     b. É a mesma comanda atualmente ativa para essa mesa?
     Se falhar → erro amigável (ver mensagens abaixo)
  7. INSERT em `pedidos`: origem='zelomenu', id_comanda, id_usuario, status='aberto'
  8. INSERT em `pedido_itens`: snapshot de nome, preco_unitario, quantidade
  9. Resposta ao cliente: "Pedido enviado! Acompanhe com o garçom."

[ZeloPDV — Cozinha]
  10. Ticket aparece na fila com badge "📱 App" (origem='zelomenu')
  11. Cozinha muda para 'preparando' → 'pronto'
  12. Garçom lança os itens na comanda (manual no MVP)
```

---

## Mudanças por Sistema

### ZeloMenu — Novas rotas

| Rota | Tipo | Descrição |
|------|------|-----------|
| `/{slug}/mesa/:mesaId` | Pública | Storefront com contexto de mesa. Reusa ZeloMenuStorePage. |
| `GET /api/public/zelomenu/mesa/:mesaId` | Server | Retorna `{ comanda_id, comanda_status: 'aberta', mesa_numero }` ou `{ error: 'sem_comanda' }` |

### ZeloMenu — Modificações no cart flow

**`POST /api/public/zelomenu/store/:slug/cart`**
- Aceita `context: 'table_order'`, `mesa_id`, `comanda_id` (snapshot)
- Valida que `comanda_id` está `aberta` antes de criar a sessão

**`POST /api/public/zelomenu/cart/:token/confirm`**
- Para `context: 'table_order'`:
  - Validação dupla do `comanda_id` (ver edge cases)
  - Escreve em `pedidos` + `pedido_itens` (não em `zelochat_orders`)
- Para outros contextos: comportamento existente inalterado

### ZeloMenu — UI

| Estado | Comportamento |
|--------|---------------|
| Mesa com comanda aberta | Banner "Mesa X" + carrinho habilitado normalmente |
| Mesa sem comanda ativa | Tela: "Aguardando atendimento. Peça ao garçom para abrir sua comanda." Vitrine visível, sem carrinho. |
| Confirmação ok | "Pedido enviado! Acompanhe com o garçom." Sem tela de acompanhamento. |

### ZeloPDV — Mudanças mínimas

**`/app/mesas/[id]` (tela da comanda):**
- Botão "QR da Mesa" → modal com QR code gerado de `{slug}/mesa/{mesa_id}`
- `slug` vem de `empresa_perfil.zelomenu_slug` (já existe)
- Geração do QR: ZeloPDV não tem biblioteca de QR code — adicionar `qrcode` (npm) ou `qrcode-svg`
- Download do QR como PNG para impressão

**`/app/pedidos/cozinha`:**
- Badge visual em pedidos com `origem='zelomenu'`: "📱 App"
- Status flow correto: `aberto → preparando → pronto`

**Incorporação à comanda (pós-MVP):**
- Ao marcar `pronto`, botão "Adicionar à comanda" copia `pedido_itens` → `comanda_itens`
  via `comanda_aplicar_delta_item()` RPC. No MVP: lançamento manual pelo garçom no PDV.

---

## Edge Cases

### Sessão de browser desatualizada

| Cenário | O que acontece | Resposta ao cliente |
|---------|---------------|---------------------|
| Grupo A foi embora, Grupo B sentou. Grupo A tenta confirmar. | `comanda_id` da sessão ≠ comanda atualmente aberta na mesa | "Esta mesa está sendo atendida por outro grupo. Escaneie o QR novamente." |
| Garçom fechou a comanda (ex: erro) enquanto cliente navegava | `comanda_id` tem `status='fechada'` | "Sessão encerrada. Peça ao garçom para abrir uma nova comanda." |
| Mesa ficou livre, nenhuma comanda aberta | Nenhuma comanda com `status='aberta'` para esse `mesa_id` | "Mesa sem atendimento ativo. Peça ao garçom para abrir sua comanda." |
| Dois clientes do mesmo grupo confirmam ao mesmo tempo | Dois `pedidos` independentes com mesmo `id_comanda` | OK — cozinha recebe dois tickets, ambos linkados à mesma comanda |

### Outros edge cases

| Cenário | Mitigação |
|---------|-----------|
| Mesa sem QR (QR danificado) | Cliente pede pelo balcão normalmente — fluxo degradado aceitável |
| Cliente sem sinal na mesa | Cart em localStorage (12h TTL já existente). Confirmação falha com retry manual. |
| Item esgotou entre browse e confirm | Revalidação de estoque no confirm (já existente no cart flow) |
| Garçom transfere mesa (ZeloPDV tem transfer) | O `mesa_id` no QR aponta para a mesa física original. Se comanda migrou, o `comanda_id` da sessão não bate mais — erro padrão de staleness |
| Pedido fora do horário de funcionamento | Regras de `horario_abertura/fechamento` já existem no ZeloMenu — bloqueio padrão |

---

## Banco de Dados — Zero Migrations Novas

| Recurso | Status |
|---------|--------|
| `pedidos.origem = 'zelomenu'` | ✅ Migration aplicada em 23/06/2026 |
| `pedidos.id_comanda` | ✅ Coluna já existente |
| `mesas`, `comandas`, `comanda_itens` | ✅ Schema completo, em produção desde Abril/2026 |
| RLS | ✅ ZeloMenu usa service-role key — RLS não se aplica |

---

## Fora do Escopo (pós-MVP)

- Divisão de conta pelo app (split payment via ZeloMenu)
- Acompanhamento em tempo real do status do pedido pelo cliente (websocket/polling)
- Incorporação automática de `pedido_itens` → `comanda_itens` via trigger
- Migração de mesa pelo app do cliente
- Modo offline no ZeloMenu para ambientes com sinal fraco
