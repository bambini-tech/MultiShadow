import { describe, it, expect } from 'vitest';
import {
  randomAllocation,
  allocateWithBounds,
  AllocationError,
} from '../src/distribution/allocate.js';
import { toBaseUnits } from '../src/util/amount.js';
import { seededRng } from '../src/util/random.js';

const DECIMALS = 9;

/** Exact-sum check performed in base units to avoid float comparison noise. */
function sumBaseUnits(values: number[]): bigint {
  return values.reduce((acc, v) => acc + toBaseUnits(v, DECIMALS), 0n);
}

describe('randomAllocation', () => {
  it('sums exactly to total (base units) for many random seeds', () => {
    const total = 12.345678901;
    for (let seed = 1; seed <= 50; seed++) {
      const out = randomAllocation({
        total,
        count: 7,
        minPerSwap: 0.5,
        maxPerSwap: 5,
        jitter: 0.8,
        decimals: DECIMALS,
        rng: seededRng(seed),
      });
      expect(out).toHaveLength(7);
      expect(sumBaseUnits(out)).toBe(toBaseUnits(total, DECIMALS));
    }
  });

  it('respects [min, max] on every allocation', () => {
    const min = 0.5;
    const max = 3;
    for (let seed = 1; seed <= 30; seed++) {
      const out = randomAllocation({
        total: 10,
        count: 5,
        minPerSwap: min,
        maxPerSwap: max,
        jitter: 1,
        decimals: DECIMALS,
        rng: seededRng(seed),
      });
      for (const v of out) {
        expect(v).toBeGreaterThanOrEqual(min - 1e-12);
        expect(v).toBeLessThanOrEqual(max + 1e-12);
      }
    }
  });

  it('handles count = 1 (single recipient gets the whole total)', () => {
    const out = randomAllocation({ total: 4.2, count: 1, decimals: DECIMALS });
    expect(out).toHaveLength(1);
    expect(out[0]).toBeCloseTo(4.2, 9);
  });

  it('jitter = 0 produces a near-even split', () => {
    const out = randomAllocation({
      total: 9,
      count: 3,
      jitter: 0,
      decimals: DECIMALS,
      rng: seededRng(123),
    });
    expect(sumBaseUnits(out)).toBe(toBaseUnits(9, DECIMALS));
    for (const v of out) expect(v).toBeCloseTo(3, 6);
  });

  it('works with tight bounds where min*count == total', () => {
    const out = randomAllocation({
      total: 5,
      count: 5,
      minPerSwap: 1,
      maxPerSwap: 1,
      jitter: 1,
      decimals: DECIMALS,
      rng: seededRng(7),
    });
    expect(sumBaseUnits(out)).toBe(toBaseUnits(5, DECIMALS));
    for (const v of out) expect(v).toBeCloseTo(1, 9);
  });

  it('handles large N with exact sum', () => {
    const total = 1000;
    const out = randomAllocation({
      total,
      count: 500,
      minPerSwap: 0.1,
      maxPerSwap: 50,
      jitter: 0.6,
      decimals: DECIMALS,
      rng: seededRng(42),
    });
    expect(out).toHaveLength(500);
    expect(sumBaseUnits(out)).toBe(toBaseUnits(total, DECIMALS));
  });

  it('throws a clear error when min * count > total', () => {
    expect(() =>
      randomAllocation({ total: 3, count: 5, minPerSwap: 1, decimals: DECIMALS }),
    ).toThrow(AllocationError);
    try {
      randomAllocation({ total: 3, count: 5, minPerSwap: 1, decimals: DECIMALS });
    } catch (e) {
      expect((e as Error).message).toMatch(/minimum per swap/i);
    }
  });

  it('throws when max * count < total (infeasible upper bound)', () => {
    expect(() =>
      randomAllocation({ total: 100, count: 5, maxPerSwap: 10, decimals: DECIMALS }),
    ).toThrow(AllocationError);
  });

  it('rejects non-positive total and bad count', () => {
    expect(() => randomAllocation({ total: 0, count: 3 })).toThrow(AllocationError);
    expect(() => randomAllocation({ total: 5, count: 0 })).toThrow(AllocationError);
  });
});

describe('allocateWithBounds (per-route min/max)', () => {
  it('honors distinct per-recipient bounds and sums to total', () => {
    const bounds = [
      { min: 1, max: 2 },
      { min: 0.5, max: 10 },
      { min: 0, max: 3 },
    ];
    const out = allocateWithBounds({
      total: 6,
      bounds,
      jitter: 0.9,
      decimals: DECIMALS,
      rng: seededRng(99),
    });
    expect(sumBaseUnits(out)).toBe(toBaseUnits(6, DECIMALS));
    expect(out[0]!).toBeGreaterThanOrEqual(1 - 1e-12);
    expect(out[0]!).toBeLessThanOrEqual(2 + 1e-12);
    expect(out[2]!).toBeLessThanOrEqual(3 + 1e-12);
  });
});
