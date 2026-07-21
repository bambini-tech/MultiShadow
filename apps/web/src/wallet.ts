/**
 * Wallet abstraction.
 *
 * The rest of the app depends on this narrow interface, NOT on Reown's concrete
 * types, so the wallet layer is swappable and testable. The Reown-backed
 * implementation lives in ./appkit.ts.
 *
 * Only the SOURCE wallet signs. Recipient private keys are never involved.
 */
import type { Transaction } from '@solana/web3.js';

export interface SolanaWallet {
  isConnected(): boolean;
  getAddress(): string | undefined;
  /** Open the connect modal. */
  open(): void;
  disconnect(): Promise<void>;
  onChange(cb: (address: string | undefined) => void): () => void;
  /**
   * Sign and send a fully-built transaction (feePayer + recentBlockhash set).
   * Returns the transaction signature. One call = one wallet prompt = one batch.
   */
  signAndSendTransaction(tx: Transaction): Promise<string>;
}
