import { describe, it, expect } from 'vitest';
import {
  transition,
  canTransition,
  isTerminal,
  makeWalletKey,
  newWalletRecord,
  InvalidTransitionError,
} from '../src/state/machine.js';
import { InMemoryStore, KvWalletStore, getOrCreate } from '../src/state/store.js';
import type { KeyValueBackend } from '../src/state/store.js';

let clock = 1000;
const now = () => clock++;

function freshRecord() {
  return newWalletRecord(
    { batchId: 'b1', receiver: 'RCPT', from: 'sol', to: 'sol', amount: 1, index: 0 },
    now,
  );
}

describe('state machine transitions', () => {
  it('allows the happy path pending → order_created → funded → completed', () => {
    let r = freshRecord();
    expect(r.phase).toBe('pending');
    r = transition(
      r,
      'order_created',
      { orderId: 'o1', depositAddress: 'DEP', depositAmount: 1 },
      now,
    );
    r = transition(r, 'funded', { fundingTxSignature: 'sig' }, now);
    r = transition(r, 'completed', {}, now);
    expect(r.phase).toBe('completed');
    expect(r.orderId).toBe('o1');
    expect(isTerminal(r)).toBe(true);
  });

  it('rejects illegal jumps (pending → funded)', () => {
    const r = freshRecord();
    expect(() => transition(r, 'funded', {}, now)).toThrow(InvalidTransitionError);
  });

  it('allows failing from any non-terminal phase', () => {
    let r = freshRecord();
    r = transition(r, 'order_created', {}, now);
    r = transition(r, 'failed', { error: 'boom' }, now);
    expect(r.phase).toBe('failed');
    expect(canTransition('completed', 'failed')).toBe(false);
  });

  it('treats same-phase transition as an idempotent no-op', () => {
    const r = freshRecord();
    expect(() => transition(r, 'pending', {}, now)).not.toThrow();
  });

  it('produces deterministic idempotent keys', () => {
    const a = makeWalletKey({ batchId: 'b', receiver: 'R', from: 'sol', to: 'sol', index: 3 });
    const b = makeWalletKey({ batchId: 'b', receiver: 'R', from: 'sol', to: 'sol', index: 3 });
    expect(a).toBe(b);
  });
});

describe('InMemoryStore + getOrCreate (idempotency)', () => {
  it('getOrCreate returns the existing record on the second call (no double-create)', async () => {
    const store = new InMemoryStore();
    let created = 0;
    const make = () => {
      created++;
      return freshRecord();
    };
    const key = freshRecord().key;
    const first = await getOrCreate(store, key, make);
    const second = await getOrCreate(store, key, make);
    expect(created).toBe(1);
    expect(second.key).toBe(first.key);
  });

  it('filters getAll by batchId', async () => {
    const store = new InMemoryStore();
    await store.put({ ...freshRecord(), key: 'a', batchId: 'x' });
    await store.put({ ...freshRecord(), key: 'b', batchId: 'y' });
    expect(await store.getAll('x')).toHaveLength(1);
    expect(await store.getAll()).toHaveLength(2);
  });

  it('resume: a funded record is not re-created, preventing double-funding', async () => {
    const store = new InMemoryStore();
    const rec = transition(
      transition(freshRecord(), 'order_created', { orderId: 'o' }, now),
      'funded',
      { fundingTxSignature: 'sig' },
      now,
    );
    await store.put(rec);
    // Simulate a restart: getOrCreate must return the funded record untouched.
    const resumed = await getOrCreate(store, rec.key, freshRecord);
    expect(resumed.phase).toBe('funded');
    expect(resumed.fundingTxSignature).toBe('sig');
  });
});

describe('KvWalletStore', () => {
  it('persists and reloads records through a localStorage-like backend', async () => {
    const map = new Map<string, string>();
    const backend: KeyValueBackend = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
      keys: () => [...map.keys()],
    };
    const store = new KvWalletStore(backend);
    const rec = freshRecord();
    await store.put(rec);

    const reloaded = new KvWalletStore(backend);
    const got = await reloaded.get(rec.key);
    expect(got?.receiver).toBe('RCPT');
    expect(await reloaded.getAll('b1')).toHaveLength(1);

    await reloaded.delete(rec.key);
    expect(await reloaded.get(rec.key)).toBeUndefined();
  });
});
