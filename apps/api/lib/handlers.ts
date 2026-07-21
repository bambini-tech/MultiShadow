/**
 * Platform-agnostic proxy handlers.
 *
 * Each handler validates input, calls the Houdini client (with transient-only
 * retries), and returns a plain `{ status, body }`. Vercel/Netlify adapters wrap
 * these so the business logic stays identical across platforms.
 *
 * Validation failures return 400 and are NOT retried — they are business errors
 * (bad amount, missing field). Only transient upstream failures are retried.
 */
import { retry, HttpError, type HoudiniClient } from '@multishadow/core';
import { getHoudiniClient } from './houdini.js';

export interface HandlerResult {
  status: number;
  body: unknown;
}

export interface HandlerInput {
  query: Record<string, string | undefined>;
  body: unknown;
}

class BadRequest extends Error {}

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new BadRequest(`Missing or invalid "${name}".`);
  }
  return v.trim();
}

function requireAmount(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new BadRequest('Missing or invalid "amount" (must be a positive number).');
  }
  return n;
}

const RETRY = { attempts: 4, baseDelayMs: 300, maxDelayMs: 8000 } as const;

/** GET /quote?amount&from&to[&anonymous] */
export async function handleQuote(input: HandlerInput): Promise<HandlerResult> {
  return guard(async () => {
    const client = getHoudiniClient();
    const amount = requireAmount(input.query.amount);
    const from = requireString(input.query.from, 'from');
    const to = requireString(input.query.to, 'to');
    const anonymous = input.query.anonymous !== 'false';
    const quote = await retry(() => client.quote({ amount, from, to, anonymous }), RETRY);
    return { status: 200, body: quote };
  });
}

/** POST /exchange { amount, from, to, addressTo[, addressToTag, anonymous] } */
export async function handleExchange(input: HandlerInput): Promise<HandlerResult> {
  return guard(async () => {
    const client = getHoudiniClient();
    const b = (input.body ?? {}) as Record<string, unknown>;
    const amount = requireAmount(b.amount);
    const from = requireString(b.from, 'from');
    const to = requireString(b.to, 'to');
    const addressTo = requireString(b.addressTo, 'addressTo');
    const anonymous = b.anonymous !== false;
    const order = await retry(
      () =>
        client.exchange({
          amount,
          from,
          to,
          addressTo,
          ...(typeof b.addressToTag === 'string' ? { addressToTag: b.addressToTag } : {}),
          anonymous,
        }),
      RETRY,
    );
    return { status: 200, body: order };
  });
}

/** GET /status?id */
export async function handleStatus(input: HandlerInput): Promise<HandlerResult> {
  return guard(async () => {
    const client = getHoudiniClient();
    const id = requireString(input.query.id, 'id');
    const status = await retry(() => client.status(id), RETRY);
    return { status: 200, body: status };
  });
}

/** GET /min-max?from&to */
export async function handleMinMax(input: HandlerInput): Promise<HandlerResult> {
  return guard(async () => {
    const client = getHoudiniClient();
    const from = requireString(input.query.from, 'from');
    const to = requireString(input.query.to, 'to');
    const minmax = await retry(() => client.getMinMax({ from, to }), RETRY);
    return { status: 200, body: minmax };
  });
}

/** GET /tokens */
export async function handleTokens(): Promise<HandlerResult> {
  return guard(async () => {
    const client: HoudiniClient = getHoudiniClient();
    const tokens = await retry(() => client.getTokens(), RETRY);
    return { status: 200, body: tokens };
  });
}

/** Map thrown errors to sane HTTP responses without leaking internals. */
async function guard(fn: () => Promise<HandlerResult>): Promise<HandlerResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BadRequest) {
      return { status: 400, body: { error: err.message } };
    }
    if (err instanceof HttpError) {
      // Pass through the upstream status (e.g. 400 amount-below-min, 429 rate).
      return {
        status: err.status >= 400 && err.status < 600 ? err.status : 502,
        body: { error: 'Upstream Houdini error', status: err.status, detail: err.body },
      };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    // Config errors (missing key) and everything else become a 500 without
    // echoing secrets.
    return { status: 500, body: { error: safeMessage(message) } };
  }
}

function safeMessage(message: string): string {
  // Never echo anything that could contain a secret value.
  if (/api[_-]?key/i.test(message)) return 'Server configuration error.';
  return message;
}
