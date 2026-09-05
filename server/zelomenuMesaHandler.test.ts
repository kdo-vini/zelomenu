import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mesa: { data: { id: 'mesa', numero: '1', ativa: true } as Record<string, unknown> | null, error: null as Error | null },
  comanda: { data: { id: 'comanda', status: 'aberta' } as Record<string, unknown> | null, error: null as Error | null },
  filters: [] as Array<[string, string, unknown]>,
}));
vi.mock('./supabaseServer.js', () => ({ getServiceSupabase: () => ({
  from: (table: string) => {
    const query = {
      select: () => query, order: () => query, limit: () => query,
      eq: (column: string, value: unknown) => { mocks.filters.push([table, column, value]); return query; },
      maybeSingle: async () => table === 'mesas' ? mocks.mesa : mocks.comanda,
    };
    return query;
  },
}) }));
import { getMesaContext } from './zelomenuMesaHandler';

beforeEach(() => {
  mocks.filters = [];
  mocks.mesa = { data: { id: 'mesa', numero: '1', ativa: true }, error: null };
  mocks.comanda = { data: { id: 'comanda', status: 'aberta' }, error: null };
});

describe('getMesaContext — actual service boundary', () => {
  it('retorna a comanda aberta e aplica dono/mesa nas duas consultas', async () => {
    expect(await getMesaContext('mesa', 'owner')).toEqual({ ok: true, comanda_id: 'comanda', comanda_status: 'aberta', mesa_numero: '1' });
    expect(mocks.filters).toEqual(expect.arrayContaining([
      ['mesas', 'id', 'mesa'], ['mesas', 'id_usuario', 'owner'],
      ['comandas', 'id_mesa', 'mesa'], ['comandas', 'id_usuario', 'owner'], ['comandas', 'status', 'aberta'],
    ]));
  });
  it('rejeita mesa ausente sem consultar comandas', async () => {
    mocks.mesa.data = null;
    expect(await getMesaContext('mesa', 'owner')).toEqual({ ok: false, error: 'MESA_NOT_FOUND' });
    expect(mocks.filters.every(([table]) => table === 'mesas')).toBe(true);
  });
  it('rejeita mesa desativada', async () => {
    mocks.mesa.data!.ativa = false;
    expect(await getMesaContext('mesa', 'owner')).toEqual({ ok: false, error: 'MESA_NOT_FOUND' });
  });
  it('retorna SEM_COMANDA quando nenhuma comanda aberta existe', async () => {
    mocks.comanda.data = null;
    expect(await getMesaContext('mesa', 'owner')).toEqual({ ok: false, error: 'SEM_COMANDA' });
  });
  it.each(['mesa', 'comanda'] as const)('propaga erro de consulta em %s', async (table) => {
    mocks[table].error = new Error('database failure');
    await expect(getMesaContext('mesa', 'owner')).rejects.toThrow('database failure');
  });
});
