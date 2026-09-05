// Recorded wire fixtures for the ZeloMenu <-> ZeloChat conversational-ordering
// contract. The recorder drives the production materializer, Supabase adapter
// and row mapper; only persistence/geocoding boundaries are deterministic fakes.
import {
  createConversationOrdering,
  type ConversationAiPermit,
  type ConversationOrderCommand,
  type ConversationOrderingRecord,
  type OrderingSnapshot,
} from './conversationOrdering.js';
import { getConfig, type BusinessConfig } from './configStore.js';
import { deriveConversationConfirmationToken, hashConversationConfirmationToken } from './conversationConfirmationToken.js';
import { bemServidoConversationCatalog } from './fixtures/bemServidoConversationCatalog.js';
import { SupabaseConversationOrderingAdapter } from './supabaseConversationOrderingAdapter.js';

const FIXTURE_TOKEN_SECRET = 'fixture-only-hmac-secret-never-used-in-prod-00';
export const EMPRESA_ID = '10000000-0000-4000-8000-0000000000f1';
export const REMOTE_JID = '5511900000001@s.whatsapp.net';
const AI_PERMIT: ConversationAiPermit = {
  conversationControlId: '60000000-0000-4000-8000-0000000000f1',
  conversationEpoch: '1',
};
const BASE_CLOCK_MS = Date.parse('2026-09-03T12:00:00.000Z');

function pad(n: number): string {
  return String(n).padStart(12, '0');
}

type FixtureSessionRow = {
  id: string; empresa_id: string; ordering_id: string; context: 'whatsapp_order';
  state: ConversationOrderingRecord['state']; source_ref: string;
  customer_snapshot: ConversationOrderingRecord['customer'];
  cart_snapshot: ConversationOrderingRecord['cart'];
  fulfillment_snapshot: ConversationOrderingRecord['fulfillment'];
  pricing_snapshot: ConversationOrderingRecord['pricing'];
  payment_snapshot: ConversationOrderingRecord['payment'];
  metadata: Record<string, unknown>; revision: number; last_revalidated_at: string;
  last_revalidation: ConversationOrderingRecord['revalidation'];
  requirements_snapshot: ConversationOrderingRecord['requirements'];
  ready_for_confirmation: boolean; archived_at: null; created_at: string; updated_at: string;
};
type FixtureOrderRow = { id: string; zelomenu_session_id: string; status: string; revision: number };
type FixtureQuery = {
  eq(column: string, value: unknown): FixtureQuery;
  contains(column: string, value: Record<string, unknown>): FixtureQuery;
  order(column: string, options: unknown): FixtureQuery;
  limit(count: number): FixtureQuery;
  maybeSingle(): Promise<{ data: FixtureSessionRow | FixtureOrderRow | null; error: null }>;
};

const FIXTURE_CONFIG: BusinessConfig = {
  ...getConfig('__conversation_wire_fixture__'),
  deliveryConfig: { enabled: true, neighborhoods: [] },
  products: bemServidoConversationCatalog.map((product) => ({
    ...product,
    price: product.basePrice,
    modifierGroups: product.modifierGroups.map((group) => ({
      ...group,
      productId: product.id,
      active: true,
      options: group.options.map((option) => ({
        id: option.id,
        name: option.name,
        priceDelta: option.priceDelta,
        active: option.available,
        order: option.order,
      })),
    })),
  })) as unknown as BusinessConfig['products'],
};

function processedMessageIds(row: FixtureSessionRow): string[] {
  return Array.isArray(row.metadata.processedMessageIds)
    ? row.metadata.processedMessageIds.filter((value): value is string => typeof value === 'string')
    : [];
}

/** Fake only the database boundary, returning the snake_case rows/RPC outcomes
 * consumed by the real `SupabaseConversationOrderingAdapter.mapRow` path. */
class WireFixturePersistence {
  readonly sessions: FixtureSessionRow[] = [];
  readonly orders: FixtureOrderRow[] = [];
  readonly tokenHashesBySession = new Map<string, string>();
  clockMs = BASE_CLOCK_MS;
  simulateFeeChangeOnConfirm = false;
  private sessionCounter = 0;

  private tick(): string {
    this.clockMs += 60_000;
    return new Date(this.clockMs).toISOString();
  }

  private sessionById(id: unknown): FixtureSessionRow | undefined {
    return this.sessions.find((row) => row.id === id);
  }

  readonly from = (table: string) => ({
    select: (_columns: string): FixtureQuery => {
      const filters = new Map<string, unknown>();
      let containment: { column: string; value: Record<string, unknown> } | null = null;
      const query: FixtureQuery = {
        eq: (column, value) => { filters.set(column, value); return query; },
        contains: (column, value) => { containment = { column, value }; return query; },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => {
          const source: Array<FixtureSessionRow | FixtureOrderRow> = table === 'zelomenu_cart_sessions'
            ? this.sessions : table === 'zelo_orders' ? this.orders : [];
          const data = source.find((row) => {
            const record = row as unknown as Record<string, unknown>;
            if (![...filters].every(([column, value]) => record[column] === value)) return false;
            if (!containment) return true;
            const container = record[containment.column];
            if (!container || typeof container !== 'object') return false;
            return Object.entries(containment.value).every(([key, expected]) => {
              const actual = (container as Record<string, unknown>)[key];
              return Array.isArray(expected) && Array.isArray(actual)
                ? expected.every((value) => actual.includes(value)) : actual === expected;
            });
          }) ?? null;
          return { data, error: null };
        },
      };
      return query;
    },
  });

  readonly rpc = async (name: string, params: Record<string, unknown>) => {
    if (name === 'zelomenu_open_whatsapp_order_with_ai_epoch_v1') {
      this.sessionCounter += 1;
      const timestamp = this.tick();
      const row: FixtureSessionRow = {
        id: `20000000-0000-4000-8000-${pad(this.sessionCounter)}`,
        empresa_id: String(params.p_empresa_id),
        ordering_id: `30000000-0000-4000-8000-${pad(this.sessionCounter)}`,
        context: 'whatsapp_order', state: 'cart_open', source_ref: String(params.p_source_ref),
        customer_snapshot: params.p_customer_snapshot as FixtureSessionRow['customer_snapshot'],
        cart_snapshot: params.p_cart_snapshot as FixtureSessionRow['cart_snapshot'],
        fulfillment_snapshot: params.p_fulfillment_snapshot as FixtureSessionRow['fulfillment_snapshot'],
        pricing_snapshot: params.p_pricing_snapshot as FixtureSessionRow['pricing_snapshot'],
        payment_snapshot: params.p_payment_snapshot as FixtureSessionRow['payment_snapshot'],
        metadata: params.p_metadata as Record<string, unknown>, revision: 1,
        last_revalidated_at: String(params.p_last_revalidated_at),
        last_revalidation: params.p_last_revalidation as FixtureSessionRow['last_revalidation'],
        requirements_snapshot: params.p_requirements_snapshot as FixtureSessionRow['requirements_snapshot'],
        ready_for_confirmation: params.p_ready_for_confirmation === true,
        archived_at: null, created_at: timestamp, updated_at: timestamp,
      };
      this.sessions.push(row);
      return { data: { outcome: 'applied', orderingId: row.ordering_id }, error: null };
    }

    const row = this.sessionById(params.p_session_id);
    if (!row) return { data: { outcome: 'conflict' }, error: null };
    if (name === 'zelomenu_update_whatsapp_order_with_ai_epoch_v1') {
      if (row.state !== 'cart_open' || row.revision !== params.p_expected_revision) return { data: { outcome: 'conflict' }, error: null };
      row.customer_snapshot = params.p_customer_snapshot as FixtureSessionRow['customer_snapshot'];
      row.cart_snapshot = params.p_cart_snapshot as FixtureSessionRow['cart_snapshot'];
      row.fulfillment_snapshot = params.p_fulfillment_snapshot as FixtureSessionRow['fulfillment_snapshot'];
      row.pricing_snapshot = params.p_pricing_snapshot as FixtureSessionRow['pricing_snapshot'];
      row.payment_snapshot = params.p_payment_snapshot as FixtureSessionRow['payment_snapshot'];
      row.last_revalidated_at = String(params.p_last_revalidated_at);
      row.last_revalidation = params.p_last_revalidation as FixtureSessionRow['last_revalidation'];
      row.requirements_snapshot = params.p_requirements_snapshot as FixtureSessionRow['requirements_snapshot'];
      row.ready_for_confirmation = params.p_ready_for_confirmation === true;
      row.metadata = params.p_metadata as Record<string, unknown>;
      row.revision += 1;
      row.updated_at = this.tick();
      return { data: { outcome: 'applied' }, error: null };
    }
    if (name === 'zelomenu_cancel_whatsapp_order_with_ai_epoch_v1') {
      if (row.state !== 'cart_open' || row.revision !== params.p_expected_revision) return { data: { outcome: 'conflict' }, error: null };
      row.state = 'cancelled'; row.ready_for_confirmation = false;
      row.metadata = params.p_metadata as Record<string, unknown>;
      row.revision += 1; row.updated_at = this.tick();
      return { data: { outcome: 'applied' }, error: null };
    }
    if (name === 'issue_whatsapp_zelo_confirmation_token_with_ai_epoch_v1') {
      this.tokenHashesBySession.set(row.id, String(params.p_token_hash));
      return { data: { outcome: 'issued' }, error: null };
    }
    if (name === 'confirm_whatsapp_zelo_order_with_ai_epoch_v1') {
      if (row.state !== 'cart_open' || row.revision !== params.p_expected_revision) return { data: { outcome: 'conflict' }, error: null };
      if (this.tokenHashesBySession.get(row.id) !== params.p_token_hash) {
        return { data: null, error: { message: 'CONFIRMATION_TOKEN_INVALID' } };
      }
      const messageId = String(params.p_message_id);
      if (this.simulateFeeChangeOnConfirm) {
        row.fulfillment_snapshot = { ...row.fulfillment_snapshot, deliveryFee: 12, deliveryFeeToConfirm: true };
        row.pricing_snapshot = { ...row.pricing_snapshot, deliveryFee: 12, total: row.pricing_snapshot.subtotal + 12 };
        const checkedAt = this.tick();
        row.last_revalidation = { checkedAt, ok: false, issues: [{ code: 'price_changed', message: 'A taxa de entrega mudou desde o último resumo.' }] };
        row.last_revalidated_at = checkedAt; row.revision += 1; row.ready_for_confirmation = false;
        row.metadata = {
          ...row.metadata,
          processedMessageIds: [...processedMessageIds(row), messageId],
          conversationReview: { required: true, revision: row.revision, messageId, cause: 'issues' },
        };
        row.updated_at = this.tick();
        return { data: { outcome: 'requires_review', alreadyConfirmed: false }, error: null };
      }
      row.state = 'confirmed_waiting_review'; row.ready_for_confirmation = false;
      row.metadata = { ...row.metadata, pessoaId: params.p_pessoa_id, processedMessageIds: [...processedMessageIds(row), messageId] };
      row.updated_at = this.tick();
      const order: FixtureOrderRow = {
        id: `50000000-0000-4000-8000-${pad(this.sessions.indexOf(row) + 1)}`,
        zelomenu_session_id: row.id, status: 'pending_review', revision: 1,
      };
      this.orders.push(order);
      return { data: { outcome: 'confirmed', alreadyConfirmed: false, orderId: order.id }, error: null };
    }
    throw new Error(`FIXTURE_RPC_UNSUPPORTED:${name}`);
  };
}

function createFixtureOrdering() {
  const persistence = new WireFixturePersistence();
  const adapter = new SupabaseConversationOrderingAdapter(
    persistence as never,
    {
      loadedConfig: FIXTURE_CONFIG,
      now: () => new Date(persistence.clockMs),
      deliveryQuoter: async (input) => ({
        fee: 8,
        feeToConfirm: false,
        detail: {
          address: {
            postalCode: input.postalCode,
            number: input.number,
            complement: input.complement?.trim() ?? null,
            street: 'Rua Fixture',
            neighborhood: 'Bairro Fixture',
            city: 'São Paulo',
            state: 'SP',
          },
          coordinates: { latitude: -23.55052, longitude: -46.633308 },
          distanceM: 2400,
          deliveryFee: 8,
          status: 'eligible',
          cacheLayer: 'memory',
          quoteRequestId: null,
        },
      }),
    },
    async (input) => ({ accepted: false, status: input.status, revision: input.revision }),
  );
  const ordering = orderingFor(adapter, persistence);
  return { adapter, persistence, ordering };
}

function orderingFor(adapter: SupabaseConversationOrderingAdapter, persistence: WireFixturePersistence) {
  return createConversationOrdering(adapter, {
    createRawConfirmationToken: (record, expiresAt) => deriveConversationConfirmationToken(FIXTURE_TOKEN_SECRET, {
      empresaId: record.empresaId,
      remoteJid: record.remoteJid,
      sessionId: record.sessionId,
      revision: record.revision,
      expiresAt,
    }),
    hashConfirmationToken: hashConversationConfirmationToken,
    now: () => new Date(persistence.clockMs),
  });
}

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
          lineId: 'linha-massa-1', productId: 1007, quantity: 1,
          selectedOptions: [
            { groupId: 'g001', optionSelections: [{ optionId: 'o001', quantity: 1 }] },
            { groupId: 'g004', optionSelections: [{ optionId: 'o008', quantity: 1 }] },
          ],
        },
        { lineId: 'linha-massa-2', productId: 1007, quantity: 1 },
      ],
      customer: { name: 'Cliente Fixture da Silva' },
    },
  }));
}

type ReadyFixture = {
  snapshot: OrderingSnapshot;
  adapter: SupabaseConversationOrderingAdapter;
  persistence: WireFixturePersistence;
  orderingId: string;
};

async function buildReadySnapshot(): Promise<ReadyFixture> {
  const { adapter, persistence, ordering } = createFixtureOrdering();
  const opened = await ordering.apply(command({
    type: 'open_or_update_draft', empresaId: EMPRESA_ID, remoteJid: REMOTE_JID,
    messageId: 'wamid.fixture-ready-open-000001',
    draft: {
      items: [{
        lineId: 'linha-massa-1', productId: 1007, quantity: 1,
        selectedOptions: [
          { groupId: 'g001', optionSelections: [{ optionId: 'o002', quantity: 1 }] },
          { groupId: 'g002', optionSelections: [{ optionId: 'o003', quantity: 1 }] },
        ],
      }],
    },
  }));
  const ready = await ordering.apply(command({
    type: 'open_or_update_draft', empresaId: EMPRESA_ID, remoteJid: REMOTE_JID,
    messageId: 'wamid.fixture-ready-update-000001', orderingId: opened.orderingId,
    expectedRevision: opened.revision,
    draft: {
      customer: { name: 'Cliente Fixture da Silva' },
      paymentMethod: 'pix',
      fulfillment: {
        type: 'delivery', asap: true, deliveryAddress: 'Rua Fixture, 100',
        deliveryNeighborhood: 'Bairro Fixture', deliveryPostalCode: '01001000', deliveryNumber: '100',
      },
    },
  }));
  return { snapshot: ready, adapter, persistence, orderingId: opened.orderingId };
}

async function buildConfirmedSnapshot(): Promise<OrderingSnapshot> {
  const built = await buildReadySnapshot();
  return orderingFor(built.adapter, built.persistence).apply(command({
    type: 'confirm_draft', empresaId: EMPRESA_ID, remoteJid: REMOTE_JID,
    messageId: 'wamid.fixture-confirmed-000001', orderingId: built.orderingId,
    expectedRevision: built.snapshot.revision,
    confirmationToken: built.snapshot.confirmationAction!.token,
  }));
}

async function buildCancelledSnapshot(): Promise<OrderingSnapshot> {
  const { ordering } = createFixtureOrdering();
  const opened = await ordering.apply(command({
    type: 'open_or_update_draft', empresaId: EMPRESA_ID, remoteJid: REMOTE_JID,
    messageId: 'wamid.fixture-cancelled-open-000001',
    draft: {
      items: [{ lineId: 'linha-bebida-1', productId: 1001, quantity: 2 }],
      customer: { name: 'Cliente Fixture da Silva' }, paymentMethod: 'dinheiro',
      fulfillment: { type: 'pickup', asap: true },
    },
  }));
  return ordering.apply(command({
    type: 'cancel_draft', empresaId: EMPRESA_ID, remoteJid: REMOTE_JID,
    messageId: 'wamid.fixture-cancelled-cancel-000001', orderingId: opened.orderingId,
    expectedRevision: opened.revision,
  }));
}

async function buildReviewRequiredSnapshot(): Promise<OrderingSnapshot> {
  const built = await buildReadySnapshot();
  built.persistence.simulateFeeChangeOnConfirm = true;
  return orderingFor(built.adapter, built.persistence).apply(command({
    type: 'confirm_draft', empresaId: EMPRESA_ID, remoteJid: REMOTE_JID,
    messageId: 'wamid.fixture-review-required-000001', orderingId: built.orderingId,
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
    buildPartialMontavelSnapshot(), buildReadySnapshot(), buildConfirmedSnapshot(),
    buildCancelledSnapshot(), buildReviewRequiredSnapshot(),
  ]);
  return {
    'snapshot.partial-montavel.json': partial,
    'snapshot.ready.json': readyBuilt.snapshot,
    'snapshot.confirmed.json': confirmed,
    'snapshot.cancelled.json': cancelled,
    'snapshot.review-required.json': reviewRequired,
  };
}
