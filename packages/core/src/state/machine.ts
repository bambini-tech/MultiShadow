/**
 * Per-wallet state machine + idempotency.
 *
 * Each recipient wallet moves through:
 *
 *     pending ──▶ order_created ──▶ funded ──▶ completed
 *        │             │              │
 *        └─────────────┴──────────────┴──▶ failed
 *
 * The transition table is enforced so illegal jumps (e.g. funding before an
 * order exists) throw. Combined with a persistent store keyed by an idempotent
 * key, this guarantees a restart never double-funds an order.
 */

export type WalletPhase = 'pending' | 'order_created' | 'funded' | 'completed' | 'failed';

export const TERMINAL_PHASES: ReadonlySet<WalletPhase> = new Set(['completed', 'failed']);

/** Allowed forward transitions. `failed` is reachable from any non-terminal. */
const TRANSITIONS: Record<WalletPhase, ReadonlySet<WalletPhase>> = {
  pending: new Set<WalletPhase>(['order_created', 'failed']),
  order_created: new Set<WalletPhase>(['funded', 'failed']),
  funded: new Set<WalletPhase>(['completed', 'failed']),
  completed: new Set<WalletPhase>(),
  failed: new Set<WalletPhase>(['pending']), // allow explicit retry/reset
};

export interface WalletRecord {
  /** Idempotent key — stable across restarts for the same intended transfer. */
  key: string;
  /** Batch this wallet belongs to. */
  batchId: string;
  /** Recipient PUBLIC address. */
  receiver: string;
  /** Source token id. */
  from: string;
  /** Destination token id (same as `from` for SOL→SOL). */
  to: string;
  /** Intended amount to distribute to this recipient (decimal). */
  amount: number;
  phase: WalletPhase;
  /** Set once the Houdini order exists. */
  orderId?: string;
  depositAddress?: string;
  /** Exact amount Houdini asked us to deposit (decimal). */
  depositAmount?: number;
  depositMemo?: string;
  /** Solana signature of the batch tx that funded this deposit. */
  fundingTxSignature?: string;
  /** Human-readable error if the wallet failed. */
  error?: string;
  updatedAt: number;
}

export class InvalidTransitionError extends Error {
  constructor(from: WalletPhase, to: WalletPhase) {
    super(`Invalid state transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

/** Whether `from → to` is a legal transition. */
export function canTransition(from: WalletPhase, to: WalletPhase): boolean {
  if (from === to) return true; // idempotent no-op
  return TRANSITIONS[from].has(to);
}

/**
 * Apply a transition, returning a NEW record. Throws on an illegal transition.
 * `patch` carries phase-specific fields (orderId, depositAmount, signature, …).
 */
export function transition(
  record: WalletRecord,
  to: WalletPhase,
  patch: Partial<Omit<WalletRecord, 'key' | 'batchId' | 'phase'>> = {},
  now: () => number = Date.now,
): WalletRecord {
  if (!canTransition(record.phase, to)) {
    throw new InvalidTransitionError(record.phase, to);
  }
  return { ...record, ...patch, phase: to, updatedAt: now() };
}

/** True when the wallet is in a terminal phase (completed or failed). */
export function isTerminal(record: WalletRecord): boolean {
  return TERMINAL_PHASES.has(record.phase);
}

/**
 * A stable idempotent key for a recipient in a batch. Deterministic given the
 * same inputs, so re-running the same batch resolves to the same records rather
 * than creating duplicates.
 */
export function makeWalletKey(input: {
  batchId: string;
  receiver: string;
  from: string;
  to: string;
  index: number;
}): string {
  return [input.batchId, input.index, input.from, input.to, input.receiver].join(':');
}

/** Build a fresh `pending` record. */
export function newWalletRecord(
  input: {
    batchId: string;
    receiver: string;
    from: string;
    to: string;
    amount: number;
    index: number;
  },
  now: () => number = Date.now,
): WalletRecord {
  return {
    key: makeWalletKey(input),
    batchId: input.batchId,
    receiver: input.receiver,
    from: input.from,
    to: input.to,
    amount: input.amount,
    phase: 'pending',
    updatedAt: now(),
  };
}
