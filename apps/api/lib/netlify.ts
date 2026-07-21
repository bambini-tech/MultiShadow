/**
 * Netlify Functions (v2) adapter. Uses the web-standard `Request`/`Response`,
 * wrapping the SAME platform-agnostic handlers as the Vercel adapter.
 */
import type { HandlerInput, HandlerResult } from './handlers.js';

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

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function createNetlifyHandler(
  method: 'GET' | 'POST',
  handler: (input: HandlerInput) => Promise<HandlerResult>,
) {
  return async function (req: Request): Promise<Response> {
    const cors = corsHeaders(req.headers.get('origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== method) {
      return jsonResponse({ error: `Method not allowed. Use ${method}.` }, 405, cors);
    }
    const url = new URL(req.url);
    const query = Object.fromEntries(url.searchParams.entries());
    let body: unknown;
    if (method === 'POST') {
      try {
        body = await req.json();
      } catch {
        body = undefined;
      }
    }
    const result = await handler({ query, body });
    return jsonResponse(result.body, result.status, cors);
  };
}
