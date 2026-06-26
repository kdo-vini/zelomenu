# Design: Integração ZeloMenu × ZeloPDV — Módulo de Mesas

**Data:** 2026-06-25
**Status:** Aprovado
**Escopo:** ZeloMenu admin + storefront + server | ZeloPDV kitchen queue (mudanças mínimas)

---

## Contexto

O ZeloPDV tem um módulo de mesas **completo e em produção** (Sprint 4, Abril/2026):
- `mesas`, `comandas`, `comanda_itens`, `comanda_pagamentos` — schema completo
- UI de gestão (`/gestao/mesas`), mapa visual (`/app/mesas`), editor de comanda (`/app/mesas/[id]`)
- Divisão de conta, pagamentos parciais, pagamento múltiplo — tudo já existe no ZeloPDV
- Funções RPC: `comanda_aplicar_delta_item`, `comanda_cancelar_com_estoque`, `comanda_garantir_estoque_baixado`

O ZeloMenu tem o tipo `table_order` definido no cart context mas sem lógica conectada. As migrations
`pedidos_origem_zelomenu_2026_06_23.sql` e `zelomenu_pedido_status_sync_2026_06_23.sql` foram aplicadas
em 23/06/2026, indicando que a integração já foi antecipada no banco.

O objetivo: clientes escaneiam QR code estático na mesa → adicionam itens via ZeloMenu storefront →
pedido chega como ticket na fila de cozinha do ZeloPDV, linkado à comanda aberta pelo garçom.

---

## Decisões de Design

- **D-1:** Abordagem B — ZeloMenu cria `pedidos` com `origem='zelomenu'` e `id_comanda`. O garçom
  aprova na fila de cozinha. Não escrita direta em `comanda_itens` (evita acoplamento com RPCs internas).
- **D-2:** QR code estático por mesa (`/{slug}/mesa/{mesa_id}`). A comanda ativa é resolvida no servidor
  no momento do acesso, não embutida no QR.
- **D-3:** Garçom abre a comanda no ZeloPDV antes de o cliente poder pedir. Mesa sem comanda aberta
  mostra vitrine read-only, sem carrinho.
- **D-4:** Status flow da cozinha: `aberto → preparando → pronto` (não `aberto → pronto`).
- **D-5:** Snapshot do `comanda_id` no momento de abertura do carrinho + validação dupla no confirm,
  para impedir que sessões de browser desatualizadas contaminem a comanda de outro grupo.
- **D-6:** Zero migrations novas — toda a infraestrutura de banco já existe.
- **D-7:** Gate combinado: `hasMesasAddon AND hasZeloMenuAccess`. Clientes com apenas o addon mesas
  não veem nenhuma feature de integração ZeloMenu — nem no ZeloPDV, nem no ZeloMenu admin.
- **D-8:** Gestão de QR codes fica no ZeloMenu admin (`/admin`), não no ZeloPDV. O ZeloMenu admin
  lê a tabela `mesas` do DB compartilhado e exibe os QR codes para impressão.
- **D-9:** Divisão de conta e pagamentos múltiplos são responsabilidade do garçom/caixa no ZeloPDV —
  já estão implementados. Não é escopo da integração via app.

---

## Fluxo de Ponta a Ponta

```
[ZeloMenu Admin — Dono/Garçom]
  1. Acessa /admin → seção "Mesas" (visível só se hasMesasAddon AND hasZeloMenu)
  2. Lista de mesas vinda de SELECT * FROM mesas WHERE id_usuario = {owner_user_id}
  3. Clica em uma mesa → QR code gerado com URL: https://menu.zelopdv.com.br/{slug}/mesa/{mesa_id}
  4. Baixa o QR como PNG → imprime e cola fisicamente na mesa

[ZeloPDV — Garçom]
  5. Abre a comanda para Mesa 5 em /app/mesas/[id] (fluxo existente, sem mudança)

[Cliente — Celular]
  6. Escaneia QR → abre /{slug}/mesa/{mesa_id} no ZeloMenu
  7. ZeloMenu server busca comanda ABERTA para esse mesa_id:
     SELECT id FROM comandas WHERE id_mesa = {mesa_id} AND status = 'aberta'
     ORDER BY aberta_em DESC LIMIT 1
     → Sem comanda: vitrine read-only + mensagem de aguardo
     → Com comanda: vitrine + carrinho habilitado; comanda_id salvo na cart session
  8. Cliente navega, adiciona itens, confirma pedido

[ZeloMenu — Server]
  9. Validação dupla ao confirmar:
     a. comanda_id da sessão ainda está com status='aberta'?
     b. É a mesma comanda atualmente ativa para essa mesa? (previne browser stale)
     Se falhar → erro amigável (ver tabela de edge cases)
  10. INSERT em `pedidos`: origem='zelomenu', id_comanda, id_usuario={owner_user_id}, status='aberto'
  11. INSERT em `pedido_itens`: snapshot de nome, preco_unitario, quantidade
  12. Resposta ao cliente: "Pedido enviado! Aguarde o garçom."

[ZeloPDV — Cozinha / Garçom]
  13. Ticket aparece na fila /app/pedidos/cozinha com badge "📱 App" (origem='zelomenu')
  14. Cozinha muda status: aberto → preparando → pronto
  15. Garçom lança os itens na comanda manualmente no PDV (MVP)
  16. Fechamento da comanda, divisão de conta e pagamento: fluxo existente no ZeloPDV, sem mudança
```

---

## Mudanças por Sistema

### ZeloMenu Admin (`/admin`) — Nova seção "Mesas"

- Visível apenas se `hasMesasAddon AND hasZeloMenuAccess` (D-7)
- Lista mesas da tabela `mesas` (DB compartilhado, leitura via service-role ou com user_id do dono)
- Por mesa: número, status atual (livre/ocupada), QR code gerado client-side
- Botão "Baixar QR" → PNG para impressão
- URL do QR: `https://menu.zelopdv.com.br/{slug}/mesa/{mesa_id}`
- Não replica a gestão de mesas (criar/editar/deletar) — isso continua no ZeloPDV

### ZeloMenu — Novas rotas server

| Rota | Tipo | Descrição |
|------|------|-----------|
| `/{slug}/mesa/:mesaId` | Pública | Storefront com contexto de mesa. Reusa ZeloMenuStorePage. |
| `GET /api/public/zelomenu/mesa/:mesaId` | Server | Retorna `{ comanda_id, comanda_status: 'aberta', mesa_numero }` ou `{ error: 'sem_comanda' }` |

### ZeloMenu — Modificações no cart flow

**`POST /api/public/zelomenu/store/:slug/cart`**
- Aceita `context: 'table_order'`, `mesa_id`, `comanda_id` (snapshot no momento de abertura)
- Valida que `comanda_id` está `aberta` antes de criar a sessão

**`POST /api/public/zelomenu/cart/:token/confirm`**
- Para `context: 'table_order'`:
  - Validação dupla do `comanda_id`
  - Escreve em `pedidos` + `pedido_itens` com `origem='zelomenu'` (não em `zelochat_orders`)
- Para outros contextos: comportamento existente inalterado

### ZeloMenu — UI do storefront de mesa

| Estado | Comportamento |
|--------|---------------|
| Mesa com comanda aberta | Banner "Mesa X — Peça pelo app" + carrinho habilitado normalmente |
| Mesa sem comanda ativa | "Aguardando atendimento. Peça ao garçom para abrir sua comanda." Vitrine visível, sem carrinho. |
| Confirmação ok | "Pedido enviado! Aguarde o garçom." Sem tela de acompanhamento. |

### ZeloPDV — Mudanças mínimas

**`/app/pedidos/cozinha` (fila de cozinha):**
- Badge visual em pedidos com `origem='zelomenu'`: "📱 App" — diferencia do balcão/comanda manual
- Status flow corrigido: `aberto → preparando → pronto` (adicionar estado `preparando` se não existir)

**Nenhuma mudança em:**
- `/gestao/mesas` — CRUD de mesas inalterado
- `/app/mesas` — mapa visual inalterado
- `/app/mesas/[id]` — editor de comanda inalterado
- Fechamento, divisão de conta, pagamentos — inalterados (já prontos)

---

## Entitlement Gate: `hasMesasAddon AND hasZeloMenuAccess`

A integração só aparece quando AMBOS os addons estão ativos:

| Situação | Comportamento |
|----------|---------------|
| Só `has_mesas_addon` (sem ZeloMenu) | Módulo mesas funciona normalmente. Nenhuma feature de QR/ZeloMenu exposta. |
| Só `has_zelo_menu` (sem mesas) | ZeloMenu funciona normalmente. Seção "Mesas" no admin não aparece. |
| Ambos ativos | Seção "Mesas" no admin + rota pública `/{slug}/mesa/:mesaId` ativa |
| chat / bundle (plan tier) | ZeloMenu ativo por padrão; se `has_mesas_addon` também ativo → integração disponível |

---

## Banco de Dados — Zero Migrations Novas

| Recurso | Status |
|---------|--------|
| `pedidos.origem = 'zelomenu'` | ✅ Migration aplicada em 23/06/2026 |
| `pedidos.id_comanda` | ✅ Coluna já existente |
| `mesas`, `comandas`, `comanda_itens` | ✅ Schema completo, em produção desde Abril/2026 |
| `comanda_pagamentos`, `vendas_pagamentos` | ✅ Pagamentos múltiplos e parciais já implementados |
| RLS | ✅ ZeloMenu usa service-role key — RLS não se aplica |

---

## Edge Cases

### Sessão de browser desatualizada

| Cenário | Validação | Mensagem ao cliente |
|---------|-----------|---------------------|
| Grupo A foi embora, Grupo B sentou. Grupo A tenta confirmar. | `comanda_id` da sessão ≠ comanda atualmente aberta para essa mesa | "Esta mesa está sendo atendida por outro grupo. Escaneie o QR novamente." |
| Garçom fechou a comanda enquanto cliente navegava | `comanda_id` com `status='fechada'` | "Sessão encerrada. Peça ao garçom para abrir uma nova comanda." |
| Mesa ficou livre, nenhuma comanda aberta | Nenhuma comanda com `status='aberta'` para esse `mesa_id` | "Mesa sem atendimento ativo. Peça ao garçom para abrir sua comanda." |
| Dois clientes do mesmo grupo confirmam ao mesmo tempo | Dois `pedidos` independentes com mesmo `id_comanda` | OK — cozinha recebe dois tickets, ambos linkados à mesma comanda |

### Outros edge cases

| Cenário | Mitigação |
|---------|-----------|
| Mesa sem QR (danificado) | Cliente pede pelo balcão — fluxo degradado aceitável |
| Cliente sem sinal | Cart em localStorage (12h TTL já existente). Erro de rede com retry manual. |
| Item esgotou entre browse e confirm | Revalidação de estoque no confirm (já existe no cart flow) |
| Garçom transfere mesa no ZeloPDV | `comanda_id` da sessão não bate com a nova comanda → erro de staleness padrão |
| Pedido fora do horário de funcionamento | Regras de `horario_abertura/fechamento` já existem no ZeloMenu — bloqueio padrão |

---

## Fora do Escopo

- Divisão de conta pelo app do cliente — **já existe no ZeloPDV** (garçom/caixa fecha via multiplo + comanda_pagamentos)
- Acompanhamento em tempo real do status do pedido (websocket/polling) — pós-MVP
- Incorporação automática de `pedido_itens` → `comanda_itens` via trigger — pós-MVP
- Migração de mesa pelo app do cliente — pós-MVP
- Gestão de mesas (criar/editar) no ZeloMenu — permanece no ZeloPDV
