/**
 * Server-side Houdini client factory.
 *
 * The API key is read from `process.env` here and NOWHERE near the browser
 * bundle. This module must only ever run in a serverless function.
 */
import { HoudiniClient } from '@multishadow/core';

let cached: HoudiniClient | undefined;

export function getHoudiniClient(): HoudiniClient {
  if (cached) return cached;

  const apiKey = process.env.HOUDINI_API_KEY;
  // Partner API v2. The official docs authenticate as `Authorization: <api-key>`
  // (the RAW key, no "Bearer " prefix) against a `/v2` base.
  const baseUrl = process.env.HOUDINI_BASE_URL ?? 'https://api-partner.houdiniswap.com/v2';
  if (!apiKey) {
    throw new Error('HOUDINI_API_KEY is not set. The proxy cannot call Houdini without it.');
  }

  // Auth scheme is configurable so it can be matched to the docs WITHOUT a code
  // change. Defaults now match Houdini v2: header `Authorization`, raw key.
  //   HOUDINI_API_KEY_HEADER — header name (default "Authorization")
  //   HOUDINI_BEARER         — "true" to send "Bearer <key>"; default false (raw)
  const apiKeyHeader = process.env.HOUDINI_API_KEY_HEADER?.trim() || 'Authorization';
  const bearer = process.env.HOUDINI_BEARER?.trim().toLowerCase() === 'true';

  cached = new HoudiniClient({
    baseUrl,
    apiKey,
    apiKeyHeader,
    bearer,
    // Route DEX variants when explicitly enabled server-side.
    dex: process.env.HOUDINI_DEX === 'true',
  });
  return cached;
}
