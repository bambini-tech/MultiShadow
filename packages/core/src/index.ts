/**
 * @multishadow/core — framework-agnostic logic.
 *
 * Public surface: Houdini client + flow, distribution engine, concurrency pool,
 * Solana batching, and the wallet state machine + store.
 */

// Houdini
export { HoudiniClient } from './houdini/client.js';
export type { HoudiniClientOptions, FetchLike } from './houdini/client.js';
export { createOrder, pollUntilSettled, isTerminalPhase } from './houdini/flow.js';
export type {
  CreateOrderInput,
  CreateOrderResult,
  PollOptions,
  PollResult,
} from './houdini/flow.js';
export type {
  HoudiniToken,
  HoudiniQuote,
  HoudiniMinMax,
  HoudiniOrder,
  HoudiniOrderStatus,
  HoudiniPhase,
  QuoteParams,
  ExchangeParams,
  MinMaxParams,
} from './houdini/types.js';

// HTTP
export { retry } from './http/retry.js';
export type { RetryOptions } from './http/retry.js';
export { HttpError, NetworkError, isRetryable } from './http/errors.js';

// Distribution
export { randomAllocation, allocateWithBounds, AllocationError } from './distribution/allocate.js';
export type { RandomAllocationOptions, PerRouteBound } from './distribution/allocate.js';

// Concurrency
export {
  runPool,
  partitionSettled,
  PoolAbortedError,
  DEFAULT_CONCURRENCY,
} from './concurrency/pool.js';
export type { Settled, RunPoolOptions } from './concurrency/pool.js';

// Solana
export {
  buildBatchedTransactions,
  buildTransferInstruction,
  solToLamports,
  MAX_TX_BYTES,
} from './solana/batch.js';
export type { DepositTransfer, BuildBatchesParams, BatchTransaction } from './solana/batch.js';
export {
  isValidSolanaAddress,
  isValidEvmAddress,
  isValidAddressForChain,
} from './solana/address.js';

// State
export {
  canTransition,
  transition,
  isTerminal,
  makeWalletKey,
  newWalletRecord,
  InvalidTransitionError,
  TERMINAL_PHASES,
} from './state/machine.js';
export type { WalletPhase, WalletRecord } from './state/machine.js';
export { InMemoryStore, KvWalletStore, getOrCreate } from './state/store.js';
export type { WalletStore, KeyValueBackend } from './state/store.js';

// Utils
export { toBaseUnits, fromBaseUnits, formatBaseUnits, unitsPerToken } from './util/amount.js';
export { seededRng, defaultRng, randomInt, shuffle } from './util/random.js';
export type { Rng } from './util/random.js';
