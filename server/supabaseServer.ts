import type { Request } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import { fetchWithDeadline } from './fetchWithDeadline.js';
import { BoundedMap } from './boundedMap.js';

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
      global: { fetch: fetchWithDeadline },
    });
  }
  return serviceClient;
}

const empresaUserIdCache = new BoundedMap<string, { userId: string; cachedAt: number }>(1000);
const EMPRESA_CACHE_TTL_MS = 5 * 60 * 1000;

// ─── Bearer-auth helpers ────────────────────────────────────────────────────────

const empresaIdCache = new BoundedMap<string, { empresaId: string; cachedAt: number }>(1000);

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

export async function resolveEmpresaIdFromToken(token: string): Promise<string> {
  const supabase = getServiceSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) throw new Error('UNAUTHORIZED');

  const userId = authData.user.id;
  const cached = empresaIdCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < EMPRESA_CACHE_TTL_MS) return cached.empresaId;

  const { data: empresa, error: empresaError } = await supabase
    .from('empresa_perfil')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (empresaError) throw new Error(empresaError.message);
  if (!empresa?.id) throw new Error('EMPRESA_NOT_FOUND');

  empresaIdCache.set(userId, { empresaId: empresa.id as string, cachedAt: Date.now() });
  return empresa.id as string;
}

export async function requireEmpresaId(req: Request): Promise<string> {
  const existingEmpresaId = (req as Request & { empresaId?: string }).empresaId;
  if (existingEmpresaId) return existingEmpresaId;

  const token = extractBearerToken(req);
  if (!token) throw new Error('UNAUTHORIZED');
  const empresaId = await resolveEmpresaIdFromToken(token);
  (req as Request & { empresaId?: string }).empresaId = empresaId;
  return empresaId;
}

export async function getEmpresaUserId(empresaId: string): Promise<string | null> {
  const cached = empresaUserIdCache.get(empresaId);
  if (cached && Date.now() - cached.cachedAt < EMPRESA_CACHE_TTL_MS) return cached.userId;
  const { data, error } = await getServiceSupabase()
    .from('empresa_perfil')
    .select('user_id')
    .eq('id', empresaId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.user_id) return null;
  empresaUserIdCache.set(empresaId, { userId: data.user_id, cachedAt: Date.now() });
  return data.user_id;
}
