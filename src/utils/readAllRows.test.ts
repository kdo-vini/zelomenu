import { expect, it, vi } from 'vitest';
import { readAllRows } from './readAllRows';

it('reads past the API cap without skipping or duplicating records', async () => {
  const rows = Array.from({ length: 1250 }, (_, id) => ({ id }));
  const fetchPage = vi.fn(async (from, to) => ({ data: rows.slice(from, to + 1), error: null }));
  expect((await readAllRows(fetchPage)).data).toEqual(rows);
  expect(fetchPage.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
});
it('propagates a later-page failure instead of returning a truncated success', async () => {
  const error = { code: '08006', message: 'unavailable' };
  const fetchPage = vi.fn(async (from) => from === 0 ? { data: Array(500).fill({ id: 1 }), error: null } : { data: null, error });
  expect(await readAllRows(fetchPage)).toEqual({ data: null, error });
});
