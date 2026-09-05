import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ profile: {} as Record<string, unknown>, profiles: null as Record<string, unknown>[] | null, error: null as { code: string; message: string } | null, reads: 0 }));
vi.mock('./zelomenuAccess.js', () => ({ getEligibleZeloMenuUserIds: async () => new Set(['owner']) }));
vi.mock('./supabaseServer.js', () => ({ getServiceSupabase: () => ({
  from: (table: string) => {
    let start = 0; let end = 49;
    const query = {
      range: (from: number, to: number) => { start = from; end = to; return query; }, select: () => query, not: () => query, limit: () => query, in: () => query, order: () => query,
      then: (resolve: (value: unknown) => unknown) => {
        if (table === 'empresa_perfil') state.reads += 1;
        return Promise.resolve({ data: table === 'empresa_perfil' ? (state.profiles ?? [state.profile]).slice(start, end + 1) : [], error: table === 'empresa_perfil' ? state.error : null }).then(resolve);
      },
    };
    return query;
  },
}) }));
import { listBusinesses } from './zelomenuBusinessDirectory';

beforeEach(() => {
  state.profile = { id: 'empresa', user_id: 'owner', zelomenu_slug: 'loja', nome_exibicao: 'Loja', delivery_latitude: null, delivery_longitude: null };
  state.error = null;
  state.reads = 0;
  state.profiles = null;
});

describe('business directory response', () => {
  it('finds an eligible store after fifty ineligible profiles', async () => {
    state.profiles = [...Array.from({ length: 50 }, (_, n) => ({ ...state.profile, id: `company-${n}`, user_id: `ineligible-${n}` })), state.profile];
    expect(await listBusinesses()).toHaveLength(1);
    expect(state.reads).toBe(2);
  });
  it('não transforma coordenadas ausentes em uma localização no oceano', async () => {
    expect((await listBusinesses())[0]).toMatchObject({ latitude: null, longitude: null });
  });
  it('preserva zero quando a coordenada é realmente zero', async () => {
    state.profile.delivery_latitude = 0;
    state.profile.delivery_longitude = -46;
    expect((await listBusinesses())[0]).toMatchObject({ latitude: 0, longitude: -46 });
  });
  it('propaga indisponibilidade de banco sem anunciar diretório vazio nem repetir a consulta', async () => {
    state.error = { code: '08006', message: 'database unavailable' };
    await expect(listBusinesses()).rejects.toMatchObject(state.error);
    expect(state.reads).toBe(1);
  });
});
