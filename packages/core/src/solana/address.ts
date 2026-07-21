/**
 * Address validation helpers.
 *
 * Recipient addresses are user-entered; validating them before building a
 * transaction turns a cryptic runtime error into a clear "this address is
 * invalid" message in the UI.
 */
import { PublicKey } from '@solana/web3.js';

/** True if `value` is a syntactically valid, on-curve Solana address. */
export function isValidSolanaAddress(value: string): boolean {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  try {
    // Constructing throws for malformed/off-curve keys; that's the validation.
    void new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

/** Basic EVM (0x + 40 hex) shape check for cross-chain destinations. */
export function isValidEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** Validate against a named chain family. Extend as more chains are added. */
export function isValidAddressForChain(value: string, chain: string): boolean {
  const c = chain.trim().toLowerCase();
  if (c === 'sol' || c === 'solana') return isValidSolanaAddress(value);
  if (['eth', 'ethereum', 'evm', 'bsc', 'polygon', 'arbitrum', 'base'].includes(c)) {
    return isValidEvmAddress(value);
  }
  // Unknown chain: accept non-empty, let the API reject if wrong.
  return value.trim().length > 0;
}
