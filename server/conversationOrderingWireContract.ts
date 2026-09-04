// Static (non-generated-from-a-running-adapter) parts of the recorded wire
// contract: the exhaustive requirement-type catalog, the exhaustive error
// catalog, and hand-authored accepted/rejected command bodies (verified
// against the real parser inside conversationOrderingWireFixtures.test.ts).
//
// See conversationOrderingWireFixtures.ts for the snapshot bundle, which is
// produced by actually running the domain code end to end.
import type {
  ModifierOrderingRequirement,
  FulfillmentTypeOrderingRequirement,
  CustomerNameOrderingRequirement,
  PaymentMethodOrderingRequirement,
  DeliveryAddressOrderingRequirement,
  ScheduleOrderingRequirement,
  OrderingRequirement,
} from './conversationOrderRequirements.js';

type RequirementTypeKey = OrderingRequirement['type'];

type RequirementTypeDoc = {
  fields: string[];
  kinds?: readonly string[];
  missingFieldsValues?: readonly string[];
};

// `satisfies Record<RequirementTypeKey, RequirementTypeDoc>` below fails to
// compile the moment `OrderingRequirement`'s discriminant union gains (or
// loses) a member without this catalog being updated in lockstep — that is
// the "assert exhaustiveness" the brief asked for.
export const REQUIREMENT_TYPE_CATALOG = {
  modifier_group: {
    kinds: ['adicional', 'variacao'],
    fields: [
      'id', 'type', 'lineId', 'productId', 'groupId', 'name', 'blocking',
      'kind', 'pricingMode', 'minSelections', 'maxSelections',
      'minTotalQuantity', 'maxTotalQuantity', 'allowsQuantity', 'maxPerOption',
      'selectedDistinctCount', 'selectedTotalQuantity',
      'autoSelectableOptionId?', 'options',
    ] satisfies (keyof ModifierOrderingRequirement | 'autoSelectableOptionId?')[],
  },
  fulfillment_type: {
    fields: ['id', 'type', 'name', 'blocking'] satisfies (keyof FulfillmentTypeOrderingRequirement)[],
  },
  customer_name: {
    fields: ['id', 'type', 'name', 'blocking'] satisfies (keyof CustomerNameOrderingRequirement)[],
  },
  payment_method: {
    fields: ['id', 'type', 'name', 'blocking'] satisfies (keyof PaymentMethodOrderingRequirement)[],
  },
  delivery_address: {
    fields: ['id', 'type', 'name', 'blocking', 'missingFields'] satisfies (keyof DeliveryAddressOrderingRequirement)[],
    missingFieldsValues: ['address', 'number', 'neighborhood'],
  },
  schedule: {
    fields: ['id', 'type', 'name', 'blocking', 'missingFields'] satisfies (keyof ScheduleOrderingRequirement)[],
    missingFieldsValues: ['date', 'time'],
  },
} satisfies Record<RequirementTypeKey, RequirementTypeDoc>;

// ── Error catalog ───────────────────────────────────────────────────────────
// Every `error` code the internal ordering surface (router + domain +
// Supabase-RPC adapter) can return, with its HTTP status. Domain codes are
// verified live against `createInternalOrderingRouter` in the fixture test;
// the three transport-level codes (JSON_INVALIDO, PAYLOAD_MUITO_GRANDE,
// MUITAS_REQUISICOES) are sourced directly from server/index.ts and are not
// reachable through `createInternalOrderingRouter` alone, so they are
// recorded here from source instead of round-tripped.
export type ErrorCatalogEntry = {
  status: number | number[];
  detail: string;
  source: string;
  note?: string;
};

export const ERROR_CATALOG: Record<string, ErrorCatalogEntry> = {
  NAO_AUTORIZADO: { status: 401, detail: 'Não foi possível autorizar esta solicitação.', source: 'server/internalOrdering.ts (router guard)' },
  COMANDO_INVALIDO: { status: 400, detail: '(varies — see commands.rejected.json)', source: 'server/internalOrdering.ts (parseInternalOrderingCommand)', note: 'detail is always the exact parser validation message for the field that failed.' },
  EMPRESA_INVALIDA: { status: 400, detail: 'Informe uma empresa válida.', source: 'server/internalOrdering.ts (GET /:orderingId)' },
  CONVERSA_INVALIDA: { status: 400, detail: 'Informe uma conversa válida.', source: 'server/internalOrdering.ts (GET /:orderingId)' },
  PEDIDO_INVALIDO: { status: 400, detail: '(varies — e.g. "Informe um pedido válido." on GET, "Revise os dados pendentes antes de confirmar." on confirm)', source: 'server/internalOrdering.ts + server/conversationOrdering.ts' },
  ITEM_INVALIDO: { status: 400, detail: '(varies — e.g. "Revise a identificação dos itens do pedido.")', source: 'server/conversationOrdering.ts (validateDraftLineIds, mergeDraftLines)' },
  PEDIDO_VAZIO: { status: 400, detail: 'O pedido precisa ter pelo menos um item. Para encerrar tudo, cancele o pedido.', source: 'server/conversationOrdering.ts' },
  CLIENTE_INVALIDO: { status: 400, detail: 'Não foi possível vincular o cliente a este pedido.', source: 'server/supabaseConversationOrderingAdapter.ts' },
  PEDIDO_NAO_ENCONTRADO: { status: 404, detail: 'Não encontrei este pedido.', source: 'server/internalOrdering.ts (GET) + server/conversationOrdering.ts (commands)' },
  REVISAO_DESATUALIZADA: { status: 409, detail: 'O pedido foi atualizado. Use a revisão mais recente.', source: 'server/conversationOrdering.ts', note: 'carries `current` (the fresh snapshot) in the response body.' },
  RESUMO_EXPIRADO: { status: 409, detail: 'Este resumo expirou. Atualize o pedido para receber uma nova confirmação.', source: 'server/conversationOrdering.ts', note: 'carries `current`.' },
  PEDIDO_EM_ANDAMENTO: { status: 409, detail: 'Já existe um pedido em andamento nesta conversa.', source: 'server/conversationOrdering.ts', note: 'carries `current` — the consumer should recover the existing orderingId from it instead of treating this as a generic failure.' },
  PEDIDO_FECHADO: { status: 409, detail: 'Este pedido já foi encerrado.', source: 'server/conversationOrdering.ts', note: 'carries `current`.' },
  CONFIRMACAO_INVALIDA: { status: 409, detail: 'Esta confirmação não é mais válida. Peça um novo resumo.', source: 'server/supabaseConversationOrderingAdapter.ts', note: 'also returned when confirmationToken is present but does not match the token issued for the current revision.' },
  AI_TURN_REVOKED: { status: 409, detail: 'Esta conversa mudou de atendimento. Vou deixar a equipe continuar por aqui.', source: 'server/supabaseConversationOrderingAdapter.ts', note: 'must be suppressed cleanly by the consumer — no customer message, no escalation.' },
  CONFIRMACAO_INDISPONIVEL: { status: 400, detail: 'A confirmação de pedidos não está disponível agora.', source: 'server/supabaseConversationOrderingAdapter.ts', note: 'this is a service-availability fault (missing RPC / missing token secret) surfaced as 400 because it is absent from the 409 allowlist in sendOrderingError — recorded as-is, not proposed to change here.' },
  PEDIDO_INDISPONIVEL: {
    status: [400, 500],
    detail: '(varies — e.g. "Não foi possível concluir o pedido agora. Tente novamente.")',
    source: 'server/conversationOrdering.ts (materialization failure -> 400 via ConversationOrderingError) and server/internalOrdering.ts sendOrderingError catch-all (unexpected error -> 500)',
    note: 'the SAME code string is emitted at two different statuses depending on whether it reached the router as a ConversationOrderingError (400) or as an unexpected/non-domain exception (500, server/internalOrdering.ts:234-235).',
  },
  MUITAS_REQUISICOES: {
    status: 429,
    detail: '(varies — "Muitos pedidos em pouco tempo..." for the per-empresa quota, "Muitas tentativas em pouco tempo..." for the coarse per-key failure limiter)',
    source: 'server/internalOrdering.ts (quota, 120/min) and server/internalCatalogRateLimit.ts (coarse failure limiter, 30 failures/min) mounted at server/index.ts',
  },
  JSON_INVALIDO: { status: 400, detail: 'Envie dados em JSON válido.', source: 'server/index.ts (express.json syntax-error middleware)' },
  PAYLOAD_MUITO_GRANDE: { status: 413, detail: 'Os dados enviados são grandes demais.', source: 'server/index.ts (express.json limit middleware)' },
};

// ── Accepted / rejected command bodies ──────────────────────────────────────
// Bodies are hand-authored to mirror real and (for rejected) real-WRONG
// shapes the consumer has sent (see ultra-review-contract.md). The exact
// `ok`/`expectedError` verdict for each is computed by actually running the
// body through `parseInternalOrderingCommand` inside the fixture test — so
// this file records intent, and the test is what proves the intent still
// holds against the live parser.
const EMPRESA_ID = '10000000-0000-4000-8000-0000000000f1';
const REMOTE_JID = '5511900000001@s.whatsapp.net';
const CONVERSATION_CONTROL_ID = '60000000-0000-4000-8000-0000000000f1';
const ORDERING_ID = '30000000-0000-4000-8000-000000000001';

function identity(messageId: string) {
  return {
    empresaId: EMPRESA_ID,
    remoteJid: REMOTE_JID,
    messageId,
    conversationControlId: CONVERSATION_CONTROL_ID,
    conversationEpoch: '7',
  };
}

export type NamedCommandBody = { name: string; body: unknown };

export const ACCEPTED_COMMAND_BODIES: NamedCommandBody[] = [
  {
    name: 'open_or_update_draft: cria com selectedOptions (grupo/opção/quantidade), notes e retirada imediata',
    body: {
      type: 'open_or_update_draft',
      ...identity('wamid.accepted-open-000001'),
      draft: {
        items: [{
          lineId: 'linha-1',
          productId: 1007,
          quantity: 1,
          notes: 'sem cebola',
          selectedOptions: [
            { groupId: 'g001', optionSelections: [{ optionId: 'o001', quantity: 1 }] },
            { groupId: 'g005', optionSelections: [{ optionId: 'o011', quantity: 2 }] },
          ],
        }],
        fulfillment: { type: 'pickup', asap: true },
        paymentMethod: 'dinheiro',
        customer: { name: 'Cliente Fixture' },
      },
    },
  },
  {
    name: 'open_or_update_draft: atualiza com removedLineIds e entrega com endereço',
    body: {
      type: 'open_or_update_draft',
      ...identity('wamid.accepted-update-000001'),
      orderingId: ORDERING_ID,
      expectedRevision: 1,
      draft: {
        items: [],
        removedLineIds: ['linha-2'],
        fulfillment: {
          type: 'delivery',
          asap: true,
          deliveryAddress: 'Rua Fixture, 100',
          deliveryNeighborhood: 'Bairro Fixture',
          deliveryNumber: '100',
        },
      },
    },
  },
  {
    name: 'open_or_update_draft: retirada agendada (não existe fulfillment.type "scheduled" — agendamento é asap:false + pickupDate/pickupTime)',
    body: {
      type: 'open_or_update_draft',
      ...identity('wamid.accepted-scheduled-000001'),
      orderingId: ORDERING_ID,
      expectedRevision: 2,
      draft: {
        items: [],
        fulfillment: { type: 'pickup', asap: false, pickupDate: '2026-09-10', pickupTime: '19:30' },
      },
    },
  },
  {
    name: 'confirm_draft: com confirmationToken (43 chars base64url, formato válido)',
    body: {
      type: 'confirm_draft',
      ...identity('wamid.accepted-confirm-000001'),
      orderingId: ORDERING_ID,
      expectedRevision: 3,
      confirmationToken: 'a'.repeat(43),
    },
  },
  {
    name: 'cancel_draft',
    body: {
      type: 'cancel_draft',
      ...identity('wamid.accepted-cancel-000001'),
      orderingId: ORDERING_ID,
      expectedRevision: 1,
    },
  },
];

export const REJECTED_COMMAND_BODIES: NamedCommandBody[] = [
  {
    name: 'fulfillment.deliveryFee / deliveryFeeToConfirm ecoados (a loja calcula a taxa, nunca o cliente)',
    body: {
      type: 'open_or_update_draft',
      ...identity('wamid.rejected-fee-000001'),
      orderingId: ORDERING_ID,
      expectedRevision: 1,
      draft: { items: [], fulfillment: { type: 'delivery', deliveryFee: 8, deliveryFeeToConfirm: false } },
    },
  },
  {
    name: 'fulfillment.type: null (autoridade nula o tipo internamente até a escolha; o wire nunca aceita null explícito)',
    body: {
      type: 'open_or_update_draft',
      ...identity('wamid.rejected-fulfillment-null-000001'),
      orderingId: ORDERING_ID,
      expectedRevision: 1,
      draft: { items: [], fulfillment: { type: null } },
    },
  },
  {
    name: 'fulfillment.type: "scheduled" (enum inexistente — só pickup/delivery)',
    body: {
      type: 'open_or_update_draft',
      ...identity('wamid.rejected-fulfillment-scheduled-000001'),
      orderingId: ORDERING_ID,
      expectedRevision: 1,
      draft: { items: [], fulfillment: { type: 'scheduled' } },
    },
  },
  {
    name: 'item sem lineId (o "repeat o de sempre" que nunca funcionou no consumidor)',
    body: {
      type: 'open_or_update_draft',
      ...identity('wamid.rejected-no-lineid-000001'),
      draft: { items: [{ productId: 1007, quantity: 1 }] },
    },
  },
  {
    name: 'item ecoa productName/unitPrice/lineTotal (carrinho completo do consumidor, preço não é confiável do cliente)',
    body: {
      type: 'open_or_update_draft',
      ...identity('wamid.rejected-priced-item-000001'),
      draft: { items: [{ lineId: 'linha-1', productId: 1007, quantity: 1, productName: 'Monte Sua Massa', unitPrice: 22, lineTotal: 22 }] },
    },
  },
  {
    name: 'conversationEpoch como number (deve ser string decimal exata)',
    body: {
      type: 'open_or_update_draft',
      empresaId: EMPRESA_ID,
      remoteJid: REMOTE_JID,
      messageId: 'wamid.rejected-epoch-number-000001',
      conversationControlId: CONVERSATION_CONTROL_ID,
      conversationEpoch: 7,
      draft: { items: [{ lineId: 'linha-1', productId: 1007, quantity: 1 }] },
    },
  },
  {
    name: 'messageId curto demais (< 8 caracteres)',
    body: {
      type: 'open_or_update_draft',
      empresaId: EMPRESA_ID,
      remoteJid: REMOTE_JID,
      messageId: 'curta',
      conversationControlId: CONVERSATION_CONTROL_ID,
      conversationEpoch: '7',
      draft: { items: [{ lineId: 'linha-1', productId: 1007, quantity: 1 }] },
    },
  },
  {
    name: 'confirm_draft sem confirmationToken (obrigatório desde ZM1 passo 3 — ver server/internalOrdering.ts)',
    body: {
      type: 'confirm_draft',
      ...identity('wamid.rejected-no-token-000001'),
      orderingId: ORDERING_ID,
      expectedRevision: 1,
    },
  },
];
