/**
 * Vercel adapter: CORS, method guard, and dispatch to a platform-agnostic
 * handler. The Netlify equivalent would wrap the same handlers from ./handlers.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { HandlerInput, HandlerResult } from './handlers.js';

function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function applyCors(req: VercelRequest, res: VercelResponse): void {
  const origin = req.headers.origin;
  const list = allowedOrigins();
  if (origin && (list.length === 0 || list.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/** Normalize `req.query` (values may be string | string[]) to string | undefined. */
function normalizeQuery(query: VercelRequest['query']): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(query)) {
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

export function createVercelHandler(
  method: 'GET' | 'POST',
  handler: (input: HandlerInput) => Promise<HandlerResult>,
) {
  return async function (req: VercelRequest, res: VercelResponse): Promise<void> {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method !== method) {
      res.status(405).json({ error: `Method not allowed. Use ${method}.` });
      return;
    }
    const result = await handler({
      query: normalizeQuery(req.query),
      body: req.body,
    });
    res.status(result.status).json(result.body);
  };
}
