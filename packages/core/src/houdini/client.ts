/**
 * Houdini Swap API client.
 *
 * Transport-agnostic: it takes a `fetch`-compatible function and a base URL.
 *   - Server-side (apps/api) constructs it WITH the API key so the key stays
 *     off the client.
 *   - The frontend constructs it pointing at the MultiShadow proxy WITHOUT a key
 *     (the proxy injects the key). Same class, two deployments.
 *
 * Endpoints (v1.2.4): quote, exchange, status, getMinMax, tokens (+ dex*
 * variants). Verify paths/fields against the official docs; response parsing is
 * centralized in ./types.ts.
 */
import { HttpError, NetworkError } from '../http/errors.js';
import {
  type ExchangeParams,
  type HoudiniMinMax,
  type HoudiniOrder,
  type HoudiniOrderStatus,
  type HoudiniQuote,
  type HoudiniToken,
  type MinMaxParams,
  type QuoteParams,
  type RawJson,
  mapMinMax,
  mapOrder,
  mapPhase,
  mapQuote,
  mapToken,
  unwrap,
} from './types.js';

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface HoudiniClientOptions {
  baseUrl: string;
  /**
   * API key. Server-side ONLY. Omit when the client points at the MultiShadow
   * proxy (the proxy injects the key). If set on the frontend, that is a bug.
   */
  apiKey?: string;
  /** Header name for the API key. Default `Authorization` (Bearer). */
  apiKeyHeader?: string;
  /** If true, send the key as `Bearer <key>`. Default true for Authorization. */
  bearer?: boolean;
  /** Injected fetch (default: global fetch). */
  fetchImpl?: FetchLike;
  /** Whether to route DEX (dex*) variants. Default false (standard swaps). */
  dex?: boolean;
}

export class HoudiniClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly apiKeyHeader: string;
  private readonly bearer: boolean;
  private readonly fetchImpl: FetchLike;
  private readonly dex: boolean;

  constructor(opts: HoudiniClientOptions) {
    if (!opts.baseUrl) throw new Error('HoudiniClient: baseUrl is required');
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.apiKeyHeader = opts.apiKeyHeader ?? 'Authorization';
    this.bearer = opts.bearer ?? this.apiKeyHeader.toLowerCase() === 'authorization';
    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
    const chosen = opts.fetchImpl ?? globalFetch;
    if (!chosen) throw new Error('HoudiniClient: no fetch implementation available');
    this.fetchImpl = chosen;
    this.dex = opts.dex ?? false;
  }

  /** GET /quote (or /dexQuote) — price + min/max for a route. */
  async quote(params: QuoteParams): Promise<HoudiniQuote> {
    const path = this.dex ? '/dexQuote' : '/quote';
    const raw = await this.request(path, 'GET', {
      amount: String(params.amount),
      from: params.from,
      to: params.to,
      anonymous: String(params.anonymous ?? true),
    });
    return mapQuote(asObject(unwrap(raw)));
  }

  /** POST /exchange (or /dexExchange) — create an order, get deposit details. */
  async exchange(params: ExchangeParams): Promise<HoudiniOrder> {
    const path = this.dex ? '/dexExchange' : '/exchange';
    const body: RawJson = {
      amount: params.amount,
      from: params.from,
      to: params.to,
      addressTo: params.addressTo,
      anonymous: params.anonymous ?? true,
    };
    if (params.addressToTag) body.addressToTag = params.addressToTag;
    const raw = await this.request(path, 'POST', undefined, body);
    return mapOrder(asObject(unwrap(raw)));
  }

  /** GET /status — current lifecycle phase of an order. */
  async status(orderId: string): Promise<HoudiniOrderStatus> {
    const raw = await this.request('/status', 'GET', { id: orderId });
    const obj = asObject(unwrap(raw));
    const rawStatus = obj.status ?? obj.state ?? obj.phase;
    return {
      orderId,
      phase: mapPhase(rawStatus),
      rawStatus,
      raw: obj,
    };
  }

  /** GET /getMinMax — min/max input for a route. */
  async getMinMax(params: MinMaxParams): Promise<HoudiniMinMax> {
    const raw = await this.request('/getMinMax', 'GET', {
      from: params.from,
      to: params.to,
    });
    return mapMinMax(asObject(unwrap(raw)));
  }

  /** GET /tokens (or /dexTokens) — supported tokens. */
  async getTokens(): Promise<HoudiniToken[]> {
    const path = this.dex ? '/dexTokens' : '/tokens';
    const raw = await this.request(path, 'GET');
    const data = unwrap(raw);
    if (!Array.isArray(data)) return [];
    return data.map((t) => mapToken(asObject(t)));
  }

  // ── transport ────────────────────────────────────────────────────────────

  private async request(
    path: string,
    method: 'GET' | 'POST',
    query?: Record<string, string>,
    body?: RawJson,
  ): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (this.apiKey) {
      headers[this.apiKeyHeader] = this.bearer ? `Bearer ${this.apiKey}` : this.apiKey;
    }

    let res;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new NetworkError(`Network error calling ${path}`, err);
    }

    if (!res.ok) {
      let parsed: unknown;
      const text = await safeText(res);
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = text;
      }
      throw new HttpError(res.status, `Houdini ${path} failed with ${res.status}`, parsed);
    }

    return res.json();
  }
}

function asObject(v: unknown): RawJson {
  return v && typeof v === 'object' ? (v as RawJson) : {};
}

async function safeText(res: { text: () => Promise<string> }): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
