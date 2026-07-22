/**
 * Address validation helpers.
 *
 * Recipient addresses are user-entered; validating them before building a
 * transaction turns a cryptic runtime error into a clear "this address is
 * invalid" message in the UI.
 */
import { PublicKey } from '@solana/web3.js';
import { classifyNetwork } from '../chains/networks.js';

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

/**
 * Validate an address against a named network. Uses the shared network
 * classifier so every EVM chain (and any future Solana/EVM alias) is covered by
 * one rule. Unknown networks (BTC, TRON, XMR, …) accept any non-empty string and
 * let Houdini reject a malformed one.
 */
export function isValidAddressForChain(value: string, chain: string): boolean {
  switch (classifyNetwork(chain)) {
    case 'solana':
      return isValidSolanaAddress(value);
    case 'evm':
      return isValidEvmAddress(value);
    default:
      return value.trim().length > 0;
  }
}
