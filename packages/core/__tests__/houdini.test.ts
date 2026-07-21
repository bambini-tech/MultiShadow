import { describe, it, expect } from 'vitest';
import { HoudiniClient, type FetchLike } from '../src/houdini/client.js';
import { mapOrder, mapPhase, mapQuote, unwrap } from '../src/houdini/types.js';

/** A fake fetch that records calls and returns queued JSON responses. */
function fakeFetch(
  handler: (url: string, init?: Parameters<FetchLike>[1]) => { status?: number; json: unknown },
): { fetch: FetchLike; calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> } {
  const calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, json } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    };
  };
  return { fetch, calls };
}

describe('Houdini field mapping', () => {
  it('maps an order response to deposit address + amount', () => {
    const order = mapOrder({
      id: 'order-123',
      senderAddress: 'DEPOSIT_ADDR',
      inAmount: 2.5,
      outAmount: 2.49,
    });
    expect(order.orderId).toBe('order-123');
    expect(order.depositAddress).toBe('DEPOSIT_ADDR');
    expect(order.depositAmount).toBe(2.5);
    expect(order.expectedOut).toBe(2.49);
  });

  it('maps a quote with min/max', () => {
    const q = mapQuote({ amountIn: 5, amountOut: 4.9, min: 0.1, max: 100 });
    expect(q.min).toBe(0.1);
    expect(q.max).toBe(100);
    expect(q.amountOut).toBe(4.9);
  });

  it('normalizes numeric and string status codes', () => {
    expect(mapPhase(0)).toBe('awaiting_deposit');
    expect(mapPhase(5)).toBe('completed');
    expect(mapPhase(6)).toBe('failed');
    expect(mapPhase('finished')).toBe('completed');
    expect(mapPhase('exchanging')).toBe('processing');
    expect(mapPhase('some-unmapped-value')).toBe('unknown');
  });

  it('unwraps common envelopes', () => {
    expect(unwrap({ data: { a: 1 } })).toEqual({ a: 1 });
    expect(unwrap({ result: [1, 2] })).toEqual([1, 2]);
    expect(unwrap({ a: 1 })).toEqual({ a: 1 });
  });
});

describe('HoudiniClient transport', () => {
  it('sends the API key server-side as a Bearer header', async () => {
    const { fetch, calls } = fakeFetch(() => ({
      json: { id: 'o1', senderAddress: 'D', inAmount: 1 },
    }));
    const client = new HoudiniClient({
      baseUrl: 'https://api.example.com',
      apiKey: 'SECRET',
      fetchImpl: fetch,
    });
    await client.exchange({ amount: 1, from: 'sol', to: 'sol', addressTo: 'R' });
    expect(calls[0]!.init?.headers?.['Authorization']).toBe('Bearer SECRET');
    expect(calls[0]!.url).toContain('/exchange');
  });

  it('does NOT attach any auth header when no key is set (proxy mode)', async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { min: 0.1, max: 10 } }));
    const client = new HoudiniClient({ baseUrl: 'https://proxy.local', fetchImpl: fetch });
    await client.getMinMax({ from: 'sol', to: 'eth' });
    expect(calls[0]!.init?.headers?.['Authorization']).toBeUndefined();
    expect(calls[0]!.url).toContain('/getMinMax');
    expect(calls[0]!.url).toContain('from=sol');
    expect(calls[0]!.url).toContain('to=eth');
  });

  it('throws HttpError on non-2xx', async () => {
    const { fetch } = fakeFetch(() => ({ status: 400, json: { error: 'bad' } }));
    const client = new HoudiniClient({ baseUrl: 'https://x', fetchImpl: fetch });
    await expect(client.quote({ amount: 1, from: 'a', to: 'b' })).rejects.toMatchObject({
      status: 400,
    });
  });
});
