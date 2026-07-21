/** App state types + a tiny observable store (no framework). */
import type { WalletRecord } from '@multishadow/core';

export type Strategy = 'equal' | 'random-in-range' | 'weighted';

export interface Recipient {
  id: string;
  address: string;
  /** Destination chain family, e.g. "SOL", "ETH". */
  chain: string;
  /** Optional per-recipient min/max (decimal SOL of source). */
  min?: number;
  max?: number;
  /** Relative weight for the "weighted" strategy. */
  weight?: number;
}

export interface Settings {
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
  chain: string;
  amount: number;
}

export interface AppState {
  connected: boolean;
  address?: string;
  recipients: Recipient[];
  settings: Settings;
  preview?: PreviewRow[];
  previewError?: string;
  running: boolean;
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
    wallets: {},
    log: [],
  };
}

let seq = 0;
export function newRecipient(): Recipient {
  seq += 1;
  return { id: `r${Date.now()}_${seq}`, address: '', chain: 'SOL' };
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
