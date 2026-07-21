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

  cached = new HoudiniClient({
    baseUrl,
    apiKey,
    // Route DEX variants when explicitly enabled server-side.
    dex: process.env.HOUDINI_DEX === 'true',
  });
  return cached;
}
