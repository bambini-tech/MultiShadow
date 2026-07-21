/**
 * Houdini Swap API types and the SINGLE field-mapping layer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  IMPORTANT — field-name verification
 *  The official docs (https://docs.houdiniswap.com/houdini-swap/api-documentation,
 *  v1.2.4: quote, exchange, status, getMinMax, tokens, dex* variants) were NOT
 *  reachable from the build environment. Everything below is written against the
 *  documented v1.2.4 response shape. If a field name differs in production, fix
 *  it HERE (in the `map*` functions) — the rest of the codebase consumes only the
 *  normalized types and should not need changes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Raw JSON as returned by the API before normalization. */
export type RawJson = Record<string, unknown>;

// ── Normalized domain types ────────────────────────────────────────────────

export interface HoudiniToken {
  /** Houdini token identifier used as `from`/`to` in quote/exchange. */
  id: string;
  symbol: string;
  name: string;
  /** Network / chain name, e.g. "SOL", "ETH". */
  network: string;
  decimals?: number;
  /** Original object, in case the caller needs a field we did not normalize. */
  raw: RawJson;
}

export interface HoudiniQuote {
  amountIn: number;
  amountOut: number;
  /** Minimum input amount accepted for this route. */
  min: number;
  /** Maximum input amount accepted for this route. */
  max: number;
  /** Whether this is a private (anonymous) route. */
  anonymous: boolean;
  raw: RawJson;
}

export interface HoudiniMinMax {
  min: number;
  max: number;
  raw: RawJson;
}

/** Result of creating an exchange order. */
export interface HoudiniOrder {
  /** Order identifier used for status polling. */
  orderId: string;
  /** Address the source wallet must send funds to. */
  depositAddress: string;
  /** Exact amount to deposit (in the source token). */
  depositAmount: number;
  /** Memo/tag some chains require alongside the deposit (optional). */
  depositMemo?: string;
  /** Expected amount delivered to the recipient. */
  expectedOut?: number;
  raw: RawJson;
}

/** Normalized lifecycle phase of a Houdini order. */
export type HoudiniPhase =
  'awaiting_deposit' | 'processing' | 'completed' | 'failed' | 'refunded' | 'expired' | 'unknown';

export interface HoudiniOrderStatus {
  orderId: string;
  phase: HoudiniPhase;
  /** The raw status value (number or string) exactly as returned. */
  rawStatus: unknown;
  raw: RawJson;
}

// ── Request parameter shapes ───────────────────────────────────────────────

export interface QuoteParams {
  amount: number;
  /** Source token id (from getTokens). */
  from: string;
  /** Destination token id (from getTokens). */
  to: string;
  /** Private/anonymous routing. Defaults to true for MultiShadow. */
  anonymous?: boolean;
}

export interface ExchangeParams {
  amount: number;
  from: string;
  to: string;
  /** Recipient public address (we NEVER handle their private key). */
  addressTo: string;
  /** Optional destination memo/tag (e.g. for chains that require it). */
  addressToTag?: string;
  anonymous?: boolean;
}

export interface MinMaxParams {
  from: string;
  to: string;
}

// ── Field-mapping helpers (the only place to touch on a field mismatch) ─────

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

function pick(obj: RawJson, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

export function mapToken(raw: RawJson): HoudiniToken {
  const decimals = pick(raw, ['decimals', 'decimal']);
  return {
    id: str(pick(raw, ['id', '_id', 'token', 'tokenId'])),
    symbol: str(pick(raw, ['symbol', 'ticker'])),
    name: str(pick(raw, ['name', 'title'])),
    network: str(pick(raw, ['network', 'chain', 'blockchain'])),
    ...(decimals !== undefined ? { decimals: num(decimals) } : {}),
    raw,
  };
}

export function mapQuote(raw: RawJson): HoudiniQuote {
  return {
    amountIn: num(pick(raw, ['amountIn', 'inAmount', 'amount_in', 'fromAmount'])),
    amountOut: num(pick(raw, ['amountOut', 'outAmount', 'amount_out', 'toAmount'])),
    min: num(pick(raw, ['min', 'minAmount', 'minimum'])),
    max: num(pick(raw, ['max', 'maxAmount', 'maximum'])),
    anonymous: Boolean(pick(raw, ['anonymous', 'private']) ?? true),
    raw,
  };
}

export function mapMinMax(raw: RawJson): HoudiniMinMax {
  return {
    min: num(pick(raw, ['min', 'minAmount', 'minimum'])),
    max: num(pick(raw, ['max', 'maxAmount', 'maximum'])),
    raw,
  };
}

export function mapOrder(raw: RawJson): HoudiniOrder {
  const memo = pick(raw, ['senderTag', 'depositTag', 'senderMemo', 'memo']);
  const expected = pick(raw, ['outAmount', 'expectedOut', 'amountOut', 'toAmount']);
  return {
    orderId: str(pick(raw, ['id', '_id', 'orderId', 'houdiniId'])),
    // Houdini returns the address the user must fund as the "sender" side of the
    // order (the deposit address generated for this order).
    depositAddress: str(
      pick(raw, ['senderAddress', 'depositAddress', 'payinAddress', 'inAddress']),
    ),
    depositAmount: num(pick(raw, ['inAmount', 'depositAmount', 'amountIn', 'payinAmount'])),
    ...(memo !== undefined ? { depositMemo: str(memo) } : {}),
    ...(expected !== undefined ? { expectedOut: num(expected) } : {}),
    raw,
  };
}

/**
 * Map a raw status value to a normalized phase.
 *
 * Houdini has historically used numeric status codes. The mapping below is
 * defensive (accepts numbers OR strings) and MUST be checked against the live
 * `/status` responses. Unknown values normalize to `'unknown'`, which the state
 * machine treats as "keep polling" rather than a terminal state.
 */
export function mapPhase(rawStatus: unknown): HoudiniPhase {
  if (typeof rawStatus === 'string') {
    const s = rawStatus.trim().toLowerCase();
    if (['new', 'waiting', 'wait', 'awaiting_deposit', 'created'].includes(s))
      return 'awaiting_deposit';
    if (['confirming', 'confirmation', 'exchanging', 'sending', 'processing'].includes(s))
      return 'processing';
    if (['finished', 'completed', 'complete', 'done', 'success'].includes(s)) return 'completed';
    if (['failed', 'error'].includes(s)) return 'failed';
    if (['refunded', 'refund'].includes(s)) return 'refunded';
    if (['expired', 'overdue'].includes(s)) return 'expired';
    // A numeric string?
    if (Number.isFinite(Number(s))) return mapNumericPhase(Number(s));
    return 'unknown';
  }
  if (typeof rawStatus === 'number') return mapNumericPhase(rawStatus);
  return 'unknown';
}

/**
 * Numeric status code mapping (v1.2.4 documented ordering). VERIFY against live
 * responses before mainnet use — only this function needs changing if the codes
 * differ.
 */
function mapNumericPhase(code: number): HoudiniPhase {
  switch (code) {
    case 0: // new / awaiting deposit
    case 1: // waiting for deposit
      return 'awaiting_deposit';
    case 2: // confirming
    case 3: // exchanging
    case 4: // sending to destination
      return 'processing';
    case 5: // finished
      return 'completed';
    case 6: // failed
      return 'failed';
    case 7: // refunded
      return 'refunded';
    case 8: // expired
      return 'expired';
    default:
      return 'unknown';
  }
}

/** Unwrap common envelope shapes: `{ data: ... }`, `{ result: ... }`, or bare. */
export function unwrap(json: unknown): unknown {
  if (json && typeof json === 'object') {
    const obj = json as RawJson;
    if ('data' in obj && obj.data !== undefined) return obj.data;
    if ('result' in obj && obj.result !== undefined) return obj.result;
  }
  return json;
}
