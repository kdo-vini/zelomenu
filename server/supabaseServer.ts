import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

let serviceClient: SupabaseClient | null = null;

function getSupabaseUrl(): string {
  const value = process.env.SUPABASE_URL;
  if (!value) throw new Error('SUPABASE_URL not set');
  return value;
}

function getServiceRoleKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
  return value;
}

export function getServiceSupabase(): SupabaseClient {
  if (!serviceClient) {
    serviceClient = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: ws as any },
    });
  }
  return serviceClient;
}

const empresaUserIdCache = new Map<string, { userId: string; cachedAt: number }>();
const EMPRESA_CACHE_TTL_MS = 5 * 60 * 1000;

export async function getEmpresaUserId(empresaId: string): Promise<string | null> {
  const cached = empresaUserIdCache.get(empresaId);
  if (cached && Date.now() - cached.cachedAt < EMPRESA_CACHE_TTL_MS) return cached.userId;
  const { data, error } = await getServiceSupabase()
    .from('empresa_perfil')
    .select('user_id')
    .eq('id', empresaId)
    .maybeSingle();
  if (error || !data?.user_id) return null;
  empresaUserIdCache.set(empresaId, { userId: data.user_id, cachedAt: Date.now() });
  return data.user_id;
}
