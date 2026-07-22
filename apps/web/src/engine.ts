/**
 * Distribution orchestration for the browser — Houdini v2 native multi-swap.
 *
 * Flow:
 *   1. Compute per-recipient amounts (local distribution engine).      [preview]
 *   2. POST /exchanges/multi — create ALL orders in one group (a `multiId`),
 *      each with its own Houdini deposit address. Quotes are resolved by Houdini.
 *   3. Fund the deposits with the batched transactions Houdini pre-builds:
 *        · Solana → GET .../tx?sender  → base64 transactions → sign + send.
 *        · EVM    → POST .../tx/build  → ERC-4337 user-ops → sign hash → submit.
 *   4. Poll GET /exchanges/multi/{multiId} until every order is terminal.
 *
 * The `multiId` is persisted so a reload can re-attach to an in-flight group.
 */
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import {
  randomAllocation,
  allocateWithBounds,
  toBaseUnits,
  fromBaseUnits,
  classifyNetwork,
  isTerminalOrderPhase,
  type OrderPhase,
} from '@multishadow/core';
import { getBytes } from 'ethers';
import { proxy, type MultiOrderInput } from './proxy.js';
import type { Recipient, Settings, PreviewRow, Store, TokenRef, OrderView } from './state.js';
import type { Wallet } from './wallet.js';

/** Houdini caps a multi-exchange group at 50 orders. */
const MAX_ORDERS = 50;
const EVM_NATIVE_DECIMALS = 18;

// ── Preview (pure, no network) ─────────────────────────────────────────────

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

function sourceDecimals(source: TokenRef | undefined): number {
  if (source?.decimals !== undefined) return Math.min(18, Math.max(0, source.decimals));
  if (source && sourceKind(source) === 'evm') return EVM_NATIVE_DECIMALS;
  return 9;
}

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

/** 'solana' | 'evm' | 'other' for a token, preferring Houdini's `kind`. */
function sourceKind(t: TokenRef): 'solana' | 'evm' | 'other' {
  if (t.kind === 'sol') return 'solana';
  if (t.kind === 'evm') return 'evm';
  return classifyNetwork(t.network);
}

// ── Run (network + wallet) ─────────────────────────────────────────────────

const MULTI_KEY = (batchId: string): string => `multishadow:multiId:${batchId}`;

export interface RunDeps {
  store: Store;
  wallet: Wallet;
  batchId: string;
}

export async function runDistribution(deps: RunDeps): Promise<void> {
  const { store, wallet, batchId } = deps;
  const { recipients, settings } = store.get();
  const source = settings.source;
  if (!source) throw new Error('Pick a source token to send from first.');

  const kind = sourceKind(source);
  if (kind === 'other') {
    throw new Error(
      `Sending from ${source.symbol} on ${source.network} isn't supported yet — ` +
        `pick a Solana or EVM-chain source token. (Recipients can be any chain.)`,
    );
  }
  const walletKind = wallet.getKind();
  if (walletKind && walletKind !== kind) {
    throw new Error(
      `Connect a ${kind === 'solana' ? 'Solana' : 'EVM'} wallet to fund ${source.symbol}.`,
    );
  }
  const sender = wallet.getAddress();
  if (!sender) throw new Error('Connect the source wallet first.');

  store.set({ running: true });
  try {
    const preview = computePreview(recipients, settings);
    if (preview.length === 0) {
      throw new Error('Add at least one recipient with an address and a destination token.');
    }
    if (preview.length > MAX_ORDERS) {
      throw new Error(
        `Houdini allows up to ${MAX_ORDERS} recipients per run (got ${preview.length}).`,
      );
    }

    const orderInputs: MultiOrderInput[] = preview.map((row) => ({
      from: source.id,
      to: row.token!.id,
      amount: row.amount,
      addressTo: row.address,
      anonymous: settings.anonymous,
    }));

    store.log(`Creating multi-exchange with ${orderInputs.length} order(s)…`);
    const created = await proxy.createMultiExchange(orderInputs);
    window.localStorage.setItem(MULTI_KEY(batchId), created.multiId);
    store.log(`Group created: ${created.multiId}`);

    // Seed the order views (zip by index with the preview we submitted).
    const views: OrderView[] = created.orders.map((item, i) => {
      const row = preview[i];
      if (item.order) {
        return {
          houdiniId: item.order.houdiniId,
          receiver: item.order.receiverAddress || row?.address || '',
          ...(row?.token ? { token: row.token } : {}),
          depositAddress: item.order.depositAddress,
          depositAmount: item.order.depositAmount,
          phase: item.order.phase,
        };
      }
      return {
        houdiniId: '',
        receiver: row?.address ?? '',
        ...(row?.token ? { token: row.token } : {}),
        phase: 'failed',
        error: item.error ?? 'Order was not created.',
      };
    });
    store.set({ multiId: created.multiId, orders: views });

    const fundable = views.filter((v) => v.houdiniId && v.depositAddress);
    if (fundable.length === 0) throw new Error('No orders were created — nothing to fund.');

    // Phase 2 — fund via Houdini's pre-built batched transactions.
    if (kind === 'solana') {
      await fundSolana(store, wallet, created.multiId, sender);
    } else {
      await fundEvm(store, wallet, created.multiId, sender);
    }

    // Phase 3 — poll the group until every order is terminal.
    await pollGroup(store, created.multiId);
    store.log('Distribution finished.');
  } finally {
    store.set({ running: false });
  }
}

async function fundSolana(
  store: Store,
  wallet: Wallet,
  multiId: string,
  sender: string,
): Promise<void> {
  store.log('Fetching batched Solana deposit transactions…');
  const tx = await proxy.multiTxSolana(multiId, sender);
  const batches = tx.transactions.filter((b) => b.solanaBase64);
  if (batches.length === 0) throw new Error('Houdini returned no Solana transactions to sign.');
  store.log(`Signing ${batches.length} batch transaction(s)…`);

  for (const batch of batches) {
    const signature = await wallet.signAndSendSolana(
      deserializeSolana(batch.solanaBase64 as string),
    );
    store.log(`Batch sent: ${signature.slice(0, 12)}…`);
    markFunded(store, batch.houdiniIds, signature);
  }
}

async function fundEvm(
  store: Store,
  wallet: Wallet,
  multiId: string,
  sender: string,
): Promise<void> {
  store.log('Building batched EVM user-operations…');
  const tx = await proxy.multiTxBuildEvm(multiId, sender);
  const batches = tx.transactions.filter((b) => b.evm);
  if (batches.length === 0) throw new Error('Houdini returned no EVM user-operations to sign.');
  if (tx.depositNeeded && tx.depositNeeded !== '0') {
    store.log(
      `Note: smart account needs ${tx.depositNeeded} wei more native gas before submission.`,
    );
  }

  store.log(`Signing ${batches.length} user-operation(s)…`);
  const signatures: string[] = [];
  for (const batch of batches) {
    signatures.push(await wallet.signEvmMessage(getBytes(batch.evm!.userOpHash)));
  }
  const submit = await proxy.multiTxSubmitEvm(multiId, signatures);
  store.log(`Submitted ${submit.userOpHashes.length} user-operation(s).`);
  for (const batch of batches) markFunded(store, batch.houdiniIds, batch.evm!.userOpHash);
}

async function pollGroup(store: Store, multiId: string): Promise<void> {
  store.log('Polling order statuses…');
  const started = Date.now();
  const timeoutMs = 30 * 60 * 1000;
  for (;;) {
    const status = await proxy.multiStatus(multiId);
    const byId = new Map(status.orders.map((o) => [o.houdiniId, o]));
    store.set((s) => ({
      orders: s.orders.map((v) => {
        const o = byId.get(v.houdiniId);
        return o ? { ...v, phase: o.phase, depositAmount: o.depositAmount || v.depositAmount } : v;
      }),
    }));
    const phases = status.orders.map((o) => o.phase);
    if (phases.length > 0 && phases.every((p) => isTerminalOrderPhase(p as OrderPhase))) return;
    if (Date.now() - started >= timeoutMs) {
      store.log('Polling timed out; check the group later.');
      return;
    }
    await sleep(6000);
  }
}

/** Re-attach to an in-flight group after a reload. */
export async function loadBatch(store: Store, batchId: string): Promise<void> {
  const multiId = window.localStorage.getItem(MULTI_KEY(batchId));
  if (!multiId) return;
  try {
    const status = await proxy.multiStatus(multiId);
    if (status.orders.length === 0) return;
    store.set({
      multiId,
      orders: status.orders.map((o) => ({
        houdiniId: o.houdiniId,
        receiver: o.receiverAddress,
        depositAddress: o.depositAddress,
        depositAmount: o.depositAmount,
        phase: o.phase,
      })),
    });
    store.log(`Recovered group ${multiId} (${status.orders.length} order(s)).`);
  } catch {
    // A stale/expired group (>48h) just won't resolve; ignore.
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function markFunded(store: Store, houdiniIds: string[], tx: string): void {
  const ids = new Set(houdiniIds);
  store.set((s) => ({
    orders: s.orders.map((v) =>
      ids.has(v.houdiniId)
        ? { ...v, phase: v.phase === 'waiting' ? 'confirming' : v.phase, fundingTx: tx }
        : v,
    ),
  }));
}

function deserializeSolana(base64: string): Transaction | VersionedTransaction {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
