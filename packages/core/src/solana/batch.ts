/**
 * Solana batched send.
 *
 * Funds many Houdini orders with as few transactions — and as few wallet
 * signature prompts — as possible by bundling multiple `SystemProgram.transfer`
 * instructions into one transaction.
 *
 * CRITICAL invariants:
 *   - Each instruction's destination is the Houdini **deposit address** for that
 *     order, NOT the final recipient wallet. Sending straight to the recipient
 *     would skip the privacy routing entirely.
 *   - The lamport amount is the order's **depositAmount** (what Houdini asked
 *     for), not the raw distribution amount.
 *   - A Solana transaction is capped at ~1232 bytes, so batches are auto-chunked
 *     to stay under the limit; each chunk needs exactly one signature from the
 *     source wallet.
 */
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { toBaseUnits } from '../util/amount.js';

/** Total transaction size limit on Solana, in bytes. */
export const MAX_TX_BYTES = 1232;

/** One transfer that funds a single Houdini deposit address. */
export interface DepositTransfer {
  /** The Houdini deposit address for an order (NOT the recipient wallet). */
  depositAddress: string;
  /** Amount to send, in lamports. */
  lamports: bigint;
  /** Optional back-reference so callers can map results to orders/wallets. */
  ref?: string;
}

/** Number of decimals in one SOL (kept explicit for readers of this module). */
const SOL_DECIMALS = Math.log10(LAMPORTS_PER_SOL); // 9

/** Convert a decimal SOL amount to integer lamports (exact, no float drift). */
export function solToLamports(sol: number): bigint {
  if (!Number.isFinite(sol) || sol < 0) throw new RangeError(`invalid SOL amount: ${sol}`);
  return toBaseUnits(sol, SOL_DECIMALS);
}

/** Build one `SystemProgram.transfer` instruction. */
export function buildTransferInstruction(
  source: PublicKey,
  transfer: DepositTransfer,
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: source,
    toPubkey: new PublicKey(transfer.depositAddress),
    lamports: transfer.lamports,
  });
}

export interface BuildBatchesParams {
  /** The funding (source) wallet public key. */
  source: PublicKey | string;
  transfers: readonly DepositTransfer[];
  /** A recent blockhash (required to compile/measure the transaction). */
  recentBlockhash: string;
  /**
   * Hard cap on transfers per transaction. If omitted, the packer fills each
   * transaction up to the byte limit (typically ~18–20 simple transfers).
   */
  maxPerTx?: number;
}

export interface BatchTransaction {
  transaction: Transaction;
  /** The transfers included in this transaction, in order. */
  transfers: DepositTransfer[];
}

/**
 * Pack transfers into as few transactions as possible, each under the byte
 * limit and with the source set as fee payer. Each returned transaction needs a
 * single signature from the source wallet (do this via Reown on the frontend).
 *
 * The caller should refresh `recentBlockhash` immediately before signing/sending
 * since blockhashes expire quickly.
 */
export function buildBatchedTransactions(params: BuildBatchesParams): BatchTransaction[] {
  const source = typeof params.source === 'string' ? new PublicKey(params.source) : params.source;
  const { transfers, recentBlockhash } = params;
  if (transfers.length === 0) return [];

  // Byte budget for the *message*: total tx limit minus the signature section
  // (1 length byte + 64 bytes per signer; single signer here).
  const messageBudget = MAX_TX_BYTES - (1 + 64);
  const hardCap = params.maxPerTx && params.maxPerTx > 0 ? params.maxPerTx : Infinity;

  const batches: BatchTransaction[] = [];
  let current = newTx(source, recentBlockhash);
  let currentTransfers: DepositTransfer[] = [];

  const flush = () => {
    if (currentTransfers.length > 0) {
      batches.push({ transaction: current, transfers: currentTransfers });
    }
    current = newTx(source, recentBlockhash);
    currentTransfers = [];
  };

  for (const t of transfers) {
    const ix = buildTransferInstruction(source, t);
    const trial = cloneTx(current);
    trial.add(ix);

    const withinBytes = messageSize(trial) <= messageBudget;
    const withinCap = currentTransfers.length + 1 <= hardCap;

    if (withinBytes && withinCap) {
      current.add(ix);
      currentTransfers.push(t);
      continue;
    }

    // Doesn't fit — start a new transaction. If a single transfer alone can't
    // fit, that's a malformed input we surface rather than loop forever.
    if (currentTransfers.length === 0) {
      throw new Error(
        `A single transfer to ${t.depositAddress} exceeds the transaction size limit.`,
      );
    }
    flush();
    current.add(ix);
    currentTransfers.push(t);
  }
  flush();
  return batches;
}

function newTx(feePayer: PublicKey, recentBlockhash: string): Transaction {
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = recentBlockhash;
  return tx;
}

function cloneTx(tx: Transaction): Transaction {
  const copy = new Transaction();
  if (tx.feePayer) copy.feePayer = tx.feePayer;
  if (tx.recentBlockhash) copy.recentBlockhash = tx.recentBlockhash;
  for (const ix of tx.instructions) copy.add(ix);
  return copy;
}

/** Serialized size of the compiled message, in bytes. */
function messageSize(tx: Transaction): number {
  return tx.compileMessage().serialize().length;
}
