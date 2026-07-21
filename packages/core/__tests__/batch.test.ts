import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
  buildBatchedTransactions,
  solToLamports,
  MAX_TX_BYTES,
  type DepositTransfer,
} from '../src/solana/batch.js';

/** Deterministic valid addresses for tests. */
function addr(i: number): string {
  return Keypair.fromSeed(
    Uint8Array.from({ length: 32 }, (_, k) => (i + k) % 251),
  ).publicKey.toBase58();
}

const BLOCKHASH = '11111111111111111111111111111111';

describe('solToLamports', () => {
  it('converts SOL to lamports exactly', () => {
    expect(solToLamports(1)).toBe(1_000_000_000n);
    expect(solToLamports(0.000000001)).toBe(1n);
    expect(solToLamports(2.5)).toBe(2_500_000_000n);
  });
});

describe('buildBatchedTransactions', () => {
  const source = addr(1);

  it('bundles multiple transfers into a single transaction when they fit', () => {
    const transfers: DepositTransfer[] = Array.from({ length: 5 }, (_, i) => ({
      depositAddress: addr(i + 2),
      lamports: solToLamports(0.1),
    }));
    const batches = buildBatchedTransactions({ source, transfers, recentBlockhash: BLOCKHASH });
    expect(batches).toHaveLength(1);
    expect(batches[0]!.transaction.instructions).toHaveLength(5);
    expect(batches[0]!.transaction.feePayer?.toBase58()).toBe(source);
  });

  it('auto-chunks large batches so each tx stays under the byte limit', () => {
    const transfers: DepositTransfer[] = Array.from({ length: 60 }, (_, i) => ({
      depositAddress: addr(i + 2),
      lamports: solToLamports(0.05),
    }));
    const batches = buildBatchedTransactions({ source, transfers, recentBlockhash: BLOCKHASH });
    expect(batches.length).toBeGreaterThan(1);
    // Every chunk must serialize under the limit and cover all transfers exactly once.
    let covered = 0;
    for (const b of batches) {
      const size = b.transaction.compileMessage().serialize().length + 1 + 64;
      expect(size).toBeLessThanOrEqual(MAX_TX_BYTES);
      covered += b.transfers.length;
    }
    expect(covered).toBe(60);
  });

  it('respects an explicit maxPerTx cap', () => {
    const transfers: DepositTransfer[] = Array.from({ length: 10 }, (_, i) => ({
      depositAddress: addr(i + 2),
      lamports: solToLamports(0.1),
    }));
    const batches = buildBatchedTransactions({
      source,
      transfers,
      recentBlockhash: BLOCKHASH,
      maxPerTx: 3,
    });
    expect(batches).toHaveLength(4); // 3 + 3 + 3 + 1
    for (const b of batches) expect(b.transfers.length).toBeLessThanOrEqual(3);
  });

  it('returns an empty array for no transfers', () => {
    expect(buildBatchedTransactions({ source, transfers: [], recentBlockhash: BLOCKHASH })).toEqual(
      [],
    );
  });

  it('targets the deposit address, not the recipient wallet', () => {
    const deposit = addr(2);
    const batches = buildBatchedTransactions({
      source,
      transfers: [{ depositAddress: deposit, lamports: solToLamports(1) }],
      recentBlockhash: BLOCKHASH,
    });
    const ix = batches[0]!.transaction.instructions[0]!;
    // SystemProgram.transfer keys: [from, to]; `to` must be the deposit address.
    expect(ix.keys[1]!.pubkey.toBase58()).toBe(deposit);
  });
});
