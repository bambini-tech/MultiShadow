/**
 * Random-number utilities.
 *
 * A pluggable RNG is used everywhere randomness matters (allocation, jitter) so
 * that behaviour is deterministic and unit-testable. In production the default
 * `Math.random`-backed RNG is used; tests pass a seeded RNG.
 */

/** A function returning a float in [0, 1). Compatible with `Math.random`. */
export type Rng = () => number;

/** The default RNG. Uses `crypto` when available for better entropy. */
export const defaultRng: Rng = () => {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } };
  if (g.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    g.crypto.getRandomValues(buf);
    // 2**32 = 4294967296
    return (buf[0] as number) / 4294967296;
  }
  return Math.random();
};

/**
 * `mulberry32` — a small, fast, seedable PRNG. Deterministic given a seed.
 * Not cryptographically secure; intended for reproducible tests and for
 * non-security-critical jitter/weights.
 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random integer in [minInclusive, maxInclusive]. */
export function randomInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  if (maxInclusive < minInclusive) {
    throw new RangeError('randomInt: max must be >= min');
  }
  const span = maxInclusive - minInclusive + 1;
  return minInclusive + Math.floor(rng() * span);
}

/** Fisher–Yates shuffle producing a new array (does not mutate input). */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
