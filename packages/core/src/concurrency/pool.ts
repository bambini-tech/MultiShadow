/**
 * Bounded-concurrency worker pool.
 *
 * `runPool` processes items with a capped number of in-flight workers and
 * collects a settled result per item (`{ ok: true, value }` or
 * `{ ok: false, error }`) instead of aborting on the first rejection — one
 * failed recipient must not stop the rest of the batch.
 *
 * The Speed ↔ Privacy knob is expressed through two options:
 *   - `concurrency`  — high = fast; low = fewer simultaneous swaps, so less
 *                      obvious that the recipients are related.
 *   - `maxJitterMs`  — a random pre-start delay per item; > 0 decorrelates the
 *                      timing between recipients at the cost of speed.
 */
import { type Rng, defaultRng } from '../util/random.js';

export type Settled<T> =
  { ok: true; index: number; value: T } | { ok: false; index: number; error: unknown };

export interface RunPoolOptions {
  /** Maximum number of workers running at once. Default 6. */
  concurrency?: number;
  /** Upper bound on a random pre-start delay per item (ms). Default 0. */
  maxJitterMs?: number;
  /** Injected RNG (for deterministic tests). Default crypto-backed. */
  rng?: Rng;
  /** Optional AbortSignal to stop scheduling new work. */
  signal?: AbortSignal;
  /** Sleep implementation (injectable for tests). Default real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Called after each item settles — useful for live progress UI. */
  onSettled?: (result: Settled<unknown>) => void;
}

const realSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

/** Default concurrency — Houdini and partner exchanges rate-limit aggressively. */
export const DEFAULT_CONCURRENCY = 6;

/**
 * Run `worker` over every item with bounded parallelism. Never rejects; returns
 * one {@link Settled} entry per input item, in input order.
 */
export async function runPool<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  options: RunPoolOptions = {},
): Promise<Settled<R>[]> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
  const maxJitterMs = Math.max(0, options.maxJitterMs ?? 0);
  const rng = options.rng ?? defaultRng;
  const sleep = options.sleep ?? realSleep;
  const { signal, onSettled } = options;

  const results = new Array<Settled<R>>(items.length);
  let next = 0;

  async function runOne(index: number): Promise<void> {
    const item = items[index] as T;
    try {
      if (maxJitterMs > 0) {
        await sleep(Math.floor(rng() * (maxJitterMs + 1)));
      }
      const value = await worker(item, index);
      const settled: Settled<R> = { ok: true, index, value };
      results[index] = settled;
      onSettled?.(settled);
    } catch (error) {
      const settled: Settled<R> = { ok: false, index, error };
      results[index] = settled;
      onSettled?.(settled);
    }
  }

  async function drain(): Promise<void> {
    for (;;) {
      if (signal?.aborted) return;
      const index = next++;
      if (index >= items.length) return;
      await runOne(index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  const drains: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) drains.push(drain());
  await Promise.all(drains);

  // Any indices skipped because of an abort are marked as aborted errors.
  for (let i = 0; i < items.length; i++) {
    if (results[i] === undefined) {
      results[i] = { ok: false, index: i, error: new PoolAbortedError(i) };
    }
  }
  return results;
}

export class PoolAbortedError extends Error {
  readonly index: number;
  constructor(index: number) {
    super(`Item ${index} was not processed because the pool was aborted.`);
    this.name = 'PoolAbortedError';
    this.index = index;
  }
}

/** Convenience: split settled results into successes and failures. */
export function partitionSettled<R>(results: readonly Settled<R>[]): {
  ok: Array<{ index: number; value: R }>;
  failed: Array<{ index: number; error: unknown }>;
} {
  const ok: Array<{ index: number; value: R }> = [];
  const failed: Array<{ index: number; error: unknown }> = [];
  for (const r of results) {
    if (r.ok) ok.push({ index: r.index, value: r.value });
    else failed.push({ index: r.index, error: r.error });
  }
  return { ok, failed };
}
