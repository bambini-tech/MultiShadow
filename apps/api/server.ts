/**
 * Standalone HTTP server for container hosts (Railway, Render, Fly, a plain VPS,
 * Docker …) — anywhere that runs a long-lived process rather than serverless
 * functions.
 *
 * It reuses the SAME platform-agnostic handlers as the Vercel/Netlify adapters,
 * so behaviour is identical, and additionally serves the built frontend
 * (apps/web/dist) from the same origin. One process, one domain, no CORS needed:
 *   - GET  /api/quote      ── Houdini quote
 *   - POST /api/exchange   ── create order (deposit address + amount)
 *   - GET  /api/status     ── order status
 *   - GET  /api/min-max    ── route min/max
 *   - GET  /api/tokens     ── supported tokens
 *   - everything else      ── static frontend, SPA-fallback to index.html
 *
 * The Houdini API key is read from the environment here and never sent to the
 * browser.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleQuote,
  handleExchange,
  handleStatus,
  handleMinMax,
  handleTokens,
  type HandlerInput,
  type HandlerResult,
} from './lib/handlers.js';
import { forwardHoudini } from './lib/forward.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIR = normalize(join(here, '..', 'web', 'dist'));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

type Route = { method: 'GET' | 'POST'; handler: (input: HandlerInput) => Promise<HandlerResult> };

const routes: Record<string, Route> = {
  '/api/quote': { method: 'GET', handler: handleQuote },
  '/api/exchange': { method: 'POST', handler: handleExchange },
  '/api/status': { method: 'GET', handler: handleStatus },
  '/api/min-max': { method: 'GET', handler: handleMinMax },
  '/api/tokens': { method: 'GET', handler: () => handleTokens() },
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const list = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.origin;
  // Same-origin (UI served here) needs no CORS; this only matters when the
  // frontend is hosted elsewhere and points VITE_API_BASE_URL at this server.
  if (origin && (list.length === 0 || list.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy(); // basic guard
    });
    req.on('end', () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  // Resolve within WEB_DIR only; reject path traversal.
  const rel = pathname === '/' ? '/index.html' : pathname;
  const target = normalize(join(WEB_DIR, rel));
  if (!target.startsWith(WEB_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const file = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(file);
  } catch {
    // SPA fallback: serve index.html for unknown non-file routes.
    try {
      const index = await readFile(join(WEB_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] as string });
      res.end(index);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found (frontend build missing — run `pnpm -r build`).');
    }
  }
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      // Health check for the platform (Railway healthcheckPath).
      if (url.pathname === '/healthz') {
        sendJson(res, 200, { ok: true });
        return;
      }

      // Generic allowlisted passthrough to Houdini v2 (native multi-swap flow).
      if (url.pathname === '/api/hd' || url.pathname.startsWith('/api/hd/')) {
        applyCors(req, res);
        if (req.method === 'OPTIONS') {
          res.writeHead(204).end();
          return;
        }
        if (req.method !== 'GET' && req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed. Use GET or POST.' });
          return;
        }
        const subpath = url.pathname.slice('/api/hd'.length) || '/';
        const query: Record<string, string | undefined> = {};
        for (const [k, v] of url.searchParams) query[k] = v;
        const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
        const result = await forwardHoudini(req.method, subpath, query, body);
        sendJson(res, result.status, result.body);
        return;
      }

      const route = routes[url.pathname];

      if (route) {
        applyCors(req, res);
        if (req.method === 'OPTIONS') {
          res.writeHead(204).end();
          return;
        }
        if (req.method !== route.method) {
          sendJson(res, 405, { error: `Method not allowed. Use ${route.method}.` });
          return;
        }
        const query: Record<string, string | undefined> = {};
        for (const [k, v] of url.searchParams) query[k] = v;
        const body = route.method === 'POST' ? await readJsonBody(req) : undefined;
        const result = await route.handler({ query, body });
        sendJson(res, result.status, result.body);
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: `Unknown API route: ${url.pathname}` });
        return;
      }

      await serveStatic(res, url.pathname);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      sendJson(res, 500, { error: /api[_-]?key/i.test(message) ? 'Server error' : message });
    }
  })();
});

server.listen(PORT, HOST, () => {
  console.log(`MultiShadow server listening on http://${HOST}:${PORT}  (serving ${WEB_DIR})`);
});
