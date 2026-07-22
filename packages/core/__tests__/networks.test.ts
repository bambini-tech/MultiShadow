import { describe, expect, it } from 'vitest';
import {
  classifyNetwork,
  evmChainId,
  isSupportedSourceNetwork,
  isValidAddressForChain,
} from '../src/index.js';

describe('classifyNetwork', () => {
  it('recognizes Solana aliases', () => {
    for (const n of ['SOL', 'sol', 'Solana', 'SPL']) {
      expect(classifyNetwork(n)).toBe('solana');
    }
  });

  it('recognizes EVM chains by short and long names', () => {
    for (const n of [
      'ETH',
      'ethereum',
      'BSC',
      'binance-smart-chain',
      'polygon',
      'MATIC',
      'arbitrum',
      'base',
      'optimism',
      'avalanche',
    ]) {
      expect(classifyNetwork(n)).toBe('evm');
    }
  });

  it('falls back to other for unknown chains', () => {
    for (const n of ['BTC', 'TRON', 'XMR', '']) {
      expect(classifyNetwork(n)).toBe('other');
    }
  });
});

describe('evmChainId', () => {
  it('maps known networks to their chain ids', () => {
    expect(evmChainId('eth')).toBe(1);
    expect(evmChainId('ETHEREUM')).toBe(1);
    expect(evmChainId('bsc')).toBe(56);
    expect(evmChainId('polygon')).toBe(137);
    expect(evmChainId('matic')).toBe(137);
    expect(evmChainId('arbitrum')).toBe(42161);
    expect(evmChainId('base')).toBe(8453);
  });

  it('returns undefined for non-EVM networks', () => {
    expect(evmChainId('sol')).toBeUndefined();
    expect(evmChainId('btc')).toBeUndefined();
  });
});

describe('isSupportedSourceNetwork', () => {
  it('is true for Solana and EVM, false for others', () => {
    expect(isSupportedSourceNetwork('SOL')).toBe(true);
    expect(isSupportedSourceNetwork('polygon')).toBe(true);
    expect(isSupportedSourceNetwork('BTC')).toBe(false);
  });
});

describe('isValidAddressForChain (network-aware)', () => {
  const sol = 'So11111111111111111111111111111111111111112';
  const evm = '0x' + 'a'.repeat(40);

  it('validates Solana addresses on any Solana alias', () => {
    expect(isValidAddressForChain(sol, 'solana')).toBe(true);
    expect(isValidAddressForChain(evm, 'sol')).toBe(false);
  });

  it('validates EVM addresses on every EVM chain', () => {
    for (const n of ['eth', 'bsc', 'polygon', 'arbitrum', 'base', 'optimism', 'avalanche']) {
      expect(isValidAddressForChain(evm, n)).toBe(true);
      expect(isValidAddressForChain('0xnothex', n)).toBe(false);
    }
  });

  it('accepts any non-empty string for unknown chains', () => {
    expect(isValidAddressForChain('anything', 'TRON')).toBe(true);
    expect(isValidAddressForChain('   ', 'TRON')).toBe(false);
  });
});
