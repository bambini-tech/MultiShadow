/** App state types + a tiny observable store (no framework). */
import type { HoudiniToken, WalletRecord } from '@multishadow/core';

export type Strategy = 'equal' | 'random-in-range' | 'weighted';

/**
 * A lightweight reference to a Houdini token, cached on recipients/settings so
 * the UI can render a selection without holding the whole catalog. The `id` is
 * the Houdini token id used as `from`/`to` in quote/exchange.
 */
export interface TokenRef {
  id: string;
  symbol: string;
  name: string;
  network: string;
  logo?: string;
  decimals?: number;
  contractAddress?: string;
}

export function toTokenRef(t: HoudiniToken): TokenRef {
  return {
    id: t.id,
    symbol: t.symbol,
    name: t.name,
    network: t.network,
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
  /** Live per-wallet records keyed by wallet key. */
  wallets: Record<string, WalletRecord>;
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
    wallets: {},
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
