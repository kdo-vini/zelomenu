# ZeloMenu Delivery: plano de prontidão para produção

> Documento de execução para agentes de implementação, QA e operação.
>
> Objetivo: fechar os gaps que ainda impedem o delivery por distância de ser liberado com segurança para produção, preservando o checkout, o pedido e a capacidade de recuperação quando um provedor externo falhar.

## 1. Veredito atual

### Estado atual

O happy path está implementado e validado localmente:

- cache L1 em memória e L2 no Supabase;
- cálculo por rota real no backend;
- deadline total configurado;
- fallback configurável de geocoding e rota;
- circuit breaker por processo;
- cache stale limitado;
- RLS restritiva nas tabelas internas de delivery;
- salvamento atômico da configuração da loja;
- checkout bloqueado até a cotação ser confirmada;
- modal de loading durante a cotação;
- memória local do cliente por loja;
- fallback visual do mapa e ícone vetorial de produto;
- migrations remotas alinhadas até `20260725160000` e RPC transacional validada.

Verificações já executadas:

- `npm run typecheck`;
- `npm run typecheck:server`;
- `npm test -- --run`: 18 arquivos, 190 testes;
- `npm run build`;
- `supabase migration list --linked`;
- `supabase db lint --linked`.

O Supabase lint retornou apenas warnings preexistentes em funções de comanda/estoque, sem warning apontado para as tabelas de delivery.

### Veredito

**Ainda não aprovar o rollout global.**

O fluxo normal está próximo de pronto, mas existem gaps de operação, resiliência, segurança de dependências e testes de falha. Os bloqueadores mais importantes são:

1. a fila de cotação pendente é criada, mas não possui fluxo completo de resolução;
2. não existe uma decisão fechada entre “bloquear até a taxa” e “permitir pedido pendente sem taxa”;
3. não há E2E específico do delivery;
4. o `npm audit` reporta seis vulnerabilidades de severidade alta;
5. o ambiente ainda pode depender de providers públicos sem SLA contratado e sem fallback de CEP implementado;
6. não existe validação de carga/timeout/caos em cenário próximo de produção.

## 2. Regras de execução para os agentes

Cada agente deve:

1. ler este documento e o `deliveryproject.md` antes de alterar código;
2. trabalhar em uma worktree própria;
3. não executar `git reset --hard`, `git checkout --` ou apagar mudanças de outro agente;
4. inspecionar o estado atual da branch antes de implementar;
5. alterar apenas os arquivos do seu workstream, salvo dependência explicitamente documentada;
6. adicionar testes de regressão junto com qualquer correção;
7. executar typecheck, testes e build do workstream;
8. registrar no handoff: arquivos, decisões, comandos executados, limitações e risco restante;
9. não marcar uma tarefa como pronta somente porque o TypeScript compila;
10. não usar `npm audit fix --force` sem revisar a alteração de versão e o impacto de runtime.

### Formato obrigatório de handoff

```md
## Handoff: [workstream]

### Entregue
- ...

### Arquivos alterados
- ...

### Testes executados
- comando: resultado

### Riscos ou decisões pendentes
- ...

### Próximo agente
- ...
```

## 3. Decisão de produto necessária antes do fallback

O produto já decidiu que o cliente não deve concluir um pedido sem uma taxa calculada. A implementação atual respeita isso: o CTA fica bloqueado quando a cotação está pendente ou indisponível.

Ao mesmo tempo, o `deliveryproject.md` descreve que o cliente pode optar por enviar um pedido pendente de cotação. Hoje essas duas regras não estão conciliadas.

### Opção recomendada para o primeiro rollout

Manter o bloqueio rígido do checkout para o cliente e tratar `delivery_quote_pending` como contingência de corrida ou falha durante a confirmação. Nesse modo:

- nenhum pedido é aceito com frete desconhecido;
- nenhum Pix ou cobrança é criado com valor incompleto;
- a intenção fica preservada para operação;
- o cliente recebe um protocolo e uma mensagem clara;
- a empresa precisa ter uma ação operacional para recalcular ou concluir a solicitação.

### Opção alternativa

Implementar um CTA explícito `Enviar para a loja calcular` que permita pedido pendente sem cobrança automática. Essa opção exige um novo estado de pedido, tela de acompanhamento para o cliente, resolução manual pela empresa e regras de comunicação.

**Critério de aceite:** uma opção deve ser escolhida e documentada antes de qualquer agente implementar o fallback final. Não manter comportamento implícito.

## 4. Registro de riscos e prioridades

### Estado após a revisão de implementação

- A fila agora possui retry, resolução manual e cancelamento no backend e na UI.
- Retry/resolução atualizam a fila e a sessão do carrinho na mesma transação via RPC.
- A limpeza de solicitações expiradas é limitada à empresa autenticada.
- A migration `20260725160000_zelomenu_delivery_quote_resolution.sql` foi aplicada
  e validada no Supabase remoto.
- O rollback reversível por empresa foi ensaiado na Donutopia: delivery foi
  desligado, a vitrine refletiu `deliveryEnabled=false`, e o estado original
  `true` foi restaurado.
- O canário funcional de produção está bloqueado até o deploy do backend novo:
  `POST /api/public/zelomenu/delivery/cep` ainda responde `404` em produção.
- `react-router-dom@7.18.1` foi mantido por corrigir os advisories anteriores;
  o advisory RSC restante não se aplica ao SPA client-side atual, que não usa
  SSR, loaders/actions, server actions, hidratação ou RSC. Essa é uma exceção
  temporária que deve ser reavaliada em todo upgrade.

### P0: bloqueia produção

#### P0-01: fila de cotação pendente sem resolução

**Status após a implementação:** retry, resolução manual e cancelamento já
existem no backend e na UI. Retry/resolução atualizam a fila e a sessão do
carrinho por RPC transacional; o fluxo já está aplicado no Supabase remoto e
agora depende do canário e do rollback ensaiado para aprovação operacional.

Evidência atual:

- a tabela `zelomenu_delivery_quote_requests` existe;
- o backend cria o registro idempotente;
- existe apenas `GET /api/admin/zelomenu/delivery/quote-requests`;
- não existe ação de `recalcular`, `resolver`, `cancelar` ou `notificar`;
- não existe tela administrativa da fila;
- não existe worker que processe registros pendentes;
- não há uso de `resolved_fee` ou `resolved_snapshot` para concluir a solicitação.

Risco: a mensagem promete que a solicitação foi preservada, mas a empresa pode não ter como concluir a cotação dentro do produto.

Critério de aceite:

- toda solicitação pendente aparece para a empresa autorizada;
- a empresa consegue solicitar nova cotação;
- a empresa consegue informar/confirmar a taxa quando necessário;
- a operação é idempotente;
- o cliente não recebe cobrança sem taxa confirmada;
- o pedido preserva cliente, carrinho, endereço, preço base e protocolo;
- registros expirados possuem estado e motivo;
- existe teste de recuperação após provider indisponível.

#### P0-02: contrato de providers não definido para produção

O fluxo usa ViaCEP, Nominatim e OSRM. Geocoding e rota possuem fallback configurável, mas o fallback de OSRM está vazio no exemplo e o CEP não possui um segundo provider implementado.

Critério de aceite:

- provider primário e secundário definidos por ambiente;
- timeout, limite de uso, SLA e contato operacional documentados;
- fallback de CEP implementado ou decisão explícita de aceitar indisponibilidade de CEP;
- fallback de geocoding e rota testado com respostas reais e simuladas;
- nenhum provider público sem SLA fica como dependência única do checkout de produção;
- falha de provider nunca vira `out_of_area`.

#### P0-03: vulnerabilidades de dependência sem triagem

**Status após a implementação:** `react-router-dom` está fixado em `7.18.1`,
que elimina os advisories anteriores. O registry ainda reporta o advisory alto
`GHSA-qwww-vcr4-c8h2` para RSC; este SPA usa `BrowserRouter` client-side e não
usa SSR, loaders/actions, server actions, hidratação ou RSC. A exceção é
temporária e deve ser reavaliada em cada upgrade.

`npm audit --omit=dev --audit-level=high` deve ser executado no CI. O advisory
RSC acima permanece documentado como exceção técnica temporária; novas
vulnerabilidades altas devem bloquear o pipeline até triagem aprovada.

Critério de aceite:

- atualizar as dependências corrigíveis sem `--force`, ou documentar exceção técnica;
- revisar o advisory do React Router e confirmar se o modo afetado está ou não em uso;
- executar testes e build após cada grupo de atualização;
- registrar CVE/advisory, versão corrigida, impacto e decisão;
- pipeline bloquear novas vulnerabilidades altas sem exceção aprovada.

### P1: obrigatório antes do rollout global

#### P1-01: E2E de delivery ausente

Adicionar uma suíte dedicada, sem depender de providers públicos reais nos testes determinísticos. Usar mocks/adapters controlados para ViaCEP, geocoding, OSRM e Supabase quando necessário.

#### P1-02: rate limiting e abuso

As rotas públicas de abertura, atualização e confirmação de carrinho não possuem rate limiting específico. Um atacante pode provocar chamadas de CEP/geocoding/rota e aumentar custo ou saturar providers.

Adicionar:

- limite por IP para abertura e lookup;
- limite por token de carrinho para update/retry;
- proteção contra repetição agressiva de confirmação;
- resposta `429` com `Retry-After`;
- métricas de bloqueio;
- limites compatíveis com clientes legítimos em rede compartilhada.

#### P1-03: observabilidade insuficiente

Implementar métricas e logs estruturados sem CEP, número, endereço, latitude ou longitude do cliente.

Métricas mínimas:

- `delivery_quote_total` por status;
- `delivery_quote_latency_ms`;
- cache hit por camada: memória, Supabase, stale e provider;
- timeout por provider;
- fallback acionado por provider;
- circuito aberto/fechado;
- quantidade de solicitações pendentes;
- idade máxima da fila pendente;
- taxa de erro em janela de 5 minutos;
- taxa de pedidos bloqueados por cotação.

Alertas mínimos:

- timeout ou falha de cotação acima de 1% em cinco minutos;
- fila pendente crescendo por cinco minutos;
- provider primário e secundário indisponíveis;
- erro na gravação da fila de contingência;
- Supabase indisponível para criação/confirmação de pedido.

#### P1-04: testes de isolamento e autorização

Verificar que:

- anon não lê nem escreve tabelas internas;
- authenticated não lê nem escreve tabelas internas;
- somente `service_role` executa a RPC de salvamento;
- empresa A não acessa endereço, faixas ou fila da empresa B;
- token público de carrinho só acessa o próprio carrinho;
- rota administrativa sem sessão retorna 401;
- tentativa de trocar `empresaId` no corpo não muda o tenant efetivo.

#### P1-05: teste de carga e falha

Executar carga controlada para:

- 10, 50 e 100 cotações simultâneas do mesmo endereço;
- 10, 50 e 100 endereços diferentes;
- cache frio e cache quente;
- provider primário lento;
- provider primário fora do ar;
- provider primário e fallback fora do ar;
- Supabase indisponível durante escrita de cache;
- Supabase indisponível durante criação da fila pendente.

Critérios sugeridos:

- o checkout não fica pendurado além do deadline;
- nenhuma chamada continua viva depois do abort;
- cache writes falhos não derrubam uma cotação válida;
- falha ao criar a contingência não é silenciosamente tratada como pedido aceito;
- não há duplicação de pedido ou de solicitação idempotente.

### P2: importante, mas não bloqueia o primeiro canário

- extrair partes de `ZeloMenuCartPage.tsx`, que já possui mais de 2.200 linhas;
- adicionar visual regression para desktop e mobile;
- adicionar botão/fluxo de limpeza do cache local do cliente;
- adicionar painel operacional de saúde dos providers;
- documentar retenção e privacidade do endereço salvo em `localStorage` por 30 dias;
- validar fallback quando os tiles do mapa não carregarem;
- adicionar teste de acessibilidade do modal de cotação e dos campos estruturados.

## 5. Workstreams para os agentes

Os workstreams abaixo podem ser executados em worktrees separadas. O Workstream 1 deve terminar antes dos Workstreams 4 e 5.

### Workstream 0: baseline e contrato

**Owner:** agente coordenador/tech lead.

Arquivos principais: documentação, contratos, fixtures e scripts de teste.

Entregas:

- escolher a política de pedido pendente;
- registrar estados possíveis e transições;
- definir payload de resolução da fila;
- definir SLOs de cotação;
- criar fixtures de provider saudável, timeout, resposta inválida e fora da área;
- criar matriz de testes compartilhada.

Aceite:

- nenhum agente implementa uma interpretação diferente de `quote_pending`;
- os contratos de API e de estado estão documentados;
- os testes sabem distinguir timeout de fora da área.

### Workstream 1: contingência e fila pendente

**Owner:** agente backend + agente frontend admin.

Arquivos prováveis: `server/zelomenuDeliveryService.ts`, `server/zelomenuCartSessions.ts`, `server/index.ts`, `src/services/zelomenuAdminApi.ts`, página/componente de configurações e migration adicional se necessário.

Entregas:

- endpoint idempotente de retry;
- endpoint de resolução manual, se essa for a decisão escolhida;
- transição segura `pending -> resolved/expired/cancelled`;
- atualização do snapshot de cotação;
- UI administrativa da fila;
- indicação de idade, motivo, protocolo e ação disponível;
- proteção para não duplicar pedido;
- teste de concorrência em dois operadores.

Aceite:

- uma solicitação pendente pode ser recuperada sem acesso direto ao banco;
- o operador vê apenas a própria empresa;
- toda ação gera log com `request_id` e `quote_request_id`;
- reprocessar duas vezes produz o mesmo resultado.

### Workstream 2: providers, timeout e cache

**Owner:** agente backend/platform.

Entregas:

- adapter de CEP com fallback ou decisão documentada;
- configuração real de geocoding e routing primário/secundário;
- testes de timeout individual e deadline total;
- circuit breaker testado;
- cache stale testado e limitado à política aprovada;
- deduplicação de chamadas concorrentes para o mesmo endereço;
- teste de invalidação quando o endereço da loja muda;
- health check independente do checkout.

Aceite:

- primary timeout aciona fallback dentro do deadline;
- fallback timeout gera contingência, nunca área inválida;
- cache stale é identificado e auditável;
- distância zero é válida e aplica a primeira faixa;
- escrita de cache falha sem derrubar resultado válido.

### Workstream 3: segurança, autorização e dependências

**Owner:** agente security/platform.

Entregas:

- corrigir/justificar advisories do `npm audit`;
- adicionar rate limiting;
- confirmar validação de payloads e limites de tamanho;
- testes de RLS com anon/authenticated/service role;
- testes de isolamento por empresa;
- revisão de logs para remover PII;
- confirmar que service role e secrets nunca entram no bundle frontend;
- revisar CORS e headers de produção.

Aceite:

- nenhuma vulnerabilidade alta sem exceção aprovada;
- ataques de tenant crossing falham;
- payload malformado não provoca 500 sem rastreabilidade;
- dados de endereço não aparecem em logs de aplicação/métrica.

### Workstream 4: E2E e testes de caos

**Owner:** agente QA.

Entregas:

- Playwright desktop e mobile para delivery;
- mocks determinísticos de providers;
- teste de usuário lento digitando endereço;
- teste de loading/modal e bloqueio do CTA;
- teste de sucesso, fora da área, timeout, retry e stale;
- teste de refresh, back, duas abas e revisão de versão;
- teste de duplo clique e idempotência;
- screenshots de estados principais.

Aceite:

- a suíte roda contra ambiente local sem criar dados em produção;
- nenhum teste depende de `casadossalgados` ou de provider externo real;
- falhas de provider são reproduzíveis;
- artefatos de screenshot e trace são publicados no CI.

### Workstream 5: rollout e operação

**Owner:** agente release/DevOps.

Entregas:

- checklist de variáveis de produção;
- health check e smoke test pós-deploy;
- dashboard/alertas;
- feature flag ou ativação por empresa;
- canário com Donutopia;
- runbook de rollback;
- procedimento para fila pendente e provider degradado;
- backup/verificação antes de migrations.

Aceite:

- é possível desligar delivery por empresa sem interromper retirada;
- rollback da aplicação não apaga dados nem migrations;
- o time sabe identificar um pedido pendente e agir;
- o canário pode ser encerrado sem impacto nas outras empresas.

## 6. Matriz mínima de testes

| ID | Cenário | Resultado esperado | Prioridade |
|---|---|---|---|
| DEL-001 | CEP válido, endereço dentro da primeira faixa | taxa correta, cache registrado, CTA liberado | P0 |
| DEL-002 | CEP válido, segunda faixa | taxa da primeira faixa cujo limite atende a rota | P0 |
| DEL-003 | Distância exatamente no limite | faixa inclusiva aplicada | P0 |
| DEL-004 | Distância zero, loja e cliente no mesmo endereço | primeira faixa aplicada | P0 |
| DEL-005 | Rota acima da maior faixa | `out_of_area`, sem cobrança, sem pedido aceito | P0 |
| DEL-006 | CEP inexistente | endereço inválido, sem chamar geocoding/rota | P0 |
| DEL-007 | Usuário digitando lentamente | nenhum request parcial, nenhum toast de erro durante foco | P0 |
| DEL-008 | CEP lookup em cache L1 | não chama ViaCEP | P1 |
| DEL-009 | CEP lookup em cache Supabase | não chama provider externo | P1 |
| DEL-010 | Cache expirado dentro da janela stale | resultado identificado como stale conforme política | P1 |
| DEL-011 | Geocoding primário timeout | fallback acionado ou contingência | P0 |
| DEL-012 | Geocoding primário e fallback indisponíveis | contingência, nunca `out_of_area` | P0 |
| DEL-013 | OSRM primário timeout | fallback acionado ou contingência | P0 |
| DEL-014 | Todos os providers indisponíveis | solicitação idempotente preservada | P0 |
| DEL-015 | Retry da mesma solicitação | mesmo registro, sem duplicidade | P0 |
| DEL-016 | Operador resolve solicitação pendente | estado e snapshot atualizados de forma auditável | P0 |
| DEL-017 | Duas resoluções simultâneas | somente uma transição válida | P1 |
| DEL-018 | Duplo clique em confirmar | no máximo um pedido | P0 |
| DEL-019 | Revisão de preço durante cotação | cliente revisa total antes de concluir | P0 |
| DEL-020 | Alteração do endereço após cotação | taxa antiga invalidada e nova cotação obrigatória | P0 |
| DEL-021 | Atualização do endereço da loja | cache de rota antigo não é reutilizado | P1 |
| DEL-022 | Loja sem geocoding | delivery desabilitado, retirada continua funcionando | P0 |
| DEL-023 | Empresa A tentando acessar empresa B | 401/403 e nenhum dado vazado | P0 |
| DEL-024 | Anon lendo tabelas internas | acesso negado por RLS | P0 |
| DEL-025 | Modal mobile | bloqueia avanço sem cobrir ou perder os controles essenciais após conclusão | P1 |
| DEL-026 | Fallback de imagem de produto | ícone SVG, sem emoji dependente de plataforma | P2 |

## 7. Checklist de segurança e privacidade

- [ ] Service role ausente do bundle frontend.
- [ ] RPC de salvamento executável somente por `service_role`.
- [ ] Tabelas de cache e fila inacessíveis por anon/authenticated.
- [ ] Empresa derivada da sessão autenticada, nunca aceita como autoridade do body.
- [ ] Token público não permite enumerar sessões.
- [ ] Request body limitado e validado.
- [ ] Rate limiting aplicado às rotas públicas de cart e lookup.
- [ ] Logs não contêm CEP, número, endereço, latitude ou longitude do cliente.
- [ ] `localStorage` do cliente documentado como cache de conveniência com TTL de 30 dias.
- [ ] Política de retenção da fila pendente definida.
- [ ] Dados de provider e mensagens externas não são devolvidos diretamente ao cliente.
- [ ] Dependências de runtime e build auditadas.

## 8. Checklist de produção

### Configuração

- [ ] `SUPABASE_SERVICE_ROLE_KEY` configurada somente no backend.
- [ ] `DELIVERY_PROVIDER_TIMEOUT_MS` revisada com base no SLA.
- [ ] `DELIVERY_TOTAL_DEADLINE_MS` compatível com UX e infraestrutura.
- [ ] Provider de CEP primário e secundário definidos.
- [ ] Geocoding primário e fallback definidos.
- [ ] Routing primário e fallback definidos.
- [ ] `GEOCODING_USER_AGENT` identifica a aplicação corretamente.
- [ ] limites/rate limits dos providers contratados documentados.
- [ ] tile provider do mapa admin configurado com atribuição válida.

### Banco

- [x] migrations aplicadas no projeto correto;
- [x] `supabase migration list --linked` alinhado;
- [x] `supabase db lint --linked` revisado;
- [x] RLS validada em ambiente remoto;
- [ ] índices e constraints verificados;
- [ ] backup ou ponto de restauração confirmado;
- [ ] retenção/limpeza da fila pendente agendada.

### Operação

- [ ] health check básico funcionando;
- [ ] health check de providers separado do checkout;
- [ ] alertas configurados;
- [ ] logs com `request_id` e `quote_request_id`;
- [ ] dashboard de latência, cache, timeout e fallback;
- [ ] runbook de provider degradado;
- [ ] runbook de fila pendente;
- [ ] contato responsável por Supabase, CEP, geocoding e routing.

## 9. Plano de rollout

### Fase 0: staging

- Aplicar migrations em staging.
- Executar a matriz DEL-001 a DEL-026.
- Simular provider primário fora do ar.
- Confirmar que o fallback não cria pedido com taxa zero.
- Confirmar que retirada continua disponível.

### Fase 1: canário Donutopia

- Ativar somente para a empresa de teste Donutopia.
- Testar endereço conhecido dentro da primeira faixa.
- Testar segundo endereço dentro da segunda faixa.
- Testar endereço fora da área.
- Testar erro/timeout controlado.
- Confirmar logs, métricas, fila e ausência de duplicidade.
- Observar por pelo menos um ciclo operacional completo.

### Fase 2: expansão gradual

- 5% das empresas com delivery habilitado.
- 25% após métricas estáveis.
- 100% somente após fechamento dos alertas e da fila operacional.

Critérios para interromper expansão:

- taxa de timeout acima de 1% em cinco minutos;
- aumento de pedidos pendentes sem resolução;
- qualquer pedido duplicado;
- qualquer cobrança/Pix com frete desconhecido;
- qualquer vazamento de tenant ou PII;
- qualquer falha que afete retirada.

## 10. Rollback

O rollback deve ser reversível e não destrutivo:

1. desabilitar delivery por empresa/feature flag;
2. manter retirada funcionando;
3. preservar sessões e solicitações pendentes;
4. pausar o worker de reprocessamento, se existir;
5. reverter aplicação somente após preservar logs e request IDs;
6. não remover migrations nem apagar tabelas de cache/fila;
7. comunicar a operação sobre solicitações pendentes;
8. reabrir rollout somente após reproduzir e corrigir a causa.

> Nota de execução: migration, RLS/isolamento e rollback reversível por empresa
> já foram concluídos. O DoD ainda depende do canário funcional e do rollback
> da aplicação no Dokploy.

## 11. Definition of Done para liberar produção

### Obrigatório

- [ ] decisão de produto sobre pedido pendente registrada;
- [ ] fila pendente possui fluxo completo de recuperação;
- [ ] provider primário/secundário de cada etapa definido;
- [ ] vulnerabilidades altas triadas e tratadas;
- [ ] E2E de delivery passando em desktop e mobile;
- [ ] testes de timeout, fallback e duplicidade passando;
- [ ] RLS e isolamento de tenant validados remotamente;
- [ ] rate limiting aplicado;
- [ ] métricas e alertas ativos;
- [ ] canário Donutopia concluído;
- [ ] rollback ensaiado.

### Pode ficar para depois do canário

- [ ] refatoração estrutural da página de carrinho;
- [ ] isócronas reais no mapa admin;
- [ ] melhorias de observabilidade não relacionadas a delivery;
- [ ] visual regression completa em todos os breakpoints.

## 12. Ordem recomendada para os agentes

1. **Agente coordenador:** fechar decisão de produto e contratos de estado.
2. **Agente backend:** implementar resolução/retry da contingência.
3. **Agente security/platform:** tratar dependências, rate limiting e RLS.
4. **Agente providers:** configurar/testar fallback e observabilidade.
5. **Agente QA:** criar E2E e testes de caos.
6. **Agente frontend admin:** exibir e operar a fila pendente.
7. **Agente release:** staging, canário, métricas e rollback.

Não liberar o rollout global enquanto qualquer item P0 permanecer aberto.
