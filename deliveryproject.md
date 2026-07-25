# Delivery por distância

## Status

### Implementacao consolidada

A branch principal agora concentra cache L1/L2, deadline total de 6 segundos, fallback configuravel de geocoding/rota, circuit breaker, cache stale limitado a 30 dias, hash HMAC de endereco e RLS restritiva. A configuracao do admin e salva em uma transacao Supabase unica.

Quando a cotacao nao pode ser concluida, o checkout nao usa preco legado por bairro e nao materializa pedido, Pix ou estoque: cria uma solicitacao pendente idempotente com snapshot do cliente, carrinho, endereco e pricing para recuperacao operacional.

Validacoes locais executadas: `npm run typecheck`, `npm run build` e `npm test`.

Especificação revisada. A solução é viável, desde que o cálculo seja executado no backend, o pedido guarde um snapshot da decisão e os serviços públicos sejam tratados como dependências substituíveis.

## Requisito Tier S

Tier S, neste contexto, não significa que um serviço externo nunca ficará indisponível. Significa que a indisponibilidade de um provedor não poderá:

- travar indefinidamente o checkout;
- transformar a taxa em zero;
- marcar um endereço como fora da área sem evidência;
- duplicar um pedido;
- apagar a intenção de compra do cliente;
- impedir a empresa de recuperar e concluir a cotação.

O checkout deverá priorizar, nesta ordem:

1. resultado válido em cache local;
2. resultado válido no cache persistente do Supabase;
3. provedor primário com deadline controlado;
4. provedor secundário ou infraestrutura própria;
5. cache stale explicitamente identificado, quando a política de validade permitir;
6. registro idempotente de pedido pendente de cotação, sem cobrança automática.

Não será permitido depender de uma única chamada externa síncrona para aceitar ou perder um pedido.

## Objetivo

Substituir o cálculo de entrega baseado em bairros por um cálculo baseado na distância real percorrida entre a loja e o endereço do cliente.

O lojista configurará:

- o endereço principal da loja;
- as faixas máximas de distância;
- o valor de cada faixa;
- se a entrega está habilitada.

O cliente informará:

- CEP;
- número;
- complemento opcional.

O sistema preencherá os demais dados do endereço, calculará a rota e aplicará o valor do frete automaticamente.

## Regras de negócio

1. A distância usada para cobrança será a distância percorrida pela rota de carro, em metros. Distância em linha reta não será usada para definir elegibilidade ou preço.

2. Uma faixa será elegível quando:

   `distância_da_rota <= distância_máxima_da_faixa`

3. As faixas serão ordenadas pela distância máxima. A primeira faixa que atender à distância será aplicada.

4. A maior distância configurada será o limite máximo de atendimento. Se nenhuma faixa atender, o pedido ficará fora da área.

5. Pedido fora da área só poderá ser recusado quando houver uma distância de rota válida acima da maior faixa. Erro de geocoding, erro de rota ou indisponibilidade do provedor não provam que o endereço está fora da área.

6. O bairro continuará existindo como parte informativa do endereço retornado pelo ViaCEP e poderá ser exibido no pedido. Ele não será usado para configurar preço, validar cobertura ou permitir seleção manual.

7. O valor da taxa será calculado e revalidado exclusivamente pelo backend. O frontend nunca será fonte confiável para distância, elegibilidade ou preço.

8. A decisão de entrega deverá ser revalidada no momento da confirmação do pedido. O pedido confirmado deverá manter o resultado que foi efetivamente cobrado, mesmo que a configuração da loja mude depois.

9. Se não existir cotação válida e todos os provedores estiverem indisponíveis, o cliente poderá optar por enviar um pedido pendente de cotação. Esse registro deverá preservar carrinho, cliente e endereço, não deverá gerar cobrança nem Pix com valor incompleto e deverá ficar visível para a empresa concluir manualmente ou solicitar nova cotação.

## Escopo da migração

O sistema atual calcula o frete por bairro em `delivery_config`, permite edição manual do bairro no checkout e materializa apenas endereço, bairro e taxa no pedido.

A migração deverá substituir:

- cadastro de bairros como regra de preço;
- taxa por bairro;
- validação de cobertura por bairro;
- seleção manual de bairro pelo cliente;
- estado de “entrega a confirmar” baseado em bairro desconhecido.

O bairro não deve ser apagado dos pedidos históricos. Ele apenas deixa de ser uma dimensão de preço.

## Endereço da loja

### Entrada do lojista

Campos editáveis:

- CEP;
- número;
- complemento opcional.

Ao informar um CEP válido, o backend ou a camada de serviço deverá consultar o ViaCEP e preencher:

- logradouro;
- bairro;
- cidade;
- estado;
- CEP normalizado.

O lojista ainda poderá corrigir o número e o complemento. Logradouro, bairro, cidade e estado deverão ser exibidos como dados derivados do CEP, não como campos livres de cobertura.

Depois do preenchimento, o endereço completo será geocodificado. A loja só poderá habilitar entrega se possuir latitude e longitude válidas.

### Dados persistidos da loja

Adicionar ou adaptar os campos da empresa para persistir:

- `delivery_postal_code`;
- `delivery_number`;
- `delivery_complement`;
- `delivery_street`;
- `delivery_neighborhood`;
- `delivery_city`;
- `delivery_state`;
- `delivery_latitude`;
- `delivery_longitude`;
- `delivery_location_version` ou hash equivalente.

O campo legado `endereco` deverá ser preservado durante a migração para não quebrar outras telas ou integrações. Depois da migração, o endereço estruturado será a fonte de verdade para entrega.

## Endereço do cliente

### Fluxo

1. O cliente informa o CEP.
2. O sistema consulta o ViaCEP.
3. O sistema preenche logradouro, bairro, cidade e estado.
4. O cliente informa o número e, opcionalmente, o complemento.
5. O cliente não pode editar logradouro, bairro, cidade ou estado derivados do CEP.
6. O backend normaliza o endereço e calcula ou recupera suas coordenadas.
7. O backend calcula ou recupera a distância da rota entre loja e cliente.
8. O backend encontra a faixa aplicável e atualiza o total do pedido.

### Dados do endereço no pedido

O pedido deverá guardar uma cópia do endereço usado no cálculo:

- CEP;
- número;
- complemento;
- logradouro;
- bairro;
- cidade;
- estado;
- latitude;
- longitude;
- distância da rota em metros;
- faixa aplicada;
- taxa aplicada;
- identificador/versão da origem da loja usada no cálculo.

Isso evita que um pedido antigo seja alterado quando o lojista mudar o endereço ou as faixas.

## Serviços externos

### ViaCEP

Responsável por obter o endereço a partir do CEP.

- Base URL: `https://viacep.com.br`
- Endpoint: `/ws/{CEP}/json/`
- Autenticação: não requer.
- O CEP deverá ser normalizado para oito dígitos antes da consulta.
- Respostas com `erro: true` deverão gerar `ADDRESS_INVALID`.

### Nominatim / OpenStreetMap

Responsável pela geocodificação do endereço.

- Base URL configurável por `GEOCODING_BASE_URL`.
- Deve ser chamado somente pelo backend.
- Toda requisição deverá enviar um `User-Agent` identificando a aplicação.
- A aplicação deverá usar cache, limitar a no máximo uma requisição por segundo e permitir troca futura de provedor.
- O endereço completo do cliente não deverá ser gravado em logs.
- O uso do endpoint público deve ser considerado adequado apenas para baixo volume e após validação de privacidade. A política do Nominatim limita o uso a 1 requisição por segundo, exige identificação da aplicação e recomenda proxy/cache: https://operations.osmfoundation.org/policies/nominatim/.
- Para produção com volume relevante, usar provedor comercial com tratamento adequado de dados ou uma instância própria.

O resultado só será aceito se:

- possuir latitude e longitude numéricas;
- estiver no Brasil;
- for compatível com cidade e estado retornados pelo ViaCEP;
- não estiver claramente distante do endereço informado.

Como o geocoding pode retornar a rua ou o centro do CEP em vez do número exato, o sistema deverá tratar a precisão do resultado como uma limitação conhecida. Endereços sem resultado confiável não poderão ser confirmados automaticamente.

### OSRM

Responsável pelo cálculo da rota.

- Base URL configurável por `OSRM_BASE_URL`.
- Perfil: `driving`.
- Formato: `{longitude},{latitude};{longitude},{latitude}`.
- Usar o endpoint `/route/v1/driving/...` com `overview=false`.
- Aceitar somente resposta HTTP válida com `code: "Ok"` e distância numérica.
- Usar `routes[0].distance`, em metros.
- `NoRoute`, `NoSegment`, timeout ou resposta inválida deverão gerar erro tratável, sem concluir o pedido.
- Não usar parâmetros de fallback que estimem distância em linha reta.

Documentação da API: https://project-osrm.org/docs/v5.24.0/api/.

O endpoint público do OSRM deverá ser considerado substituível. A aplicação deverá funcionar com uma URL própria ou outro provedor sem alteração do domínio de negócio.

## Variáveis de ambiente

Adicionar ao `.env.example`:

```env
VIACEP_BASE_URL=https://viacep.com.br
GEOCODING_BASE_URL=https://nominatim.openstreetmap.org
GEOCODING_PROVIDER=nominatim
GEOCODING_USER_AGENT=ZeloMenu/1.0 (contato@zelopdv.com.br)
OSRM_BASE_URL=https://router.project-osrm.org
DELIVERY_PROVIDER_TIMEOUT_MS=2500
DELIVERY_TOTAL_DEADLINE_MS=6000
GEOCODING_MIN_INTERVAL_MS=1000
DELIVERY_CACHE_TTL_DAYS=7
DELIVERY_STALE_MAX_DAYS=30
GEOCODING_FALLBACK_PROVIDER=arcgis
GEOCODING_FALLBACK_BASE_URL=https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer
OSRM_FALLBACK_BASE_URL=
```

O `User-Agent` real deve usar um contato válido da aplicação. Segredos, quando necessários para um provedor futuro, nunca deverão ser enviados ao frontend.

## Cache Tier S e orçamento de latência

### Camadas de cache

O cache deverá ser consultado antes de qualquer chamada externa, inclusive na rota administrativa de geocodificação da loja. Ao voltar para um CEP + número já resolvido, a configuração deve reutilizar as coordenadas persistidas sem repetir a chamada externa:

- **L1 — memória do processo:** cache LRU pequeno, com expiração curta, para endereços mais acessados. É apenas otimização; não é fonte de verdade e pode ser perdido ao reiniciar ou escalar horizontalmente.
- **L2 — Supabase:** cache persistente compartilhado entre instâncias do backend e entre usuários. Deve ser acessado exclusivamente pelo backend com `service_role`.
- **L3 — provedor externo:** somente em cache miss ou quando o registro persistente estiver inválido.

O resultado da cotação deverá ser salvo no Supabase assim que for obtido, mesmo que o cliente abandone o checkout. Assim, o próximo pedido para o mesmo endereço poderá reutilizar o resultado.

O cache compartilhável não será baseado apenas na cidade:

- resposta do ViaCEP: chave por CEP normalizado;
- geocoding: chave por endereço exato normalizado, no mínimo CEP + número;
- rota: chave por empresa, versão das coordenadas da loja e destino exato.

Endereços diferentes na mesma cidade não podem compartilhar distância de rota. A mesma coordenada de destino pode compartilhar geocoding, mas nunca pode compartilhar a distância entre lojas diferentes.

### Concorrência e idempotência do cache

Para impedir que dez clientes consultando o mesmo endereço gerem dez chamadas externas simultâneas:

- usar chave única no Supabase;
- usar `upsert` idempotente;
- deduplicar requisições em andamento no processo;
- aceitar que apenas uma requisição seja a vencedora da gravação;
- fazer os demais consumidores relerem o resultado persistido;
- aplicar backoff limitado somente para erros transitórios.

O cache nunca deverá gravar uma resposta parcial como se fosse uma cotação válida.

### Validade e cache stale

Cada camada deverá guardar `created_at`, `updated_at`, provedor e versão da origem.

Valores iniciais configuráveis:

- CEP: 30 dias;
- geocoding: 30 dias;
- rota: 7 dias;
- cache stale de rota: até 30 dias, somente quando a empresa e o destino forem os mesmos e a versão da origem não tiver mudado;
- erro transitório: 30 segundos de backoff;
- endereço sem resultado: 15 minutos antes de nova tentativa.

Uma cotação stale deverá ser marcada no snapshot e na auditoria. Se a origem da loja mudar, nenhuma cotação antiga dessa loja poderá ser usada, mesmo que ainda esteja dentro do TTL.

### Orçamento de latência

O frontend não deverá consultar serviços a cada tecla digitada. A cotação será disparada somente quando:

- o CEP tiver oito dígitos válidos;
- o número estiver preenchido;
- o usuário sair do campo ou avançar no checkout.

Metas de experiência:

- cache L1: até 50 ms;
- cache Supabase: até 300 ms no p95;
- cotação com cache miss: até 3 s no p95;
- deadline total da cotação: 6 s;
- nenhuma chamada poderá ficar pendurada indefinidamente.

Uma medição pontual feita em ambiente de desenvolvimento em 25/07/2026 observou aproximadamente 534 ms no ViaCEP, 65 ms no Nominatim e 672 ms no OSRM. Esses valores servem apenas como referência de smoke test; não são SLA e deverão ser substituídos por métricas de produção.

O deadline é um mecanismo de proteção, não uma falha do pedido. Ao atingir o limite, o sistema deverá usar o próximo nível da estratégia Tier S ou criar o registro pendente de cotação. Nunca deverá retornar erro genérico sem preservar a intenção de compra.

### Alta disponibilidade dos provedores

Para atingir Tier S real em produção, o endpoint público do Nominatim e o endpoint público do OSRM não podem ser as únicas opções. Configurar:

- provedor primário;
- provedor secundário compatível;
- possibilidade de usar instância própria;
- health check independente do checkout;
- circuit breaker por provedor;
- alertas de latência, erro e aumento de cache miss.

O circuit breaker deverá abrir após falhas consecutivas e enviar novas cotações diretamente para o fallback, sem esperar o timeout completo de cada tentativa.

## Arquitetura técnica

### Frontend

O frontend deverá:

- consultar o ViaCEP através de uma API própria ou serviço de backend;
- mostrar os campos derivados como somente leitura;
- mostrar estado de carregamento durante geocoding e roteamento;
- exibir a taxa e a distância calculadas pelo servidor;
- bloquear confirmação somente quando o endereço estiver fora da área com rota válida;
- oferecer tentativa novamente ou “enviar para cotação” quando o provedor estiver indisponível;
- mostrar claramente quando a cotação veio de cache stale;
- nunca calcular ou aceitar taxa enviada pelo cliente como valor final.

### Backend

Criar um serviço de domínio para entrega, separado da sessão de carrinho, com responsabilidades de:

- normalizar CEP, número e complemento;
- consultar o ViaCEP;
- geocodificar a loja e o cliente;
- calcular a chave do cache;
- recuperar ou criar cache de CEP, geocoding e distância;
- consultar o OSRM quando necessário;
- selecionar a faixa;
- retornar estados e erros padronizados;
- revalidar o resultado no checkout;
- aplicar deadline, retry limitado, circuit breaker e fallback;
- criar pedido pendente de cotação de forma idempotente quando não houver rota disponível.

O backend deverá aplicar timeout e não poderá depender de chamadas externas durante todo acesso de leitura se já existir resultado válido em cache.

O serviço deverá receber um `AbortSignal` ou deadline explícito. Nenhum `fetch` poderá permanecer aberto sem limite de tempo e nenhuma exceção de provedor poderá escapar como `500` genérico sem código operacional.

Erros mínimos:

- `DELIVERY_DISABLED`;
- `STORE_ADDRESS_NOT_CONFIGURED`;
- `ADDRESS_INVALID`;
- `ADDRESS_GEOCODING_FAILED`;
- `ROUTE_NOT_FOUND`;
- `DELIVERY_PROVIDER_UNAVAILABLE`;
- `DELIVERY_OUT_OF_AREA`;
- `DELIVERY_CONFIGURATION_INVALID`.

## Banco de dados

### Faixas de entrega

Criar uma tabela, por exemplo `zelomenu_delivery_ranges`:

| Campo | Regra |
|---|---|
| `id` | chave primária |
| `company_id` | empresa proprietária |
| `max_distance_m` | inteiro positivo |
| `delivery_price` | valor monetário maior ou igual a zero |
| `created_at` | data de criação |
| `updated_at` | data de atualização |

Restrições:

- índice por `company_id` e `max_distance_m`;
- distância máxima sem duplicidade dentro da mesma empresa;
- configuração validada e ordenada antes de ser ativada;
- pelo menos uma faixa para habilitar entrega.

A interface poderá exibir quilômetros, mas o domínio deverá comparar e persistir a distância em metros para evitar ambiguidades de arredondamento.

### Cache persistente

Os caches deverão ser tabelas internas, com RLS bloqueando acesso público e leitura/escrita somente pelo backend com `service_role`.

#### Cache de CEP

Criar `zelomenu_delivery_cep_cache`:

| Campo | Regra |
|---|---|
| `postal_code` | oito dígitos, chave primária |
| `street` | logradouro retornado |
| `neighborhood` | bairro retornado |
| `city` | cidade retornada |
| `state` | UF retornada |
| `provider` | provedor usado |
| `expires_at` | validade do resultado |
| `created_at` | data de criação |
| `updated_at` | data da última atualização |

Esse cache não depende de empresa ou usuário e pode ser reutilizado por todos os pedidos para o mesmo CEP.

#### Cache de geocoding

Criar `zelomenu_delivery_geocoding_cache`:

| Campo | Regra |
|---|---|
| `id` | chave primária |
| `address_hash` | HMAC-SHA-256 de CEP + número normalizados |
| `postal_code` | CEP normalizado |
| `number` | número normalizado |
| `latitude` | coordenada validada |
| `longitude` | coordenada validada |
| `provider` | provedor usado |
| `provider_payload_hash` | hash do payload validado, sem dados pessoais brutos |
| `expires_at` | validade do resultado |
| `created_at` | data de criação |
| `updated_at` | última atualização |

Restrições:

- chave única em `(address_hash, provider)`;
- usar HMAC com segredo do servidor, nunca hash simples de CEP e número;
- não salvar complemento quando ele não alterar a posição do imóvel;
- não expor o hash nem o payload bruto ao cliente;
- permitir trocar a política para chave por empresa se a análise de privacidade exigir isolamento entre empresas.

#### Cache de rota

Criar `zelomenu_delivery_distance_cache`:

| Campo | Regra |
|---|---|
| `id` | chave primária |
| `company_id` | empresa proprietária |
| `destination_address_hash` | referência ao endereço normalizado |
| `origin_location_version` | versão/hash das coordenadas da loja |
| `latitude` | coordenada do cliente usada na rota |
| `longitude` | coordenada do cliente usada na rota |
| `distance_m` | distância retornada pelo OSRM |
| `geocoding_provider` | provedor do destino |
| `routing_provider` | provedor da rota |
| `is_stale` | indica uso fora do TTL normal |
| `expires_at` | validade normal |
| `created_at` | data de criação |
| `updated_at` | data da última atualização |

Restrições e decisões:

- chave única em `(company_id, destination_address_hash, origin_location_version)`;
- alterar a versão da origem sempre que as coordenadas da loja mudarem;
- permitir invalidação manual do cache por empresa;
- nunca usar rota de outra empresa, mesmo que seja a mesma cidade;
- não expor `destination_address_hash` ao cliente.

Cache miss, upsert simultâneo e reprocessamento deverão ser seguros contra duplicidade. Respostas de erro deverão ter TTL curto separado e nunca ocupar o lugar de uma cotação válida.

### Pedidos e sessão de carrinho

Estender o snapshot de `fulfillment` da sessão para incluir o endereço estruturado e o resultado do cálculo.

Atualizar a função transacional de confirmação para persistir, no pedido final:

- endereço estruturado;
- coordenadas;
- distância;
- taxa;
- faixa;
- versão da origem.

O preço final deverá continuar sendo calculado e gravado dentro da transação de confirmação, usando o resultado revalidado pelo backend.

### Pedido pendente de cotação

Criar estado explícito para contingência, por exemplo `delivery_quote_pending`.

Esse estado deverá:

- ser criado com chave idempotente;
- guardar cliente, carrinho, endereço estruturado e motivo técnico;
- não reservar estoque de forma irreversível;
- não gerar Pix nem cobrar um total sem taxa confirmada;
- aparecer para a empresa em uma fila de atendimento;
- permitir nova cotação sem o cliente redigitar os dados;
- registrar quem e quando concluiu a cotação;
- expirar/arquivar automaticamente após prazo configurável.

Se o cliente já tiver clicado em confirmar e o provedor cair, a resposta deverá informar que a solicitação foi preservada e fornecer um identificador de acompanhamento. Repetir o clique com a mesma chave idempotente deverá retornar o mesmo registro, nunca criar outro pedido.

## Contrato de resposta

O payload público deverá deixar de retornar `deliveryNeighborhoods` como configuração de preço e passar a retornar algo equivalente a:

```ts
delivery: {
  enabled: boolean;
  ranges: Array<{
    maxDistanceM: number;
    price: number;
  }>;
}
```

O snapshot do carrinho deverá conter algo equivalente a:

```ts
fulfillment: {
  type: 'pickup' | 'delivery';
  address: {
    postalCode: string | null;
    number: string | null;
    complement: string | null;
    street: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  distanceM: number | null;
  deliveryFee: number;
  deliveryStatus: 'not_applicable' | 'pending' | 'eligible' | 'eligible_stale' | 'out_of_area' | 'unavailable' | 'quote_pending';
  cacheLayer: 'none' | 'memory' | 'supabase' | 'provider' | 'stale' | null;
  quoteRequestId: string | null;
}
```

Os nomes podem ser adaptados ao padrão existente, mas o contrato deve separar endereço informativo de decisão de preço.

## Fluxo de falhas

### CEP inválido ou inexistente

- não geocodificar;
- não chamar OSRM;
- informar que o CEP precisa ser corrigido.

### Geocoding sem resultado confiável

- não aplicar taxa;
- não permitir confirmação;
- permitir corrigir CEP ou número.

### Rota inexistente ou provedor indisponível

- não aplicar taxa zero;
- não classificar o endereço como fora da área;
- consultar fallback e cache stale conforme a política definida;
- se não houver rota disponível, preservar a solicitação como `delivery_quote_pending`;
- não gerar cobrança ou Pix sem taxa confirmada;
- registrar erro técnico, latência, provedor e request id sem registrar endereço completo;
- mostrar ao cliente uma confirmação explícita de que a solicitação foi preservada.

O erro de timeout deverá ser convertido em estado operacional conhecido. Nunca retornar `500 INTERNAL_ERROR` depois que a intenção de compra já tiver sido recebida sem antes verificar se o registro idempotente de contingência foi criado.

### Falha do Supabase

- o cache L1 poderá atender somente leituras já conhecidas;
- nenhuma gravação de pedido poderá ser considerada concluída sem confirmação transacional do banco;
- se a gravação do pedido não puder ser confirmada, exibir falha recuperável e manter a chave idempotente para repetição segura;
- não afirmar ao cliente que o pedido foi recebido apenas porque a requisição HTTP chegou ao servidor;
- alertar imediatamente quando a disponibilidade do Supabase afetar criação, confirmação ou fila de contingência.

### Distância acima da maior faixa

- retornar `DELIVERY_OUT_OF_AREA`;
- exibir “Este endereço está fora da área de entrega”;
- bloquear confirmação.

Esse bloqueio só é válido quando `distance_m` vier de uma rota válida e auditável. Timeout ou ausência de resposta não podem produzir `DELIVERY_OUT_OF_AREA`.

## Observabilidade e operação

Registrar métricas por empresa e por provedor, sem endereço bruto:

- total de cotações;
- acertos L1, Supabase, provedor e cache stale;
- cache miss;
- p50, p95 e p99 de cada etapa;
- timeout, HTTP 4xx, HTTP 5xx e erro de parsing;
- acionamento de fallback;
- pedidos pendentes de cotação;
- pedidos duplicados evitados por idempotência;
- erro de gravação ou confirmação no Supabase.

Alertas mínimos:

- p95 acima do orçamento por cinco minutos;
- taxa de timeout acima de 1% em cinco minutos;
- circuit breaker aberto;
- falha de criação de pedido pendente;
- divergência entre cotação apresentada e snapshot confirmado.

O health check dos provedores deverá ser separado do fluxo de pedido. Health check degradado deve abrir o circuit breaker, mas nunca deve excluir ou alterar pedidos existentes.

O log deverá conter `request_id`, `quote_request_id`, provedor, status, duração e camada de cache. Não deverá conter CEP completo, número, endereço, latitude ou longitude do cliente.

## Compatibilidade e rollout

1. Adicionar variáveis de ambiente e executar testes de conectividade.
2. Criar migrações de endereço, faixas, cache e snapshot do pedido.
3. Criar o serviço de entrega com testes unitários e provedores mockáveis.
4. Configurar provedor secundário, circuit breaker, cache stale e fila de pedido pendente.
5. Executar teste de carga, teste de falha, teste de timeout e teste de duplicidade antes do rollout.
6. Implementar leitura das novas faixas sem remover imediatamente o legado.
7. Implementar configuração do endereço e das faixas no painel do lojista.
8. Implementar o novo checkout por CEP e número.
9. Atualizar API, sessão, confirmação, mensagem de WhatsApp e telas de pedido.
10. Migrar ou desativar a configuração por bairro.
11. Remover o código legado somente depois de validar que nenhuma integração ainda depende dele.

Durante o rollout, lojas sem endereço geocodificado deverão permanecer com entrega desabilitada, mas continuar funcionando para retirada. A ativação global só poderá ocorrer após demonstrar que a fila de pedido pendente funciona quando todos os provedores externos são desligados.

## Testes obrigatórios

### Domínio

- faixa ordenada corretamente;
- limite exato da faixa é aceito;
- distância acima da última faixa é recusada;
- faixas duplicadas ou inválidas são rejeitadas;
- cálculo de preço usa metros e arredondamento monetário correto;
- cache muda quando a origem da loja muda;
- complemento não altera indevidamente a chave da rota.

### Provedores

- ViaCEP válido;
- ViaCEP inexistente;
- timeout;
- resposta malformada;
- Nominatim sem resultado;
- Nominatim fora do estado/cidade esperados;
- OSRM com `Ok`;
- OSRM com `NoRoute` ou `NoSegment`;
- OSRM retornando distância inválida.

### Cache e resiliência

- cache L1 atende sem chamar a rede;
- cache Supabase atende depois de reiniciar o processo;
- usuários diferentes reutilizam o mesmo cache de CEP;
- o mesmo endereço em empresas diferentes não reutiliza distância de rota;
- duas cotações simultâneas geram no máximo uma chamada externa efetiva;
- upsert concorrente não cria linhas duplicadas;
- TTL expirado atualiza sem indisponibilizar uma cotação stale permitida;
- alteração da localização da loja invalida a rota anterior;
- provedor primário em timeout aciona fallback dentro do deadline total;
- todos os provedores indisponíveis criam solicitação pendente idempotente;
- mesma chave idempotente retorna o mesmo pedido pendente;
- falha do Supabase não produz confirmação falsa;
- circuit breaker evita repetir chamadas lentas para provedor fora do ar;
- métricas registram cache hit, cache miss, latência, timeout e fallback.

### Checkout

- endereço elegível aplica a taxa correta;
- endereço fora da área bloqueia confirmação;
- alteração de faixa entre prévia e confirmação é revalidada;
- o cliente não consegue forjar taxa, distância ou coordenadas;
- o pedido confirmado preserva o snapshot calculado;
- retirada não chama geocoding nem OSRM.

### E2E

- configuração do endereço da loja;
- configuração das faixas;
- checkout com CEP válido;
- checkout fora da área;
- indisponibilidade temporária de provedor;
- pedido pendente preservado durante indisponibilidade;
- repetição do clique após timeout sem duplicar o pedido;
- compatibilidade de pedidos antigos.

## Critérios de aceite

O projeto estará concluído quando:

- nenhuma regra nova de preço depender do bairro;
- o endereço da loja estiver geocodificado antes de habilitar entrega;
- pedidos com cobrança/confirmados aceitarem somente endereço com geocoding e rota válidos;
- falhas de provedor criarem, quando escolhido pelo cliente, uma solicitação pendente idempotente;
- o frete for calculado por distância de rota no backend;
- pedidos fora da maior faixa não puderem ser confirmados;
- a confirmação revalidar o preço dentro da transação;
- o pedido guardar endereço, distância, faixa e taxa aplicados;
- cache L1/L2, TTL e versão da origem impedirem chamadas desnecessárias e resultados obsoletos;
- nenhuma chamada externa ficar pendurada além do deadline total;
- circuit breaker e fallback evitarem que uma indisponibilidade isolada interrompa o checkout;
- nenhum clique repetido criar pedidos duplicados;
- métricas e alertas permitirem detectar degradação antes de churn;
- os provedores puderem ser trocados por configuração;
- os testes de domínio, integração e E2E relevantes estiverem passando;
- a configuração legada por bairro puder ser removida sem quebrar pedidos históricos.
