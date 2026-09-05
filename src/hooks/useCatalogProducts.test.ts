import { beforeEach, expect, it, vi } from 'vitest';
import { EMPTY, type CatalogState, type ZeloMenuProductPublicationRow } from './useCatalogTypes';

const mocks = vi.hoisted(() => ({ single: vi.fn(), remove: vi.fn(), upload: vi.fn(), events: [] as string[], filters: [] as unknown[] }));
// Exercise the hook's mutation callbacks with real catalog state; rendering is outside this test.
vi.mock('react', () => ({ useCallback: (callback: unknown) => callback }));
vi.mock('../services/supabaseClient', () => ({
  supabase: { from: () => {
    const q = { insert: () => q, update: () => q, select: () => q,
      eq: (key: string, value: unknown) => { mocks.filters.push([key, value]); return q; }, maybeSingle: mocks.single };
    return q;
  } },
}));
vi.mock('../services/zelomenuPublicationImages', () => ({
  deleteOwnedZeloMenuPublicationImage: mocks.remove,
  uploadOwnedZeloMenuPublicationImage: mocks.upload,
}));
import { useCatalogProducts } from './useCatalogProducts';

const previousUrl = 'https://test.supabase.co/storage/v1/object/public/logos/zelomenu-products/owner/1-old.jpg';
const nextUrl = 'https://test.supabase.co/storage/v1/object/public/logos/zelomenu-products/owner/1-new.jpg';
const publication: ZeloMenuProductPublicationRow = {
  id: 'pub-1', id_produto: 1, foto_url: previousUrl, nome_publico: null,
  descricao_publica: null, visivel_online: true, pausado_manualmente: false, ordem: 0,
  updated_at: '2026-09-04T10:00:00.000Z',
};

function catalog() {
  const dataRef = { current: { ...EMPTY, productPublications: { 1: { ...publication } } } as CatalogState };
  const actions = useCatalogProducts('owner', dataRef, (updater) => {
    dataRef.current = updater(dataRef.current);
    mocks.events.push('commit');
  });
  return { dataRef, actions };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.events.length = 0;
  mocks.filters.length = 0;
  mocks.remove.mockImplementation(async () => { mocks.events.push('remove'); });
});

it('rejects an outdated publication without removing either photo', async () => {
  mocks.single.mockResolvedValue({ data: null, error: null });
  const { actions, dataRef } = catalog();
  await expect(actions.upsertProductPublication(1, { foto_url: nextUrl })).rejects.toThrow('outra sessão');
  expect(mocks.filters).toContainEqual(['updated_at', publication.updated_at]);
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(dataRef.current.productPublications[1].foto_url).toBe(previousUrl);
});

it('keeps both the published photo and retryable draft when the reference write fails', async () => {
  const error = new TypeError('Failed to fetch');
  mocks.single.mockResolvedValue({ data: null, error });
  const { actions, dataRef } = catalog();
  await expect(actions.upsertProductPublication(1, { foto_url: nextUrl })).rejects.toBe(error);
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(dataRef.current.productPublications[1].foto_url).toBe(previousUrl);
});

it.each([nextUrl, null])('removes the previous photo only after an acknowledged reference change to %s', async (foto_url) => {
  mocks.single.mockImplementation(async () => {
    expect(mocks.remove).not.toHaveBeenCalled();
    mocks.events.push('ack');
    return { data: { ...publication, foto_url }, error: null };
  });
  const { actions, dataRef } = catalog();
  await actions.upsertProductPublication(1, { foto_url });
  expect(dataRef.current.productPublications[1].foto_url).toBe(foto_url);
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(previousUrl);
  expect(mocks.events).toEqual(['ack', 'commit', 'remove']);
});

it('does not remove a photo when saving unrelated publication fields', async () => {
  mocks.single.mockResolvedValue({ data: publication, error: null });
  await catalog().actions.upsertProductPublication(1, { nome_publico: 'Novo nome' });
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('does not remove the still-referenced object when only its URL query changes', async () => {
  const foto_url = `${previousUrl}?v=2`;
  mocks.single.mockResolvedValue({ data: { ...publication, foto_url }, error: null });
  await catalog().actions.upsertProductPublication(1, { foto_url });
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('keeps the committed reference when old image cleanup fails', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mocks.single.mockResolvedValue({ data: { ...publication, foto_url: nextUrl }, error: null });
  mocks.remove.mockRejectedValue(new Error('Storage unavailable'));
  const { actions, dataRef } = catalog();
  await expect(actions.upsertProductPublication(1, { foto_url: nextUrl })).resolves.toMatchObject({ foto_url: nextUrl });
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(previousUrl);
  expect(dataRef.current.productPublications[1].foto_url).toBe(nextUrl);
});
