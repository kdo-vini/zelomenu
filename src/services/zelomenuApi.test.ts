import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPublicOrder, ZeloMenuApiError } from './zelomenuApi';

describe('startPublicOrder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses the shared abort timeout and maps a slow request to a retryable error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));

    const request = startPublicOrder('loja-a', { items: [{ productId: 1, productName: 'Produto', quantity: 1 }] });
    const assertion = expect(request).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', status: 408 });
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
  });

  it('keeps the public order payload and table context contract unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.context).toBe('table_order');
      expect(body.mesa_id).toBe('mesa-1');
      expect(body.comanda_id).toBe('comanda-1');
      return new Response(JSON.stringify({ token: 'token', path: '/menu/carrinho/token', orderingId: 'order-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    await expect(startPublicOrder('loja-a', {
      items: [{ productId: 1, productName: 'Produto', quantity: 1 }],
      tableOrderContext: { mesa_id: 'mesa-1', comanda_id: 'comanda-1' },
    })).resolves.toEqual({ token: 'token', path: '/menu/carrinho/token', orderingId: 'order-1' });
  });

  it('keeps API errors actionable for the caller retry state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'PRODUCT_UNAVAILABLE' }), { status: 400 })));

    await expect(startPublicOrder('loja-a', {
      items: [{ productId: 1, productName: 'Produto', quantity: 1 }],
    })).rejects.toBeInstanceOf(ZeloMenuApiError);
  });
});
