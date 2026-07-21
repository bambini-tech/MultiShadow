import { describe, it, expect } from 'vitest';
import { runPool, partitionSettled } from '../src/concurrency/pool.js';
import { seededRng } from '../src/util/random.js';

const noSleep = () => Promise.resolve();

describe('runPool', () => {
  it('processes every item and returns results in input order', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runPool(items, async (n) => n * 2, {
      concurrency: 2,
      sleep: noSleep,
    });
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual([2, 4, 6, 8, 10]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('collects failures instead of aborting the whole batch', async () => {
    const items = [1, 2, 3, 4];
    const results = await runPool(
      items,
      async (n) => {
        if (n % 2 === 0) throw new Error(`fail ${n}`);
        return n;
      },
      { concurrency: 3, sleep: noSleep },
    );
    const { ok, failed } = partitionSettled(results);
    expect(ok.map((r) => r.value).sort()).toEqual([1, 3]);
    expect(failed.map((r) => r.index).sort()).toEqual([1, 3]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await runPool(
      items,
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
      },
      { concurrency: 4 },
    );
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it('applies jitter via the injected sleep + rng', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
    };
    await runPool([0, 1, 2], async (n) => n, {
      concurrency: 1,
      maxJitterMs: 100,
      rng: seededRng(5),
      sleep,
    });
    expect(sleeps).toHaveLength(3);
    for (const ms of sleeps) {
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(100);
    }
  });

  it('marks unprocessed items as aborted when the signal fires', async () => {
    const controller = new AbortController();
    const items = [0, 1, 2, 3, 4, 5];
    const results = await runPool(
      items,
      async (n) => {
        if (n === 1) controller.abort();
        return n;
      },
      { concurrency: 1, signal: controller.signal, sleep: noSleep },
    );
    const failed = results.filter((r) => !r.ok);
    expect(failed.length).toBeGreaterThan(0);
  });

  it('handles an empty item list', async () => {
    const results = await runPool([], async (n) => n, { sleep: noSleep });
    expect(results).toEqual([]);
  });
});
