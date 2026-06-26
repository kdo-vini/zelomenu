import { getServiceSupabase } from './supabaseServer.js'

export interface MesaRow {
  id: string
  numero: string
  capacidade: number | null
  status: string
  ativa: boolean
}

export type MesaContextResult =
  | { ok: true; comanda_id: string; comanda_status: string; mesa_numero: string }
  | { ok: false; error: 'SEM_COMANDA' | 'MESA_NOT_FOUND' }

export async function getMesaContext(
  mesaId: string,
  empresaId: string,
): Promise<MesaContextResult> {
  const db = getServiceSupabase()

  const { data: mesa, error: mesaError } = await db
    .from('mesas')
    .select('id, numero, ativa')
    .eq('id', mesaId)
    .eq('id_usuario', empresaId)
    .maybeSingle()

  if (mesaError) throw mesaError
  if (!mesa || !mesa.ativa) return { ok: false, error: 'MESA_NOT_FOUND' }

  const { data: comanda, error: comandaError } = await db
    .from('comandas')
    .select('id, status')
    .eq('id_mesa', mesaId)
    .eq('id_usuario', empresaId)
    .eq('status', 'aberta')
    .order('aberta_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (comandaError) throw comandaError

  if (!comanda) return { ok: false, error: 'SEM_COMANDA' }

  return {
    ok: true,
    comanda_id: comanda.id,
    comanda_status: comanda.status,
    mesa_numero: mesa.numero,
  }
}

export async function listMesasForAdmin(empresaId: string): Promise<MesaRow[]> {
  const db = getServiceSupabase()

  const { data, error } = await db
    .from('mesas')
    .select('id, numero, capacidade, status, ativa')
    .eq('id_usuario', empresaId)
    .eq('ativa', true)
    .order('numero', { ascending: true })

  if (error) throw error
  return (data as MesaRow[] | null) ?? []
}
