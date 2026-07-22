/**
 * Token catalog.
 *
 * Loads the full Houdini token list once (all chains, all tokens — exactly what
 * the HoudiniSwap app offers) and indexes it for the token pickers. The list is
 * shared by the source selector and every recipient row.
 */
import type { HoudiniToken } from '@multishadow/core';
import { proxy } from './proxy.js';

let tokens: HoudiniToken[] = [];
let byId = new Map<string, HoudiniToken>();
let loaded = false;
let loadingPromise: Promise<HoudiniToken[]> | undefined;

export function getTokens(): HoudiniToken[] {
  return tokens;
}

export function isLoaded(): boolean {
  return loaded;
}

export function tokenById(id: string): HoudiniToken | undefined {
  return byId.get(id);
}

/** Load (or return the cached) catalog. Safe to call concurrently. */
export function loadCatalog(): Promise<HoudiniToken[]> {
  if (loaded) return Promise.resolve(tokens);
  if (loadingPromise) return loadingPromise;
  loadingPromise = proxy
    .tokens()
    .then((list) => {
      tokens = list.filter((t) => t.id && t.symbol);
      byId = new Map(tokens.map((t) => [t.id, t]));
      loaded = true;
      return tokens;
    })
    .catch((err) => {
      loadingPromise = undefined; // allow a retry
      throw err;
    });
  return loadingPromise;
}

/**
 * Rank tokens for a query. Empty query returns the catalog in a stable order
 * (native/major coins first-ish via symbol length, then alphabetical). Matches
 * on symbol, name, and network so "usdc", "polygon" and "matic" all work.
 */
export function searchTokens(query: string, limit = 200): HoudiniToken[] {
  const q = query.trim().toLowerCase();
  if (q === '') return tokens.slice(0, limit);

  const scored: Array<{ t: HoudiniToken; score: number }> = [];
  for (const t of tokens) {
    const sym = t.symbol.toLowerCase();
    const name = t.name.toLowerCase();
    const net = t.network.toLowerCase();
    let score = -1;
    if (sym === q) score = 100;
    else if (sym.startsWith(q)) score = 80;
    else if (net === q) score = 70;
    else if (sym.includes(q)) score = 60;
    else if (name.startsWith(q)) score = 50;
    else if (net.startsWith(q)) score = 45;
    else if (name.includes(q) || net.includes(q)) score = 30;
    if (score >= 0) scored.push({ t, score });
  }
  scored.sort((a, b) => b.score - a.score || a.t.symbol.localeCompare(b.t.symbol));
  return scored.slice(0, limit).map((s) => s.t);
}

/** The default funding source: native SOL on Solana. */
export function findDefaultSource(): HoudiniToken | undefined {
  return (
    tokens.find(
      (t) =>
        t.symbol.toUpperCase() === 'SOL' &&
        ['sol', 'solana'].includes(t.network.toLowerCase()) &&
        !t.contractAddress,
    ) ?? tokens.find((t) => t.symbol.toUpperCase() === 'SOL')
  );
}
