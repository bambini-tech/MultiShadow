/**
 * Vanilla-TS UI. The static shell is built once; dynamic regions (recipients,
 * preview, status, log) are re-rendered on state changes. Text inputs update
 * state without re-rendering their own container so focus is preserved.
 */
import { isValidAddressForChain } from '@multishadow/core';
import { SUPPORTED_CHAINS } from './tokens.js';
import type { AppState, Recipient, Settings, Store, Strategy } from './state.js';
import { newRecipient } from './state.js';

export interface Actions {
  connect(): void;
  disconnect(): void;
  preview(): void;
  run(): void;
  updateSettings(patch: Partial<Settings>): void;
}

const PRIVACY_NOTE =
  'Privacy here is from the public, not from authorities. Houdini routes through ' +
  'partner exchanges that run KYC/AML per swap — this breaks the public on-chain ' +
  'link, it does not make transfers untraceable to a compelled investigation.';

export function mountApp(root: HTMLElement, store: Store, actions: Actions): void {
  root.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="logo">◲</span>
        <div>
          <h1>MultiShadow</h1>
          <p class="tagline">Private multi-wallet SOL distributor</p>
        </div>
      </div>
      <div id="connect" class="connect"></div>
    </header>

    <div class="banner" role="note">
      <strong>Honest privacy scope.</strong> ${PRIVACY_NOTE}
    </div>

    <main class="grid">
      <section class="card">
        <h2>1 · Recipients</h2>
        <p class="hint">Your own wallet addresses. Only public addresses — never private keys.</p>
        <div id="recipients"></div>
        <button class="btn ghost" id="addRecipient">+ Add recipient</button>
      </section>

      <section class="card">
        <h2>2 · Strategy</h2>
        <div id="settings"></div>
      </section>

      <section class="card wide">
        <h2>3 · Preview</h2>
        <div class="row-actions">
          <button class="btn" id="previewBtn">Recompute preview</button>
          <button class="btn primary" id="runBtn">Distribute</button>
        </div>
        <div id="preview"></div>
      </section>

      <section class="card wide">
        <h2>4 · Live status</h2>
        <div id="status"></div>
      </section>

      <section class="card wide">
        <h2>Log</h2>
        <pre id="log" class="log"></pre>
      </section>
    </main>
    <footer class="foot">Security &amp; privacy tool for your own funds. Not for evading compliance or market manipulation.</footer>
  `;

  root.querySelector<HTMLButtonElement>('#addRecipient')!.addEventListener('click', () => {
    store.set((s) => ({ recipients: [...s.recipients, newRecipient()] }));
  });
  root.querySelector<HTMLButtonElement>('#previewBtn')!.addEventListener('click', actions.preview);
  root.querySelector<HTMLButtonElement>('#runBtn')!.addEventListener('click', actions.run);

  const regions = {
    connect: root.querySelector<HTMLElement>('#connect')!,
    recipients: root.querySelector<HTMLElement>('#recipients')!,
    settings: root.querySelector<HTMLElement>('#settings')!,
    preview: root.querySelector<HTMLElement>('#preview')!,
    status: root.querySelector<HTMLElement>('#status')!,
    log: root.querySelector<HTMLElement>('#log')!,
  };

  // Initial render + subscribe.
  renderConnect(regions.connect, store.get(), actions);
  renderRecipients(regions.recipients, store);
  renderSettings(regions.settings, store.get(), actions);
  renderPreview(regions.preview, store.get());
  renderStatus(regions.status, store.get());
  renderLog(regions.log, store.get());

  let prevRecipientCount = store.get().recipients.length;
  store.subscribe((s) => {
    renderConnect(regions.connect, s, actions);
    // Only re-render recipient rows when the set changes (add/remove) to keep
    // focus while typing.
    if (s.recipients.length !== prevRecipientCount) {
      renderRecipients(regions.recipients, store);
      prevRecipientCount = s.recipients.length;
    }
    renderPreview(regions.preview, s);
    renderStatus(regions.status, s);
    renderLog(regions.log, s);
    renderRunButton(root, s);
  });
}

function renderRunButton(root: HTMLElement, s: AppState): void {
  const btn = root.querySelector<HTMLButtonElement>('#runBtn');
  if (btn) {
    btn.disabled = s.running || !s.connected;
    btn.textContent = s.running ? 'Distributing…' : 'Distribute';
  }
}

function renderConnect(el: HTMLElement, s: AppState, actions: Actions): void {
  if (s.connected && s.address) {
    el.innerHTML = `<span class="addr" title="${s.address}">${short(s.address)}</span>`;
    const btn = document.createElement('button');
    btn.className = 'btn ghost';
    btn.textContent = 'Disconnect';
    btn.addEventListener('click', actions.disconnect);
    el.appendChild(btn);
  } else {
    el.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.textContent = 'Connect wallet';
    btn.addEventListener('click', actions.connect);
    el.appendChild(btn);
  }
}

function renderRecipients(el: HTMLElement, store: Store): void {
  const { recipients } = store.get();
  el.innerHTML = '';
  recipients.forEach((r) => el.appendChild(recipientRow(r, store)));
}

function recipientRow(r: Recipient, store: Store): HTMLElement {
  const row = document.createElement('div');
  row.className = 'recipient';

  const addr = input('text', r.address, 'Destination address');
  addr.classList.add('grow');
  addr.addEventListener('input', () => {
    patchRecipient(store, r.id, { address: addr.value });
    validateAddr(addr, addr.value, chain.value);
  });

  const chain = document.createElement('select');
  chain.className = 'select';
  for (const c of SUPPORTED_CHAINS) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    if (c === r.chain) opt.selected = true;
    chain.appendChild(opt);
  }
  chain.addEventListener('change', () => {
    patchRecipient(store, r.id, { chain: chain.value });
    validateAddr(addr, addr.value, chain.value);
  });

  const min = numInput(r.min, 'min');
  min.addEventListener('input', () =>
    patchRecipient(store, r.id, { min: min.value ? Number(min.value) : undefined }),
  );
  const max = numInput(r.max, 'max');
  max.addEventListener('input', () =>
    patchRecipient(store, r.id, { max: max.value ? Number(max.value) : undefined }),
  );
  const weight = numInput(r.weight, 'weight');
  weight.addEventListener('input', () =>
    patchRecipient(store, r.id, { weight: weight.value ? Number(weight.value) : undefined }),
  );

  const del = document.createElement('button');
  del.className = 'btn icon';
  del.textContent = '✕';
  del.title = 'Remove';
  del.addEventListener('click', () =>
    store.set((s) => ({ recipients: s.recipients.filter((x) => x.id !== r.id) })),
  );

  row.append(addr, chain, min, max, weight, del);
  validateAddr(addr, r.address, r.chain);
  return row;
}

function validateAddr(el: HTMLInputElement, value: string, chain: string): void {
  if (value.trim() === '') {
    el.classList.remove('invalid', 'valid');
    return;
  }
  const ok = isValidAddressForChain(value, chain);
  el.classList.toggle('invalid', !ok);
  el.classList.toggle('valid', ok);
}

function renderSettings(el: HTMLElement, s: AppState, actions: Actions): void {
  el.innerHTML = '';
  const st = s.settings;

  el.appendChild(
    field(
      'Total to distribute (SOL)',
      bind(numInput(st.total, '1.0'), (v) => actions.updateSettings({ total: Number(v) || 0 })),
    ),
  );

  const strat = document.createElement('select');
  strat.className = 'select';
  (['equal', 'random-in-range', 'weighted'] as Strategy[]).forEach((v) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    if (v === st.strategy) o.selected = true;
    strat.appendChild(o);
  });
  strat.addEventListener('change', () =>
    actions.updateSettings({ strategy: strat.value as Strategy }),
  );
  el.appendChild(field('Amount strategy', strat));

  el.appendChild(
    field(
      `Jitter (randomness): ${st.jitter.toFixed(2)}`,
      bind(slider(0, 1, 0.05, st.jitter), (v) => actions.updateSettings({ jitter: Number(v) })),
    ),
  );

  el.appendChild(
    field(
      `Speed ↔ Privacy · concurrency: ${st.concurrency}`,
      bind(slider(1, 12, 1, st.concurrency), (v) =>
        actions.updateSettings({ concurrency: Number(v) }),
      ),
    ),
  );

  el.appendChild(
    field(
      `Timing jitter per recipient: ${st.maxJitterMs} ms`,
      bind(slider(0, 20000, 500, st.maxJitterMs), (v) =>
        actions.updateSettings({ maxJitterMs: Number(v) }),
      ),
    ),
  );

  const anon = document.createElement('input');
  anon.type = 'checkbox';
  anon.checked = st.anonymous;
  anon.addEventListener('change', () => actions.updateSettings({ anonymous: anon.checked }));
  const anonLabel = document.createElement('label');
  anonLabel.className = 'checkbox';
  anonLabel.append(anon, document.createTextNode(' Private (anonymous) routing'));
  el.appendChild(anonLabel);
}

function renderPreview(el: HTMLElement, s: AppState): void {
  if (s.previewError) {
    el.innerHTML = `<p class="error">${escapeHtml(s.previewError)}</p>`;
    return;
  }
  if (!s.preview || s.preview.length === 0) {
    el.innerHTML = `<p class="hint">No preview yet — add recipients and recompute.</p>`;
    return;
  }
  const total = s.preview.reduce((a, r) => a + r.amount, 0);
  const rows = s.preview
    .map(
      (r) => `<tr><td class="mono">${short(r.address)}</td><td>${r.chain}</td>
        <td class="num">${r.amount.toFixed(6)}</td></tr>`,
    )
    .join('');
  el.innerHTML = `
    <table class="tbl">
      <thead><tr><th>Recipient</th><th>Chain</th><th class="num">Amount (SOL)</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="2">Total</td><td class="num">${total.toFixed(6)}</td></tr></tfoot>
    </table>`;
}

function renderStatus(el: HTMLElement, s: AppState): void {
  const records = Object.values(s.wallets);
  if (records.length === 0) {
    el.innerHTML = `<p class="hint">No active distribution.</p>`;
    return;
  }
  const rows = records
    .map(
      (r) => `<tr>
        <td class="mono">${short(r.receiver)}</td>
        <td><span class="pill ${r.phase}">${r.phase.replace('_', ' ')}</span></td>
        <td class="num">${r.depositAmount ? r.depositAmount.toFixed(6) : r.amount.toFixed(6)}</td>
        <td class="mono">${r.fundingTxSignature ? short(r.fundingTxSignature) : '—'}</td>
        <td class="err">${r.error ? escapeHtml(r.error) : ''}</td>
      </tr>`,
    )
    .join('');
  el.innerHTML = `
    <table class="tbl">
      <thead><tr><th>Recipient</th><th>State</th><th class="num">Amount</th><th>Funding tx</th><th>Error</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderLog(el: HTMLElement, s: AppState): void {
  el.textContent = s.log.join('\n');
  el.scrollTop = el.scrollHeight;
}

// ── small DOM helpers ──────────────────────────────────────────────────────

function input(type: string, value: string, placeholder: string): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  el.className = 'input';
  el.value = value;
  el.placeholder = placeholder;
  return el;
}

function numInput(value: number | undefined, placeholder: string): HTMLInputElement {
  const el = input('number', value !== undefined ? String(value) : '', placeholder);
  el.step = 'any';
  el.min = '0';
  el.classList.add('num-input');
  return el;
}

function slider(min: number, max: number, step: number, value: number): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'range';
  el.min = String(min);
  el.max = String(max);
  el.step = String(step);
  el.value = String(value);
  el.className = 'slider';
  return el;
}

function bind(el: HTMLInputElement, cb: (v: string) => void): HTMLInputElement {
  el.addEventListener('input', () => cb(el.value));
  return el;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(span, control);
  return wrap;
}

function patchRecipient(store: Store, id: string, patch: Partial<Recipient>): void {
  store.set((s) => ({
    recipients: s.recipients.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }));
}

function short(v: string): string {
  return v.length <= 12 ? v : `${v.slice(0, 5)}…${v.slice(-4)}`;
}

function escapeHtml(v: string): string {
  return v.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
