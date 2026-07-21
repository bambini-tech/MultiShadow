# MultiShadow

Private multi-wallet transactions made simple.

MultiShadow splits **your own** SOL capital across **your own** self-controlled
wallets and routes each transfer privately through the
[Houdini Swap](https://houdiniswap.com) API. You provide the destination
addresses; the tool distributes a total amount across them (equal, random, or
weighted) and routes every transfer so the on-chain link between source and
destinations is broken to public observers.

The purpose is **security diversification** — avoiding a single point of failure
for your funds — and **transactional privacy against public chain observers**.

---

## ⚠️ Honest privacy scope (read this)

Privacy here means **privacy from the public**, not anonymity from authorities.

- Houdini routes swaps through partner exchanges. Those partner exchanges run
  **KYC/AML** on their flows. A swap is **not** untraceable to a compelled,
  subpoena-backed investigation.
- MultiShadow breaks the _publicly visible_ on-chain link between your source
  wallet and your destination wallets. It does **not** make transactions
  "untraceable for everyone."
- We will never claim otherwise anywhere in this tool or its UI copy.

**Intended use:** protecting your own funds and your own on-chain privacy.
**Not intended for:** evading exchange compliance controls, or disguising that
multiple wallets are related for market manipulation (bundling, wash-trading,
launch-sniping). See [Non-goals](#non-goals).

---

## Architecture

```
apps/web        → Frontend (Vite + TypeScript, Reown AppKit wallet-connect, UI, state)
apps/api        → Serverless proxy (Houdini client wiring, API key stays server-side)
packages/core   → Framework-agnostic logic
                  (Houdini client, distribution, concurrency, Solana batching, state machine)
packages/core/__tests__
```

### Hard constraints

1. **The Houdini API key is server-side only.** Every Houdini call goes through
   the proxy in `apps/api` (also required for CORS). The key never enters the
   frontend bundle.
2. **MultiShadow never touches recipient private keys** — only their public
   addresses. Only the source wallet signs, via Reown.
3. **Honest privacy framing** (see above) is enforced in copy.

---

## Setup

Requires Node.js ≥ 20 and pnpm ≥ 10.

```bash
pnpm install
cp .env.example .env   # fill in your values
```

Fill in `.env`:

| Variable                | Scope        | Purpose                                     |
| ----------------------- | ------------ | ------------------------------------------- |
| `HOUDINI_API_KEY`       | server only  | Houdini partner API key — **never** exposed |
| `HOUDINI_BASE_URL`      | server only  | Houdini API base URL                        |
| `SOLANA_RPC_URL`        | server only  | RPC for building/sending transactions       |
| `ALLOWED_ORIGINS`       | server only  | CORS allow-list for the proxy               |
| `VITE_REOWN_PROJECT_ID` | client (pub) | Reown AppKit project id (public value)      |
| `VITE_API_BASE_URL`     | client (pub) | Base URL of the deployed proxy              |
| `VITE_SOLANA_RPC_URL`   | client (pub) | Read-only RPC for the frontend              |

### Common commands

```bash
pnpm build          # build all packages
pnpm test           # run unit tests (core)
pnpm typecheck      # type-check all packages
pnpm lint           # lint
pnpm dev:web        # run the frontend locally
pnpm dev:api        # run the proxy locally (vercel dev)
```

---

## How it works (private-swap flow)

For each destination wallet, MultiShadow runs the Houdini private-swap flow via
the proxy:

1. **`quote`** — price/route + min/max for the chosen source→destination pair.
2. **`exchange`** — creates an order, returning an `orderId`, a **deposit
   address**, and the exact **deposit amount** to send.
3. Fund the order by sending the deposit amount to the deposit address. To
   minimise cost and wallet prompts, MultiShadow **batches** multiple
   `SystemProgram.transfer` instructions (one per deposit address) into a single
   Solana transaction, signed once via Reown.
4. **`status`** polling until each order reaches `completed` (or `failed`).

Amounts are distributed with the [distribution engine](packages/core/src/distribution),
respecting per-route min/max from Houdini's `getMinMax`. Concurrency and timing
jitter are tunable via a **Speed ↔ Privacy** control: full parallelism / no
jitter is fastest; low concurrency + jitter reduces timing correlation between
recipients.

A local, idempotent [state store](packages/core/src/state) records each wallet's
progress (`pending → order_created → funded → completed | failed`) so a restart
**never double-funds** an order, and an interrupted batch can be resumed.

> **Houdini API field names.** The Houdini docs were not reachable from the build
> environment, so the client is written against the documented v1.2.4 shape with
> a single centralized field-mapping layer
> ([`packages/core/src/houdini/types.ts`](packages/core/src/houdini/types.ts)).
> Verify the field names against the
> [official API docs](https://docs.houdiniswap.com/houdini-swap/api-documentation)
> before mainnet use; only that one file should need adjusting.

---

## Deployment

Both `apps/api` (serverless proxy) and `apps/web` (static frontend) deploy to
Vercel or Netlify. Set the server-side secrets (`HOUDINI_API_KEY`, etc.) as
environment variables in the platform dashboard — never in the repo. See
[`apps/api/vercel.json`](apps/api/vercel.json) and
[`apps/api/netlify.toml`](apps/api/netlify.toml).

---

## Non-goals

- **No** concealment that multiple wallets are related for the purpose of market
  manipulation (bundling, wash-trading, launch-sniping). This is a
  security/privacy tool for your own funds.
- **No** circumvention of exchange compliance controls.

## License

MIT © bambini-tech
