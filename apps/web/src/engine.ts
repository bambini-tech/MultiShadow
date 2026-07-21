/**
 * Distribution orchestration for the browser.
 *
 * Flow (mirrors the milestones):
 *   1. Compute amounts (distribution engine).                       [preview]
 *   2. Create a Houdini order per recipient → deposit address + amount.
 *   3. Batch `SystemProgram.transfer`s into as few signed txs as possible,
 *      each funding the deposit addresses (one wallet prompt per batch).
 *   4. Poll each order until completed/failed.
 *
 * A Kv-backed store keyed by an idempotent key makes the run resumable and
 * prevents double-funding after a reload.
 */
import { Connection, PublicKey, type Transaction as SolTransaction } from '@solana/web3.js';
import {
  randomAllocation,
  allocateWithBounds,
  buildBatchedTransactions,
  solToLamports,
  runPool,
  partitionSettled,
  createOrder,
  pollUntilSettled,
  KvWalletStore,
  getOrCreate,
  transition,
  newWalletRecord,
  makeWalletKey,
  HoudiniClient,
  toBaseUnits,
  fromBaseUnits,
  type WalletRecord,
  type KeyValueBackend,
  type DepositTransfer,
} from '@multishadow/core';
import { config } from './config.js';
import { proxy } from './proxy.js';
import { findSolToken, resolveDestinationToken } from './tokens.js';
import type { Recipient, Settings, PreviewRow, Store } from './state.js';
import type { SolanaWallet } from './wallet.js';

// ── Preview (pure, no network) ─────────────────────────────────────────────

export function computePreview(recipients: Recipient[], settings: Settings): PreviewRow[] {
  const valid = recipients.filter((r) => r.address.trim() !== '');
  if (valid.length === 0) return [];

  let amounts: number[];
  if (settings.strategy === 'equal') {
    amounts = randomAllocation({ total: settings.total, count: valid.length, jitter: 0 });
  } else if (settings.strategy === 'weighted') {
    amounts = weightedAllocation(
      settings.total,
      valid.map((r) => (r.weight && r.weight > 0 ? r.weight : 1)),
    );
  } else {
    // random-in-range: honor per-recipient bounds if present.
    const bounds = valid.map((r) => ({
      ...(r.min !== undefined ? { min: r.min } : {}),
      ...(r.max !== undefined ? { max: r.max } : {}),
    }));
    amounts = allocateWithBounds({ total: settings.total, bounds, jitter: settings.jitter });
  }

  return valid.map((r, i) => ({
    recipientId: r.id,
    address: r.address,
    chain: r.chain,
    amount: amounts[i] ?? 0,
  }));
}

/** Exact weighted split (base units) that sums to `total`. */
function weightedAllocation(total: number, weights: number[], decimals = 9): number[] {
  const units = toBaseUnits(total, decimals);
  const scaled = weights.map((w) => BigInt(Math.max(1, Math.round(w * 1_000_000))));
  const sum = scaled.reduce((a, b) => a + b, 0n);
  const raw = scaled.map((w) => (units * w) / sum);
  let used = raw.reduce((a, b) => a + b, 0n);
  let i = 0;
  while (used < units && weights.length > 0) {
    raw[i % raw.length] = (raw[i % raw.length] as bigint) + 1n;
    used += 1n;
    i += 1;
  }
  return raw.map((u) => fromBaseUnits(u, decimals));
}

// ── Run (network + wallet) ─────────────────────────────────────────────────

const localStorageBackend: KeyValueBackend = {
  getItem: (k) => window.localStorage.getItem(k),
  setItem: (k, v) => window.localStorage.setItem(k, v),
  removeItem: (k) => window.localStorage.removeItem(k),
  keys: () => Object.keys(window.localStorage),
};

export interface RunDeps {
  store: Store;
  wallet: SolanaWallet;
  /** Deterministic batch id lets a reload resume the same batch. */
  batchId: string;
}

/**
 * Run the full distribution. Safe to call again with the same `batchId` to
 * resume: already-created orders and already-funded deposits are skipped.
 */
export async function runDistribution(deps: RunDeps): Promise<void> {
  const { store, wallet, batchId } = deps;
  const { recipients, settings } = store.get();
  const source = wallet.getAddress();
  if (!source) throw new Error('Connect a Solana wallet first.');

  const walletStore = new KvWalletStore(localStorageBackend);
  const connection = new Connection(config.solanaRpcUrl, 'confirmed');
  store.set({ running: true });

  try {
    const preview = computePreview(recipients, settings);
    if (preview.length === 0) throw new Error('Add at least one recipient with an address.');

    store.log('Resolving Houdini tokens…');
    const tokens = await proxy.tokens();
    const solToken = findSolToken(tokens);
    if (!solToken) throw new Error('Could not resolve the SOL token id from Houdini.');

    // Build the per-recipient plan with resolved destination token ids.
    const plan = preview.map((row, index) => {
      const dest = resolveDestinationToken(tokens, row.chain);
      if (!dest) throw new Error(`Unsupported destination chain: ${row.chain}`);
      const key = makeWalletKey({
        batchId,
        receiver: row.address,
        from: solToken.id,
        to: dest.id,
        index,
      });
      return { row, index, fromId: solToken.id, toId: dest.id, key };
    });

    // Phase 1 — create orders (bounded concurrency, settled per item).
    store.log(`Creating ${plan.length} orders…`);
    const houdini = new HoudiniClient({ baseUrl: config.apiBaseUrl });
    const created = await runPool(
      plan,
      async (p) => {
        const record = await getOrCreate(walletStore, p.key, () =>
          newWalletRecord({
            batchId,
            receiver: p.row.address,
            from: p.fromId,
            to: p.toId,
            amount: p.row.amount,
            index: p.index,
          }),
        );
        publish(store, record);

        // Idempotency: if we already have deposit details, don't create again.
        if (record.orderId && record.depositAddress && record.depositAmount) {
          return record;
        }

        const { order } = await createOrder(houdini, {
          amount: p.row.amount,
          from: p.fromId,
          to: p.toId,
          addressTo: p.row.address,
          anonymous: settings.anonymous,
        });
        const next = transition(record, 'order_created', {
          orderId: order.orderId,
          depositAddress: order.depositAddress,
          depositAmount: order.depositAmount,
          ...(order.depositMemo ? { depositMemo: order.depositMemo } : {}),
        });
        await walletStore.put(next);
        publish(store, next);
        return next;
      },
      { concurrency: settings.concurrency, maxJitterMs: settings.maxJitterMs },
    );

    const { ok: orders, failed } = partitionSettled(created);
    for (const f of failed) {
      const p = plan[f.index];
      if (p) {
        const rec = (await walletStore.get(p.key)) ?? undefined;
        if (rec) {
          const failedRec = transition(rec, 'failed', { error: errMsg(f.error) });
          await walletStore.put(failedRec);
          publish(store, failedRec);
        }
      }
      store.log(`Order failed: ${errMsg(f.error)}`);
    }

    // Only fund records that have deposit details and are not yet funded.
    const toFund = orders
      .map((o) => o.value)
      .filter((r) => r.phase === 'order_created' && r.depositAddress && r.depositAmount);
    if (toFund.length === 0) {
      store.log('No orders to fund.');
      return;
    }

    // Phase 2 — batch + sign + send.
    const transfers: DepositTransfer[] = toFund.map((r) => ({
      depositAddress: r.depositAddress as string,
      lamports: solToLamports(r.depositAmount as number),
      ref: r.key,
    }));

    store.log('Fetching recent blockhash…');
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const batches = buildBatchedTransactions({
      source: new PublicKey(source),
      transfers,
      recentBlockhash: blockhash,
    });
    store.log(`Signing ${batches.length} batch transaction(s)…`);

    for (const batch of batches) {
      const signature = await wallet.signAndSendTransaction(batch.transaction as SolTransaction);
      store.log(`Batch sent: ${signature.slice(0, 12)}…`);
      for (const t of batch.transfers) {
        const rec = await walletStore.get(t.ref as string);
        if (rec) {
          const funded = transition(rec, 'funded', { fundingTxSignature: signature });
          await walletStore.put(funded);
          publish(store, funded);
        }
      }
    }

    // Phase 3 — poll each order until settled.
    store.log('Polling order statuses…');
    await runPool(
      toFund,
      async (r) => {
        const current = (await walletStore.get(r.key)) ?? r;
        const { status } = await pollUntilSettled(houdini, current.orderId as string, {
          intervalMs: 6000,
          timeoutMs: 30 * 60 * 1000,
          onStatus: (s) => store.log(`${current.receiver.slice(0, 6)}… → ${s.phase}`),
        });
        const terminalPhase = status.phase === 'completed' ? 'completed' : 'failed';
        const next = transition(current, terminalPhase, {
          ...(terminalPhase === 'failed' ? { error: `Houdini phase: ${status.phase}` } : {}),
        });
        await walletStore.put(next);
        publish(store, next);
        return next;
      },
      { concurrency: settings.concurrency },
    );

    store.log('Distribution finished.');
  } finally {
    store.set({ running: false });
  }
}

/** Load any persisted records for a batch (recovery of an interrupted run). */
export async function loadBatch(store: Store, batchId: string): Promise<void> {
  const walletStore = new KvWalletStore(localStorageBackend);
  const records = await walletStore.getAll(batchId);
  if (records.length === 0) return;
  const map: Record<string, WalletRecord> = {};
  for (const r of records) map[r.key] = r;
  store.set({ wallets: map });
  store.log(`Recovered ${records.length} record(s) from a previous run.`);
}

function publish(store: Store, record: WalletRecord): void {
  store.set((s) => ({ wallets: { ...s.wallets, [record.key]: record } }));
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
