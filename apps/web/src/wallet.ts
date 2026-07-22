/**
 * Wallet abstraction.
 *
 * The rest of the app depends on this narrow interface, NOT on Reown's concrete
 * types, so the wallet layer is swappable. The Reown-backed implementation lives
 * in ./appkit.ts.
 *
 * The native multi-swap flow needs two signing primitives:
 *   - Solana: sign + send a batched deposit transaction Houdini pre-built.
 *   - EVM:    sign an ERC-4337 user-operation hash (submitted back via the proxy).
 * Only the SOURCE wallet signs; recipient keys are never involved.
 */
import type { Transaction, VersionedTransaction } from '@solana/web3.js';

export type WalletKind = 'solana' | 'evm';

export interface WalletState {
  address?: string;
  kind?: WalletKind;
}

export interface Wallet {
  isConnected(): boolean;
  getAddress(): string | undefined;
  /** Active ecosystem of the connected account, when known. */
  getKind(): WalletKind | undefined;
  /** Open the connect modal. */
  open(): void;
  disconnect(): Promise<void>;
  onChange(cb: (state: WalletState) => void): () => void;
  /**
   * Sign and send a fully-built Solana transaction (legacy or versioned).
   * Returns the signature. Used for Houdini's batched deposit transactions.
   */
  signAndSendSolana(tx: Transaction | VersionedTransaction): Promise<string>;
  /**
   * Sign a message/hash with the EVM wallet (personal_sign). Used to sign the
   * ERC-4337 user-operation hash for EVM multi-swaps. Returns the 0x signature.
   */
  signEvmMessage(message: string | Uint8Array): Promise<string>;
}
