/** App state types + a tiny observable store (no framework). */
import type { V2Token } from '@multishadow/core';

export type Strategy = 'equal' | 'random-in-range' | 'weighted';

/**
 * A lightweight reference to a Houdini v2 token, cached on recipients/settings
 * so the UI can render a selection without re-querying. The `id` is the Houdini
 * token ObjectId used as `from`/`to` in the exchange endpoints.
 */
export interface TokenRef {
  id: string;
  symbol: string;
  name: string;
  /** Chain short name, e.g. "ethereum", "solana". */
  network: string;
  /** Chain kind, e.g. "sol", "evm", "bitcoin". Drives the funding path. */
  kind?: string;
  /** Numeric EVM chain id when the chain is EVM. */
  evmChainId?: number;
  logo?: string;
  decimals?: number;
  contractAddress?: string;
}

export function toTokenRef(t: V2Token): TokenRef {
  return {
    id: t.id,
    symbol: t.symbol,
    name: t.name,
    network: t.network,
    ...(t.kind ? { kind: t.kind } : {}),
    ...(t.evmChainId !== undefined ? { evmChainId: t.evmChainId } : {}),
    ...(t.logo ? { logo: t.logo } : {}),
    ...(t.decimals !== undefined ? { decimals: t.decimals } : {}),
    ...(t.contractAddress ? { contractAddress: t.contractAddress } : {}),
  };
}

export interface Recipient {
  id: string;
  address: string;
  /** Destination token (any chain). Undefined until the user picks one. */
  token?: TokenRef;
  /** Optional per-recipient min/max (decimal amount of the SOURCE token). */
  min?: number;
  max?: number;
  /** Relative weight for the "weighted" strategy. */
  weight?: number;
}

export interface Settings {
  /** The funding token every recipient is paid FROM (any chain). */
  source?: TokenRef;
  total: number;
  strategy: Strategy;
  /** 0..1 randomness for random/weighted strategies. */
  jitter: number;
  /** Speed ↔ Privacy: worker concurrency. */
  concurrency: number;
  /** Speed ↔ Privacy: max per-recipient timing jitter (ms). */
  maxJitterMs: number;
  anonymous: boolean;
}

export interface PreviewRow {
  recipientId: string;
  address: string;
  token?: TokenRef;
  amount: number;
}

/** Live view of one Houdini order in a multi-swap group. */
export interface OrderView {
  houdiniId: string;
  /** Destination (recipient) address. */
  receiver: string;
  token?: TokenRef;
  depositAddress?: string;
  depositAmount?: number;
  /** OrderPhase from Houdini, plus local pre-create states. */
  phase: string;
  fundingTx?: string;
  error?: string;
}

export interface AppState {
  connected: boolean;
  address?: string;
  /** Active wallet ecosystem of the connected account, when known. */
  walletKind?: 'solana' | 'evm';
  recipients: Recipient[];
  settings: Settings;
  preview?: PreviewRow[];
  previewError?: string;
  running: boolean;
  /** Token catalog load state (drives the token pickers). */
  tokensLoaded: boolean;
  tokensError?: string;
  /** The active multi-exchange group id, when a run is in progress. */
  multiId?: string;
  /** Live per-order views for the current/last run. */
  orders: OrderView[];
  log: string[];
}

export const defaultSettings: Settings = {
  total: 1,
  strategy: 'random-in-range',
  jitter: 0.6,
  concurrency: 6,
  maxJitterMs: 0,
  anonymous: true,
};

export function initialState(): AppState {
  return {
    connected: false,
    recipients: [newRecipient(), newRecipient()],
    settings: { ...defaultSettings },
    running: false,
    tokensLoaded: false,
    orders: [],
    log: [],
  };
}

let seq = 0;
export function newRecipient(): Recipient {
  seq += 1;
  return { id: `r${Date.now()}_${seq}`, address: '' };
}

/** Minimal observable store. */
export class Store {
  private state: AppState;
  private listeners = new Set<(s: AppState) => void>();

  constructor(initial: AppState) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l(this.state);
  }

  subscribe(fn: (s: AppState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  log(message: string): void {
    this.set((s) => ({
      log: [...s.log.slice(-99), `${new Date().toLocaleTimeString()}  ${message}`],
    }));
  }
}
