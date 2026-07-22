/**
 * Token catalog access.
 *
 * Houdini v2 has thousands of tokens, so instead of downloading the whole list
 * we search server-side (`GET /tokens?term=…`) as the user types — exactly what
 * the HoudiniSwap app does. A tiny cache keeps repeated queries snappy.
 */
import type { V2Token } from '@multishadow/core';
import { proxy, type TokenSearchParams } from './proxy.js';

const cache = new Map<string, V2Token[]>();

function key(p: TokenSearchParams): string {
  return JSON.stringify([p.term ?? '', p.chain ?? '', p.symbol ?? '', p.hasCex ?? '']);
}

/** Search tokens by free text (name/symbol/chain). Cached per query. */
export async function searchTokens(term: string): Promise<V2Token[]> {
  const params: TokenSearchParams = { term: term.trim(), pageSize: 50 };
  const k = key(params);
  const hit = cache.get(k);
  if (hit) return hit;
  const { tokens } = await proxy.searchTokens(params);
  cache.set(k, tokens);
  return tokens;
}

/** The default funding source: native SOL on Solana. */
export async function fetchDefaultSource(): Promise<V2Token | undefined> {
  const { tokens } = await proxy.searchTokens({ symbol: 'SOL', chain: 'solana', pageSize: 10 });
  return (
    tokens.find((t) => t.symbol.toUpperCase() === 'SOL' && !t.contractAddress) ??
    tokens.find((t) => t.symbol.toUpperCase() === 'SOL')
  );
}
