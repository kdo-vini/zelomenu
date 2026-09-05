# Autoridade canônica para pedidos conversacionais

**Status:** aprovado em 2026-09-02

**Consumidor:** ZeloChat

**Escopo:** catálogo, montagem parcial, requisitos, preço, disponibilidade e confirmação

## Decisão

O ZeloMenu será a única autoridade de pedido, mesmo enquanto a conversa ainda está incompleta. O ZeloChat interpreta texto e áudio, mas só pode selecionar IDs canônicos e aplicar patches ao rascunho. O ZeloMenu persiste as escolhas, calcula preço, devolve requisitos pendentes e impede confirmação enquanto faltar qualquer requisito bloqueante.

Essa extensão mantém o pedido conversacional compatível com o checkout digital: ambos usam as mesmas regras de produto, grupo, opção, publicação, pausa, estoque, entrega e confirmação transacional.

## Modelo do rascunho

Cada item recebe um `lineId` opaco e estável para permitir duas linhas do mesmo produto e correções como `na segunda, troca o molho`. O patch de uma linha contém produto, quantidade, observação e seleções estruturadas por grupo. IDs de grupo e opção são validados dentro da hierarquia daquele produto; conjuntos globais de IDs não são suficientes.

Rascunhos parciais são válidos para persistência, mas não para confirmação. O snapshot passa a incluir:

- `requirements`: requisitos bloqueantes e opcionais derivados do estado atual;
- `readyForConfirmation`: verdadeiro apenas quando todos os bloqueios foram resolvidos;
- `confirmationAction`: nulo enquanto `readyForConfirmation` for falso;
- preço provisório com semântica explícita quando ainda puder mudar;
- as regras completas de cada grupo e opção ainda disponível.

Não existe default silencioso de retirada. Modalidade, endereço/agenda, pagamento e nome do cliente são requisitos quando aplicáveis.

## Requisitos de modificadores

O contrato preserva os campos reais do catálogo:

- `kind`;
- `pricingMode` (`somar` ou `substituir`);
- `minSelections` e `maxSelections` para opções distintas;
- `minTotalQuantity` e `maxTotalQuantity` para quantidade total;
- `allowsQuantity`;
- `maxPerOption`;
- preço atual e delta de cada opção;
- disponibilidade atual da identidade vinculada.

Grupo obrigatório incompleto gera requisito bloqueante. Grupo opcional gera requisito não bloqueante, consumido pelo ZeloChat para uma oferta única. Uma única opção obrigatória e disponível pode ser marcada como auto-selecionável, mas a seleção continua explícita no snapshot.

## Preço e disponibilidade

Produto-base com grupo de preço por substituição deve apresentar o menor preço completo vendável. Assim, `Monte Sua Massa` não aparece como R$ 0; aparece `a partir de R$ 22,00` no catálogo e usa a massa escolhida no total.

Uma opção vinculada pode apontar para produto ou componente canônico:

- produto: pausa e estoque são respeitados; controle de estoque desligado ignora quantidade zero;
- componente: pausa global é respeitada; não gera reserva de estoque de produto;
- `price_override`, inclusive zero, prevalece conforme a regra já definida;
- required-group viability considera os dois tipos.

A função SQL chamada por `confirm_whatsapp_zelo_order_atomic_v1` deve ter paridade com a prévia Node. Hoje ela ignora `id_componente`; a migration desta feature corrigirá essa divergência. A validação de estoque vinculado agrega `quantidade da linha × quantidade da opção` entre todas as linhas antes de comparar o saldo.

## Concorrência

Comandos de IA carregam o ID do controle e o epoch obtido no início do turno. Create/update/cancel/confirm verificam esse permit no mesmo limite transacional da gravação. Se um humano assumir a conversa, o comando perde legitimidade mesmo que o modelo tenha terminado milissegundos antes.

Message ID, revisão esperada e token preservam idempotência. Um replay retorna o snapshot já associado à mensagem. Token emitido para revisão anterior não confirma uma revisão nova.

## Segurança

- Empresa e JID fazem parte de toda resolução.
- `orderingId` de outra conversa retorna não encontrado, sem revelar existência.
- Limites de quantidade, texto e cardinalidade são aplicados na borda HTTP e no domínio.
- Dados de catálogo reais usados em testes são sanitizados e congelados; nenhum identificador de empresa ou pessoa é versionado.
- Erros públicos usam mensagens simples em português; códigos técnicos ficam no contrato interno e nos logs.

## Verificação

Testes de domínio cobrem rascunho parcial, requisitos, hierarquia de IDs, duas linhas iguais, grupos opcionais, preço por substituição e estoque. Testes HTTP cobrem validação e idempotência. Testes SQL em Postgres local executam as migrations reais para componente, pausa concorrente, required-group viability, estoque agregado e permit revogado.

Nenhuma migration será aplicada ao projeto conectado e nenhum deploy será realizado sem autorização explícita após os gates locais.
