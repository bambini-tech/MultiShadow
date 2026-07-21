/** App bootstrap: wire store, wallet, engine, and UI together. */
import { Store, initialState, type Settings } from './state.js';
import { mountApp, type Actions } from './ui.js';
import { createWallet } from './appkit.js';
import { computePreview, runDistribution, loadBatch } from './engine.js';
import { config } from './config.js';
import type { SolanaWallet } from './wallet.js';

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');

const store = new Store(initialState());

// A stable batch id per browser session enables resume across reloads.
const batchId = getOrCreateBatchId();

// The wallet is initialised lazily and defensively: Reown/AppKit init must NEVER
// prevent the UI from rendering (that was a cause of the blank page — offline,
// or with a missing project id, an init throw blanked the whole app).
let wallet: SolanaWallet | undefined;

const actions: Actions = {
  connect: () => {
    if (!wallet) {
      store.log('Wallet unavailable — check VITE_REOWN_PROJECT_ID and your connection.');
      return;
    }
    wallet.open();
  },
  disconnect: () => void wallet?.disconnect(),
  updateSettings: (patch: Partial<Settings>) =>
    store.set((s) => ({ settings: { ...s.settings, ...patch } })),
  preview: () => {
    try {
      const { recipients, settings } = store.get();
      const preview = computePreview(recipients, settings);
      store.set({ preview, previewError: undefined });
    } catch (e) {
      store.set({ preview: undefined, previewError: e instanceof Error ? e.message : String(e) });
    }
  },
  run: () => {
    if (!wallet) {
      store.log('Connect a wallet first (wallet not initialised).');
      return;
    }
    void runDistribution({ store, wallet, batchId }).catch((e) => {
      store.log(`Error: ${e instanceof Error ? e.message : String(e)}`);
      store.set({ running: false });
    });
  },
};

// 1) Render the UI immediately — before any wallet/network work.
mountApp(root, store, actions);

// 2) Initialise the wallet in a guard so failures degrade gracefully.
initWallet();

// 3) Recover any interrupted run for this batch id.
void loadBatch(store, batchId);

function initWallet(): void {
  if (!config.reownProjectId) {
    store.log('⚠ VITE_REOWN_PROJECT_ID is not set — wallet connect is disabled until configured.');
    return;
  }
  try {
    wallet = createWallet();
    store.set({
      connected: wallet.isConnected(),
      ...(wallet.getAddress() ? { address: wallet.getAddress() } : {}),
    });
    wallet.onChange((address) => {
      store.set({
        connected: Boolean(address),
        ...(address ? { address } : { address: undefined }),
      });
    });
  } catch (e) {
    store.log(`Wallet init failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function getOrCreateBatchId(): string {
  const KEY = 'multishadow:batchId';
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    window.localStorage.setItem(KEY, id);
  }
  return id;
}
