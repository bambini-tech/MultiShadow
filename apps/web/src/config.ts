/** Client-side configuration, sourced from public (VITE_*) env vars. */
export const config = {
  reownProjectId: import.meta.env.VITE_REOWN_PROJECT_ID ?? '',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api',
  solanaRpcUrl: import.meta.env.VITE_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
};

export const metadata = {
  name: 'MultiShadow',
  description: 'Private multi-wallet SOL distributor',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://multishadow.app',
  icons: [] as string[],
};
