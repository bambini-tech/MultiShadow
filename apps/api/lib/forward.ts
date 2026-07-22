/**
 * Allowlisted passthrough to the Houdini v2 partner API.
 *
 * The browser can't hold the API key, so it calls this proxy at `/api/hd/<path>`
 * and we forward to `https://api-partner.houdiniswap.com/v2/<path>` with the key
 * injected. Only the endpoints MultiShadow needs are allowlisted — the key can
 * never be used through this proxy for account endpoints (withdrawals, /me, …).
 *
 * GETs are retried on transient failures; POSTs (order creation, tx submit) are
 * NEVER retried — a retry could double-create orders.
 */
import { retry, HttpError } from '@multishadow/core';
import { getHoudiniRequestConfig } from './houdini.js';
import type { HandlerResult } from './handlers.js';

type Method = 'GET' | 'POST';

/** Path patterns (relative to the `/v2` base) this proxy will forward. */
const ALLOW: Array<{ method: Method; re: RegExp }> = [
  { method: 'GET', re: /^\/tokens$/ },
  { method: 'GET', re: /^\/chains$/ },
  { method: 'GET', re: /^\/minMax$/ },
  { method: 'GET', re: /^\/quotes$/ },
  { method: 'GET', re: /^\/status$/ },
  { method: 'POST', re: /^\/exchanges$/ },
  { method: 'POST', re: /^\/exchanges\/multi$/ },
  { method: 'GET', re: /^\/exchanges\/multi\/[^/]+$/ },
  { method: 'GET', re: /^\/exchanges\/multi\/[^/]+\/tx$/ },
  { method: 'POST', re: /^\/exchanges\/multi\/[^/]+\/tx$/ },
  { method: 'POST', re: /^\/exchanges\/multi\/[^/]+\/tx\/build$/ },
  { method: 'POST', re: /^\/exchanges\/multi\/[^/]+\/retry$/ },
  { method: 'POST', re: /^\/exchanges\/multi\/recovery$/ },
  { method: 'GET', re: /^\/orders\/[^/]+$/ },
];

const RETRY = { attempts: 4, baseDelayMs: 300, maxDelayMs: 8000 } as const;

function isAllowed(method: Method, path: string): boolean {
  return ALLOW.some((a) => a.method === method && a.re.test(path));
}

/** Ensure the subpath is a clean, single-segment-safe path with a leading slash. */
function normalizePath(subpath: string): string {
  let p = subpath.split('?')[0] ?? '';
  if (!p.startsWith('/')) p = `/${p}`;
  return p.replace(/\/+$/, '') || '/';
}

/**
 * Forward one request to Houdini v2. `subpath` is everything after `/api/hd`
 * (e.g. `/tokens` or `/exchanges/multi/abc/tx`).
 */
export async function forwardHoudini(
  method: Method,
  subpath: string,
  query: Record<string, string | undefined>,
  body: unknown,
): Promise<HandlerResult> {
  const path = normalizePath(subpath);
  if (!isAllowed(method, path)) {
    return { status: 404, body: { error: `Unsupported proxy route: ${method} ${path}` } };
  }

  let cfg;
  try {
    cfg = getHoudiniRequestConfig();
  } catch (err) {
    return { status: 500, body: { error: err instanceof Error ? err.message : 'Config error' } };
  }

  const url = new URL(cfg.baseUrl + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }

  const headers: Record<string, string> = { ...cfg.headers };
  let payload: string | undefined;
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body ?? {});
  }

  const doFetch = async (): Promise<HandlerResult> => {
    const res = await fetch(url.toString(), {
      method,
      headers,
      ...(payload !== undefined ? { body: payload } : {}),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      // Surface the upstream status but throw for GETs so retry can kick in.
      throw new HttpError(res.status, `Houdini ${path} failed with ${res.status}`, parsed);
    }
    return { status: res.status, body: parsed };
  };

  try {
    // Only idempotent GETs are retried; POSTs run exactly once.
    return method === 'GET' ? await retry(doFetch, RETRY) : await doFetch();
  } catch (err) {
    if (err instanceof HttpError) {
      const status = err.status >= 400 && err.status < 600 ? err.status : 502;
      return {
        status,
        body: { error: 'Upstream Houdini error', status: err.status, detail: err.body },
      };
    }
    return { status: 502, body: { error: err instanceof Error ? err.message : 'Proxy error' } };
  }
}
