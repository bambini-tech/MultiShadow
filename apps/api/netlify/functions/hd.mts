/**
 * Netlify catch-all for the Houdini v2 passthrough: `/api/hd/<path>`.
 * Mirrors the Railway server route; the allowlist lives in ../../lib/forward.ts.
 */
import { forwardHoudini } from '../../lib/forward.js';

function corsHeaders(origin: string | null): Record<string, string> {
  const list = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && (list.length === 0 || list.includes(origin))) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export default async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use GET or POST.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
  const url = new URL(req.url);
  const subpath = url.pathname.slice('/api/hd'.length) || '/';
  const query: Record<string, string | undefined> = Object.fromEntries(url.searchParams.entries());
  let body: unknown;
  if (req.method === 'POST') {
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
  }
  const result = await forwardHoudini(req.method, subpath, query, body);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

export const config = { path: '/api/hd/*' };
