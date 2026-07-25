# Redesign de Configurações do admin — aba Entrega

> **Para agentes de implementação:** este plano descreve o redesign da página de Configurações do ZeloMenu com base na referência visual fornecida pelo produto. A implementação deve seguir as tarefas em ordem e manter o comportamento atual das abas existentes.

**Objetivo:** transformar a página de Configurações do admin em um workspace com abas — Pedidos online, Pagamento via Pix, Cupons de desconto e Entrega — adicionando uma aba de entrega visualmente próxima da referência, com endereço da loja, faixas por distância, visualização da área e salvamento seguro.

**Referências visuais:**

- Desktop: `C:\Users\Vinicius\AppData\Local\Temp\orca-paste-1784987920553-38f2d456-f3cd-4302-a1c9-f79eb7150a26.png`
- Mobile: `C:\Users\Vinicius\Downloads\5e690ee3-026d-482a-a8d5-d4bb655de4be.png`

As referências mobile representam dois estados do mesmo fluxo, não duas páginas concorrentes: (1) a visão geral de Configurações, com cards-resumo empilhados; (2) a tela dedicada de configuração de Entrega, aberta pelo CTA `Configurar entrega`.

**Arquitetura:** `SettingsPage` passa a ser o shell das configurações. As configurações existentes continuam encapsuladas em seus componentes atuais; a nova aba Entrega será composta por um formulário de endereço, editor de faixas e preview de cobertura. O mapa é uma visualização auxiliar e nunca poderá bloquear o salvamento ou o checkout.

**Stack:** React 19 + TypeScript + Tailwind v4 + Lucide + Express + Supabase. Reutilizar os tokens existentes em `src/index.css` e as regras de `DESIGN.md`.

## Estado da implementação

Implementação consolidada na branch principal. Sprints 0–3 estão implementados no frontend e no backend; o hardening Tier S inclui deadline, cache stale, fallback de provedores, circuit breaker, cotação pendente idempotente e suíte Vitest separada dos E2E. O Sprint 4 permanece para QA visual integrado, autenticação e validação no Supabase antes do rollout. O preview agora tem uma primeira camada de mapa geográfico real; as isócronas viárias permanecem no Sprint 5.

- Frontend iniciado na worktree Orca `C:\Users\Vinicius\orca\workspaces\zelomenu\delivery-frontend`, branch `kdo-vini/delivery-frontend`.
- Sprint 0 concluído no frontend: tipos, contrato de rotas/hash, client API com timeout e helpers de validação.
- Sprint 1 concluído no frontend: visão geral mobile com cards-resumo, abas/âncoras e CTA `Configurar entrega`.
- Sprint 2 concluído no frontend: tela dedicada com endereço, faixas, preview, back, draft, dirty state e save bar.
- Sprint 3 parcialmente concluído no frontend: adapter das chamadas de CEP/geocoding/salvamento e fallback visual estão prontos; integração final depende do contrato implementado na worktree backend `delivery-by-distance`.
- Sprint 4 pendente de QA visual integrado com autenticação e backend.

## Direção visual escolhida

### Leitura da referência

A referência estabelece uma linguagem de painel operacional:

- sidebar branca fixa, com marca e navegação vertical;
- canvas quase branco, com muito espaço negativo;
- título de página com ícone lilás em bloco arredondado;
- navegação secundária por abas com underline roxo;
- cards brancos de borda suave e sombra discreta;
- formulário à esquerda e visualização de cobertura à direita;
- roxo como ação e estado ativo, sem transformar tudo em roxo;
- botão de salvar persistente no canto inferior direito;
- linguagem direta e utilitária, em PT-BR.

### Brainstorm de alternativas

#### Opção A — Página dedicada de entrega

Criar uma rota/página independente apenas para entrega.

- Vantagem: implementação isolada.
- Problema: quebra a relação entre Entrega, Pix, pedidos e cupons mostrada na referência.
- Decisão: rejeitada.

#### Opção B — Cards empilhados na página atual

Adicionar um card de entrega abaixo dos cards existentes.

- Vantagem: menor alteração estrutural.
- Problema: não reproduz a referência, aumenta o scroll e mistura configurações de naturezas diferentes.
- Decisão: rejeitada.

#### Opção C — Workspace com abas e aba Entrega em duas colunas

Transformar `SettingsPage` no shell de abas e manter cada domínio dentro de sua aba.

- Vantagem: corresponde à referência, reduz carga cognitiva e deixa espaço para a área de entrega.
- Custo: exige reorganizar a composição da página e ajustar o salvamento.
- Decisão: escolhida.

### Autocrítica da direção

O risco seria copiar um dashboard genérico com quatro abas e cards sem relação. A assinatura específica do ZeloMenu será a visualização de círculos de cobertura lilás ao redor da loja, acompanhada por métricas operacionais — distância máxima, tempo estimado e área aproximada. O mapa não será decoração: ele explicará a regra que o lojista está configurando.

## Sistema visual

### Tokens

Usar os tokens existentes, sem hexes novos espalhados nos componentes:

| Uso | Token |
|---|---|
| Fundo do painel | `--color-canvas` |
| Superfície dos cards | `--color-surface` |
| Texto principal | `--color-ink` |
| Texto secundário | `--color-ink-muted` |
| Bordas | `--color-line` / `--color-line-strong` |
| Ação e estado ativo | `--color-brand` / `--color-brand-deep` |
| Fundo suave de ícones e avisos | `--color-brand-soft` |
| Sucesso | `--color-success` / `--color-success-soft` |
| Erro | `--color-alert` / `--color-alert-soft` |
| Aviso | `--color-warn` / `--color-warn-soft` |

### Tipografia e densidade

- Manter `Inter`, já definido no design system.
- Título da página: 24–26px, peso 700–800.
- Título de card: 14–15px, peso 650–700.
- Labels: 11–12px, peso 600, sentence case ou uppercase apenas para campos técnicos.
- Corpo: 13–14px, line-height confortável.
- Campos e botões: altura mínima de 44px.
- Raio dos cards: 14–16px; campos: 10–12px.
- Sombra: baixa opacidade, sem aparência de modal flutuante.

### Assinatura

O elemento memorável será o preview de cobertura: pin roxo no centro, círculos concêntricos translúcidos para as faixas e etiquetas `2 km`, `4 km`, `6 km`. O conteúdo deve continuar legível mesmo se o mapa externo falhar.

## Wireframe

Desktop:

```text
┌───────────────┬─────────────────────────────────────────────────────────────┐
│ ZeloMenu      │  [ícone] Configurações                                      │
│               │          Configure pedidos, Pix, cupons e entrega.           │
│ Cardápio      │                                                             │
│ Publicação    │  Pedidos online  Pix  Cupons  [Entrega]                     │
│ [Configurações]│ ────────────────────────────────────────────────────────── │
│ Mesas         │  Configurações de entrega                                   │
│               │  Defina o endereço e as faixas por distância.               │
│               │                                                             │
│               │  ┌────────────────────────┐  ┌───────────────────────────┐ │
│               │  │ Endereço da loja       │  │ Área de entrega            │ │
│               │  │ CEP       [Buscar CEP] │  │                           │ │
│               │  │ Rua              Nº    │  │       mapa + pin           │ │
│               │  │ Bairro  Cidade  Estado │  │     círculos de raio        │ │
│               │  │ aviso de referência    │  │                           │ │
│               │  ├────────────────────────┤  │ distância / tempo / área   │ │
│               │  │ Faixas de entrega      │  └───────────────────────────┘ │
│               │  │ até km       valor     │                                 │
│               │  │ 2,00         R$ 5,00   │                                 │
│               │  │ 4,00         R$ 8,00   │                                 │
│               │  │ 6,00         R$ 12,00  │                                 │
│               │  │ [+ Adicionar faixa]   │                                 │
│               │  └────────────────────────┘                                 │
│               │                                      [Salvar configurações]  │
└───────────────┴─────────────────────────────────────────────────────────────┘
```

Mobile — estado A, visão geral de Configurações:

```text
┌───────────────────────────────┐
│ 9:41                     ●●●  │
│ ☰  [ZM] ZeloMenu              │
├───────────────────────────────┤
│ [ícone] Configurações         │
│ Configure pedidos, Pix e      │
│ cupons de desconto.            │
│                               │
│ Pedidos online  Pix  Entrega  │  ← abas/âncoras com scroll horizontal
│                 ─────────     │
│                               │
│ ┌───────────────────────────┐ │
│ │ [ícone] Entrega            │ │
│ │ Defina sua área de entrega │ │
│ │                           │ │
│ │      mapa + pin + raios    │ │
│ │                           │ │
│ │ distância  tempo  área    │ │
│ │ [ Configurar entrega  > ] │ │  ← abre o estado B
│ └───────────────────────────┘ │
│ ┌───────────────────────────┐ │
│ │ Pedidos online             │ │
│ │ resumo + switch + aviso    │ │
│ │ [ Editar configuração ]    │ │
│ └───────────────────────────┘ │
│ ┌───────────────────────────┐ │
│ │ Pagamento via Pix          │ │
│ └───────────────────────────┘ │
├───────────────────────────────┤
│ Cardápio Publicação Config.  │
│                         Mesas │
└───────────────────────────────┘
```

Mobile — estado B, detalhe configurável de Entrega:

```text
┌───────────────────────────────┐
│ ←  Configurar entrega         │
│    Defina endereço e faixas.  │
├───────────────────────────────┤
│ ┌───────────────────────────┐ │
│ │ Endereço da loja          │ │
│ │ CEP       [Buscar CEP]    │ │
│ │ Rua                       │ │
│ │ Número                    │ │
│ │ Bairro       Cidade       │ │
│ │ Estado                    │ │
│ │ aviso de referência       │ │
│ └───────────────────────────┘ │
│ ┌───────────────────────────┐ │
│ │ Faixas de entrega         │ │
│ │ até km       valor   🗑    │ │
│ │ 2,00         R$ 5,00      │ │
│ │ 4,00         R$ 8,00      │ │
│ │ 6,00         R$ 12,00 🗑  │ │
│ │ [ + Adicionar faixa ]     │ │
│ │ aviso do limite máximo    │ │
│ └───────────────────────────┘ │
│ ┌───────────────────────────┐ │
│ │ Visualização da área      │ │
│ │      mapa + raios          │ │
│ │ distância / tempo / área  │ │
│ └───────────────────────────┘ │
│ [  Salvar configuração     ]  │  ← sticky, respeita safe area
├───────────────────────────────┤
│ Cardápio Publicação Config.  │
│                         Mesas │
└───────────────────────────────┘
```

Regras do fluxo mobile:

- A tela raiz mantém os cards-resumo empilhados, como na referência; não transforma a aba Entrega em um formulário longo dentro da home.
- As abas horizontais funcionam como âncoras para os cards da visão geral. O CTA `Configurar entrega` é a entrada explícita no detalhe; não deve abrir um modal.
- O detalhe usa botão de voltar no cabeçalho, mantém o bottom navigation do admin e preserva o draft ao voltar após erro de salvamento.
- A transição deve atualizar o hash/rota para permitir voltar pelo navegador e compartilhar um deep link do detalhe.

## Composição da página

### `SettingsPage`

Responsabilidade: shell visual e navegação das abas.

Arquivos:

- Modify: `src/pages/SettingsPage.tsx`
- Create: `src/components/zelomenu/SettingsOverview.tsx`
- Create: `src/components/zelomenu/ZeloMenuDeliverySummaryCard.tsx`
- Create: `src/pages/ZeloMenuDeliverySettingsPage.tsx`
- Possibly modify: `src/pages/AdminPage.tsx` para suportar `#settings` e `#settings/entrega/configurar` sem quebrar o hash principal do admin.

Comportamento:

- abas com `role="tablist"`, `role="tab"` e `aria-selected`;
- teclado com foco visível e navegação horizontal;
- aba ativa persistida no URL, preferencialmente `#settings/entrega`, preservando `#settings` como fallback legado;
- título e subtítulo permanecem fixos no topo;
- no desktop, apenas o conteúdo da aba ativa é montado para evitar chamadas desnecessárias;
- no mobile, a rota raiz `#settings` mostra a visão geral com cards-resumo empilhados, enquanto `#settings/entrega/configurar` monta o detalhe de Entrega;
- mudanças não salvas devem gerar indicador visual e confirmação antes de trocar de aba ou sair.

### Dois estados mobile e navegação

O refactor deve separar explicitamente a composição da visão geral da composição do detalhe, sem duplicar estado ou contratos:

- `SettingsOverview`: cabeçalho, abas/âncoras horizontais e cards-resumo de Entrega, Pedidos online, Pix e Cupons;
- `DeliverySettingsPage`: cabeçalho com voltar, formulário completo de endereço, editor de faixas, preview e salvar;
- `ZeloMenuDeliverySummaryCard`: variante compacta do preview com métricas e CTA `Configurar entrega`;
- `DeliveryCoveragePreview`: aceitar `variant="summary" | "detail"`, reutilizando a mesma fonte de dados e o mesmo fallback visual;
- `SettingsPage` deve decidir o estado por rota/hash e compartilhar o draft somente enquanto o detalhe estiver aberto;
- clicar em `Configurar entrega` navega para `#settings/entrega/configurar`; clicar em voltar retorna para `#settings` sem descartar um draft válido;
- o botão de voltar do navegador deve produzir o mesmo comportamento do botão visual;
- o bottom navigation continua sendo o shell do admin, inclusive na tela de detalhe.

No mobile, as abas da visão geral são âncoras de navegação/scroll para os cards, e não um filtro que esconda os demais cards. Isso reproduz a referência e permite que o lojista veja rapidamente o estado de todas as configurações.

Abas:

1. `Pedidos online` → `ZeloMenuOrderSettingsCard`.
2. `Pagamento via Pix` → `ZeloMenuPixCard`.
3. `Cupons de desconto` → `ZeloMenuCouponsCard`.
4. `Entrega` → novo `ZeloMenuDeliverySettingsCard`.

As três abas existentes devem manter suas regras e endpoints. A mudança inicial de layout não deve alterar comportamento de pedidos, Pix ou cupons.

No mobile, os três domínios existentes aparecem primeiro como cards-resumo na visão geral. Seus CTAs podem abrir a configuração correspondente no mesmo padrão de detalhe em uma etapa posterior; nesta entrega, somente Entrega precisa do novo detalhe completo.

### `ZeloMenuDeliverySettingsCard`

Responsabilidade: carregar, editar, validar e salvar o endereço e as faixas de entrega.

Arquivo:

- Create: `src/components/zelomenu/ZeloMenuDeliverySettingsCard.tsx`

Estrutura interna:

- `DeliveryAddressForm`;
- `DeliveryRangesEditor`;
- `DeliveryStatusNotice`;
- `DeliverySaveBar`;
- `DeliveryCoveragePreview`.

No desktop, esse componente pode ser a coluna de configuração da aba Entrega. No mobile, ele deve ser reutilizado dentro de `DeliverySettingsPage`, com a coluna única e a ordem Endereço → Faixas → Visualização da área, enquanto `ZeloMenuDeliverySummaryCard` usa apenas a variante compacta.

O componente deve manter um draft local e comparar o draft com o snapshot carregado para calcular `dirty`. O botão de salvar deve estar sempre disponível no rodapé do conteúdo, mas desabilitado quando não houver alteração ou quando houver erro de validação.

## Aba Entrega

### Card “Endereço da loja”

Campos:

- CEP editável com máscara `00000-000`;
- botão `Buscar CEP`;
- Rua/logradouro preenchida pelo CEP;
- Número editável;
- Bairro preenchido pelo CEP;
- Cidade preenchida pelo CEP;
- Estado preenchido pelo CEP;
- complemento opcional, se suportado pelo contrato final.

Regras de UX:

- rua, bairro, cidade e estado ficam somente leitura após um CEP válido;
- `Buscar CEP` mostra loading no próprio botão;
- novo CEP limpa coordenadas antigas até nova geocodificação;
- número é obrigatório para habilitar a geocodificação;
- erros aparecem junto do campo e em uma mensagem geral acionável;
- o aviso explica: “Este endereço será usado como referência para calcular as distâncias de entrega.”

Estados:

- vazio: solicitar CEP;
- CEP válido: mostrar dados derivados;
- buscando: botão e campos derivados em loading;
- geocodificando: aviso “Localizando a loja…”;
- pronto: indicador positivo e coordenadas disponíveis no backend;
- erro: explicar como corrigir, sem apagar o que o usuário digitou;
- serviço indisponível: permitir tentar novamente e salvar o restante sem habilitar entrega.

### Card “Faixas de entrega”

Cada linha contém:

- distância máxima em km, exibida com duas casas;
- valor em reais;
- ação de remover.

Ações e validações:

- `Adicionar faixa` adiciona uma linha vazia no final;
- não permitir distância vazia, zero ou negativa;
- não permitir valores negativos;
- impedir limites duplicados;
- ordenar visualmente por distância;
- destacar erro na linha, sem bloquear edição das outras linhas;
- exigir pelo menos uma faixa para habilitar entrega;
- mostrar aviso fixo: “A última faixa define a distância máxima de entrega. Pedidos acima dela não poderão ser finalizados.”

A persistência deve armazenar metros no domínio/API, mesmo que a interface edite quilômetros.

### Preview “Área de entrega (visualização)”

Arquivo:

- Create: `src/components/zelomenu/DeliveryCoveragePreview.tsx`

Responsabilidade:

- mostrar o pin da loja;
- mostrar um círculo por faixa configurada;
- rotular cada círculo com a distância máxima;
- exibir resumo de distância máxima, tempo estimado máximo e área aproximada;
- atualizar a visualização conforme o draft muda;
- renderizar fallback visual quando mapa/tiles não carregarem.

Decisão de escopo:

- o preview não participa do cálculo de frete;
- falha do mapa nunca bloqueia salvar endereço/faixas;
- a primeira implementação deve encapsular o provedor atrás de um adapter;
- a biblioteca de mapa deve ser revisada quanto a bundle/licença; a primeira versão usa Leaflet com tiles configuráveis;
- a visualização usa uma camada geográfica real com círculos em metros, mantendo o resumo textual acessível;
- adicionar atribuição do mapa quando houver tiles externos;
- não apresentar círculos como isócronas reais: nesta etapa o texto deve dizer “alcance radial”; isócronas viárias ficam para o Sprint 5.

Métricas:

- `Distância máxima`: maior faixa;
- `Tempo estimado (máx.)`: valor derivado por um serviço de rota ou exibido como indisponível quando não houver dado confiável;
- `Área aproximada`: cálculo visual opcional, sempre identificado como aproximação.

## Sprint 5 — Mapa geográfico e alcance por ruas

### Sprint 5A — Mapa real no admin (implementado nesta etapa)

- renderizar a cidade real a partir das coordenadas geocodificadas da loja;
- mostrar marcador da loja, zoom, escala, atribuição e círculos proporcionais às faixas em metros;
- centralizar e ajustar o zoom automaticamente conforme a maior faixa;
- permitir tiles configuráveis por `VITE_MAP_TILE_URL` e `VITE_MAP_TILE_ATTRIBUTION`, mantendo o provedor atrás de uma configuração simples;
- se o provedor de tiles falhar, manter métricas, faixas e fallback visual; o mapa nunca bloqueia salvar nem checkout;
- deixar explícito na interface que os círculos são alcance radial, não alcance pelas ruas.

### Sprint 5B — Isócronas viárias

- adicionar um endpoint backend de isócronas por origem, faixa e versão do endereço;
- consultar um provedor contratado de rotas/isochrones com timeout, cache stale e circuit breaker já alinhados ao hardening Tier S;
- renderizar polígonos de alcance real por ruas quando disponíveis, preservando os círculos como fallback visual;
- cachear por `origin + range + providerVersion` e invalidar quando o endereço ou faixas mudarem;
- expor estado de precisão: `radial`, `viário`, `indisponível`, sem alterar o cálculo transacional do frete;
- cobrir falha, timeout, resposta inválida e ausência de coordenadas em testes unitários e E2E.

## API e dados necessários

Arquivos esperados:

- Modify: `src/services/zelomenuAdminApi.ts`;
- Modify: `server/index.ts`;
- Create/modify: serviço de configuração de entrega no backend;
- Referência de domínio: `deliveryproject.md`.

Contratos mínimos:

```ts
type DeliverySettings = {
  enabled: boolean;
  address: {
    postalCode: string;
    number: string;
    complement: string | null;
    street: string;
    neighborhood: string;
    city: string;
    state: string;
    latitude: number | null;
    longitude: number | null;
    locationVersion: string | null;
  } | null;
  ranges: Array<{
    id?: string;
    maxDistanceM: number;
    price: number;
  }>;
  geocodingStatus: 'not_configured' | 'ready' | 'error' | 'stale';
};
```

Endpoints administrativos sugeridos:

- `GET /api/admin/zelomenu/delivery` — carregar configuração;
- `POST /api/admin/zelomenu/delivery/lookup-cep` — consultar ViaCEP com cache;
- `POST /api/admin/zelomenu/delivery/geocode-store` — geocodificar e validar endereço da loja;
- `PATCH /api/admin/zelomenu/delivery` — salvar endereço, faixas e enabled de forma transacional.

O frontend não deve chamar Nominatim ou OSRM diretamente. O mapa pode ter um endpoint próprio ou um adapter visual independente.

## Salvamento e estados de confiabilidade

O rodapé de salvar deve ter estados explícitos:

- `Salvar configurações`;
- `Salvando…` com bloqueio de duplo clique;
- `Configurações salvas` com confirmação acessível;
- `Não foi possível salvar` com retry;
- `Endereço precisa ser geocodificado` quando a entrega estiver sendo habilitada sem coordenadas válidas.

Se o salvamento falhar:

- manter o draft na tela;
- não voltar silenciosamente ao snapshot antigo;
- não marcar como salvo;
- mostrar retry;
- impedir navegação destrutiva enquanto houver mudanças não salvas.

O mapa, o tempo estimado e a área aproximada podem falhar sem impedir o salvamento de uma configuração válida. A geocodificação da loja, porém, é requisito para ativar a entrega.

## Responsividade e acessibilidade

- Desktop: grid de duas colunas, aproximadamente `1.35fr 1fr`.
- Tablet: reduzir espaçamento e manter preview ao lado quando houver largura suficiente.
- Mobile: cards empilhados, abas com rolagem horizontal, preview depois dos formulários e botão de salvar sticky respeitando safe area.
- Todos os controles com alvo mínimo de 44px.
- Não usar cor como único indicador de erro, sucesso ou estado ativo.
- Campos derivados devem ter `readOnly` e descrição acessível.
- Tabs devem funcionar por teclado.
- Status de busca, geocoding, salvamento e erro devem usar `aria-live` sem interromper o leitor de tela excessivamente.
- O preview do mapa deve ter uma descrição textual com loja, maior faixa e métricas.
- Respeitar `prefers-reduced-motion`.

## Plano por sprints

O refactor será entregue em incrementos verticais. Cada sprint precisa terminar com o estado anterior funcionando e com um critério claro de saída; a tela de detalhe só deve ser exposta no fluxo quando o sprint correspondente estiver validado.

### Sprint 0 — Contratos, rotas e base visual

**Objetivo:** fechar as decisões que evitam retrabalho entre a visão geral e a tela de detalhe.

**Escopo:**

- registrar `#settings` como visão geral e `#settings/entrega/configurar` como detalhe;
- definir o modelo compartilhado de `DeliverySettings`, estados de carregamento e `dirty`;
- validar os tokens existentes, espaçamentos, componentes de card, bottom navigation e breakpoints;
- criar fixtures/mock adapter para a composição poder ser desenvolvida sem depender de CEP, geocoding ou mapa;
- capturar baseline visual das configurações atuais para evitar regressão.

**Saída:** rota e contrato aprovados, fixtures disponíveis e nenhuma mudança funcional nas configurações atuais.

### Sprint 1 — Nova visão geral mobile de Configurações

**Objetivo:** reproduzir o estado esquerdo da referência sem transformar a home em um formulário longo.

**Escopo:**

- extrair `SettingsOverview` do shell atual;
- manter cabeçalho, abas/âncoras horizontais e bottom navigation;
- criar `ZeloMenuDeliverySummaryCard` com mapa/preview compacto, métricas e CTA `Configurar entrega`;
- reorganizar Pedidos online, Pix e Cupons como cards-resumo empilhados, preservando seus endpoints e regras;
- fazer as âncoras levarem ao card correspondente sem esconder os outros cards;
- garantir comportamento responsivo de desktop sem alterar o fluxo legado.

**Saída:** em 320–428px a visão geral corresponde à referência, não tem overflow e o CTA altera a rota para o detalhe.

### Sprint 2 — Tela dedicada configurável de Entrega

**Objetivo:** entregar o estado direito da referência como uma tela navegável e editável.

**Escopo:**

- criar `ZeloMenuDeliverySettingsPage` com cabeçalho, voltar e subtítulo;
- montar os cards na ordem Endereço da loja → Faixas de entrega → Visualização da área;
- implementar campos, lookup de CEP, estados de endereço e editor de faixas;
- preservar draft, validação por linha, remoção e adição de faixa;
- manter `Salvar configuração` em barra inferior segura e acessível;
- implementar voltar visual, voltar do navegador e bloqueio de saída com alteração não salva.

**Saída:** o CTA abre o detalhe em mobile, o botão voltar retorna à visão geral e nenhum draft válido é perdido durante o fluxo.

### Sprint 3 — Preview, API e salvamento resiliente

**Objetivo:** conectar a interface ao backend sem tornar mapa, CEP, geocoding ou cálculo auxiliar um ponto único de falha.

**Escopo:**

- implementar `DeliveryCoveragePreview` nas variantes `summary` e `detail`;
- adicionar fallback visual sem tiles e resumo textual acessível;
- integrar client admin e endpoint transacional de configuração;
- conectar lookup de CEP/geocoding por backend, com loading, timeout, retry e mensagens recuperáveis;
- implementar estados `Salvando`, sucesso, erro com retry e draft preservado;
- invalidar o cache de cotação quando o endereço/coordenadas/faixas mudarem, conforme o contrato de `deliveryproject.md`.

**Saída:** salvar uma configuração válida não depende do mapa; falhas auxiliares são visíveis, recuperáveis e não apagam o draft.

### Sprint 4 — Hardening, QA visual e release

**Objetivo:** garantir que o refactor possa chegar a produção sem regressão de configurações nem quebra do fluxo de pedido.

**Escopo:**

- testar rotas, deep links, voltar, abas/âncoras e navegação mobile;
- cobrir CEP inexistente, resposta inválida, timeout, geocoding indisponível, erro de salvamento, retry e duplo clique;
- validar 320px, 375px, 428px, tablet e desktop com screenshots comparativas;
- verificar teclado, foco, leitor de tela, safe area e `prefers-reduced-motion`;
- executar typecheck, testes unitários, testes de integração e build;
- fazer smoke test do checkout para confirmar que preview/mapa nunca bloqueia pedido.

**Saída:** checklist de aceite completo, evidências visuais anexadas e regressão crítica bloqueando release se qualquer caminho de configuração ou pedido falhar.

## Tarefas de implementação

### Task 1 — Extrair o shell de abas

- [ ] Atualizar `SettingsPage.tsx` para renderizar header, tabs e conteúdo ativo.
- [ ] Extrair `SettingsOverview` para a visão geral mobile com cards-resumo empilhados.
- [ ] Criar `ZeloMenuDeliverySummaryCard` com preview compacto, métricas e CTA.
- [ ] Criar `ZeloMenuDeliverySettingsPage` para o detalhe configurável mobile.
- [ ] Definir modelo tipado de abas e labels em PT-BR.
- [ ] Persistir visão geral, aba/âncora e detalhe no hash sem quebrar navegação existente do `AdminPage`.
- [ ] Implementar estado de mudanças não salvas entre abas.
- [ ] Garantir navegação por teclado e foco visível.

### Task 2 — Ajustar a composição dos cards existentes

- [ ] Renderizar `ZeloMenuOrderSettingsCard` somente na aba Pedidos online.
- [ ] Renderizar `ZeloMenuPixCard` somente na aba Pagamento via Pix.
- [ ] Renderizar `ZeloMenuCouponsCard` somente na aba Cupons de desconto.
- [ ] Harmonizar cabeçalhos, espaçamento e raios sem alterar regras de negócio.
- [ ] Decidir se os cards existentes permanecem com salvamento local ou se migram para o save bar comum; não misturar os dois modelos sem comunicar o escopo.

### Task 3 — Criar formulário de endereço da loja

- [ ] Criar componente de endereço com estados vazio/loading/erro/sucesso.
- [ ] Adicionar máscara e validação de CEP.
- [ ] Integrar lookup de CEP no backend.
- [ ] Integrar geocoding da loja sem bloquear a tela.
- [ ] Exibir status de endereço pronto para entrega.

### Task 4 — Criar editor de faixas

- [ ] Criar helper puro para normalizar, ordenar e validar faixas.
- [ ] Criar linhas editáveis com distância e preço.
- [ ] Adicionar/remover faixa.
- [ ] Mostrar erros por linha e erro geral de configuração.
- [ ] Garantir que a última faixa e os limites estejam claramente explicados.

### Task 5 — Criar preview de cobertura

- [ ] Criar `DeliveryCoveragePreview` com pin, círculos, labels e métricas.
- [ ] Implementar variantes `summary` e `detail` sem duplicar o cálculo das métricas.
- [ ] Atualizar preview com mudanças locais sem chamadas externas a cada tecla.
- [ ] Implementar estado sem coordenadas.
- [ ] Implementar fallback quando tiles ou mapa falharem.
- [ ] Adicionar descrição acessível e atribuição, se houver mapa externo.

### Task 6 — Integrar salvamento confiável

- [ ] Implementar `getDeliverySettings` e `updateDeliverySettings` no client admin.
- [ ] Criar endpoint transacional para salvar endereço/faixas.
- [ ] Invalidar caches de loja quando as coordenadas mudarem.
- [ ] Desabilitar entrega quando não houver geocoding válido.
- [ ] Garantir retry idempotente e preservação do draft.

### Task 7 — Testes e verificação visual

- [ ] Testar validação de faixas e limites.
- [ ] Testar lookup de CEP válido, inexistente, timeout e resposta inválida.
- [ ] Testar geocoding da loja e estados de erro.
- [ ] Testar salvamento duplicado e retry.
- [ ] Testar tabs, deep link e mudanças não salvas.
- [ ] Executar typecheck, testes unitários e build.
- [ ] Verificar desktop, tablet e mobile com screenshot.
- [ ] Verificar teclado, leitores de tela e reduced motion.

## Critérios de aceite

- [ ] A página de Configurações possui as quatro abas da referência.
- [ ] No mobile, `#settings` mostra a visão geral com cards-resumo empilhados na ordem da referência.
- [ ] O card-resumo de Entrega mostra mapa/raios, métricas e o CTA `Configurar entrega`.
- [ ] `Configurar entrega` abre uma tela dedicada, não um modal, com back visual e back do navegador.
- [ ] A tela dedicada mobile mantém a ordem Endereço da loja, Faixas de entrega, Visualização da área e o botão salvar inferior.
- [ ] A aba Entrega reproduz a hierarquia visual: header, tabs, formulário à esquerda, preview à direita e save bar.
- [ ] O endereço da loja pode ser preenchido por CEP e número.
- [ ] Rua, bairro, cidade e estado derivados não são editáveis livremente.
- [ ] Faixas podem ser adicionadas, removidas, editadas e validadas.
- [ ] A última faixa fica visualmente identificada como limite máximo.
- [ ] O preview mostra círculos de cobertura e métricas sem bloquear o fluxo quando falha.
- [ ] A entrega só pode ser habilitada com coordenadas válidas da loja.
- [ ] O salvamento mostra estados de progresso, sucesso e erro recuperável.
- [ ] Nenhuma chamada externa é feita a cada tecla digitada.
- [ ] O layout é utilizável em 320px de largura sem overflow horizontal.
- [ ] O bottom navigation permanece disponível nos dois estados mobile sem cobrir campos ou o botão salvar.
- [ ] As abas e o formulário atendem aos requisitos básicos de teclado e leitor de tela.
- [ ] As abas atuais continuam funcionando sem regressão de pedidos, Pix ou cupons.

## Verificação final antes de implementar

Antes de escrever código, confirmar:

1. Se o save bar será global para todas as abas ou apenas para a aba Entrega. Recomendação: inicialmente, manter os cards existentes com seu comportamento e usar save bar próprio para Entrega; uma migração global de salvamento deve ser uma tarefa separada.
2. Se o preview usará mapa externo real ou uma visualização SVG aproximada. Recomendação: adapter visual com fallback obrigatório; mapa não pode ser dependência do checkout.
3. Se o contrato de backend de `deliveryproject.md` já estará disponível. Sem ele, implementar primeiro fixtures/adapter mockável para não acoplar o frontend a respostas incompletas.
4. Se o detalhe mobile usará o hash aninhado definido neste plano. Recomendação: manter `#settings` para a visão geral e `#settings/entrega/configurar` para o detalhe, porque isso preserva o admin existente e torna o back determinístico.
