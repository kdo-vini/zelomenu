import { afterEach, expect, it, vi } from 'vitest';
import { BoundedMap, ScopedCache } from './boundedMap';
import { fetchWithDeadline } from './fetchWithDeadline';

afterEach(() => vi.unstubAllGlobals());

it('evicts reusable entries but preserves the request snapshot across tenant pressure', async () => {
  const cache = new BoundedMap<string, number>(2);
  cache.set('a', 1).set('b', 2).set('c', 3);
  expect(cache.size).toBe(2); expect(cache.has('a')).toBe(false);
  const scoped = new ScopedCache<string, number>(2);
  await scoped.run(async () => {
    scoped.set('active', 1);
    await scoped.run(async () => { scoped.set('b', 2); scoped.set('c', 3); });
    expect(scoped.get('active')).toBe(1);
  });
  expect(scoped.get('active')).toBeUndefined();
});

it('aborts a stalled transport at the deadline and preserves caller cancellation', async () => {
  vi.stubGlobal('fetch', vi.fn((_input, init) => new Promise((_resolve, reject) => {
    const signal = init.signal as AbortSignal;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  })));
  await expect(fetchWithDeadline('https://fixture.example', undefined, 10)).rejects.toMatchObject({ name: 'TimeoutError' });
  const controller = new AbortController(); controller.abort(new Error('caller cancelled'));
  await expect(fetchWithDeadline('https://fixture.example', { signal: controller.signal })).rejects.toThrow('caller cancelled');
});
