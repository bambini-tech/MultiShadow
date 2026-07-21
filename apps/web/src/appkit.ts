/**
 * Reown AppKit (WalletConnect successor) wiring for the SOURCE Solana wallet.
 *
 * Only the source wallet connects/signs. Recipients are just addresses (any
 * chain), so no EVM adapter is required here — an EVM adapter can be added to
 * `adapters` later if a future feature needs the user's EVM wallet.
 *
 * The rest of the app depends on the narrow `SolanaWallet` interface (./wallet),
 * so Reown's concrete provider shape is isolated to this file.
 */
import { createAppKit } from '@reown/appkit';
import { solana } from '@reown/appkit/networks';
import { SolanaAdapter } from '@reown/appkit-adapter-solana';
import type { Transaction } from '@solana/web3.js';
import { config, metadata } from './config.js';
import type { SolanaWallet } from './wallet.js';

/** Minimal shape we rely on from the Reown Solana wallet provider. */
interface SolanaProvider {
  signAndSendTransaction?: (tx: Transaction) => Promise<{ signature: string } | string>;
  sendTransaction?: (tx: Transaction) => Promise<string>;
}

export function createWallet(): SolanaWallet {
  const solanaAdapter = new SolanaAdapter();

  const appKit = createAppKit({
    adapters: [solanaAdapter],
    networks: [solana],
    projectId: config.reownProjectId,
    metadata,
    features: { analytics: false },
  });

  // `appKit` exposes untyped-ish helpers across versions; access them narrowly.
  const kit = appKit as unknown as {
    getAddress?: () => string | undefined;
    getIsConnectedState?: () => boolean;
    getWalletProvider?: () => unknown;
    subscribeAccount?: (cb: (acc: { address?: string; isConnected?: boolean }) => void) => void;
    open: () => void;
    disconnect: () => Promise<void>;
  };

  let address: string | undefined = kit.getAddress?.();
  let connected = Boolean(kit.getIsConnectedState?.());
  const listeners = new Set<(addr: string | undefined) => void>();

  kit.subscribeAccount?.((acc) => {
    address = acc.address;
    connected = Boolean(acc.isConnected && acc.address);
    for (const l of listeners) l(connected ? address : undefined);
  });

  return {
    isConnected: () => connected,
    getAddress: () => (connected ? address : undefined),
    open: () => kit.open(),
    disconnect: () => kit.disconnect(),
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async signAndSendTransaction(tx: Transaction): Promise<string> {
      const provider = kit.getWalletProvider?.() as SolanaProvider | undefined;
      if (!provider) throw new Error('No wallet provider available. Is a wallet connected?');
      if (provider.signAndSendTransaction) {
        const res = await provider.signAndSendTransaction(tx);
        return typeof res === 'string' ? res : res.signature;
      }
      if (provider.sendTransaction) {
        return provider.sendTransaction(tx);
      }
      throw new Error('Connected wallet does not support signing Solana transactions.');
    },
  };
}
