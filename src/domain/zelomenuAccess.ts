import {
  hasZeloMenuAccess,
  type ZeloMenuPlanTier,
} from './zelomenuEntitlements';
import { isSubscriptionCurrentlyActive } from './subscription';

export interface ZeloMenuSubscriptionRecord {
  user_id?: string;
  updated_at?: string | null;
  status: string | null;
  plan_tier: string | null;
  current_period_end: string | null;
  manually_extended_until: string | null;
  has_zelo_menu: boolean | null;
}

export function selectLatestZeloMenuSubscriptions(
  rows: ReadonlyArray<ZeloMenuSubscriptionRecord & { user_id: string }>,
): Map<string, ZeloMenuSubscriptionRecord & { user_id: string }> {
  const latestByUser = new Map<string, ZeloMenuSubscriptionRecord & { user_id: string }>();

  for (const row of rows) {
    const current = latestByUser.get(row.user_id);
    if (!current) {
      latestByUser.set(row.user_id, row);
      continue;
    }

    const currentUpdatedAt = current.updated_at ? Date.parse(current.updated_at) : 0;
    const rowUpdatedAt = row.updated_at ? Date.parse(row.updated_at) : 0;
    if (rowUpdatedAt >= currentUpdatedAt) latestByUser.set(row.user_id, row);
  }

  return latestByUser;
}

function normalizePlanTier(value: string | null): ZeloMenuPlanTier | null {
  return value === 'pdv' || value === 'chat' || value === 'bundle' ? value : null;
}

export function hasActiveZeloMenuAccess(
  subscription: ZeloMenuSubscriptionRecord | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!subscription) return false;

  return hasZeloMenuAccess({
    planTier: normalizePlanTier(subscription.plan_tier),
    active: isSubscriptionCurrentlyActive(subscription, nowMs),
    hasZeloMenuFlag: subscription.has_zelo_menu,
  });
}
