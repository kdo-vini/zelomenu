import { readAllRows } from '../src/utils/readAllRows.js';
import type { Request } from 'express';
import {
  getEmpresaUserId,
  getServiceSupabase,
  requireEmpresaId,
} from './supabaseServer.js';
import {
  hasActiveZeloMenuAccess,
  selectLatestZeloMenuSubscriptions,
  type ZeloMenuSubscriptionRecord,
} from '../src/domain/zelomenuAccess.js';

const SUBSCRIPTION_COLUMNS = 'user_id, status, plan_tier, current_period_end, manually_extended_until, has_zelo_menu, updated_at';

export type ZeloMenuSubscriptionRow = ZeloMenuSubscriptionRecord & {
  user_id: string;
  updated_at: string | null;
};

export async function getLatestZeloMenuSubscription(userId: string): Promise<ZeloMenuSubscriptionRow | null> {
  const { data, error } = await getServiceSupabase()
    .from('subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as ZeloMenuSubscriptionRow | null) ?? null;
}

export async function hasZeloMenuAccessForUser(userId: string): Promise<boolean> {
  return hasActiveZeloMenuAccess(await getLatestZeloMenuSubscription(userId));
}

export async function hasZeloMenuAccessForEmpresa(empresaId: string): Promise<boolean> {
  const userId = await getEmpresaUserId(empresaId);
  return userId ? hasZeloMenuAccessForUser(userId) : false;
}

export async function getEligibleZeloMenuUserIds(userIds: readonly string[]): Promise<Set<string>> {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) return new Set();

  const { data, error } = await readAllRows((from, to) => getServiceSupabase()
    .from('subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .in('user_id', uniqueUserIds)
    .order('updated_at', { ascending: false }).order('id').range(from, to));

  if (error) throw error;

  const latestByUser = selectLatestZeloMenuSubscriptions((data ?? []) as ZeloMenuSubscriptionRow[]);
  return new Set(
    [...latestByUser.entries()]
      .filter(([, subscription]) => hasActiveZeloMenuAccess(subscription))
      .map(([userId]) => userId),
  );
}

export async function requireZeloMenuAccess(req: Request): Promise<string> {
  const empresaId = await requireEmpresaId(req);
  if (!(await hasZeloMenuAccessForEmpresa(empresaId))) {
    throw new Error('ZELOMENU_ACCESS_REQUIRED');
  }
  return empresaId;
}
