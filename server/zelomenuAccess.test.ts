import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireEmpresaId: vi.fn(),
  getEmpresaUserId: vi.fn(),
  maybeSingle: vi.fn(),
  subscriptionsResult: { data: [] as unknown[], error: null as unknown },
}));

vi.mock('./supabaseServer.js', () => ({
  requireEmpresaId: mocks.requireEmpresaId,
  getEmpresaUserId: mocks.getEmpresaUserId,
  getServiceSupabase: vi.fn(() => ({
    from: vi.fn(() => {
      const query = {
        range: vi.fn(() => query),
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        in: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn(() => query),
        maybeSingle: mocks.maybeSingle,
        then: (onFulfilled: (value: unknown) => unknown) => Promise.resolve(mocks.subscriptionsResult).then(onFulfilled),
      };
      return query;
    }),
  })),
}));

import { getEligibleZeloMenuUserIds, requireZeloMenuAccess } from './zelomenuAccess';

const activePdvSubscription = {
  user_id: 'user-1',
  status: 'active',
  plan_tier: 'pdv',
  current_period_end: '2099-01-01T00:00:00.000Z',
  manually_extended_until: null,
  has_zelo_menu: true,
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('requireZeloMenuAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireEmpresaId.mockResolvedValue('empresa-1');
    mocks.getEmpresaUserId.mockResolvedValue('user-1');
    mocks.maybeSingle.mockResolvedValue({ data: activePdvSubscription, error: null });
  });

  it('propagates unauthorized access before checking entitlement', async () => {
    mocks.requireEmpresaId.mockRejectedValue(new Error('UNAUTHORIZED'));

    await expect(requireZeloMenuAccess({} as never)).rejects.toThrow('UNAUTHORIZED');
    expect(mocks.getEmpresaUserId).not.toHaveBeenCalled();
  });

  it('rejects an authenticated company without ZeloMenu access', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { ...activePdvSubscription, has_zelo_menu: false },
      error: null,
    });

    await expect(requireZeloMenuAccess({} as never)).rejects.toThrow('ZELOMENU_ACCESS_REQUIRED');
  });

  it('returns the company id for an eligible company', async () => {
    await expect(requireZeloMenuAccess({} as never)).resolves.toBe('empresa-1');
  });
});

describe('getEligibleZeloMenuUserIds', () => {
  it('returns only owners whose newest subscription grants ZeloMenu', async () => {
    mocks.subscriptionsResult = {
      data: [
        { ...activePdvSubscription, user_id: 'owner-a', has_zelo_menu: false, updated_at: '2026-01-02T00:00:00.000Z' },
        { ...activePdvSubscription, user_id: 'owner-a', has_zelo_menu: true, updated_at: '2026-01-01T00:00:00.000Z' },
        { ...activePdvSubscription, user_id: 'owner-b', plan_tier: 'chat', has_zelo_menu: false },
        { ...activePdvSubscription, user_id: 'owner-c', current_period_end: '2020-01-01T00:00:00.000Z' },
      ],
      error: null,
    };

    const eligible = await getEligibleZeloMenuUserIds(['owner-a', 'owner-b', 'owner-c']);

    expect(eligible).toEqual(new Set(['owner-b']));
  });
});
