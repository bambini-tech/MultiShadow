/**
 * Vanilla-TS UI. The static shell is built once; dynamic regions (recipients,
 * preview, status, log) are re-rendered on state changes. Text inputs update
 * state without re-rendering their own container so focus is preserved.
 */
import { isValidAddressForChain } from '@multishadow/core';
import type { AppState, Recipient, Settings, Store, Strategy } from './state.js';
import { newRecipient, toTokenRef } from './state.js';
import { findDefaultSource, isLoaded as catalogLoaded } from './catalog.js';
import { openTokenPicker, renderTokenButton, tokenButton } from './tokenPicker.js';

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

/** The recipient field guide — the info kept from before, now behind one menu. */
const FIELD_GUIDE: Array<{ label: string; text: string }> = [
  {
    label: 'Token',
    text: 'The token and chain this wallet should receive. Pick any of the tokens Houdini supports — the source is swapped into this automatically.',
  },
  {
    label: 'Address',
    text: 'The destination wallet’s PUBLIC address on the chosen token’s chain — one of your own wallets. Never a private key. Turns green when it looks valid.',
  },
  {
    label: 'Min',
    text: 'Optional. Smallest amount (in the source token) this wallet may receive.',
  },
  { label: 'Max', text: 'Optional. Largest amount (in the source token) this wallet may receive.' },
  {
    label: 'Weight',
    text: 'Optional. Relative share for the “weighted” strategy — higher = a bigger portion of the total. Defaults to 1 (equal).',
  },
];

export function mountApp(root: HTMLElement, store: Store, actions: Actions): void {
  root.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="logo">◲</span>
        <div>
          <h1>MultiShadow</h1>
          <p class="tagline">Private multi-wallet distributor</p>
        </div>
      </div>
      <div id="connect" class="connect"></div>
    </header>

    <div class="banner" role="note">
      <strong>Honest privacy scope.</strong> ${PRIVACY_NOTE}
    </div>

    <main class="grid">
      <section class="card">
        <div class="card-head">
          <h2>1 · Recipients</h2>
          <button class="btn ghost small" id="guideToggle" aria-expanded="false">ⓘ Field guide</button>
        </div>
        <p class="hint">Your own wallet addresses. Only public addresses — never private keys.</p>
        <div id="guide" class="legend" hidden></div>
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
    const def = catalogLoaded() ? findDefaultSource() : undefined;
    const r = newRecipient();
    if (def) r.token = toTokenRef(def);
    store.set((s) => ({ recipients: [...s.recipients, r] }));
  });
  root.querySelector<HTMLButtonElement>('#previewBtn')!.addEventListener('click', actions.preview);
  root.querySelector<HTMLButtonElement>('#runBtn')!.addEventListener('click', actions.run);

  // Field guide (the info menu): hidden by default, keeps rows uncluttered.
  const guide = root.querySelector<HTMLElement>('#guide')!;
  const guideToggle = root.querySelector<HTMLButtonElement>('#guideToggle')!;
  guide.innerHTML = FIELD_GUIDE.map(
    (g) =>
      `<div class="legend-item"><span class="legend-label">${g.label}</span><span>${g.text}</span></div>`,
  ).join('');
  guideToggle.addEventListener('click', () => {
    const open = guide.hidden;
    guide.hidden = !open;
    guideToggle.setAttribute('aria-expanded', String(open));
    guideToggle.classList.toggle('active', open);
  });

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
  let prevTokensLoaded = store.get().tokensLoaded;
  store.subscribe((s) => {
    renderConnect(regions.connect, s, actions);
    // Re-render recipient rows when the set changes (add/remove) OR when the
    // catalog finishes loading (so default tokens appear) — both are structural,
    // not per-keystroke, so focus is preserved during typing.
    if (s.recipients.length !== prevRecipientCount || s.tokensLoaded !== prevTokensLoaded) {
      renderRecipients(regions.recipients, store);
      prevRecipientCount = s.recipients.length;
    }
    if (s.tokensLoaded !== prevTokensLoaded) {
      renderSettings(regions.settings, s, actions);
      prevTokensLoaded = s.tokensLoaded;
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
    const kind = s.walletKind ? ` · ${s.walletKind.toUpperCase()}` : '';
    el.innerHTML = `<span class="addr" title="${s.address}">${short(s.address)}${kind}</span>`;
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

  // Destination token picker (any chain / any token).
  const tokenBtn = tokenButton(r.token, 'Token', () => {
    openTokenPicker({
      title: 'Receive as…',
      current: r.token?.id,
      onSelect: (t) => {
        const ref = toTokenRef(t);
        patchRecipient(store, r.id, { token: ref });
        renderTokenButton(tokenBtn, ref, 'Token');
        validateAddr(addr, addr.value, ref.network);
      },
    });
  });

  const addr = input('text', r.address, 'Destination address');
  addr.classList.add('grow');
  addr.addEventListener('input', () => {
    patchRecipient(store, r.id, { address: addr.value });
    validateAddr(addr, addr.value, r.token?.network);
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

  row.append(tokenBtn, addr, min, max, weight, del);
  validateAddr(addr, r.address, r.token?.network);
  return row;
}

function validateAddr(el: HTMLInputElement, value: string, network: string | undefined): void {
  if (value.trim() === '' || !network) {
    el.classList.remove('invalid', 'valid');
    return;
  }
  const ok = isValidAddressForChain(value, network);
  el.classList.toggle('invalid', !ok);
  el.classList.toggle('valid', ok);
}

function renderSettings(el: HTMLElement, s: AppState, actions: Actions): void {
  el.innerHTML = '';
  const st = s.settings;
  const sym = st.source?.symbol ?? 'source';

  // Source token — the asset every recipient is funded FROM (any chain).
  const srcBtn = tokenButton(st.source, s.tokensLoaded ? 'Select source' : 'Loading…', () => {
    openTokenPicker({
      title: 'Send from…',
      current: st.source?.id,
      onSelect: (t) => {
        const ref = toTokenRef(t);
        actions.updateSettings({ source: ref });
        renderTokenButton(srcBtn, ref, 'Select source');
        // Relabel the total field to the new source symbol.
        const totalSpan = el.querySelector<HTMLElement>('#totalLabel');
        if (totalSpan) totalSpan.firstChild!.textContent = `Total to distribute (${ref.symbol}) `;
      },
    });
  });
  el.appendChild(
    field(
      'Source — you send',
      srcBtn,
      'The token every recipient is funded from. It can be on any chain Houdini ' +
        'supports; connect a matching wallet (Solana or EVM) to sign the funding.',
    ),
  );

  const totalField = field(
    `Total to distribute (${sym})`,
    bind(numInput(st.total, '1.0'), (v) => actions.updateSettings({ total: Number(v) || 0 })),
    'The total amount of the source token to split across all recipient wallets ' +
      'below. The per-wallet amounts always add up to exactly this number.',
  );
  totalField.querySelector('span')!.id = 'totalLabel';
  el.appendChild(totalField);

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
  el.appendChild(
    field(
      'Amount strategy',
      strat,
      'How the total is divided. equal = every wallet gets the same amount. ' +
        'random-in-range = randomized amounts (optionally within each wallet’s ' +
        'Min/Max). weighted = split by each wallet’s Weight.',
    ),
  );

  el.appendChild(
    field(
      `Jitter (randomness): ${st.jitter.toFixed(2)}`,
      bind(slider(0, 1, 0.05, st.jitter), (v) => actions.updateSettings({ jitter: Number(v) })),
      'How uneven the random split is. 0 = as even as possible; 1 = fully random ' +
        'within the allowed range. Only affects the random and weighted strategies.',
    ),
  );

  el.appendChild(
    field(
      `Speed ↔ Privacy · concurrency: ${st.concurrency}`,
      bind(slider(1, 12, 1, st.concurrency), (v) =>
        actions.updateSettings({ concurrency: Number(v) }),
      ),
      'How many swaps run at the same time. Higher = faster. Lower = fewer ' +
        'simultaneous swaps, which makes it less obvious the wallets are related.',
    ),
  );

  el.appendChild(
    field(
      `Timing jitter per recipient: ${st.maxJitterMs} ms`,
      bind(slider(0, 20000, 500, st.maxJitterMs), (v) =>
        actions.updateSettings({ maxJitterMs: Number(v) }),
      ),
      'A random delay added before each recipient’s swap. Larger values reduce ' +
        'timing correlation between recipients (more privacy) but slow the run down.',
    ),
  );

  const anon = document.createElement('input');
  anon.type = 'checkbox';
  anon.checked = st.anonymous;
  anon.addEventListener('change', () => actions.updateSettings({ anonymous: anon.checked }));
  const anonLabel = document.createElement('label');
  anonLabel.className = 'checkbox';
  anonLabel.append(anon, document.createTextNode(' Private (anonymous) routing'));
  anonLabel.appendChild(
    infoIcon(
      'Routes each swap privately through Houdini so the public on-chain link ' +
        'between your source and destination wallets is broken. Keep this on. ' +
        'Note: this is privacy from the public — partner exchanges still run KYC/AML.',
    ),
  );
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
  const sym = s.settings.source?.symbol ?? '';
  const total = s.preview.reduce((a, r) => a + r.amount, 0);
  const rows = s.preview
    .map(
      (r) => `<tr><td class="mono">${short(r.address)}</td>
        <td>${r.token ? `${escapeHtml(r.token.symbol)} · ${escapeHtml(r.token.network)}` : '—'}</td>
        <td class="num">${r.amount.toFixed(6)}</td></tr>`,
    )
    .join('');
  el.innerHTML = `
    <table class="tbl">
      <thead><tr><th>Recipient</th><th>Receives</th><th class="num">Amount (${escapeHtml(sym)})</th></tr></thead>
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

function field(label: string, control: HTMLElement, tip?: string): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  if (tip) span.appendChild(infoIcon(tip));
  wrap.append(span, control);
  return wrap;
}

/**
 * A small "i" badge that shows an explanatory tooltip on hover/focus. Keyboard
 * accessible (tabbable + aria-label). `align` shifts the bubble so it doesn't
 * run off-screen for right-hand columns.
 */
function infoIcon(tip: string, align: 'center' | 'left' | 'right' = 'center'): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = align === 'center' ? 'info' : `info info-${align}`;
  el.textContent = 'i';
  el.tabIndex = 0;
  el.setAttribute('role', 'note');
  el.setAttribute('aria-label', tip);
  el.dataset.tip = tip;
  return el;
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
