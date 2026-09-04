// Recorded wire fixtures for the ZeloMenu <-> ZeloChat conversational-ordering
// contract. This module is the single source of truth that both
// `conversationOrderingWireFixtures.test.ts` (which asserts the committed JSON
// under `docs/contracts/conversation-ordering-wire/v1/` matches this code) and
// the regeneration script consult. If this file's shape output ever
// disagrees with the committed JSON, the test fails — that is the point:
// contract drift between ZeloMenu (authority) and ZeloChat (consumer) is
// caught here, not discovered in production.
import {
  createConversationOrdering,
  type ConversationAiPermit,
  type ConversationOrderCommand,
  type ConversationOrderCreateDraft,
  type ConversationOrderingAdapter,
  type ConversationOrderingRecord,
  type ConversationOrderLookup,
  type ConversationScope,
  type DraftMaterialization,
  type DraftMutationResult,
  type OrderingSnapshot,
  type TokenIssuanceResult,
  ConversationOrderingError,
} from './conversationOrdering.js';
import {
  CUSTOMER_NAME_REQUIREMENT,
  FULFILLMENT_TYPE_REQUIREMENT,
  PAYMENT_METHOD_REQUIREMENT,
  deriveModifierRequirements,
  type ConversationCatalogProductDefinition,
  type OrderingRequirement,
} from './conversationOrderRequirements.js';
import { bemServidoConversationCatalog } from './fixtures/bemServidoConversationCatalog.js';
import {
  deriveConversationConfirmationToken,
  hashConversationConfirmationToken,
} from './conversationConfirmationToken.js';

// Fixture-only HMAC secret. Never the production `ZELO_CONFIRMATION_TOKEN_SECRET`
// (never read from env here); only used so the committed fixture's token looks
// exactly like a real 43-char base64url HMAC-SHA256 digest and regenerates
// byte-for-byte identically every run.
const FIXTURE_TOKEN_SECRET = 'fixture-only-hmac-secret-never-used-in-prod-00';

export const EMPRESA_ID = '10000000-0000-4000-8000-0000000000f1';
export const REMOTE_JID = '5511900000001@s.whatsapp.net';
const CONVERSATION_CONTROL_ID = '60000000-0000-4000-8000-0000000000f1';
const CONVERSATION_EPOCH = '1';
const AI_PERMIT: ConversationAiPermit = {
  conversationControlId: CONVERSATION_CONTROL_ID,
  conversationEpoch: CONVERSATION_EPOCH,
};
const BASE_CLOCK_MS = Date.parse('2026-09-03T12:00:00.000Z');

function pad(n: number, width = 12): string {
  return String(n).padStart(width, '0');
}

type FulfillmentDraftInput = ConversationOrderCreateDraft['fulfillment'];
type FulfillmentSnapshot = DraftMaterialization['fulfillment'];

function buildFulfillment(patch: FulfillmentDraftInput, deliveryFeeToConfirm: boolean): FulfillmentSnapshot {
  if (!patch || !patch.type) {
    return {
      type: null, asap: true, pickupDate: null, pickupTime: null,
      deliveryAddress: null, deliveryNeighborhood: null, deliveryFee: 0, deliveryFeeToConfirm: false,
    };
  }
  if (patch.type === 'delivery') {
    return {
      type: 'delivery',
      asap: patch.asap ?? true,
      pickupDate: patch.pickupDate ?? null,
      pickupTime: patch.pickupTime ?? null,
      deliveryAddress: patch.deliveryAddress ?? null,
      deliveryNeighborhood: patch.deliveryNeighborhood ?? null,
      deliveryNumber: patch.deliveryNumber ?? null,
      deliveryFee: 8,
      deliveryFeeToConfirm: deliveryFeeToConfirm,
    };
  }
  return {
    type: 'pickup',
    asap: patch.asap ?? true,
    pickupDate: patch.pickupDate ?? null,
    pickupTime: patch.pickupTime ?? null,
    deliveryAddress: null,
    deliveryNeighborhood: null,
    deliveryFee: 0,
    deliveryFeeToConfirm: false,
  };
}

function findProduct(productId: number): ConversationCatalogProductDefinition {
  const product = bemServidoConversationCatalog.find((candidate) => candidate.id === productId);
  if (!product) throw new Error(`FIXTURE_PRODUCT_NOT_FOUND:${productId}`);
  return product;
}

function computeLinePricing(item: ConversationOrderCreateDraft['items'][number], product: ConversationCatalogProductDefinition) {
  let base = product.basePrice;
  let delta = 0;
  for (const selection of item.selectedOptions ?? []) {
    const group = product.modifierGroups.find((candidate) => candidate.id === selection.groupId);
    if (!group) continue;
    for (const optionSelection of selection.optionSelections) {
      const option = group.options.find((candidate) => candidate.id === optionSelection.optionId);
      if (!option) continue;
      if (group.pricingMode === 'substituir') base = option.currentPrice;
      else delta += option.priceDelta * optionSelection.quantity;
    }
  }
  const unitPrice = base + delta;
  return { baseUnitPrice: product.basePrice, unitPrice, modifierDeltaTotal: unitPrice - product.basePrice };
}

function buildSelectedModifiers(item: ConversationOrderCreateDraft['items'][number], product: ConversationCatalogProductDefinition) {
  return (item.selectedOptions ?? []).map((selection) => {
    const group = product.modifierGroups.find((candidate) => candidate.id === selection.groupId)!;
    return {
      groupId: group.id,
      groupName: group.name,
      kind: group.kind,
      selectedOptions: selection.optionSelections.map((optionSelection) => {
        const option = group.options.find((candidate) => candidate.id === optionSelection.optionId)!;
        return { optionId: option.id, optionName: option.name, priceDelta: option.priceDelta, quantity: optionSelection.quantity };
      }),
    };
  });
}

/**
 * A deliberately small, deterministic adapter that exercises the REAL
 * requirement derivation (`deriveModifierRequirements` + the shared
 * `FULFILLMENT_TYPE_REQUIREMENT` / `CUSTOMER_NAME_REQUIREMENT` /
 * `PAYMENT_METHOD_REQUIREMENT` singletons) against the real
 * `bemServidoConversationCatalog` catalog, so the recorded fixtures reflect
 * the same authority code paths production uses — not a hand-typed double.
 */
class WireFixtureAdapter implements ConversationOrderingAdapter {
  records: ConversationOrderingRecord[] = [];
  tokenHashesBySession = new Map<string, string>();
  clockMs = BASE_CLOCK_MS;
  simulateFeeChangeOnConfirm = false;
  private sessionCounter = 0;

  private tick(): string {
    this.clockMs += 60_000;
    return new Date(this.clockMs).toISOString();
  }

  async materializeDraft(_scope: ConversationScope, draft: ConversationOrderCreateDraft): Promise<DraftMaterialization> {
    const lines = draft.items.map((item) => ({ lineId: item.lineId, productId: item.productId, selectedOptions: item.selectedOptions }));
    const modifierRequirements: OrderingRequirement[] = deriveModifierRequirements(lines, bemServidoConversationCatalog);
    const items = draft.items.map((item) => {
      const product = findProduct(item.productId);
      const pricing = computeLinePricing(item, product);
      return {
        lineId: item.lineId,
        productId: item.productId,
        productName: product.name,
        baseUnitPrice: pricing.baseUnitPrice,
        selectedModifiers: buildSelectedModifiers(item, product),
        modifierDeltaTotal: pricing.modifierDeltaTotal,
        quantity: item.quantity,
        unitPrice: pricing.unitPrice,
        lineTotal: pricing.unitPrice * item.quantity,
        notes: item.notes ?? null,
      };
    });
    const subtotal = items.reduce((total, item) => total + item.lineTotal, 0);
    const fulfillment = buildFulfillment(draft.fulfillment, false);
    const customer = { name: draft.customer?.name ?? null, phone: null };
    const payment = {
      declaredMethod: draft.paymentMethod ?? null,
      pixReceiptRequired: draft.paymentMethod === 'pix',
      pixReceiptApproved: false,
    };
    const requirements: OrderingRequirement[] = [
      ...modifierRequirements,
      ...(fulfillment.type === null ? [FULFILLMENT_TYPE_REQUIREMENT] : []),
      ...(customer.name === null ? [CUSTOMER_NAME_REQUIREMENT] : []),
      ...(payment.declaredMethod === null ? [PAYMENT_METHOD_REQUIREMENT] : []),
    ];
    const revalidation = { checkedAt: new Date(this.clockMs).toISOString(), ok: true, issues: [] as Array<{ code: string; message: string }> };
    const deliveryFee = fulfillment.type === 'delivery' ? fulfillment.deliveryFee : 0;
    const readyForConfirmation = fulfillment.type !== null
      && !fulfillment.deliveryFeeToConfirm
      && customer.name !== null
      && payment.declaredMethod !== null
      && revalidation.ok
      && !requirements.some((requirement) => requirement.blocking);
    return {
      cart: { items, observations: draft.observations ?? null },
      customer,
      fulfillment,
      payment,
      pricing: { subtotal, deliveryFee, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: subtotal + deliveryFee },
      revalidation,
      requirements,
      readyForConfirmation,
    };
  }

  async findOpen(empresaId: string, remoteJid: string): Promise<ConversationOrderingRecord | null> {
    return this.records.find((record) => record.empresaId === empresaId && record.remoteJid === remoteJid && record.state === 'cart_open') ?? null;
  }

  async findByMessageId(empresaId: string, remoteJid: string, messageId: string): Promise<ConversationOrderingRecord | null> {
    return this.records.find((record) => record.empresaId === empresaId && record.remoteJid === remoteJid && record.processedMessageIds.includes(messageId)) ?? null;
  }

  async findByOrderingId(lookup: ConversationOrderLookup): Promise<ConversationOrderingRecord | null> {
    return this.records.find((record) => record.orderingId === lookup.orderingId && record.empresaId === lookup.empresaId && record.remoteJid === lookup.remoteJid) ?? null;
  }

  async createOpen(input: Omit<ConversationOrderingRecord, 'sessionId' | 'orderingId' | 'revision' | 'state' | 'updatedAt' | 'order' | 'reviewRequired'> & ConversationAiPermit): Promise<ConversationOrderingRecord> {
    this.sessionCounter += 1;
    // The real Supabase-backed adapter never persists the AI permit
    // (conversationControlId/conversationEpoch) as part of the ordering
    // record — it is only an RPC input used to fence the mutation. Pick the
    // materialization + identity fields explicitly rather than spreading
    // `input`, so the fixture snapshot never leaks those two fields onto the
    // wire the way an accidental `{...input}` would.
    const { conversationControlId: _conversationControlId, conversationEpoch: _conversationEpoch, ...persisted } = input;
    const record: ConversationOrderingRecord = {
      ...persisted,
      sessionId: `20000000-0000-4000-8000-${pad(this.sessionCounter)}`,
      orderingId: `30000000-0000-4000-8000-${pad(this.sessionCounter)}`,
      state: 'cart_open',
      revision: 1,
      updatedAt: this.tick(),
      order: null,
      reviewRequired: false,
    };
    this.records.push(record);
    return record;
  }

  async updateOpen(input: {
    current: ConversationOrderingRecord; expectedRevision: number; messageId: string;
    materialization: DraftMaterialization; pessoaId: string | null;
  } & ConversationAiPermit): Promise<DraftMutationResult> {
    const latest = await this.findByOrderingId(input.current);
    if (!latest) throw new Error('FIXTURE_RECORD_MISSING');
    if (latest.revision !== input.expectedRevision || latest.state !== 'cart_open') return { kind: 'conflict', record: latest };
    Object.assign(latest, input.materialization, {
      revision: latest.revision + 1,
      updatedAt: this.tick(),
      pessoaId: input.pessoaId,
      reviewRequired: false,
      processedMessageIds: [...latest.processedMessageIds, input.messageId],
    });
    return { kind: 'applied', record: latest };
  }

  async cancelOpen(input: { current: ConversationOrderingRecord; expectedRevision: number; messageId: string } & ConversationAiPermit): Promise<DraftMutationResult> {
    const latest = await this.findByOrderingId(input.current);
    if (!latest) throw new Error('FIXTURE_RECORD_MISSING');
    if (latest.revision !== input.expectedRevision || latest.state !== 'cart_open') return { kind: 'conflict', record: latest };
    latest.state = 'cancelled';
    latest.revision += 1;
    latest.updatedAt = this.tick();
    latest.processedMessageIds.push(input.messageId);
    return { kind: 'applied', record: latest };
  }

  async issueConfirmationToken(input: { current: ConversationOrderingRecord; tokenHash: string; expiresAt: string } & ConversationAiPermit): Promise<TokenIssuanceResult> {
    this.tokenHashesBySession.set(input.current.sessionId, input.tokenHash);
    return { kind: 'issued' };
  }

  async confirmAtomically(input: {
    current: ConversationOrderingRecord; expectedRevision: number; messageId: string;
    tokenHash: string | null; idempotencyKey: string; pessoaId: string | null;
  } & ConversationAiPermit) {
    const latest = await this.findByOrderingId(input.current);
    if (!latest) throw new Error('FIXTURE_RECORD_MISSING');
    if (latest.revision !== input.expectedRevision || latest.state !== 'cart_open') return { kind: 'conflict' as const, record: latest };
    if (!input.tokenHash || this.tokenHashesBySession.get(latest.sessionId) !== input.tokenHash) {
      throw new ConversationOrderingError('CONFIRMACAO_INVALIDA', 'Esta confirmação não é mais válida. Peça um novo resumo.');
    }
    if (this.simulateFeeChangeOnConfirm) {
      latest.fulfillment = { ...latest.fulfillment, deliveryFee: 12, deliveryFeeToConfirm: true };
      latest.pricing = { ...latest.pricing, deliveryFee: 12, total: latest.pricing.subtotal + 12 };
      latest.revalidation = {
        checkedAt: this.tick(),
        ok: false,
        issues: [{ code: 'price_changed', message: 'A taxa de entrega mudou desde o último resumo.' }],
      };
      latest.revision += 1;
      latest.updatedAt = this.tick();
      latest.reviewRequired = true;
      latest.processedMessageIds.push(input.messageId);
      return { kind: 'requires_review' as const, record: latest };
    }
    latest.state = 'confirmed_waiting_review';
    latest.pessoaId = input.pessoaId;
    latest.order = { id: `50000000-0000-4000-8000-${pad(this.records.indexOf(latest) + 1)}`, status: 'pending_review', alreadyConfirmed: false, revision: 1 };
    latest.processedMessageIds.push(input.messageId);
    return { kind: 'confirmed' as const, record: latest };
  }

  async applyAutoAccept(record: ConversationOrderingRecord): Promise<ConversationOrderingRecord> {
    // Auto-accept is deliberately disabled for these fixtures so the
    // "confirmed" example freezes at the state a restaurant sees before it
    // acts on the order: 'confirmed_waiting_review'.
    return record;
  }
}

function createFixtureOrdering() {
  const adapter = new WireFixtureAdapter();
  const ordering = createConversationOrdering(adapter, {
    createRawConfirmationToken: (record, expiresAt) => deriveConversationConfirmationToken(FIXTURE_TOKEN_SECRET, {
      empresaId: record.empresaId, remoteJid: record.remoteJid, sessionId: record.sessionId, revision: record.revision, expiresAt,
    }),
    hashConfirmationToken: (token) => hashConversationConfirmationToken(token),
    now: () => new Date(adapter.clockMs),
  });
  return { adapter, ordering };
}

// `Omit` does not distribute over `ConversationOrderCommand`'s discriminated
// union on its own (it would collapse to only the fields common to every
// variant), so this mirrors the distributive-conditional pattern already
// used for the same purpose in conversationOrdering.test.ts.
type CommandWithoutPermit = ConversationOrderCommand extends infer Command
  ? Command extends ConversationOrderCommand
    ? Omit<Command, keyof ConversationAiPermit>
    : never
  : never;

function command(partial: CommandWithoutPermit): ConversationOrderCommand {
  return { ...AI_PERMIT, ...partial } as ConversationOrderCommand;
}

async function buildPartialMontavelSnapshot(): Promise<OrderingSnapshot> {
  const { ordering } = createFixtureOrdering();
  return ordering.apply(command({
    type: 'open_or_update_draft',
    empresaId: EMPRESA_ID,
    remoteJid: REMOTE_JID,
    messageId: 'wamid.fixture-partial-montavel-000001',
    draft: {
      items: [
        {
          lineId: 'linha-massa-1',
          productId: 1007,
          quantity: 1,
          selectedOptions: [
            { groupId: 'g001', optionSelections: [{ optionId: 'o001', quantity: 1 }] },
            { groupId: 'g004', optionSelections: [{ optionId: 'o008', quantity: 1 }] },
          ],
        },
        {
          lineId: 'linha-massa-2',
          productId: 1007,
          quantity: 1,
        },
      ],
      customer: { name: 'Cliente Fixture da Silva' },
      // fulfillment and paymentMethod deliberately omitted: this is the
      // "customer hasn't chosen yet" state the wire must be able to express.
    },
  }));
}

async function buildReadySnapshot(): Promise<{ snapshot: OrderingSnapshot; adapter: WireFixtureAdapter; orderingId: string }> {
  const { adapter, ordering } = createFixtureOrdering();
  const opened = await ordering.apply(command({
    type: 'open_or_update_draft',
    empresaId: EMPRESA_ID,
    remoteJid: REMOTE_JID,
    messageId: 'wamid.fixture-ready-open-000001',
    draft: { items: [{
      lineId: 'linha-massa-1',
      productId: 1007,
      quantity: 1,
      selectedOptions: [
        { groupId: 'g001', optionSelections: [{ optionId: 'o002', quantity: 1 }] },
        { groupId: 'g002', optionSelections: [{ optionId: 'o003', quantity: 1 }] },
      ],
    }] },
  }));
  const ready = await ordering.apply(command({
    type: 'open_or_update_draft',
    empresaId: EMPRESA_ID,
    remoteJid: REMOTE_JID,
    messageId: 'wamid.fixture-ready-update-000001',
    orderingId: opened.orderingId,
    expectedRevision: opened.revision,
    draft: {
      customer: { name: 'Cliente Fixture da Silva' },
      paymentMethod: 'pix',
      fulfillment: {
        type: 'delivery',
        asap: true,
        deliveryAddress: 'Rua Fixture, 100',
        deliveryNeighborhood: 'Bairro Fixture',
        deliveryNumber: '100',
      },
    },
  }));
  return { snapshot: ready, adapter, orderingId: opened.orderingId };
}

async function buildConfirmedSnapshot(): Promise<OrderingSnapshot> {
  const { ready, adapter } = await (async () => {
    const built = await buildReadySnapshot();
    return { ready: built.snapshot, adapter: built.adapter };
  })();
  // buildReadySnapshot created its own ordering instance; re-derive one bound
  // to the same adapter so the confirm command replays against the exact
  // in-memory record (mirrors production: one adapter instance per process).
  const ordering = createConversationOrdering(adapter, {
    createRawConfirmationToken: (record, expiresAt) => deriveConversationConfirmationToken(FIXTURE_TOKEN_SECRET, {
      empresaId: record.empresaId, remoteJid: record.remoteJid, sessionId: record.sessionId, revision: record.revision, expiresAt,
    }),
    hashConfirmationToken: (token) => hashConversationConfirmationToken(token),
    now: () => new Date(adapter.clockMs),
  });
  return ordering.apply(command({
    type: 'confirm_draft',
    empresaId: EMPRESA_ID,
    remoteJid: REMOTE_JID,
    messageId: 'wamid.fixture-confirmed-000001',
    orderingId: ready.orderingId,
    expectedRevision: ready.revision,
    confirmationToken: ready.confirmationAction!.token,
  }));
}

async function buildCancelledSnapshot(): Promise<OrderingSnapshot> {
  const { ordering } = createFixtureOrdering();
  const opened = await ordering.apply(command({
    type: 'open_or_update_draft',
    empresaId: EMPRESA_ID,
    remoteJid: REMOTE_JID,
    messageId: 'wamid.fixture-cancelled-open-000001',
    draft: {
      items: [{ lineId: 'linha-bebida-1', productId: 1001, quantity: 2 }],
      customer: { name: 'Cliente Fixture da Silva' },
      paymentMethod: 'dinheiro',
      fulfillment: { type: 'pickup', asap: true },
    },
  }));
  return ordering.apply(command({
    type: 'cancel_draft',
    empresaId: EMPRESA_ID,
    remoteJid: REMOTE_JID,
    messageId: 'wamid.fixture-cancelled-cancel-000001',
    orderingId: opened.orderingId,
    expectedRevision: opened.revision,
  }));
}

async function buildReviewRequiredSnapshot(): Promise<OrderingSnapshot> {
  const built = await buildReadySnapshot();
  built.adapter.simulateFeeChangeOnConfirm = true;
  const ordering = createConversationOrdering(built.adapter, {
    createRawConfirmationToken: (record, expiresAt) => deriveConversationConfirmationToken(FIXTURE_TOKEN_SECRET, {
      empresaId: record.empresaId, remoteJid: record.remoteJid, sessionId: record.sessionId, revision: record.revision, expiresAt,
    }),
    hashConfirmationToken: (token) => hashConversationConfirmationToken(token),
    now: () => new Date(built.adapter.clockMs),
  });
  return ordering.apply(command({
    type: 'confirm_draft',
    empresaId: EMPRESA_ID,
    remoteJid: REMOTE_JID,
    messageId: 'wamid.fixture-review-required-000001',
    orderingId: built.orderingId,
    expectedRevision: built.snapshot.revision,
    confirmationToken: built.snapshot.confirmationAction!.token,
  }));
}

export type WireFixtureSnapshots = {
  'snapshot.partial-montavel.json': OrderingSnapshot;
  'snapshot.ready.json': OrderingSnapshot;
  'snapshot.confirmed.json': OrderingSnapshot;
  'snapshot.cancelled.json': OrderingSnapshot;
  'snapshot.review-required.json': OrderingSnapshot;
};

export async function buildWireFixtureSnapshots(): Promise<WireFixtureSnapshots> {
  const [partial, readyBuilt, confirmed, cancelled, reviewRequired] = await Promise.all([
    buildPartialMontavelSnapshot(),
    buildReadySnapshot(),
    buildConfirmedSnapshot(),
    buildCancelledSnapshot(),
    buildReviewRequiredSnapshot(),
  ]);
  return {
    'snapshot.partial-montavel.json': partial,
    'snapshot.ready.json': readyBuilt.snapshot,
    'snapshot.confirmed.json': confirmed,
    'snapshot.cancelled.json': cancelled,
    'snapshot.review-required.json': reviewRequired,
  };
}
