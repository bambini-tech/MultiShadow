/**
 * Typed client for the MultiShadow proxy.
 *
 * The proxy returns already-normalized Houdini objects (the serverless functions
 * run the same core `map*` functions), so we consume the core types directly.
 * The Houdini API key lives ONLY behind this proxy — never here.
 */
import type {
  HoudiniQuote,
  HoudiniOrder,
  HoudiniOrderStatus,
  HoudiniMinMax,
  HoudiniToken,
} from '@multishadow/core';
import { config } from './config.js';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(config.apiBaseUrl + path, {
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
  return json as T;
}

export const proxy = {
  quote(params: { amount: number; from: string; to: string; anonymous?: boolean }) {
    const q = new URLSearchParams({
      amount: String(params.amount),
      from: params.from,
      to: params.to,
      anonymous: String(params.anonymous ?? true),
    });
    return request<HoudiniQuote>(`/quote?${q.toString()}`);
  },

  exchange(params: {
    amount: number;
    from: string;
    to: string;
    addressTo: string;
    addressToTag?: string;
    anonymous?: boolean;
  }) {
    return request<HoudiniOrder>('/exchange', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  status(orderId: string) {
    return request<HoudiniOrderStatus>(`/status?id=${encodeURIComponent(orderId)}`);
  },

  minMax(params: { from: string; to: string }) {
    const q = new URLSearchParams(params);
    return request<HoudiniMinMax>(`/min-max?${q.toString()}`);
  },

  tokens() {
    return request<HoudiniToken[]>('/tokens');
  },
};
