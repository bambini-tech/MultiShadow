import { describe, expect, it } from 'vitest';
import {
  mapV2Token,
  mapV2TokenSearch,
  mapV2Order,
  mapOrderStatus,
  isTerminalOrderPhase,
  mapMultiCreate,
  mapMultiTx,
} from '../src/index.js';

describe('mapV2Token', () => {
  it('normalizes a token search item', () => {
    const t = mapV2Token({
      id: '6689b73ec90e45f3b3e51564',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      icon: 'https://x/usdc.png',
      address: '0xA0b8...',
      mainnet: false,
      hasCex: true,
      chain: 'ETH',
      chainData: { shortName: 'ethereum', kind: 'evm', chainId: 1 },
    });
    expect(t).toMatchObject({
      id: '6689b73ec90e45f3b3e51564',
      symbol: 'USDC',
      decimals: 6,
      network: 'ethereum',
      kind: 'evm',
      evmChainId: 1,
      logo: 'https://x/usdc.png',
      contractAddress: '0xA0b8...',
      mainnet: false,
    });
  });

  it('treats a native coin (no address) as having no contractAddress', () => {
    const t = mapV2Token({
      id: 'a'.repeat(24),
      symbol: 'SOL',
      decimals: 9,
      address: null,
      chainData: { shortName: 'solana', kind: 'sol', chainId: null },
    });
    expect(t.contractAddress).toBeUndefined();
    expect(t.evmChainId).toBeUndefined();
    expect(t.network).toBe('solana');
    expect(t.kind).toBe('sol');
  });
});

describe('mapV2TokenSearch', () => {
  it('unwraps the paginated envelope', () => {
    const r = mapV2TokenSearch({
      tokens: [{ id: '1', symbol: 'BTC', chainData: { shortName: 'bitcoin', kind: 'bitcoin' } }],
      total: 1,
      totalPages: 1,
    });
    expect(r.total).toBe(1);
    expect(r.tokens[0]!.symbol).toBe('BTC');
  });
});

describe('mapOrderStatus', () => {
  it('maps every documented code', () => {
    expect(mapOrderStatus(-2)).toBe('initializing');
    expect(mapOrderStatus(-1)).toBe('new');
    expect(mapOrderStatus(0)).toBe('waiting');
    expect(mapOrderStatus(4)).toBe('completed');
    expect(mapOrderStatus(5)).toBe('expired');
    expect(mapOrderStatus(6)).toBe('failed');
    expect(mapOrderStatus(7)).toBe('refunded');
    expect(mapOrderStatus(8)).toBe('deleted');
    expect(mapOrderStatus(99)).toBe('unknown');
  });

  it('flags terminal phases', () => {
    expect(isTerminalOrderPhase('completed')).toBe(true);
    expect(isTerminalOrderPhase('failed')).toBe(true);
    expect(isTerminalOrderPhase('waiting')).toBe(false);
  });
});

describe('mapV2Order', () => {
  it('reads deposit fields from the v2 order shape', () => {
    const o = mapV2Order({
      houdiniId: 'abc',
      depositAddress: 'bc1qdeposit',
      inAmount: 0.25,
      inSymbol: 'BTC',
      outAmount: 3.52,
      outSymbol: 'ETH',
      depositTag: 'memo123',
      status: 0,
      displayStatus: 'WAITING_FOR_DEPOSIT',
    });
    expect(o).toMatchObject({
      houdiniId: 'abc',
      depositAddress: 'bc1qdeposit',
      depositAmount: 0.25,
      depositTag: 'memo123',
      phase: 'waiting',
    });
  });
});

describe('mapMultiCreate', () => {
  it('splits per-order envelopes into order/error', () => {
    const r = mapMultiCreate({
      multiId: 'm1',
      orders: [
        { order: { houdiniId: 'o1', depositAddress: 'addr1', inAmount: 1, status: 0 } },
        { error: { message: 'quote failed' } },
      ],
    });
    expect(r.multiId).toBe('m1');
    expect(r.orders[0]!.order!.houdiniId).toBe('o1');
    expect(r.orders[1]!.error).toBe('quote failed');
  });
});

describe('mapMultiTx', () => {
  it('reads a Solana batch (base64) and an EVM batch (userOp)', () => {
    const sol = mapMultiTx({
      multiId: 'm1',
      chain: 'solana',
      transactions: [{ houdiniIds: ['o1', 'o2'], txData: { data: 'BASE64==' } }],
    });
    expect(sol.transactions[0]!.solanaBase64).toBe('BASE64==');
    expect(sol.transactions[0]!.evm).toBeUndefined();

    const evm = mapMultiTx({
      multiId: 'm2',
      chain: 'evm',
      transactions: [
        {
          houdiniIds: ['o3'],
          txData: { userOpHash: '0xhash', to: '0xto', data: '0xdata', value: '0', chainId: 1 },
        },
      ],
    });
    expect(evm.transactions[0]!.evm?.userOpHash).toBe('0xhash');
    expect(evm.transactions[0]!.solanaBase64).toBeUndefined();
  });
});
