import { describe, expect, it } from 'vitest';
import {
  hasActiveZeloMenuAccess,
  selectLatestZeloMenuSubscriptions,
  type ZeloMenuSubscriptionRecord,
} from './zelomenuAccess';

const future = '2099-01-01T00:00:00.000Z';
const past = '2020-01-01T00:00:00.000Z';

function subscription(overrides: Partial<ZeloMenuSubscriptionRecord> = {}): ZeloMenuSubscriptionRecord {
  return {
    status: 'active',
    plan_tier: 'pdv',
    current_period_end: future,
    manually_extended_until: null,
    has_zelo_menu: false,
    ...overrides,
  };
}

describe('hasActiveZeloMenuAccess', () => {
  it('rejects an inactive subscription even when the plan includes ZeloMenu', () => {
    expect(hasActiveZeloMenuAccess(subscription({ plan_tier: 'chat', status: 'canceled' }))).toBe(false);
  });

  it('rejects a pdv subscription without the ZeloMenu flag', () => {
    expect(hasActiveZeloMenuAccess(subscription())).toBe(false);
  });

  it('accepts a pdv subscription with the ZeloMenu flag', () => {
    expect(hasActiveZeloMenuAccess(subscription({ has_zelo_menu: true }))).toBe(true);
  });

  it('accepts chat and bundle subscriptions while they are active', () => {
    expect(hasActiveZeloMenuAccess(subscription({ plan_tier: 'chat' }))).toBe(true);
    expect(hasActiveZeloMenuAccess(subscription({ plan_tier: 'bundle' }))).toBe(true);
  });

  it('uses the later manual extension when the billing period is expired', () => {
    expect(hasActiveZeloMenuAccess(subscription({
      current_period_end: past,
      manually_extended_until: future,
      has_zelo_menu: true,
    }))).toBe(true);
  });

  it('rejects an expired subscription with no valid extension', () => {
    expect(hasActiveZeloMenuAccess(subscription({ current_period_end: past }))).toBe(false);
  });
});

describe('selectLatestZeloMenuSubscriptions', () => {
  it('keeps the newest subscription row for each owner', () => {
    const rows: Array<ZeloMenuSubscriptionRecord & { user_id: string; updated_at: string }> = [
      { ...subscription({ has_zelo_menu: false }), user_id: 'owner-a', updated_at: '2026-01-02T00:00:00.000Z' },
      { ...subscription({ plan_tier: 'chat' }), user_id: 'owner-b', updated_at: '2026-01-01T00:00:00.000Z' },
      { ...subscription({ has_zelo_menu: true }), user_id: 'owner-a', updated_at: '2026-01-01T00:00:00.000Z' },
    ];

    const latest = selectLatestZeloMenuSubscriptions(rows);

    expect(latest.get('owner-a')?.has_zelo_menu).toBe(false);
    expect(latest.get('owner-b')?.plan_tier).toBe('chat');
  });
});
