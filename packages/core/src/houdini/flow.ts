/**
 * Private-swap flow: quote → exchange → status polling.
 *
 * Two building blocks:
 *   - `createOrder`  — quote (optional preview) then create the exchange order,
 *                      returning the deposit address + exact deposit amount to
 *                      fund. Retries transient errors; never retries business
 *                      errors (e.g. amount below minimum).
 *   - `pollUntilSettled` — poll `status` with backoff until the order reaches a
 *                      terminal phase or a timeout elapses.
 *
 * Same-chain (SOL→SOL) and cross-chain routing are both supported: the caller
 * chooses `from`/`to` token ids per recipient.
 */
import { retry, type RetryOptions } from '../http/retry.js';
import type { HoudiniClient } from './client.js';
import type { HoudiniOrder, HoudiniOrderStatus, HoudiniPhase } from './types.js';

export interface CreateOrderInput {
  amount: number;
  /** Source token id (e.g. Solana SOL). */
  from: string;
  /** Destination token id — same as `from` for SOL→SOL, different for cross-chain. */
  to: string;
  /** Recipient PUBLIC address. */
  addressTo: string;
  /** Optional destination memo/tag. */
  addressToTag?: string;
  /** Private routing. Default true. */
  anonymous?: boolean;
}

export interface CreateOrderResult {
  order: HoudiniOrder;
}

const TERMINAL: ReadonlySet<HoudiniPhase> = new Set(['completed', 'failed', 'refunded', 'expired']);

/** Create an exchange order (with transient-only retries). */
export async function createOrder(
  client: HoudiniClient,
  input: CreateOrderInput,
  retryOpts?: RetryOptions,
): Promise<CreateOrderResult> {
  const order = await retry(
    () =>
      client.exchange({
        amount: input.amount,
        from: input.from,
        to: input.to,
        addressTo: input.addressTo,
        ...(input.addressToTag ? { addressToTag: input.addressToTag } : {}),
        anonymous: input.anonymous ?? true,
      }),
    retryOpts,
  );

  if (!order.orderId || !order.depositAddress || !(order.depositAmount > 0)) {
    throw new Error(
      'Houdini exchange returned an incomplete order (missing orderId, deposit ' +
        'address, or deposit amount). Verify the API field mapping in houdini/types.ts.',
    );
  }
  return { order };
}

export interface PollOptions {
  /** Delay between polls in ms. Default 5000. */
  intervalMs?: number;
  /** Give up after this many ms. Default 30 minutes. */
  timeoutMs?: number;
  /** Injected sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Injected clock (tests). Returns ms. Default Date.now. */
  now?: () => number;
  /** AbortSignal to stop polling. */
  signal?: AbortSignal;
  /** Called on every status read. */
  onStatus?: (status: HoudiniOrderStatus) => void;
  /** Retry options for each individual status call. */
  retry?: RetryOptions;
}

export interface PollResult {
  status: HoudiniOrderStatus;
  timedOut: boolean;
}

const realSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

/** Poll an order's status until it reaches a terminal phase or times out. */
export async function pollUntilSettled(
  client: HoudiniClient,
  orderId: string,
  options: PollOptions = {},
): Promise<PollResult> {
  const intervalMs = Math.max(500, options.intervalMs ?? 5000);
  const timeoutMs = Math.max(intervalMs, options.timeoutMs ?? 30 * 60 * 1000);
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const { signal, onStatus } = options;

  const start = now();
  let last: HoudiniOrderStatus | undefined;

  for (;;) {
    if (signal?.aborted) {
      return { status: last ?? unknownStatus(orderId), timedOut: false };
    }
    const status = await retry(() => client.status(orderId), options.retry);
    last = status;
    onStatus?.(status);

    if (TERMINAL.has(status.phase)) {
      return { status, timedOut: false };
    }
    if (now() - start >= timeoutMs) {
      return { status, timedOut: true };
    }
    await sleep(intervalMs);
  }
}

/** True when a phase is terminal (completed/failed/refunded/expired). */
export function isTerminalPhase(phase: HoudiniPhase): boolean {
  return TERMINAL.has(phase);
}

function unknownStatus(orderId: string): HoudiniOrderStatus {
  return { orderId, phase: 'unknown', rawStatus: undefined, raw: {} };
}
