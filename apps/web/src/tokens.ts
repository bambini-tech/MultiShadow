/**
 * Token resolution.
 *
 * Houdini quote/exchange calls take token ids from the `tokens` endpoint. Users
 * pick a chain per recipient; we resolve that to the chain's native token id.
 */
import type { HoudiniToken } from '@multishadow/core';

/** The native token symbol for each supported destination chain family. */
const NATIVE_SYMBOL: Record<string, string> = {
  SOL: 'SOL',
  SOLANA: 'SOL',
  ETH: 'ETH',
  ETHEREUM: 'ETH',
  BSC: 'BNB',
  POLYGON: 'MATIC',
  ARBITRUM: 'ETH',
  BASE: 'ETH',
};

/** The Houdini "network" label expected for each chain family. */
const NETWORK_LABEL: Record<string, string[]> = {
  SOL: ['sol', 'solana'],
  ETH: ['eth', 'ethereum', 'erc20'],
  BSC: ['bsc', 'bep20', 'binance'],
  POLYGON: ['polygon', 'matic'],
  ARBITRUM: ['arbitrum', 'arb'],
  BASE: ['base'],
};

/** The source token: SOL on Solana. */
export function findSolToken(tokens: HoudiniToken[]): HoudiniToken | undefined {
  return tokens.find(
    (t) => t.symbol.toUpperCase() === 'SOL' && NETWORK_LABEL.SOL!.includes(t.network.toLowerCase()),
  );
}

/** Resolve the native token id for a recipient's chain. */
export function resolveDestinationToken(
  tokens: HoudiniToken[],
  chain: string,
): HoudiniToken | undefined {
  const key = chain.trim().toUpperCase();
  const symbol = NATIVE_SYMBOL[key];
  const networks = NETWORK_LABEL[key] ?? [key.toLowerCase()];
  if (!symbol) return undefined;
  return tokens.find(
    (t) => t.symbol.toUpperCase() === symbol && networks.includes(t.network.toLowerCase()),
  );
}

export const SUPPORTED_CHAINS = Object.keys(NETWORK_LABEL);
