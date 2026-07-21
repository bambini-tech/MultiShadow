/** App bootstrap: wire store, wallet, engine, and UI together. */
import { Store, initialState, type Settings } from './state.js';
import { mountApp, type Actions } from './ui.js';
import { createWallet } from './appkit.js';
import { computePreview, runDistribution, loadBatch } from './engine.js';
import { config } from './config.js';

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');

const store = new Store(initialState());

if (!config.reownProjectId) {
  store.log('⚠ VITE_REOWN_PROJECT_ID is not set — wallet connect will not work until configured.');
}

const wallet = createWallet();

// Keep the store in sync with wallet connection changes.
store.set({
  connected: wallet.isConnected(),
  ...(wallet.getAddress() ? { address: wallet.getAddress() } : {}),
});
wallet.onChange((address) => {
  store.set({ connected: Boolean(address), ...(address ? { address } : { address: undefined }) });
});

// A stable batch id per browser session enables resume across reloads.
const batchId = getOrCreateBatchId();

const actions: Actions = {
  connect: () => wallet.open(),
  disconnect: () => void wallet.disconnect(),
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
    void runDistribution({ store, wallet, batchId }).catch((e) => {
      store.log(`Error: ${e instanceof Error ? e.message : String(e)}`);
      store.set({ running: false });
    });
  },
};

mountApp(root, store, actions);

// Recover any interrupted run for this batch id.
void loadBatch(store, batchId);

function getOrCreateBatchId(): string {
  const KEY = 'multishadow:batchId';
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    window.localStorage.setItem(KEY, id);
  }
  return id;
}
