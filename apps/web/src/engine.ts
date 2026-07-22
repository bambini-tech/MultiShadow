/**
 * Distribution orchestration for the browser.
 *
 * Flow (mirrors the milestones):
 *   1. Compute amounts (distribution engine).                       [preview]
 *   2. Create a Houdini order per recipient → deposit address + amount.
 *   3. Fund every deposit address FROM the selected source token:
 *        · Solana (native SOL) → batched `SystemProgram.transfer`s (one wallet
 *          prompt per batch).
 *        · EVM (native coin or ERC-20) → one transfer per recipient.
 *   4. Poll each order until completed/failed.
 *
 * The order-creation and polling phases are network-agnostic (they only use
 * Houdini token ids + order ids); only the funding phase branches on the source
 * network.
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
  classifyNetwork,
  evmChainId,
  type WalletRecord,
  type KeyValueBackend,
  type DepositTransfer,
} from '@multishadow/core';
import { Interface } from 'ethers';
import { config } from './config.js';
import type { Recipient, Settings, PreviewRow, Store, TokenRef } from './state.js';
import type { Wallet } from './wallet.js';

/** EVM native coins are 18-decimal (wei); Solana native SOL is 9 (lamports). */
const EVM_NATIVE_DECIMALS = 18;
const erc20Interface = new Interface(['function transfer(address to, uint256 amount)']);

// ── Preview (pure, no network) ─────────────────────────────────────────────

/** A recipient counts toward the split only once it has an address AND a token. */
function isReady(r: Recipient): r is Recipient & { token: TokenRef } {
  return r.address.trim() !== '' && r.token !== undefined;
}

export function computePreview(recipients: Recipient[], settings: Settings): PreviewRow[] {
  const valid = recipients.filter(isReady);
  if (valid.length === 0) return [];

  const decimals = sourceDecimals(settings.source);

  let amounts: number[];
  if (settings.strategy === 'equal') {
    amounts = randomAllocation({ total: settings.total, count: valid.length, jitter: 0 });
  } else if (settings.strategy === 'weighted') {
    amounts = weightedAllocation(
      settings.total,
      valid.map((r) => (r.weight && r.weight > 0 ? r.weight : 1)),
      decimals,
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
    token: r.token,
    amount: amounts[i] ?? 0,
  }));
}

/** Source token base-unit precision (defaults to SOL's 9 for the SOL source). */
function sourceDecimals(source: TokenRef | undefined): number {
  if (source?.decimals !== undefined) return Math.min(18, Math.max(0, source.decimals));
  if (source && classifyNetwork(source.network) === 'evm' && !source.contractAddress) {
    return EVM_NATIVE_DECIMALS;
  }
  return 9;
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
  wallet: Wallet;
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
  const source = settings.source;
  if (!source) throw new Error('Pick a source token to send from first.');

  const sourceKind = classifyNetwork(source.network);
  if (sourceKind === 'other') {
    throw new Error(
      `Sending from ${source.symbol} on ${source.network} isn't supported yet — ` +
        `pick a Solana or EVM-chain source token. (Recipients can still be any chain.)`,
    );
  }
  if (sourceKind === 'solana' && source.contractAddress) {
    throw new Error(
      `Sending from the SPL token ${source.symbol} isn't supported yet — use SOL, ` +
        `or an EVM-chain source token.`,
    );
  }

  store.set({ running: true });
  try {
    const preview = computePreview(recipients, settings);
    if (preview.length === 0) {
      throw new Error('Add at least one recipient with an address and a destination token.');
    }

    // Build the per-recipient plan. `from`/`to` are Houdini token ids.
    const plan = preview.map((row, index) => {
      const dest = row.token!;
      const key = makeWalletKey({
        batchId,
        receiver: row.address,
        from: source.id,
        to: dest.id,
        index,
      });
      return { row, index, fromId: source.id, toId: dest.id, key };
    });

    // Phase 1 — create orders (bounded concurrency, settled per item).
    store.log(`Creating ${plan.length} orders…`);
    const walletStore = new KvWalletStore(localStorageBackend);
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

    // Phase 2 — fund deposits (branches on the source network).
    if (sourceKind === 'solana') {
      await fundSolana(store, wallet, walletStore, toFund);
    } else {
      await fundEvm(store, wallet, walletStore, toFund, source);
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

// ── Funding: Solana (native SOL, batched) ──────────────────────────────────

async function fundSolana(
  store: Store,
  wallet: Wallet,
  walletStore: KvWalletStore,
  toFund: WalletRecord[],
): Promise<void> {
  const source = wallet.getAddress();
  if (!source) throw new Error('Connect a Solana wallet to fund the deposits.');
  const connection = new Connection(config.solanaRpcUrl, 'confirmed');

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
    const signature = await wallet.signAndSendSolana(batch.transaction as SolTransaction);
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
}

// ── Funding: EVM (native coin or ERC-20, one tx per recipient) ─────────────

async function fundEvm(
  store: Store,
  wallet: Wallet,
  walletStore: KvWalletStore,
  toFund: WalletRecord[],
  source: TokenRef,
): Promise<void> {
  const chainId = evmChainId(source.network);
  if (chainId === undefined) {
    throw new Error(`Unknown EVM chain id for ${source.network}.`);
  }
  store.log(`Switching wallet to ${source.network} (chain ${chainId})…`);
  await wallet.switchEvmChain(chainId);

  const decimals = source.contractAddress
    ? (source.decimals ?? evmTokenDecimalsFallback(source))
    : EVM_NATIVE_DECIMALS;

  // EVM can't batch transfers to different addresses in one native tx, so each
  // deposit is its own transaction (and its own wallet prompt).
  for (const r of toFund) {
    const amount = toBaseUnits(r.depositAmount as number, decimals);
    const to = r.depositAddress as string;
    let hash: string;
    if (source.contractAddress) {
      const data = erc20Interface.encodeFunctionData('transfer', [to, amount]);
      hash = await wallet.sendEvm({ chainId, to: source.contractAddress, data });
    } else {
      hash = await wallet.sendEvm({ chainId, to, valueWei: amount });
    }
    store.log(`Sent to ${to.slice(0, 10)}…: ${hash.slice(0, 12)}…`);
    const funded = transition(r, 'funded', { fundingTxSignature: hash });
    await walletStore.put(funded);
    publish(store, funded);
  }
}

function evmTokenDecimalsFallback(source: TokenRef): never {
  throw new Error(
    `Missing decimals for ERC-20 source token ${source.symbol}; cannot compute the exact amount.`,
  );
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
