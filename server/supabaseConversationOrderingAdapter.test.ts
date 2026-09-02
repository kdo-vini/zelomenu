import { describe, expect, it, vi } from 'vitest';
import type { ConversationOrderingRecord } from './conversationOrdering';
import { SupabaseConversationOrderingAdapter } from './supabaseConversationOrderingAdapter';
import { deriveModifierRequirements } from './conversationOrderRequirements';
import { bemServidoConversationCatalog } from './fixtures/bemServidoConversationCatalog';

vi.hoisted(() => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ordering-adapter.test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key-for-ordering-adapter';
});

const materializeWhatsAppOrderDraft = vi.hoisted(() => vi.fn());

vi.mock('./zelomenuCartSessions', async (importOriginal) => ({
  ...await importOriginal<typeof import('./zelomenuCartSessions')>(),
  materializeWhatsAppOrderDraft,
}));

const EMPRESA = '10000000-0000-4000-8000-000000000001';

function record(overrides: Partial<ConversationOrderingRecord> = {}): ConversationOrderingRecord {
  return {
    sessionId: '20000000-0000-4000-8000-000000000001',
    orderingId: '30000000-0000-4000-8000-000000000001',
    empresaId: '10000000-0000-4000-8000-000000000001',
    remoteJid: '5511999999999@s.whatsapp.net',
    state: 'cart_open',
    revision: 1,
    updatedAt: '2026-08-30T12:00:00.000Z',
    pessoaId: null,
    processedMessageIds: ['wamid.open-atomic-contract'],
    customer: { name: null, phone: null },
    cart: { items: [], observations: null },
    fulfillment: { type: 'pickup', asap: true, pickupDate: null, pickupTime: null, deliveryAddress: null, deliveryNeighborhood: null, deliveryFee: 0, deliveryFeeToConfirm: false },
    pricing: { subtotal: 0, deliveryFee: 0, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: 0 },
    payment: { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false },
    revalidation: { checkedAt: '2026-08-30T12:00:00.000Z', ok: true, issues: [] },
    requirements: [],
    readyForConfirmation: true,
    order: null,
    ...overrides,
  };
}

function adapterWithRpc(result: { data: unknown; error: { message: string } | null }, refreshed = record()) {
  const rpc = vi.fn(async () => result);
  const adapter = new SupabaseConversationOrderingAdapter({ rpc } as never);
  Object.defineProperty(adapter, 'findRequired', { value: vi.fn(async () => refreshed) });
  return { adapter, rpc };
}

describe('SupabaseConversationOrderingAdapter confirmação atômica', () => {
  it('preserva requisitos e decisão de prontidão produzidos pelo materializador', async () => {
    const requirements = deriveModifierRequirements(
      [{ lineId: 'line-1', productId: 1007 }],
      bemServidoConversationCatalog,
    );
    materializeWhatsAppOrderDraft.mockResolvedValueOnce({
      cart: {
        items: [{
          productId: 1007,
          productName: 'Monte Sua Massa',
          baseUnitPrice: 0,
          selectedModifiers: [],
          modifierDeltaTotal: 0,
          quantity: 1,
          unitPrice: 0,
          lineTotal: 0,
          notes: null,
        }],
        observations: null,
      },
      customer: { name: null, phone: null },
      fulfillment: {
        type: 'pickup',
        asap: true,
        pickupDate: null,
        pickupTime: null,
        deliveryAddress: null,
        deliveryNeighborhood: null,
        deliveryFee: 0,
        deliveryFeeToConfirm: false,
      },
      payment: { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false },
      pricing: {
        subtotal: 0,
        deliveryFee: 0,
        discount: 0,
        couponCode: null,
        couponDiscountType: null,
        couponDiscountValue: null,
        total: 0,
      },
      revalidation: { checkedAt: '2026-08-30T12:00:00.000Z', ok: true, issues: [] },
      requirements,
      readyForConfirmation: false,
    });
    const adapter = new SupabaseConversationOrderingAdapter({} as never);

    const result = await adapter.materializeDraft(EMPRESA, {
      items: [{ lineId: 'line-1', productId: 1007, quantity: 1 }],
      fulfillment: { type: 'pickup' },
    });

    expect(result.requirements).toEqual(requirements);
    expect(result.readyForConfirmation).toBe(false);
    expect(result.cart.items[0].lineId).toBe('line-1');
  });

  it.each([
    { label: 'texto', tokenHash: null },
    { label: 'botão', tokenHash: 'a'.repeat(64) },
  ])('usa a mesma RPC transacional para $label e preserva requiresReview', async ({ tokenHash }) => {
    const current = record();
    const reviewed = record({ revision: 2, revalidation: { checkedAt: '2026-08-30T12:01:00.000Z', ok: false, issues: [{ code: 'stock_insufficient', message: 'Revise a quantidade.' }] } });
    const { adapter, rpc } = adapterWithRpc({ data: { outcome: 'requires_review' }, error: null }, reviewed);

    await expect(adapter.confirmAtomically({
      current,
      expectedRevision: 1,
      messageId: 'wamid.confirm-atomic-contract',
      tokenHash,
      idempotencyKey: 'whatsapp:session:message',
      pessoaId: '40000000-0000-4000-8000-000000000001',
    })).resolves.toEqual({ kind: 'requires_review', record: reviewed });
    expect(rpc).toHaveBeenCalledWith('confirm_whatsapp_zelo_order_atomic_v1', {
      p_empresa_id: current.empresaId,
      p_source_ref: current.remoteJid,
      p_session_id: current.sessionId,
      p_expected_revision: 1,
      p_message_id: 'wamid.confirm-atomic-contract',
      p_idempotency_key: 'whatsapp:session:message',
      p_pessoa_id: '40000000-0000-4000-8000-000000000001',
      p_token_hash: tokenHash,
    });
  });

  it('falha fechado quando a RPC canônica ainda não existe', async () => {
    const current = record();
    const { adapter } = adapterWithRpc({ data: null, error: { message: 'function confirm_whatsapp_zelo_order_atomic_v1 does not exist' } });

    await expect(adapter.confirmAtomically({
      current, expectedRevision: 1, messageId: 'wamid.missing-rpc-contract', tokenHash: null,
      idempotencyKey: 'whatsapp:session:missing', pessoaId: null,
    })).rejects.toMatchObject({ code: 'CONFIRMACAO_INDISPONIVEL', currentSnapshot: null });
  });

  it('relê a sessão quando a emissão de token perde a revisão', async () => {
    const current = record();
    const latest = record({ revision: 2 });
    const { adapter } = adapterWithRpc({ data: null, error: { message: 'SESSION_REVISION_MISMATCH' } }, latest);

    await expect(adapter.issueConfirmationToken({ current, tokenHash: 'b'.repeat(64), expiresAt: '2026-08-30T12:10:00.000Z' }))
      .resolves.toEqual({ kind: 'conflict', record: latest });
  });
});
