/**
 * Wallet abstraction.
 *
 * The rest of the app depends on this narrow interface, NOT on Reown's concrete
 * types, so the wallet layer is swappable and testable. The Reown-backed
 * implementation lives in ./appkit.ts.
 *
 * The SOURCE wallet can be Solana OR any EVM chain — whichever ecosystem the
 * selected source token lives on. Recipient private keys are never involved.
 */
import type { Transaction } from '@solana/web3.js';

export type WalletKind = 'solana' | 'evm';

/** One EVM transaction: a native value transfer, or an ERC-20 `transfer()`. */
export interface EvmSendRequest {
  /** Numeric chain id the transaction must be sent on. */
  chainId: number;
  /** Recipient (deposit) address. */
  to: string;
  /** Native value in wei (native-coin funding). Omit for ERC-20. */
  valueWei?: bigint;
  /** Calldata (ERC-20 `transfer(to,amount)`). Omit for native. */
  data?: string;
}

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
   * Sign and send a fully-built Solana transaction (feePayer + recentBlockhash
   * set). Returns the signature. One call = one wallet prompt = one batch.
   */
  signAndSendSolana(tx: Transaction): Promise<string>;
  /** Ensure the EVM wallet is connected to `chainId` (prompts a switch/add). */
  switchEvmChain(chainId: number): Promise<void>;
  /** Send one EVM transaction (native or ERC-20). Returns the tx hash. */
  sendEvm(req: EvmSendRequest): Promise<string>;
}
