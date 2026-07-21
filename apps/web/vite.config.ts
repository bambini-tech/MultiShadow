import { defineConfig } from 'vite';

// During local dev, proxy /api to the locally-running serverless proxy
// (e.g. `vercel dev` on :3000) so the browser never needs the Houdini key.
export default defineConfig({
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
