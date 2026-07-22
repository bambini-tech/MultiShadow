/**
 * Vercel catch-all for the Houdini v2 passthrough: `/api/hd/<path>`.
 * Mirrors the Railway server route; the allowlist lives in ../../lib/forward.ts.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { forwardHoudini } from '../../lib/forward.js';

function applyCors(req: VercelRequest, res: VercelResponse): void {
  const list = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.origin;
  if (origin && (list.length === 0 || list.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
    return;
  }
  const pathParam = req.query.path;
  const segs = Array.isArray(pathParam) ? pathParam : pathParam ? [pathParam] : [];
  const subpath = `/${segs.join('/')}`;
  const query: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'path') continue;
    query[k] = Array.isArray(v) ? v[0] : v;
  }
  const result = await forwardHoudini(req.method, subpath, query, req.body);
  res.status(result.status).json(result.body);
}
