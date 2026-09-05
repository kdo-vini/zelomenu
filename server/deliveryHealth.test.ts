import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-health-fixture'; return { error: null as any, count: 1250, calls: [] as any[] }; });
vi.mock('./supabaseServer.js', () => ({ getServiceSupabase: () => ({ from: (table: string) => {
  const q: any = { select: (...args: any[]) => { state.calls.push(['select', ...args]); return q; }, eq: (...args: any[]) => { state.calls.push(['eq', ...args]); return q; },
    gt: () => q, order: () => q, limit: (...args: any[]) => { state.calls.push(['limit', ...args]); return q; },
    then: (resolve: any) => Promise.resolve(table === 'zelomenu_delivery_quote_requests'
      ? { data: [{ created_at: new Date(Date.now() - 1000).toISOString() }], error: state.error, count: state.count }
      : { data: [], error: null }).then(resolve) };
  return q;
} }) }));
import { getDeliveryHealth } from './zelomenuDeliveryService';
beforeEach(() => { state.error = null; state.calls = []; });

it('uses the exact tenant count with only the oldest pending row fetched', async () => {
  expect(await getDeliveryHealth('company-1')).toMatchObject({ supabase: 'ok', pendingRequests: 1250 });
  expect(state.calls).toContainEqual(['select', 'created_at', { count: 'exact' }]);
  expect(state.calls).toContainEqual(['eq', 'company_id', 'company-1']);
  expect(state.calls).toContainEqual(['limit', 1]);
});
it('reports unavailable counts as null and marks database health as failed', async () => {
  state.error = { code: '08006' };
  expect(await getDeliveryHealth('company-1')).toMatchObject({ supabase: 'error', pendingRequests: null });
});
