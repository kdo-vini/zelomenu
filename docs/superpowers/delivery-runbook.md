# Runbook: ZeloMenu Delivery por Distância

> Documento operacional para o time responsável pelo delivery.

## Contatos

| Serviço | Contato | SLA |
|---------|---------|-----|
| Supabase | [suporte interno] | - |
| ViaCEP | Público, sem SLA | Best effort |
| BrasilAPI | Público, sem SLA | Best effort |
| Nominatim (geocoding) | Público, sem SLA | Best effort, limite 1 req/s |
| OSRM (rota) | Público, sem SLA | Best effort |

## Visão geral da arquitetura

```
Cliente → CEP lookup (ViaCEP → fallback BrasilAPI)
       → Geocoding (Nominatim → fallback config)
       → Route (OSRM → fallback config)
       → Cache L1 (memória) / L2 (Supabase)
       → Match faixa → cotação → checkout
       ↳ Falha → fila de cotação pendente → resolução manual
```

## Health Check

Endpoint: `GET /api/admin/zelomenu/delivery/health` (requer sessão admin)

Retorna:
- `supabase`: conectividade com o banco
- `circuits`: estado de cada provider (open/closed/half-open + falhas)
- `pendingRequests`: quantidade de solicitações pendentes
- `oldestPendingMs`: idade da solicitação mais antiga

**Uso:**
```bash
# Monitoramento manual
curl -H "Authorization: Bearer <token>" https://menu.zelopdv.com.br/api/admin/zelomenu/delivery/health

# Integrar com health check do deploy
# Adicionar à rota de health check da aplicação
```

### Critérios de alerta

| Condição | Ação |
|----------|------|
| Supabase = error | Verificar conectividade com o banco |
| Provider circuit = open | Aguardar backoff (30s), verificar se provider voltou |
| pendingRequests > 5 | Verificar fila e provedores |
| oldestPendingMs > 30min | Acionar operador para resolver manualmente |

## Fila de cotação pendente

### Como identificar

No painel admin > Configurações de entrega > "Solicitações pendentes".

Ou via API:
```bash
curl -H "Authorization: Bearer <token>" \
  https://menu.zelopdv.com.br/api/admin/zelomenu/delivery/quote-requests
```

### Estados

| Estado | Descrição |
|--------|-----------|
| `pending` | Aguardando resolução |
| `resolved` | Cotação calculada ou fee definido manualmente |
| `expired` | Prazo expirou sem resolução |
| `cancelled` | Cancelado pelo operador |

### Ações disponíveis

1. **Recalcular**: tenta novamente a cotação automática. Útil se o provider voltou.
2. **Resolver manual**: define o valor do frete manualmente. Use quando o provider está fora e o pedido precisa ser processado.
3. **Cancelar**: cancela a solicitação. O cliente é notificado que o pedido não pôde ser processado.

### Cleanup de expirados

Solicitações com `expires_at` vencido e status `pending` são automaticamente marcadas como `expired`.

Endpoint de cleanup manual:
```bash
curl -X POST -H "Authorization: Bearer <token>" \
  https://menu.zelopdv.com.br/api/admin/zelomenu/delivery/cleanup-expired
```

## Métricas

Endpoint: `GET /api/admin/zelomenu/delivery/metrics` (requer sessão admin)

Métricas disponíveis:
- `delivery_quote_total:<status>` — contagem por status (eligible, out_of_area, unavailable, etc.)
- `delivery_cache_hit:<layer>` — hits por camada (memory, supabase)
- `delivery_provider:<provider>:<result>` — chamadas por provider (success, failure, timeout, fallback)
- `delivery_circuit:<state>` — estado do circuit breaker
- `delivery_quote_latency_ms_p50/p95/p99` — latência em ms

## Provider degradado

### Sintomas
- Timeout nas cotações de frete
- Aumento de solicitações pendentes
- Circuit breaker aberto no health check

### Plano de ação

1. **Verificar health check** para identificar qual provider está fora
2. **Verificar fila pendente** para ver se há pedidos afetados
3. **Se provider primário fora**: o fallback deve ser acionado automaticamente
   - CEP: ViaCEP → BrasilAPI (automático)
   - Geocoding: Nominatim → fallback (automático)
   - Rota: OSRM → fallback (automático)
4. **Se todos os providers falharem**: pedidos vão para a fila de cotação pendente
5. **Resolver manualmente** os pedidos na fila se necessário
6. **Acompanhar recovery** — circuit breaker fecha após 30s sem falhas

### Rollback de aplicação

Se for necessário reverter o deployment:

```bash
# 1. Desabilitar delivery (se houver feature flag)
# 2. Rollback da aplicação no Dokploy
# 3. Verificar que retirada continua funcionando
# 4. Verificar que pedidos existentes não foram perdidos
```

**NÃO** remover migrations ou apagar tabelas de cache/fila.

## Rollback de delivery

Caso seja necessário desabilitar o delivery sem reverter a aplicação:

1. **Desabilitar por empresa**: atualizar `zelomenu_delivery_enabled = false` na empresa
2. **Verificar**: retirada continua funcionando, delivery aparece como indisponível
3. **Preservar**: sessões e solicitações pendentes não são afetadas
4. **Reabilitar**: após identificar e corrigir a causa

**Último ensaio:** realizado na Donutopia em 25/07/2026. O delivery foi
desabilitado via `delivery_config.enabled`, a vitrine refletiu a indisponibilidade
e o valor original `true` foi restaurado. O rollback da aplicação no Dokploy
ainda não foi executado.

## Checklist de rollout

### Antes do deploy
- [ ] Migrations aplicadas no remote
- [ ] RLS validada no remote
- [ ] `npm audit` revisado
- [ ] Typecheck e build passando
- [ ] Testes E2E passando

### Pós-deploy
- [ ] Health check responde
- [ ] CEP lookup funciona
- [ ] Cotação funciona para endereço conhecido
- [ ] Retirada continua funcionando
- [ ] Métricas estão sendo registradas

### Canário (Donutopia)
- [ ] Delivery ativado apenas para Donutopia
- [ ] Testar endereço dentro da área
- [ ] Testar endereço fora da área
- [ ] Testar CEP inválido
- [ ] Observar por 1 ciclo operacional
- [ ] Verificar logs e métricas

## Rollback emergency

Em caso de incidente grave:

1. Desabilitar delivery (feature flag ou `delivery_enabled = false`)
2. Reverter aplicação no Dokploy
3. Comunicar operação
4. Preservar logs e request IDs para investigação
5. Não remover migrations
