import { describe, it, expect } from 'vitest';
import { toBaseUnits, fromBaseUnits, formatBaseUnits } from '../src/util/amount.js';

describe('amount conversion', () => {
  it('round-trips common SOL amounts exactly', () => {
    const cases = [1, 0.5, 0.000000001, 123.456789, 1000];
    for (const v of cases) {
      const units = toBaseUnits(v, 9);
      expect(fromBaseUnits(units, 9)).toBeCloseTo(v, 9);
    }
  });

  it('converts 1 SOL to 1e9 lamports', () => {
    expect(toBaseUnits(1, 9)).toBe(1_000_000_000n);
  });

  it('rounds half-up at the base-unit boundary', () => {
    // 0.0000000015 SOL -> 1.5 lamports -> rounds to 2
    expect(toBaseUnits(0.0000000015, 9)).toBe(2n);
  });

  it('formats without floating point artifacts', () => {
    expect(formatBaseUnits(1_500_000_000n, 9)).toBe('1.5');
    expect(formatBaseUnits(1_000_000_000n, 9)).toBe('1');
    expect(formatBaseUnits(1n, 9)).toBe('0.000000001');
  });

  it('rejects negative amounts and bad decimals', () => {
    expect(() => toBaseUnits(-1, 9)).toThrow();
    expect(() => toBaseUnits(1, 99)).toThrow();
  });
});
