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
  const baseUrl = process.env.HOUDINI_BASE_URL ?? 'https://api-partner.houdiniswap.com';
  if (!apiKey) {
    throw new Error('HOUDINI_API_KEY is not set. The proxy cannot call Houdini without it.');
  }

  // Auth scheme is configurable so it can be matched to the official docs
  // WITHOUT a code change. Defaults to `Authorization: Bearer <key>`.
  //   HOUDINI_API_KEY_HEADER — header name (e.g. "Authorization" or "x-api-key")
  //   HOUDINI_BEARER         — "false" to send the raw key (no "Bearer " prefix)
  const apiKeyHeader = process.env.HOUDINI_API_KEY_HEADER?.trim() || 'Authorization';
  const bearerEnv = process.env.HOUDINI_BEARER?.trim().toLowerCase();
  const bearer =
    bearerEnv === 'true'
      ? true
      : bearerEnv === 'false'
        ? false
        : apiKeyHeader.toLowerCase() === 'authorization';

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
