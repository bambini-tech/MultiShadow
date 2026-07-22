/**
 * Network / chain classification.
 *
 * Houdini's `/tokens` list spans many chains. To send funds FROM a selected
 * source token we need to know which wallet ecosystem the token's network
 * belongs to (Solana vs EVM vs something we can't sign from a browser wallet),
 * and — for EVM — the numeric chain id to switch the wallet to.
 *
 * The network strings below are matched case-insensitively and defensively:
 * Houdini has used both short symbols ("ETH", "BSC") and long names
 * ("ethereum", "binance-smart-chain") across versions. Add aliases here as new
 * chains appear — this is the single place that maps a network label to how we
 * sign for it.
 */

export type NetworkKind = 'solana' | 'evm' | 'other';

/** Canonical EVM chain ids keyed by the aliases Houdini may report. */
const EVM_CHAIN_IDS: Record<string, number> = {
  eth: 1,
  ethereum: 1,
  erc20: 1,
  mainnet: 1,
  bsc: 56,
  bep20: 56,
  binance: 56,
  'binance-smart-chain': 56,
  bnb: 56,
  polygon: 137,
  matic: 137,
  'polygon-pos': 137,
  arbitrum: 42161,
  'arbitrum-one': 42161,
  arb: 42161,
  base: 8453,
  optimism: 10,
  op: 10,
  avalanche: 43114,
  avax: 43114,
  'avalanche-c-chain': 43114,
  fantom: 250,
  ftm: 250,
  cronos: 25,
  gnosis: 100,
  xdai: 100,
  celo: 42220,
  linea: 59144,
  scroll: 534352,
  blast: 81457,
  zksync: 324,
  'zksync-era': 324,
  mantle: 5000,
  moonbeam: 1284,
  aurora: 1313161554,
  metis: 1088,
  boba: 288,
  kava: 2222,
};

const SOLANA_ALIASES = new Set(['sol', 'solana', 'spl']);

/** Normalize a network label to a lowercase key. */
function normalize(network: string): string {
  return network.trim().toLowerCase();
}

/** Which wallet ecosystem a token's network belongs to. */
export function classifyNetwork(network: string): NetworkKind {
  const key = normalize(network);
  if (SOLANA_ALIASES.has(key)) return 'solana';
  if (key in EVM_CHAIN_IDS) return 'evm';
  return 'other';
}

/** Numeric EVM chain id for a network label, or undefined if not an EVM chain. */
export function evmChainId(network: string): number | undefined {
  return EVM_CHAIN_IDS[normalize(network)];
}

/**
 * True when we can currently sign a *funding* transaction from this network in
 * the browser (Solana or any known EVM chain). Non-native Solana (SPL) tokens
 * are excluded here because SPL funding is not yet implemented — see the engine.
 */
export function isSupportedSourceNetwork(network: string): boolean {
  const kind = classifyNetwork(network);
  return kind === 'solana' || kind === 'evm';
}
