# Botão "Enviar pedido no WhatsApp" na comprovação do pedido

Data: 2026-07-17

## Objetivo

Na tela de comprovação do pedido (após confirmar), além do botão "Voltar ao
cardápio", oferecer um botão que abre o WhatsApp da loja com o resumo do pedido
já preenchido, para o cliente enviar. Vale apenas para pedidos públicos
(delivery/retirada); pedido de mesa não muda.

## Decisões (definidas no brainstorming)

- **Destino:** WhatsApp da loja, número já existente em `empresa_perfil.contato`.
- **Mecanismo:** link click-to-chat `https://wa.me/<numero>?text=<mensagem>`
  (mesmo padrão já usado no ZeloPDV). Não usa API/instância do WhatsApp.
- **Conteúdo:** resumo completo do pedido, incluindo o **nome** do cliente,
  **sem** o telefone (o WhatsApp já identifica o remetente).
- **Escopo:** somente `context === 'public_order'`. Não aparece em mesa.
- **Fallback:** se a loja não tiver `contato` válido, o botão não aparece e a
  tela mantém apenas "Voltar ao cardápio".

## Origem do dado

`empresa_perfil.contato` guarda o contato comercial da loja. Formato varia
(com máscara `(11) 99999-9999` ou só dígitos `11999999999`) e **sem DDI**.
É um contato comercial já exibido publicamente na vitrine, então expô-lo na
resposta pública é adequado (sem questão de minimização de dados).

Hoje o `contato` não é carregado no ZeloMenu; a resposta pública da loja e do
carrinho carregam um objeto `business` sem telefone.

## Arquitetura / fluxo de dados

Abordagem escolhida (A): expor `business.whatsapp` já normalizado na resposta,
e montar a mensagem no cliente a partir do `payload` que a tela já tem.

### 1. Backend — trazer e normalizar o número

- `server/configStore.ts`
  - Adicionar `contato` ao `select` de `empresa_perfil` em `loadCatalogFromDb`.
  - Adicionar `contato: string | null` ao tipo `BusinessConfig` e preencher.
- Novo helper puro `toWhatsAppNumber(raw: string | null | undefined): string | null`
  em `src/domain/whatsappOrder.ts`, espelhando `normalizeBrazilianPhone` do
  ZeloPDV:
  - remove não-dígitos;
  - se começa com `00`, remove o `00`;
  - se começa com `55`, valida 10-11 dígitos nacionais → `55` + nacional;
  - senão, se tem 10 ou 11 dígitos → prefixa `55`;
  - caso contrário → `null`.
- `server/zelomenuCartSessions.ts`
  - Adicionar `whatsapp: string | null` ao tipo `business` de `PublicCartResponse`
    (também herdado por `PublicStoreResponse`).
  - Preencher `whatsapp: toWhatsAppNumber(config.contato)` nos dois construtores
    de `business` (resposta do carrinho em `buildPublicResponse` e resposta
    pública da loja em `getPublicStoreBySlug`).

### 2. Frontend — tipos e mensagem

- `src/services/zelomenuApi.ts`: adicionar `whatsapp?: string | null` ao objeto
  `business` de `ZeloMenuPublicCartResponse` (e do store response, se aplicável).
- `src/domain/whatsappOrder.ts` (puro, testável):
  - `toWhatsAppNumber` (compartilhado com o server via import).
  - `buildWhatsAppOrderMessage(input): string` — monta o texto:
    - saudação + número do pedido (`orderingId`, 8 primeiros em maiúsculo);
    - nome do cliente (se houver);
    - lista de itens: `• {qtd}x {nome} — {preço}`;
    - total (ou "subtotal + entrega a confirmar" quando a taxa é a confirmar);
    - retirada/entrega + quando (o quanto antes / data às hora);
    - se delivery: endereço e bairro;
    - observações (se houver).
  - `buildWhatsAppOrderLink(numero: string, mensagem: string): string` →
    `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`.

### 3. UI — `src/pages/ZeloMenuCartPage.tsx` (bloco `isConfirmed`)

- Quando `isPublicOrder` e `payload.business.whatsapp` existir:
  - botão primário verde **"Enviar pedido no WhatsApp"** (ícone WhatsApp/MessageCircle),
    `<a href={buildWhatsAppOrderLink(...)} target="_blank" rel="noopener noreferrer">`,
    posicionado acima do "Voltar ao cardápio";
  - "Voltar ao cardápio" passa a ser o botão secundário (estilo atual mantido).
- Sem número → nada muda (só "Voltar ao cardápio").
- Mesa (`isTableOrder`) → inalterado.

## Formato da mensagem (exemplo)

```
Olá! Segue meu pedido pelo cardápio digital.

Pedido #A1B2C3D4
Cliente: João Silva

• 2x Coxinha — R$ 12,00
• 1x Refrigerante lata — R$ 6,00

Total: R$ 18,00
Retirada · o quanto antes
Obs.: sem cebola
```

Para delivery, troca a linha de retirada por entrega com endereço/bairro e o
total mostra "+ entrega" quando a taxa é a confirmar.

## Casos de borda

- `contato` vazio/inválido → `business.whatsapp = null` → botão oculto.
- Carrinho sem itens não ocorre nesse ponto (a tela só aparece confirmada).
- Total com taxa a confirmar → mensagem usa "subtotal + entrega a confirmar".
- Nomes de itens/observações longos → sem tratamento especial (WhatsApp lida com
  texto longo); a mensagem é montada a partir dos dados já sanitizados.

## Testes

- Unitários (`src/domain/whatsappOrder.test.ts`):
  - `toWhatsAppNumber`: máscara, só dígitos (10 e 11), com `55`, com `00`,
    inválido (curto/longo), vazio/null.
  - `buildWhatsAppOrderMessage`: retirada asap, retirada agendada, delivery com
    endereço/bairro, com observações, com nome ausente, total com taxa a confirmar.
  - `buildWhatsAppOrderLink`: encoding correto.
- `npm run lint` (tsc) + suíte vitest.
- Verificar que `server/*.ts` transpila no esbuild (server fica fora do tsc).

## Arquivos tocados

- `server/configStore.ts` (select + BusinessConfig.contato)
- `server/zelomenuCartSessions.ts` (tipo business + 2 construtores)
- `src/domain/whatsappOrder.ts` (novo)
- `src/domain/whatsappOrder.test.ts` (novo)
- `src/services/zelomenuApi.ts` (tipo business.whatsapp)
- `src/pages/ZeloMenuCartPage.tsx` (botão na comprovação)

## Fora de escopo

- Configurar o WhatsApp da loja pelo admin do ZeloMenu (usa o `contato` já
  existente do ZeloPDV).
- Botão em pedidos de mesa ou `whatsapp_order`.
- Envio automático/integração com API do WhatsApp.
