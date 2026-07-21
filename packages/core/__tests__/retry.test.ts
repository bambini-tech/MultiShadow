import { describe, it, expect } from 'vitest';
import { retry } from '../src/http/retry.js';
import { HttpError, NetworkError, isRetryable } from '../src/http/errors.js';
import { seededRng } from '../src/util/random.js';

const noSleep = () => Promise.resolve();

describe('retry', () => {
  it('returns immediately on success', async () => {
    let calls = 0;
    const out = await retry(
      async () => {
        calls++;
        return 'ok';
      },
      { sleep: noSleep },
    );
    expect(out).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries transient errors up to the attempt limit then throws', async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw new NetworkError('down');
        },
        { attempts: 4, sleep: noSleep, rng: seededRng(1) },
      ),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(calls).toBe(4);
  });

  it('succeeds after a couple of transient failures', async () => {
    let calls = 0;
    const out = await retry(
      async () => {
        calls++;
        if (calls < 3) throw new HttpError(503, 'temporary');
        return 'recovered';
      },
      { attempts: 5, sleep: noSleep, rng: seededRng(2) },
    );
    expect(out).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('does NOT retry business errors (4xx)', async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw new HttpError(400, 'amount below minimum');
        },
        { attempts: 5, sleep: noSleep },
      ),
    ).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(1);
  });

  it('classifies errors correctly', () => {
    expect(isRetryable(new NetworkError('x'))).toBe(true);
    expect(isRetryable(new HttpError(429, 'rate'))).toBe(true);
    expect(isRetryable(new HttpError(500, 'server'))).toBe(true);
    expect(isRetryable(new HttpError(404, 'not found'))).toBe(false);
    expect(isRetryable(new Error('generic'))).toBe(false);
  });

  it('reports each retry via onRetry', async () => {
    const attempts: number[] = [];
    await expect(
      retry(async () => Promise.reject(new NetworkError('x')), {
        attempts: 3,
        sleep: noSleep,
        rng: seededRng(3),
        onRetry: ({ attempt }) => attempts.push(attempt),
      }),
    ).rejects.toBeTruthy();
    // onRetry fires before each of the (attempts - 1) sleeps.
    expect(attempts).toEqual([1, 2]);
  });
});
