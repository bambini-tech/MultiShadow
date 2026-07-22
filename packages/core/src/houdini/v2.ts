/**
 * Houdini partner API **v2** — normalized types + pure mappers.
 *
 * Verified against the official OpenAPI (https://api-partner.houdiniswap.com/v2,
 * spec version 2.1.2). Only the shapes MultiShadow uses are modeled:
 *   - Token (search)
 *   - Order (OrderV2PublicResponse)
 *   - Multi-exchange create result + batched tx data
 *
 * The proxy forwards raw Houdini JSON; these mappers run in the browser so the
 * rest of the app consumes stable, normalized objects.
 */

export type RawJson = Record<string, unknown>;

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
function obj(v: unknown): RawJson {
  return v && typeof v === 'object' ? (v as RawJson) : {};
}

// ── Token ──────────────────────────────────────────────────────────────────

export interface V2Token {
  /** Mongo ObjectId — used as `from`/`to` in quotes/exchanges. */
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Canonical chain short name, e.g. "ethereum", "solana", "bitcoin". */
  network: string;
  /** Chain kind, e.g. "evm", "sol", "bitcoin", "xmr". */
  kind: string;
  /** Numeric EVM chain id, when the chain is EVM. */
  evmChainId?: number;
  /** Icon/logo URL. */
  logo?: string;
  /** Contract/mint address for non-native tokens. */
  contractAddress?: string;
  /** True for a chain's native coin. */
  mainnet?: boolean;
  hasCex?: boolean;
  hasDex?: boolean;
  raw: RawJson;
}

export function mapV2Token(raw: RawJson): V2Token {
  const chainData = obj(raw.chainData);
  const network = str(chainData.shortName) || str(raw.chain);
  const kind = str(chainData.kind);
  const chainId = chainData.chainId;
  const address = raw.address;
  const icon = raw.icon;
  return {
    id: str(raw.id ?? raw._id),
    symbol: str(raw.symbol),
    name: str(raw.name) || str(raw.symbol),
    decimals: num(raw.decimals, 0),
    network,
    kind,
    ...(chainId !== undefined && chainId !== null ? { evmChainId: num(chainId) } : {}),
    ...(icon !== undefined && str(icon) !== '' ? { logo: str(icon) } : {}),
    ...(address !== undefined && address !== null && str(address) !== ''
      ? { contractAddress: str(address) }
      : {}),
    ...(typeof raw.mainnet === 'boolean' ? { mainnet: raw.mainnet } : {}),
    ...(typeof raw.hasCex === 'boolean' ? { hasCex: raw.hasCex } : {}),
    ...(typeof raw.hasDex === 'boolean' ? { hasDex: raw.hasDex } : {}),
    raw,
  };
}

export interface V2TokenSearchResult {
  tokens: V2Token[];
  total: number;
  totalPages: number;
}

export function mapV2TokenSearch(raw: unknown): V2TokenSearchResult {
  const o = obj(raw);
  const list = Array.isArray(o.tokens) ? o.tokens : [];
  return {
    tokens: list.map((t) => mapV2Token(obj(t))),
    total: num(o.total, list.length),
    totalPages: num(o.totalPages, 1),
  };
}

// ── Order status ─────────────────────────────────────────────────────────────

/** Normalized lifecycle phase for a Houdini v2 order (top-level `status`). */
export type OrderPhase =
  | 'initializing'
  | 'new'
  | 'waiting'
  | 'confirming'
  | 'exchanging'
  | 'anonymizing'
  | 'completed'
  | 'expired'
  | 'failed'
  | 'refunded'
  | 'deleted'
  | 'unknown';

const ORDER_STATUS: Record<number, OrderPhase> = {
  [-2]: 'initializing',
  [-1]: 'new',
  0: 'waiting',
  1: 'confirming',
  2: 'exchanging',
  3: 'anonymizing',
  4: 'completed',
  5: 'expired',
  6: 'failed',
  7: 'refunded',
  8: 'deleted',
};

/** Map the numeric OrderStatus code (-2..8) to a normalized phase. */
export function mapOrderStatus(code: unknown): OrderPhase {
  const n = num(code, NaN);
  return ORDER_STATUS[n] ?? 'unknown';
}

const TERMINAL: ReadonlySet<OrderPhase> = new Set<OrderPhase>([
  'completed',
  'expired',
  'failed',
  'refunded',
  'deleted',
]);

export function isTerminalOrderPhase(p: OrderPhase): boolean {
  return TERMINAL.has(p);
}

// ── Order ────────────────────────────────────────────────────────────────────

export interface V2Order {
  houdiniId: string;
  /** Address the source wallet must send funds to. */
  depositAddress: string;
  /** Exact deposit amount in the source token (v2 `inAmount`). */
  depositAmount: number;
  /** Memo/tag required by some deposit chains. */
  depositTag?: string;
  receiverAddress: string;
  inSymbol: string;
  outAmount: number;
  outSymbol: string;
  status: number;
  phase: OrderPhase;
  displayStatus?: string;
  expires?: string;
  raw: RawJson;
}

export function mapV2Order(raw: RawJson): V2Order {
  const depositTag = raw.depositTag;
  const displayStatus = raw.displayStatus;
  const expires = raw.expires;
  return {
    houdiniId: str(raw.houdiniId ?? raw.id ?? raw._id),
    depositAddress: str(raw.depositAddress),
    depositAmount: num(raw.inAmount),
    ...(depositTag !== undefined && str(depositTag) !== '' ? { depositTag: str(depositTag) } : {}),
    receiverAddress: str(raw.receiverAddress),
    inSymbol: str(raw.inSymbol),
    outAmount: num(raw.outAmount),
    outSymbol: str(raw.outSymbol),
    status: num(raw.status),
    phase: mapOrderStatus(raw.status),
    ...(displayStatus !== undefined ? { displayStatus: str(displayStatus) } : {}),
    ...(expires !== undefined ? { expires: str(expires) } : {}),
    raw,
  };
}

// ── Multi-exchange create ────────────────────────────────────────────────────

export interface V2MultiCreateItem {
  order?: V2Order;
  error?: string;
}

export interface V2MultiCreateResult {
  multiId: string;
  orders: V2MultiCreateItem[];
}

export function mapMultiCreate(raw: unknown): V2MultiCreateResult {
  const o = obj(raw);
  const items = Array.isArray(o.orders) ? o.orders : [];
  return {
    multiId: str(o.multiId),
    orders: items.map((it) => {
      const item = obj(it);
      const err = item.error;
      const errMsg = err ? str(obj(err).message ?? err) : '';
      return {
        ...(item.order ? { order: mapV2Order(obj(item.order)) } : {}),
        ...(errMsg ? { error: errMsg } : {}),
      };
    }),
  };
}

// ── Multi-exchange status ────────────────────────────────────────────────────

export interface V2MultiStatusResult {
  multiId: string;
  orders: V2Order[];
  txHash?: string;
  bundleStatus?: string;
  failureReason?: string;
}

export function mapMultiStatus(raw: unknown): V2MultiStatusResult {
  const o = obj(raw);
  const items = Array.isArray(o.orders) ? o.orders : [];
  return {
    multiId: str(o.multiId),
    orders: items.map((it) => mapV2Order(obj(it))),
    ...(o.txHash ? { txHash: str(o.txHash) } : {}),
    ...(o.bundleStatus ? { bundleStatus: str(o.bundleStatus) } : {}),
    ...(o.failureReason ? { failureReason: str(o.failureReason) } : {}),
  };
}

// ── Batched deposit transactions ─────────────────────────────────────────────

export interface V2EvmBatchTx {
  userOpHash: string;
  to: string;
  data: string;
  value: string;
  chainId: number;
  tokenAmount?: string;
}

export interface V2TxBatch {
  houdiniIds: string[];
  /** Base64-serialized Solana transaction (native funding). */
  solanaBase64?: string;
  /** EVM ERC-4337 user-operation to sign + submit. */
  evm?: V2EvmBatchTx;
}

export interface V2MultiTxResult {
  multiId: string;
  /** Source chain kind, e.g. "solana" or "evm". */
  chain: string;
  transactions: V2TxBatch[];
  /** Extra native gas (wei) the smart account still needs; "0" = funded. */
  depositNeeded?: string;
  saCurrentBalance?: string;
}

export function mapMultiTx(raw: unknown): V2MultiTxResult {
  const o = obj(raw);
  const batches = Array.isArray(o.transactions) ? o.transactions : [];
  return {
    multiId: str(o.multiId),
    chain: str(o.chain),
    transactions: batches.map((b) => mapTxBatch(obj(b))),
    ...(o.depositNeeded !== undefined ? { depositNeeded: str(o.depositNeeded) } : {}),
    ...(o.saCurrentBalance !== undefined ? { saCurrentBalance: str(o.saCurrentBalance) } : {}),
  };
}

function mapTxBatch(raw: RawJson): V2TxBatch {
  const ids = Array.isArray(raw.houdiniIds) ? raw.houdiniIds.map((x) => str(x)) : [];
  const txData = obj(raw.txData);
  // EVM slim/full both carry a userOpHash; Solana carries only base64 `data`.
  if (txData.userOpHash !== undefined) {
    return {
      houdiniIds: ids,
      evm: {
        userOpHash: str(txData.userOpHash),
        to: str(txData.to),
        data: str(txData.data),
        value: str(txData.value),
        chainId: num(txData.chainId),
        ...(txData.tokenAmount !== undefined ? { tokenAmount: str(txData.tokenAmount) } : {}),
      },
    };
  }
  return { houdiniIds: ids, solanaBase64: str(txData.data) };
}

export interface V2SubmitTxResult {
  userOpHashes: string[];
}

export function mapSubmitTx(raw: unknown): V2SubmitTxResult {
  const o = obj(raw);
  const hashes = Array.isArray(o.userOpHashes) ? o.userOpHashes.map((x) => str(x)) : [];
  return { userOpHashes: hashes };
}
