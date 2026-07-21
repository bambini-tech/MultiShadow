# MultiShadow — single container that builds the monorepo and runs one process
# serving BOTH the frontend and the Houdini proxy API. Optimised for Railway
# (and any container host). Railway auto-detects this Dockerfile.

FROM node:22-slim AS base
# pnpm via corepack (version pinned by the root package.json "packageManager").
RUN corepack enable
WORKDIR /app

# ---- Install dependencies -------------------------------------------------
# Copy the full workspace (node_modules/dist excluded via .dockerignore) and
# install with the frozen lockfile for reproducible builds.
COPY . .
RUN pnpm install --frozen-lockfile

# ---- Build ----------------------------------------------------------------
# Public (VITE_*) values are baked into the frontend at build time. Railway
# passes matching service variables as build args. Server-side secrets
# (HOUDINI_API_KEY, …) are NOT needed here — they are read at runtime only.
ARG VITE_REOWN_PROJECT_ID=""
ARG VITE_SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
ARG VITE_API_BASE_URL="/api"
ENV VITE_REOWN_PROJECT_ID=$VITE_REOWN_PROJECT_ID
ENV VITE_SOLANA_RPC_URL=$VITE_SOLANA_RPC_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Builds core → web (produces apps/web/dist) → api (typecheck), topologically.
RUN pnpm -r build

# ---- Runtime --------------------------------------------------------------
ENV NODE_ENV=production
# Railway injects PORT; default to 3000 for local `docker run`.
ENV PORT=3000
EXPOSE 3000

# Starts the standalone HTTP server (apps/api/server.ts via tsx), which serves
# the built frontend and the /api/* routes from one origin.
CMD ["pnpm", "--filter", "@multishadow/api", "start"]
