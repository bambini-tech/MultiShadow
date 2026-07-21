import { defineConfig } from 'vite';

// During local dev, proxy /api to the locally-running serverless proxy
// (e.g. `vercel dev` on :3000) so the browser never needs the Houdini key.
export default defineConfig({
  // Relative asset paths so the built index.html works when served from any
  // path — and even when opened directly from disk (file://) — instead of
  // 404-ing on absolute "/assets/…" URLs (a cause of the blank page).
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
