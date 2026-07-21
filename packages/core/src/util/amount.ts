/**
 * Amount conversion helpers.
 *
 * All distribution math is done in integer "base units" (e.g. lamports for SOL,
 * 9 decimals) so that sums are exact and never drift due to floating-point
 * error. Human-facing decimal values are converted to/from base units at the
 * boundary.
 */

/** Number of base units in one whole token for a given decimals value. */
export function unitsPerToken(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError(`decimals must be an integer in [0, 18], got ${decimals}`);
  }
  return 10n ** BigInt(decimals);
}

/**
 * Convert a decimal token amount to integer base units.
 * Rounds to the nearest base unit (half-up) to avoid silently dropping dust.
 */
export function toBaseUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`amount must be a finite non-negative number, got ${amount}`);
  }
  const scale = unitsPerToken(decimals);
  // Use string math to avoid float precision loss for typical token amounts.
  const [intPart, fracPartRaw = ''] = amount.toFixed(decimals + 1).split('.');
  const fracPadded = fracPartRaw.padEnd(decimals + 1, '0');
  const keep = fracPadded.slice(0, decimals);
  const roundDigit = fracPadded.charAt(decimals);
  let units = BigInt(intPart ?? '0') * scale + BigInt(keep || '0');
  if (roundDigit >= '5') units += 1n;
  return units;
}

/** Convert integer base units back to a decimal token amount (number). */
export function fromBaseUnits(units: bigint, decimals: number): number {
  const scale = unitsPerToken(decimals);
  const whole = units / scale;
  const frac = units % scale;
  if (frac === 0n) return Number(whole);
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return Number(`${whole}.${fracStr}`);
}

/** Convert integer base units to a fixed-precision decimal string (no float). */
export function formatBaseUnits(units: bigint, decimals: number): string {
  const scale = unitsPerToken(decimals);
  const whole = units / scale;
  const frac = units % scale;
  if (decimals === 0) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}
