/**
 * Typed client for the MultiShadow proxy → Houdini v2.
 *
 * The proxy forwards allowlisted Houdini v2 paths under `/api/hd/*` with the API
 * key injected server-side. Responses are raw Houdini JSON; we normalize them
 * here via the core `map*` helpers. The Houdini key never reaches the browser.
 */
import {
  mapV2TokenSearch,
  mapMultiCreate,
  mapMultiStatus,
  mapMultiTx,
  mapSubmitTx,
  type V2TokenSearchResult,
  type V2MultiCreateResult,
  type V2MultiStatusResult,
  type V2MultiTxResult,
  type V2SubmitTxResult,
} from '@multishadow/core';
import { config } from './config.js';

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${config.apiBaseUrl}/hd${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json
        ? String((json as { error: unknown }).error)
        : `Request to ${path} failed (${res.status})`;
    throw new Error(message);
  }
  return json;
}

/** One order in a multi-exchange create request. */
export interface MultiOrderInput {
  from: string;
  to: string;
  amount: number;
  addressTo: string;
  anonymous?: boolean;
  destinationTag?: string;
}

export interface TokenSearchParams {
  term?: string;
  chain?: string;
  symbol?: string;
  hasCex?: boolean;
  page?: number;
  pageSize?: number;
}

export const proxy = {
  searchTokens(params: TokenSearchParams = {}): Promise<V2TokenSearchResult> {
    const q = new URLSearchParams();
    if (params.term) q.set('term', params.term);
    if (params.chain) q.set('chain', params.chain);
    if (params.symbol) q.set('symbol', params.symbol);
    if (params.hasCex !== undefined) q.set('hasCex', String(params.hasCex));
    q.set('page', String(params.page ?? 1));
    q.set('pageSize', String(params.pageSize ?? 50));
    return request(`/tokens?${q.toString()}`).then(mapV2TokenSearch);
  },

  createMultiExchange(
    orders: MultiOrderInput[],
    filters?: Record<string, unknown>,
  ): Promise<V2MultiCreateResult> {
    return request('/exchanges/multi', {
      method: 'POST',
      body: JSON.stringify({ orders, ...(filters ? { filters } : {}) }),
    }).then(mapMultiCreate);
  },

  multiStatus(multiId: string): Promise<V2MultiStatusResult> {
    return request(`/exchanges/multi/${encodeURIComponent(multiId)}`).then(mapMultiStatus);
  },

  /** Solana: batched deposit transactions (base64) ready to sign. */
  multiTxSolana(multiId: string, sender: string): Promise<V2MultiTxResult> {
    const q = new URLSearchParams({ sender });
    return request(`/exchanges/multi/${encodeURIComponent(multiId)}/tx?${q.toString()}`).then(
      mapMultiTx,
    );
  },

  /** EVM: build ERC-4337 user-operation batches to sign. */
  multiTxBuildEvm(multiId: string, sender: string): Promise<V2MultiTxResult> {
    return request(`/exchanges/multi/${encodeURIComponent(multiId)}/tx/build`, {
      method: 'POST',
      body: JSON.stringify({ sender }),
    }).then(mapMultiTx);
  },

  /** EVM: submit signed user-operations. */
  multiTxSubmitEvm(multiId: string, signatures: string[]): Promise<V2SubmitTxResult> {
    return request(`/exchanges/multi/${encodeURIComponent(multiId)}/tx`, {
      method: 'POST',
      body: JSON.stringify({ signatures }),
    }).then(mapSubmitTx);
  },
};
