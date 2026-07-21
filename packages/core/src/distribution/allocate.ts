/**
 * Distribution engine.
 *
 * Splits a total amount across `count` recipients. The result is guaranteed to:
 *   - sum EXACTLY to `total` (computed in integer base units, no float drift),
 *   - place every allocation within `[minPerSwap, maxPerSwap]`,
 *   - be randomised according to `jitter` (0 = perfectly even, 1 = fully random).
 *
 * Per-route min/max differ across Houdini routes (see `getMinMax`), so callers
 * can also supply per-index bounds via {@link allocateWithBounds}.
 */
import { type Rng, defaultRng, shuffle } from '../util/random.js';
import { toBaseUnits, fromBaseUnits } from '../util/amount.js';

export interface RandomAllocationOptions {
  /** Total amount to distribute (decimal token units, e.g. SOL). */
  total: number;
  /** Number of recipients / swaps. */
  count: number;
  /** Minimum per swap (decimal). Defaults to 0. */
  minPerSwap?: number;
  /** Maximum per swap (decimal). Defaults to `total` (no upper cap). */
  maxPerSwap?: number;
  /**
   * Unevenness of the split, in [0, 1].
   *  - 0   → as even as integer math allows,
   *  - 1   → fully random within the allowed headroom.
   */
  jitter?: number;
  /** Base-unit precision (e.g. 9 for SOL/lamports). Defaults to 9. */
  decimals?: number;
  /** Injected RNG for deterministic tests. Defaults to a crypto-backed RNG. */
  rng?: Rng;
}

/** Per-recipient min/max override (decimal). `undefined` fields fall back. */
export interface PerRouteBound {
  min?: number;
  max?: number;
}

export class AllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllocationError';
  }
}

/**
 * Allocate `total` across `count` recipients with uniform bounds.
 * Returns decimal amounts that sum exactly to `total`.
 */
export function randomAllocation(opts: RandomAllocationOptions): number[] {
  const decimals = opts.decimals ?? 9;
  const bounds: PerRouteBound[] = Array.from({ length: opts.count }, () => ({
    ...(opts.minPerSwap !== undefined ? { min: opts.minPerSwap } : {}),
    ...(opts.maxPerSwap !== undefined ? { max: opts.maxPerSwap } : {}),
  }));
  const units = allocateBaseUnits({
    total: opts.total,
    count: opts.count,
    bounds,
    jitter: opts.jitter ?? 0.5,
    decimals,
    rng: opts.rng ?? defaultRng,
  });
  return units.map((u) => fromBaseUnits(u, decimals));
}

/**
 * Allocate `total` across recipients using per-recipient bounds (e.g. distinct
 * Houdini `getMinMax` per route). `bounds.length` defines the recipient count.
 */
export function allocateWithBounds(params: {
  total: number;
  bounds: PerRouteBound[];
  jitter?: number;
  decimals?: number;
  rng?: Rng;
}): number[] {
  const decimals = params.decimals ?? 9;
  const units = allocateBaseUnits({
    total: params.total,
    count: params.bounds.length,
    bounds: params.bounds,
    jitter: params.jitter ?? 0.5,
    decimals,
    rng: params.rng ?? defaultRng,
  });
  return units.map((u) => fromBaseUnits(u, decimals));
}

interface BaseUnitParams {
  total: number;
  count: number;
  bounds: PerRouteBound[];
  jitter: number;
  decimals: number;
  rng: Rng;
}

/** The exact integer core of the allocator. Returns base-unit amounts. */
function allocateBaseUnits(p: BaseUnitParams): bigint[] {
  const { count, decimals, rng } = p;
  const jitter = clamp01(p.jitter);

  if (!Number.isInteger(count) || count < 1) {
    throw new AllocationError(`count must be a positive integer, got ${count}`);
  }

  const total = toBaseUnits(p.total, decimals);
  if (total <= 0n) {
    throw new AllocationError(`total must be greater than 0, got ${p.total}`);
  }

  const mins = p.bounds.map((b) => (b.min !== undefined ? toBaseUnits(b.min, decimals) : 0n));
  const maxs = p.bounds.map((b) => (b.max !== undefined ? toBaseUnits(b.max, decimals) : total));

  // Feasibility guards with human-readable messages.
  const sumMin = mins.reduce((a, b) => a + b, 0n);
  if (sumMin > total) {
    throw new AllocationError(
      `Cannot distribute: the minimum per swap × ${count} recipients ` +
        `(${fromBaseUnits(sumMin, decimals)}) exceeds the total (${p.total}). ` +
        `Lower the minimum, reduce the recipient count, or raise the total.`,
    );
  }
  const sumMax = maxs.reduce((a, b) => a + b, 0n);
  if (sumMax < total) {
    throw new AllocationError(
      `Cannot distribute: the maximum per swap summed across ${count} recipients ` +
        `(${fromBaseUnits(sumMax, decimals)}) is less than the total (${p.total}). ` +
        `Raise the maximum, add recipients, or lower the total.`,
    );
  }
  for (let i = 0; i < count; i++) {
    if ((maxs[i] as bigint) < (mins[i] as bigint)) {
      throw new AllocationError(`Recipient ${i}: max is less than min.`);
    }
  }

  // Start everyone at their minimum, then hand out the remainder.
  const alloc = mins.slice();
  let remaining = total - sumMin;

  // Per-slot headroom above the minimum.
  const headroom = alloc.map((a, i) => (maxs[i] as bigint) - a);

  const RES = 1_000_000; // weight resolution

  // Distribute `remaining` across slots with headroom. We iterate because a
  // proportional pass can under-shoot: when a slot's random share exceeds its
  // headroom it is capped, leaving units that must be re-distributed among the
  // remaining slots. The total-headroom >= remaining invariant (guaranteed by
  // the sumMax >= total guard) means this always converges. As `remaining`
  // shrinks below what proportional flooring can place, we fall back to an exact
  // even split of the leftover units.
  let guard = 0;
  const maxPasses = count * 64 + 64;
  while (remaining > 0n) {
    const active: number[] = [];
    for (let i = 0; i < count; i++) if ((headroom[i] as bigint) > 0n) active.push(i);
    if (active.length === 0) break; // no headroom anywhere (should not happen)

    // Fresh random weights per pass: blend an even weight with a random weight.
    // weight_i = (1 - jitter) * 1 + jitter * rand_i  (scaled to integers)
    const weights = active.map(() => {
      const w = (1 - jitter) * 1 + jitter * rng();
      return Math.max(1, Math.round(w * RES));
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    let distributed = 0n;
    for (let k = 0; k < active.length; k++) {
      const i = active[k] as number;
      const h = headroom[i] as bigint;
      let share = (remaining * BigInt(weights[k] as number)) / BigInt(totalWeight);
      if (share > h) share = h;
      if (share > 0n) {
        alloc[i] = (alloc[i] as bigint) + share;
        headroom[i] = h - share;
        distributed += share;
      }
    }

    remaining -= distributed;

    // Proportional flooring placed nothing (remaining too small): finish with an
    // exact even split of the leftover units across slots that still have room.
    if (distributed === 0n && remaining > 0n) {
      const room = shuffle(
        rng,
        active.filter((i) => (headroom[i] as bigint) > 0n),
      );
      const n = BigInt(room.length);
      const per = remaining / n;
      let extra = remaining % n;
      for (const i of room) {
        if (remaining <= 0n) break;
        let add = per + (extra > 0n ? 1n : 0n);
        if (extra > 0n) extra -= 1n;
        const h = headroom[i] as bigint;
        if (add > h) add = h;
        alloc[i] = (alloc[i] as bigint) + add;
        headroom[i] = h - add;
        remaining -= add;
      }
    }

    if (++guard > maxPasses) break;
  }

  // Invariant check — should always hold given the guards above.
  const finalSum = alloc.reduce((a, b) => a + b, 0n);
  if (finalSum !== total) {
    throw new AllocationError(
      `Internal allocation error: sum ${finalSum} != total ${total}. Please report this.`,
    );
  }
  return alloc;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
