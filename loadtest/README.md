# Load Test: ZeloMenu Delivery Quote

Script de carga para o sistema de cotação de frete por distância do ZeloMenu.

## Pré-requisitos

- Node 18+ (fetch nativo)
- Servidor ZeloMenu rodando em `localhost:3101` (ou configurar `BASE_URL`)
- Loja com **entrega por distância configurada** (slots de faixas + endereço)
- Loja com **ao menos um produto visível e disponível** no catálogo

## Uso básico

```bash
SLUG=loja-teste npx tsx loadtest/delivery-quote-load.ts
```

Isso executa **todos os cenários** com **10 requisições simultâneas**.

## Opções

| Flag | Descrição |
|------|-----------|
| `--all` | Executa todos os cenários (padrão se nenhum cenário for passado) |
| `--same-address` | `N` requisições simultâneas para o **mesmo** CEP (testa cache + dedup) |
| `--different-addresses` | `N` requisições simultâneas para **CEPs diferentes** (cache frio) |
| `--provider-failure` | `30` requisições para estressar provedores e ver contingência |
| `--cache-behavior` | Sequência: 1 fria + 2 quentes para o mesmo CEP |
| `--concurrent=<N>` | Número de requisições simultâneas (padrão: 10) |
| `--ceps=<lista>` | CEPs separados por vírgula (padrão: 50 CEPs de capitais) |
| `--address-number=<N>` | Número do endereço usado nos testes (padrão: 100) |

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `SLUG` | _(obrigatório)_ | Slug público da loja no ZeloMenu |
| `BASE_URL` | `http://localhost:3101` | URL base do servidor |

## Exemplos

```bash
# Apenas cache behavior com 5 repetições
SLUG=minha-loja npx tsx loadtest/delivery-quote-load.ts --cache-behavior

# 50 requisições simultâneas para endereços diferentes
SLUG=minha-loja npx tsx loadtest/delivery-quote-load.ts --different-addresses --concurrent=50

# Cenário específico com CEP personalizado
SLUG=minha-loja CUSTOM_CEPS=01001000,20040020 npx tsx loadtest/delivery-quote-load.ts --same-address
```

## Cenários

### 1. `--same-address` (mesmo endereço)
Cria `N` sessões de carrinho e envia `N` PATCH simultâneos com o **mesmo** CEP.
Esperado: latências menores após o cache L1 aquecer. O servidor tem dedup em voo
(`cepInFlight`, `geocodingInFlight`, `distanceInFlight`) que evita requisições
duplicadas quando o mesmo CEP chega simultaneamente.

### 2. `--different-addresses` (endereços diferentes)
Cria `N` sessões de carrinho e envia `N` PATCH simultâneos com **CEPs distintos**
(50 CEPs reais de capitais brasileiras). Esperado: maior variação de latência
— alguns CEPs acertam cache, outros batem em provedores externos.

### 3. `--provider-failure` (falha de provedor)
Envia 30 requisições simultâneas para estressar os provedores ViaCEP, Nominatim
e OSRM. O circuit breaker abre após 3 falhas por provedor. O teste verifica
que o servidor **nunca crasha** (retorna `unavailable` com status 200 em vez
de 500).

Interpretação dos resultados:
- Se a maioria retorna `eligible`: provedores funcionaram, circuit breaker não
  foi acionado — aumente o número de requisições.
- Se `unavailable` começa a aparecer: circuit breaker está funcionando.
- Se aparecem `HTTP_5xx`: o servidor crashou sob carga — investigar.

### 4. `--cache-behavior` (comportamento do cache)
Sequência de 3 requisições para o mesmo CEP:
1. **Fria**: espera-se `cacheLayer = 'provider'` (bate em ViaCEP, Nominatim, OSRM)
2. **Quente #1**: espera-se `cacheLayer = 'memory'` ou `'supabase'`
3. **Quente #2**: espera-se `cacheLayer = 'memory'`

O relatório mostra a redução percentual de latência entre a requisição fria
e a média das quentes.

## Fluxo do teste

```
1. GET  /api/public/zelomenu/store/{slug}
   → busca catálogo, encontra primeiro produto disponível

2. POST /api/public/zelomenu/store/{slug}/cart (N vezes, sequencial)
   → cria N sessões de carrinho, cada uma com token único
   → rate-limit: 30/min (generalPublicLimiter) — cria com delays

3. PATCH /api/public/zelomenu/cart/{token} (N vezes, simultâneo)
   → cada PATCH envia fulfillment com CEP + número
   → servidor chama revalidateDeliveryForCart → quoteDelivery
   → cada token tem rate-limit de 20/min (cartTokenLimiter)
```

## Métricas reportadas

| Métrica | Descrição |
|---------|-----------|
| `totalRequests` | Total de requisições PATCH disparadas |
| `succeeded` | HTTP 200 + resposta JSON válida |
| `failed` | HTTP 4xx/5xx ou erro de rede |
| `Latency min/p50/p95/p99/max` | Distribuição de latência (ms) |
| `Delivery statuses` | Distribuição de `deliveryStatus` no retorno |
| `Cache layers` | Distribuição de `deliveryCacheLayer` (memory, supabase, provider, stale) |
| `Error codes` | Códigos de erro retornados (ex: REVISION_CONFLICT, DELIVERY_DISABLED) |

## Interpretação de `deliveryStatus`

| Status | Significado |
|--------|-------------|
| `eligible` | Frete calculado com sucesso |
| `eligible_stale` | Frete calculado com cache expirado (rota antiga) |
| `out_of_area` | CEP válido, fora da área de entrega |
| `pending` | Endereço inválido ou incompleto |
| `unavailable` | Provedor indisponível ou falha no cálculo |
| `quote_pending` | Confirmado com cotação pendente (retry posterior) |

## Cache layers

| Layer | Significado |
|-------|-------------|
| `memory` | Cache em memória do processo (L1) — < 5 min |
| `supabase` | Cache no banco (L2) — até 30 dias |
| `provider` | Chamada real ao provedor externo |
| `stale` | Cache expirado, mas usado como fallback |
| `none` | Sem cache |

## Troubleshooting

**"Server is not responding"**: o servidor não está rodando ou `BASE_URL` está
errado. Execute `npm run dev:server` no projeto.

**"Store not found or has no products"**: o slug está incorreto, a loja não
existe, ou o catálogo está vazio. Verifique com uma requisição manual:
```bash
curl http://localhost:3101/api/public/zelomenu/store/SEU_SLUG
```

**Muitos `REVISION_CONFLICT`**: cada sessão de carrinho só aceita um PATCH
por revisão. O script cria uma sessão por requisição, então isso não deveria
acontecer. Se aparecer, verifique se o token está sendo reutilizado.

**Muitos `TOO_MANY_REQUESTS` (429)**: o rate limiter está ativo. O script
tem retry automático com backoff, mas se for frequente, aumente o intervalo
(`sleep()`) entre criações de carrinho.
