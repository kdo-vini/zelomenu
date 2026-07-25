# Preços de entrega por horário personalizado

> Plano executável para agentes. O comportamento atual permanece como padrão; a complexidade só aparece quando o lojista abre **Horários personalizados**.

## 1. Decisão de produto

A maioria das lojas usará apenas um preço por distância. Portanto, não devemos colocar uma segunda tabela visível permanentemente na tela de Entrega.

O novo recurso será um disclosure/accordion fechado por padrão:

- sem configuração: `Opcional · preços por horário`;
- com configuração: `1 horário configurado` ou `N horários configurados`;
- se uma regra estiver ativa: chip `Ativo agora`.

O nome público recomendado é **Horários personalizados**. “Horário avançado” descreve a complexidade, mas não comunica tão bem o que o lojista controla.

O preço especial será absoluto por faixa, não apenas um adicional. A loja informa R$ 10,00 no período noturno; a interface pode exibir `+R$ 2,00 sobre o padrão` apenas como informação auxiliar.

### Semântica recomendada

- Pedido imediato: usar o horário atual no fuso da loja.
- Pedido agendado: usar o horário agendado no fuso da loja.
- Início inclusivo e fim exclusivo.
- `20:00–02:00` inclui 20:00, 23:59, 00:00 e 01:59; às 02:00 volta ao preço padrão.
- `20:00–00:00` termina na virada do dia.
- Persistir minutos inteiros; não usar `23:59` para representar o fim do dia.
- O servidor é a autoridade do horário; o cliente não pode enviar uma hora arbitrária para obter preço menor.

## 2. Escopo

### Incluído

- preços especiais por período e faixa de distância;
- períodos que atravessam a meia-noite;
- timezone da empresa, já existente no sistema;
- disclosure fechado por padrão no admin;
- timeline de 24 horas;
- preço aplicado salvo no snapshot do pedido;
- revalidação se a cotação mudar antes da confirmação;
- fallback seguro para preço padrão;
- cache de rota preservado;
- testes unitários, integração, E2E e canário.

### Fora do MVP

- preço por clima, feriado ou demanda automática;
- percentual sobre o preço;
- regras por bairro;
- edição de dias da semana na primeira versão;
- mapa diferente por horário;
- nova rota pública;
- cobrança silenciosa de um valor diferente no checkout.

A estrutura de dados pode aceitar `daysOfWeek`, mas o editor inicial usa todos os dias.

## 3. Direção de interface

O mapa e o endereço continuam dominando a parte espacial da tela. Os horários devem aparecer abaixo das faixas padrão, como uma camada opcional de tempo.

### 3.1 Estado fechado — desktop

```text
┌──────────────────────────────────────────────────────────────┐
│ Faixas de entrega                                            │
│                                                              │
│ Até (km)                         Preço padrão                │
│ [ 2,00 ]                         [ R$ 8,00 ]                 │
│ [ 5,00 ]                         [ R$ 10,00 ]                │
│                                                              │
│ ──────────────────────────────────────────────────────────── │
│ ◷ Horários personalizados       Opcional · preços por horário ˅│
└──────────────────────────────────────────────────────────────┘
```

Com uma regra salva:

```text
│ ◷ Horários personalizados       1 horário · Ativo agora      ˄│
```

O estado fechado não deve mostrar inputs, preços duplicados ou uma segunda tabela.

### 3.2 Estado aberto — desktop

```text
┌──────────────────────────────────────────────────────────────┐
│ ◷ Horários personalizados                    1 horário ativo ˄│
│ Ajuste o preço da entrega em períodos de maior demanda.     │
│ A regra usa o fuso horário configurado para a loja.         │
│                                                              │
│ 00       06       12       18       24                       │
│ ├────────┼────────┼────────┼────────┤                        │
│ [──────── preço padrão ───────][── Noturno ──]  ↑ agora      │
│                                                              │
│ ┌ Noturno                                      Ativo agora ⋮┐ │
│ │ Das [20:00] às [02:00] · termina no dia seguinte         │ │
│ │ Até 2 km                                  [ R$ 10,00 ]   │ │
│ │ Até 5 km                                  [ R$ 12,00 ]   │ │
│ │ [Editar]  [Desativar]  [Remover]                         │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ + Adicionar horário personalizado                            │
└──────────────────────────────────────────────────────────────┘
```

A timeline é o elemento de assinatura da feature: ela explica a regra de meia-noite melhor que texto isolado. Não precisa ser arrastável no MVP.

### 3.3 Estado mobile

No mobile, cada regra vira um card vertical. Não usar uma tabela com várias colunas.

```text
┌───────────────────────────────┐
│ ◷ Horários personalizados  ˄  │
│ Ajuste preços por período.     │
│                               │
│ 00 ───── 06 ─── 12 ─── 18 ─ 24 │
│ padrão              noturno   │
│                               │
│ ┌ Noturno           Ativo agora┐
│ │ 20:00 → 02:00               │
│ │ termina no dia seguinte     │
│ │ Até 2 km       R$ 10,00     │
│ │ Até 5 km       R$ 12,00     │
│ │ Editar                 ⋮    │
│ └─────────────────────────────┘
│                               │
│ + Adicionar horário           │
└───────────────────────────────┘
```

Criar/editar abre um bottom sheet ou bloco expansível na mesma página. Não criar uma rota adicional e não substituir o save bar global.

### 3.4 Copy

Usar:

- `Horários personalizados`;
- `Ajuste o preço da entrega em períodos de maior demanda.`;
- `Preço padrão`;
- `Ativo agora`;
- `Termina no dia seguinte`;
- `Este horário não pode se sobrepor a outro.`;
- `Informe um preço para cada faixa.`;
- `A taxa usa o fuso horário da loja.`

Evitar “tarifação dinâmica”, “janela temporal”, “surcharge” e qualquer referência a cache/provider.

## 4. Arquitetura do frontend

Reutilizar:

- `src/pages/ZeloMenuDeliverySettingsPage.tsx`;
- `src/components/zelomenu/ZeloMenuDeliverySettingsCard.tsx`;
- `src/components/zelomenu/DeliveryCoveragePreview.tsx`;
- `src/domain/deliverySettings.ts`;
- `src/services/zelomenuAdminApi.ts`.

Criar componentes separados apenas se necessário:

- `DeliveryCustomScheduleDisclosure`: aberto/fechado e resumo;
- `DeliveryPricingTimeline`: timeline e estado ativo;
- `DeliveryPricingRuleCard`: visualização e ações de uma regra;
- `DeliveryPricingRuleEditor`: formulário e validação local.

Não misturar chamadas de API, cálculo de intervalos e markup responsivo em um componente monolítico.

### Estado do draft

```ts
type DeliveryPricingRuleDraft = {
  id?: string;
  label: string;
  startMinute: string;
  endMinute: string;
  enabled: boolean;
  prices: Record<string, string>; // chave: maxDistanceM
};

type DeliverySettingsDraft = {
  enabled: boolean;
  address: DeliveryAddress;
  ranges: DeliveryRangeDraft[];
  pricingRules: DeliveryPricingRuleDraft[];
  geocodingStatus: DeliveryGeocodingStatus;
};
```

Usar `maxDistanceM` como chave lógica, não o UUID da faixa. O RPC atual recria as faixas durante o salvamento; IDs não são estáveis o suficiente para essa associação.

Ao adicionar uma faixa, criar sua entrada em todas as regras e copiar inicialmente o preço padrão. Ao remover uma faixa, remover sua entrada das regras antes do PATCH.

### Acessibilidade

- `button` com `aria-expanded` e `aria-controls` no disclosure;
- foco visível e controles com mínimo de 44px;
- erros em `aria-live="polite"`;
- `Ativo agora` indicado por texto e não apenas cor;
- timeline com resumo textual acessível;
- ações não dependentes de hover;
- suporte a `prefers-reduced-motion`.

## 5. Domínio

Adicionar ao domínio compartilhado, preferencialmente `src/domain/zelomenuDelivery.ts`:

```ts
type DeliveryPricingRule = {
  id?: string;
  label: string;
  startMinute: number;
  endMinute: number;
  enabled: boolean;
  daysOfWeek: number[];
  pricesByDistance: Array<{ maxDistanceM: number; price: number }>;
};

type DeliveryPricingResolution = {
  mode: 'standard' | 'custom_time';
  ruleId: string | null;
  ruleLabel: string | null;
  baseFee: number;
  resolvedFee: number;
  quotedAt: string;
  timezone: string;
  pricingVersion: number;
};
```

Criar helpers puros:

- `normalizeDeliveryPricingRule`;
- `validateDeliveryPricingRules`;
- `minuteInPricingInterval`;
- `pricingIntervalSegments`;
- `findActiveDeliveryPricingRule`;
- `resolveDeliveryPrice`;
- `formatPricingWindowLabel`;
- `getLocalDateTimeParts`.

Rejeitar label vazia, início/fim fora do intervalo, início igual ao fim, preço inválido/negativo, regra sem preço para uma faixa, distância inexistente e intervalos sobrepostos.

## 6. Persistência no Supabase

Criar uma migration, por exemplo:

`supabase/migrations/20260725170000_zelomenu_delivery_custom_time_pricing.sql`

### Tabela de regras

Criar `zelomenu_delivery_pricing_rules` com:

- `id uuid`;
- `company_id uuid` referenciando `empresa_perfil`;
- `label text`;
- `start_minute smallint` entre `0` e `1439`;
- `end_minute smallint` entre `0` e `1440`;
- `enabled boolean default true`;
- `days_of_week smallint[] default {0,1,2,3,4,5,6}`;
- timestamps.

O domínio deve rejeitar início igual ao fim. Persistir `1440` para o fim do dia, nunca o texto `24:00`.

### Tabela de preços

Criar `zelomenu_delivery_pricing_rule_ranges` com:

- `pricing_rule_id` com cascade;
- `max_distance_m`;
- `delivery_price numeric(10,2)`;
- unique `(pricing_rule_id, max_distance_m)`.

Não criar FK para o ID da faixa atual. A distância máxima é a chave lógica porque o salvamento existente pode recriar as linhas de distância.

### RLS

Aplicar o modelo já usado nas tabelas atuais:

- RLS habilitada;
- `anon` e `authenticated` bloqueados diretamente;
- acesso somente pelo backend/service role;
- queries sempre limitadas por empresa.

### RPC atômica

Estender `save_zelomenu_delivery_settings()` para receber `p_pricing_rules`, mantendo compatibilidade com payload sem regras.

A RPC deve validar tudo, travar a empresa com `FOR UPDATE`, salvar endereço/faixas/regras na mesma transação e incrementar `delivery_pricing_version` se qualquer preço ou regra mudar.

Erros estáveis:

- `DELIVERY_PRICING_RULE_INVALID`;
- `DELIVERY_PRICING_RULE_OVERLAP`;
- `DELIVERY_PRICING_RANGE_PRICE_MISSING`;
- `DELIVERY_CONFIGURATION_INVALID`.

## 7. API e resolução

Estender `GET /api/admin/zelomenu/delivery` e `PATCH /api/admin/zelomenu/delivery` com `pricingRules`, `timezone` e `pricingVersion`.

O GET pode retornar, para a UI, `activePricingRuleId`, `activePricingRuleLabel` e `localMinuteNow`. Esses campos são informativos; a cotação transacional continua no servidor.

Não criar endpoint público novo. O fluxo atual do carrinho deve continuar chamando `quoteDelivery()`/revalidação.

Pseudofluxo:

```text
local = converter horário de cotação para timezone da loja
distance = obter rota do cache ou provider
range = primeira faixa que contém distance
rule = regra ativa para dia/minuto local
fee = rule.preçoDaFaixa ou range.price
```

O `deliveryFee` existente continua sendo o valor usado no total. Adicionar ao fulfillment snapshot:

```text
deliveryBaseFee
deliveryPricingMode
deliveryPricingRuleId
deliveryPricingRuleLabel
deliveryQuotedAt
deliveryPricingVersion
```

## 8. Cache, confirmação e fallback

O cache atual de distância deve continuar armazenando distância de rota, não preço final. Assim, mudar de 19:59 para 20:00 reaproveita a rota e recalcula apenas a política local.

Não reutilizar um fee final sem incluir horário/versionamento na chave. A preferência é aplicar o preço sobre a distância cacheada a cada cotação.

Quando uma cotação válida for exibida, manter seu preço por até 10 minutos. Se mudar durante a confirmação:

1. retornar `DELIVERY_FEE_CHANGED`;
2. atualizar snapshot e total;
3. não confirmar o pedido;
4. explicar a alteração;
5. exigir nova confirmação.

Na fila pendente, persistir horário, regra, preço e versão. Se expirar, recalcular; nunca perder a informação de qual regra foi usada.

Se houver configuração inválida em runtime, usar preço padrão, registrar métrica e log estruturado. Nunca escolher uma regra arbitrária em caso de sobreposição.

No checkout, quando aplicável:

```text
Entrega                         R$ 10,00
Tarifa noturna · Noturno
```

Para preço padrão, manter a UI atual sem adicionar texto desnecessário.

## 9. Sprints

### Sprint 0 — contrato

- confirmar label e disclosure fechado;
- confirmar preço absoluto;
- confirmar semântica de meia-noite;
- confirmar horário de pedido imediato/agendado;
- confirmar validade de quote de 10 minutos;
- confirmar `DELIVERY_FEE_CHANGED`;
- atualizar tipos e contrato API.

### Sprint 1 — domínio

- implementar tipos e normalização;
- implementar resolução em timezone;
- implementar segmentos de intervalo;
- validar sobreposição;
- testar `19:59`, `20:00`, `01:59`, `02:00`, `00:00` e `1440`;
- testar servidor UTC com loja em `America/Sao_Paulo`.

### Sprint 2 — banco/backend

- migration e índices;
- RLS restritiva;
- RPC atômica;
- versão de pricing;
- carregar regras no serviço;
- resolver depois de `matchDeliveryRange()`;
- preservar distância cacheada;
- snapshot e fila pendente;
- isolamento entre empresas.

### Sprint 3 — admin

- disclosure fechado;
- resumo vazio/configurado;
- timeline 24h;
- cards responsivos;
- editor por faixa;
- sincronização ao adicionar/remover faixa;
- validação inline;
- GET/PATCH e save bar atual.

### Sprint 4 — checkout/observabilidade

- label de tarifa personalizada;
- quote lock;
- `DELIVERY_FEE_CHANGED`;
- métricas e logs;
- fila admin e runbook;
- feature flag ou canário por empresa.

### Sprint 5 — release

- aplicar migration remotamente com Supabase CLI;
- validar RLS/RPC;
- canário em Donutopia;
- testar preço padrão, noturno e meia-noite;
- testar timeout de rota;
- desativar regra para ensaiar rollback;
- monitorar um ciclo operacional.

## 10. Testes obrigatórios

### Domínio

- sem regra usa preço padrão;
- regra diurna/noturna;
- início incluído e fim excluído;
- período cruzando meia-noite;
- `00:00` e `1440`;
- timezone diferente do processo;
- overlap rejeitado;
- preço ausente rejeitado.

### Backend

- RLS e isolamento por empresa;
- RPC salva tudo ou nada;
- payload antigo continua funcionando;
- cache de rota reaproveitado;
- preço muda na fronteira correta;
- fallback padrão em configuração degradada;
- quote pendente preserva contexto;
- confirmação bloqueada quando fee muda;
- retry idempotente.

### Frontend/E2E

- disclosure fechado em desktop/mobile;
- loja sem regra não vê complexidade extra;
- criar/editar/remover regra;
- timeline e chip `Ativo agora`;
- sem overflow no mobile;
- regra `20:00–02:00`;
- refresh preserva configuração;
- checkout mostra tarifa noturna;
- retirada permanece inalterada;
- timeout não apaga o draft.

## 11. Observabilidade e rollback

Métricas:

- `delivery_pricing_standard_count`;
- `delivery_pricing_custom_time_count`;
- `delivery_pricing_invalid_config_count`;
- `delivery_fee_changed_count`;
- `delivery_pricing_resolution_latency_ms`.

Logs não devem conter endereço completo ou dados pessoais. Registrar empresa, regra, distância, timezone, minuto local, versão e preço resolvido.

Rollback:

1. desativar regras personalizadas da empresa;
2. voltar imediatamente ao preço padrão;
3. manter dados para diagnóstico;
4. não reverter migration destrutivamente;
5. reverter frontend apenas se necessário.

Como nenhuma regra significa comportamento atual, esse rollback é natural e seguro.

## 12. Definition of Done

- [ ] `Horários personalizados` começa fechado.
- [ ] Loja sem regras continua usando somente preço padrão.
- [ ] Regra pode ser criada, editada, ativada, desativada e removida.
- [ ] `20:00–02:00` funciona corretamente nos dois dias.
- [ ] Preço usa timezone da loja.
- [ ] Rota continua sendo cacheada independentemente do horário.
- [ ] Snapshot registra preço e regra aplicada.
- [ ] Mudança de preço exige confirmação explícita.
- [ ] RPC é atômica e rejeita overlap/preço incompleto.
- [ ] RLS validada remotamente.
- [ ] Fallback padrão testado.
- [ ] Desktop e mobile validados visualmente.
- [ ] Testes unitários e E2E passam.
- [ ] Canário realizado em empresa de teste.
- [ ] Rollback e runbook atualizados.

## 13. Decisões para congelar antes do código

Recomendação final:

1. usar **Horários personalizados**;
2. manter o bloco fechado por padrão;
3. usar preço absoluto por faixa;
4. aplicar todos os dias no MVP;
5. usar fim exclusivo;
6. aceitar intervalos que cruzam meia-noite;
7. usar horário atual para pedido imediato;
8. usar horário agendado para pedido agendado;
9. travar quote por 10 minutos;
10. pedir nova confirmação quando o fee mudar;
11. cair para preço padrão em qualquer falha de regra;
12. não criar endpoint público novo.
