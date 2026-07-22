/**
 * Searchable token+chain picker — the HoudiniSwap-style selector reused by the
 * source field and every recipient row. Searches the Houdini v2 catalog
 * server-side as the user types, so any token on any chain is reachable.
 */
import type { V2Token } from '@multishadow/core';
import type { TokenRef } from './state.js';
import { searchTokens } from './catalog.js';

export interface PickerOptions {
  onSelect: (token: V2Token) => void;
  /** Currently selected token id, highlighted in the list. */
  current?: string;
  title?: string;
}

/** A small round avatar for a token: its logo, or a lettered fallback. */
export function tokenAvatar(ref: { symbol: string; logo?: string }): HTMLElement {
  const el = document.createElement('span');
  el.className = 'tk-avatar';
  if (ref.logo) {
    const img = document.createElement('img');
    img.src = ref.logo;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      el.classList.add('tk-avatar-fallback');
      el.textContent = ref.symbol.slice(0, 1).toUpperCase();
    });
    el.appendChild(img);
  } else {
    el.classList.add('tk-avatar-fallback');
    el.textContent = ref.symbol.slice(0, 1).toUpperCase();
  }
  return el;
}

/** The trigger button that opens the picker; shows the current selection. */
export function tokenButton(
  ref: TokenRef | undefined,
  placeholder: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tk-button';
  renderTokenButton(btn, ref, placeholder);
  btn.addEventListener('click', onClick);
  return btn;
}

export function renderTokenButton(
  btn: HTMLButtonElement,
  ref: TokenRef | undefined,
  placeholder: string,
): void {
  btn.innerHTML = '';
  if (ref) {
    btn.appendChild(tokenAvatar(ref));
    const label = document.createElement('span');
    label.className = 'tk-button-label';
    label.innerHTML = `<span class="tk-sym">${escapeHtml(ref.symbol)}</span><span class="tk-net">${escapeHtml(ref.network)}</span>`;
    btn.appendChild(label);
  } else {
    const label = document.createElement('span');
    label.className = 'tk-button-label tk-placeholder';
    label.textContent = placeholder;
    btn.appendChild(label);
  }
  const caret = document.createElement('span');
  caret.className = 'tk-caret';
  caret.textContent = '▾';
  btn.appendChild(caret);
}

/** Map a chain `kind` to a colour class for the network tag. */
function netClass(kind: string | undefined): string {
  if (kind === 'sol') return 'tk-net-solana';
  if (kind === 'evm') return 'tk-net-evm';
  return 'tk-net-other';
}

/** Open the modal picker. Returns a close function. */
export function openTokenPicker(opts: PickerOptions): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'tk-overlay';
  overlay.innerHTML = `
    <div class="tk-modal" role="dialog" aria-modal="true" aria-label="Select a token">
      <div class="tk-modal-head">
        <h3>${escapeHtml(opts.title ?? 'Select token')}</h3>
        <button class="tk-close" aria-label="Close">✕</button>
      </div>
      <input class="tk-search input" type="text" placeholder="Search name, symbol or chain…" autocomplete="off" spellcheck="false" />
      <div class="tk-list" role="listbox"></div>
      <p class="tk-empty hint" hidden></p>
    </div>`;

  const search = overlay.querySelector<HTMLInputElement>('.tk-search')!;
  const list = overlay.querySelector<HTMLElement>('.tk-list')!;
  const empty = overlay.querySelector<HTMLElement>('.tk-empty')!;

  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };

  const setStatus = (msg: string): void => {
    list.innerHTML = '';
    empty.hidden = false;
    empty.textContent = msg;
  };

  let seq = 0;
  const run = async (): Promise<void> => {
    const mine = ++seq;
    setStatus('Searching…');
    try {
      const results = await searchTokens(search.value);
      if (mine !== seq) return; // a newer query superseded this one
      list.innerHTML = '';
      if (results.length === 0) {
        setStatus('No tokens match.');
        return;
      }
      empty.hidden = true;
      const frag = document.createDocumentFragment();
      for (const t of results) frag.appendChild(tokenRow(t, opts, close));
      list.appendChild(frag);
    } catch (err) {
      if (mine !== seq) return;
      setStatus(err instanceof Error ? err.message : 'Search failed.');
    }
  };

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void run(), 250);
  };

  overlay.querySelector<HTMLButtonElement>('.tk-close')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  search.addEventListener('input', schedule);
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  search.focus();
  void run(); // initial (empty term) → top tokens
  return close;
}

function tokenRow(t: V2Token, opts: PickerOptions, close: () => void): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'tk-row';
  if (t.id === opts.current) row.classList.add('tk-row-active');
  row.setAttribute('role', 'option');

  row.appendChild(tokenAvatar(t));

  const meta = document.createElement('div');
  meta.className = 'tk-row-meta';
  meta.innerHTML =
    `<span class="tk-row-sym">${escapeHtml(t.symbol)}</span>` +
    `<span class="tk-row-name">${escapeHtml(t.name || t.symbol)}</span>`;
  row.appendChild(meta);

  const net = document.createElement('span');
  net.className = `tk-net-tag ${netClass(t.kind)}`;
  net.textContent = t.network;
  row.appendChild(net);

  row.addEventListener('click', () => {
    opts.onSelect(t);
    close();
  });
  return row;
}

function escapeHtml(v: string): string {
  return v.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
