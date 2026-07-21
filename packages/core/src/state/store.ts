/**
 * Persistent, idempotent wallet store.
 *
 * The store is keyed by the idempotent wallet key (see machine.ts). It is the
 * source of truth that lets an interrupted batch resume WITHOUT re-funding an
 * order that was already funded.
 *
 * `WalletStore` is transport-agnostic. Two backends are provided:
 *   - `InMemoryStore`     — for tests / ephemeral runs.
 *   - `KvWalletStore`     — wraps a simple key/value backend (localStorage in the
 *                           browser, IndexedDB via an adapter, or a Node fs shim).
 */
import type { WalletRecord } from './machine.js';

export interface WalletStore {
  get(key: string): Promise<WalletRecord | undefined>;
  getAll(batchId?: string): Promise<WalletRecord[]>;
  put(record: WalletRecord): Promise<void>;
  delete(key: string): Promise<void>;
  clear(batchId?: string): Promise<void>;
}

/** In-memory store — non-persistent. */
export class InMemoryStore implements WalletStore {
  private readonly map = new Map<string, WalletRecord>();

  async get(key: string): Promise<WalletRecord | undefined> {
    return this.map.get(key);
  }

  async getAll(batchId?: string): Promise<WalletRecord[]> {
    const all = [...this.map.values()];
    return batchId ? all.filter((r) => r.batchId === batchId) : all;
  }

  async put(record: WalletRecord): Promise<void> {
    this.map.set(record.key, record);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async clear(batchId?: string): Promise<void> {
    if (!batchId) {
      this.map.clear();
      return;
    }
    for (const [k, v] of this.map) if (v.batchId === batchId) this.map.delete(k);
  }
}

/** Minimal synchronous or async key/value backend (localStorage-compatible). */
export interface KeyValueBackend {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
  /** Enumerate keys. localStorage exposes length + key(i); adapters can too. */
  keys(): string[] | Promise<string[]>;
}

/**
 * KV-backed store. Records are namespaced under a prefix so the store can share
 * a backend (e.g. window.localStorage) with other data.
 */
export class KvWalletStore implements WalletStore {
  private readonly backend: KeyValueBackend;
  private readonly prefix: string;

  constructor(backend: KeyValueBackend, prefix = 'multishadow:wallet:') {
    this.backend = backend;
    this.prefix = prefix;
  }

  private k(key: string): string {
    return this.prefix + key;
  }

  async get(key: string): Promise<WalletRecord | undefined> {
    const raw = await this.backend.getItem(this.k(key));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as WalletRecord;
    } catch {
      return undefined;
    }
  }

  async getAll(batchId?: string): Promise<WalletRecord[]> {
    const keys = await this.backend.keys();
    const mine = keys.filter((k) => k.startsWith(this.prefix));
    const out: WalletRecord[] = [];
    for (const fullKey of mine) {
      const raw = await this.backend.getItem(fullKey);
      if (!raw) continue;
      try {
        const rec = JSON.parse(raw) as WalletRecord;
        if (!batchId || rec.batchId === batchId) out.push(rec);
      } catch {
        /* skip corrupt entry */
      }
    }
    return out;
  }

  async put(record: WalletRecord): Promise<void> {
    await this.backend.setItem(this.k(record.key), JSON.stringify(record));
  }

  async delete(key: string): Promise<void> {
    await this.backend.removeItem(this.k(key));
  }

  async clear(batchId?: string): Promise<void> {
    const records = await this.getAll(batchId);
    for (const r of records) await this.delete(r.key);
  }
}

/**
 * Idempotent get-or-create. Returns the existing record if present (so a resume
 * picks up exactly where it left off), otherwise stores and returns `fresh`.
 */
export async function getOrCreate(
  store: WalletStore,
  key: string,
  fresh: () => WalletRecord,
): Promise<WalletRecord> {
  const existing = await store.get(key);
  if (existing) return existing;
  const record = fresh();
  await store.put(record);
  return record;
}
