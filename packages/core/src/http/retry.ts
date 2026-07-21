/**
 * Retry with exponential backoff + jitter.
 *
 * Only *transient* errors are retried (see `isRetryable`); business errors fail
 * fast. Backoff is exponential with full jitter to avoid thundering-herd retries
 * against a rate-limited API.
 */
import { type Rng, defaultRng } from '../util/random.js';
import { isRetryable } from './errors.js';

export interface RetryOptions {
  /** Maximum attempts including the first. Default 4. */
  attempts?: number;
  /** Base delay in ms for the exponential curve. Default 300. */
  baseDelayMs?: number;
  /** Absolute cap on any single delay in ms. Default 8000. */
  maxDelayMs?: number;
  /** Predicate deciding whether an error is retryable. Default `isRetryable`. */
  retryOn?: (err: unknown) => boolean;
  /** Injected RNG for jitter (deterministic tests). Default crypto-backed. */
  rng?: Rng;
  /** Sleep implementation (injectable for tests). Default real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional AbortSignal to cancel between attempts. */
  signal?: AbortSignal;
  /** Called before each retry sleep — useful for logging/telemetry. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const realSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

/**
 * Invoke `fn`, retrying transient failures with exponential backoff + jitter.
 * Re-throws the last error once attempts are exhausted (or immediately for a
 * non-retryable / business error).
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 4));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 300);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 8000);
  const retryOn = options.retryOn ?? isRetryable;
  const rng = options.rng ?? defaultRng;
  const sleep = options.sleep ?? realSleep;
  const { signal, onRetry } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) throw new Error('retry aborted');
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLast = attempt === attempts;
      if (isLast || !retryOn(err)) throw err;

      // Exponential backoff with full jitter:
      // delay = random(0, min(cap, base * 2^(attempt-1)))
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = Math.floor(rng() * ceiling);
      onRetry?.({ attempt, delayMs, error: err });
      await sleep(delayMs);
    }
  }
  // Unreachable, but satisfies the type checker.
  throw lastError;
}
