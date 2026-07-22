/**
 * Reown AppKit (WalletConnect successor) wiring for the SOURCE wallet.
 *
 * MultiShadow funds each private swap from ONE source wallet. That source can be
 * Solana or any major EVM chain, so we register both a Solana and an EVM
 * (ethers) adapter. AppKit's modal then lets the user connect whichever wallet
 * matches their chosen source token, and the app signs on the active namespace.
 *
 * Reown's concrete provider shapes are isolated to this file behind the narrow
 * `Wallet` interface (./wallet).
 */
import { createAppKit } from '@reown/appkit';
import {
  solana,
  mainnet,
  bsc,
  polygon,
  arbitrum,
  base,
  optimism,
  avalanche,
} from '@reown/appkit/networks';
import type { AppKitNetwork } from '@reown/appkit/networks';
import { SolanaAdapter } from '@reown/appkit-adapter-solana';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { BrowserProvider, type Eip1193Provider } from 'ethers';
import type { Transaction } from '@solana/web3.js';
import { config, metadata } from './config.js';
import type { EvmSendRequest, Wallet, WalletKind } from './wallet.js';

/** Minimal shape we rely on from the Reown Solana wallet provider. */
interface SolanaProvider {
  signAndSendTransaction?: (tx: Transaction) => Promise<{ signature: string } | string>;
  sendTransaction?: (tx: Transaction) => Promise<string>;
}

/** EVM networks we let the source wallet switch to, keyed by numeric chain id. */
const EVM_NETWORKS: AppKitNetwork[] = [mainnet, bsc, polygon, arbitrum, base, optimism, avalanche];
const EVM_BY_ID = new Map<number, AppKitNetwork>(EVM_NETWORKS.map((n) => [Number(n.id), n]));

export function createWallet(): Wallet {
  const solanaAdapter = new SolanaAdapter();
  const ethersAdapter = new EthersAdapter();

  const appKit = createAppKit({
    adapters: [solanaAdapter, ethersAdapter],
    // At least one EVM network + Solana. Order: Solana first so it stays the
    // default source (the app's primary flow), EVM chains available on demand.
    networks: [solana, ...EVM_NETWORKS] as [AppKitNetwork, ...AppKitNetwork[]],
    projectId: config.reownProjectId,
    metadata,
    features: { analytics: false },
  });

  // `appKit` exposes untyped-ish helpers across versions; access them narrowly.
  const kit = appKit as unknown as {
    getAddress?: (namespace?: string) => string | undefined;
    getIsConnectedState?: () => boolean;
    getActiveChainNamespace?: () => string | undefined;
    getProvider?: <T>(namespace: string) => T | undefined;
    getWalletProvider?: () => unknown;
    subscribeAccount?: (
      cb: (acc: { address?: string; isConnected?: boolean }) => void,
      namespace?: string,
    ) => void;
    switchNetwork?: (network: AppKitNetwork) => Promise<void>;
    open: () => void;
    disconnect: () => Promise<void>;
  };

  const namespaceToKind = (ns: string | undefined): WalletKind | undefined =>
    ns === 'solana' ? 'solana' : ns === 'eip155' ? 'evm' : undefined;

  let kind: WalletKind | undefined = namespaceToKind(kit.getActiveChainNamespace?.());
  let address: string | undefined = kit.getAddress?.();
  let connected = Boolean(kit.getIsConnectedState?.());
  const listeners = new Set<(s: { address?: string; kind?: WalletKind }) => void>();

  const emit = (): void => {
    for (const l of listeners) l({ address: connected ? address : undefined, kind });
  };

  const onAccount = (acc: { address?: string; isConnected?: boolean }): void => {
    kind = namespaceToKind(kit.getActiveChainNamespace?.());
    address = acc.address;
    connected = Boolean(acc.isConnected && acc.address);
    emit();
  };
  // Watch both namespaces so a source switch (SOL ↔ EVM) is reflected.
  kit.subscribeAccount?.(onAccount, 'solana');
  kit.subscribeAccount?.(onAccount, 'eip155');
  kit.subscribeAccount?.(onAccount);

  const getEvmProvider = (): Eip1193Provider => {
    const provider =
      kit.getProvider?.<Eip1193Provider>('eip155') ??
      (kit.getWalletProvider?.() as Eip1193Provider | undefined);
    if (!provider)
      throw new Error('No EVM wallet connected. Connect an EVM wallet for this source.');
    return provider;
  };

  return {
    isConnected: () => connected,
    getAddress: () => (connected ? address : undefined),
    getKind: () => (connected ? kind : undefined),
    open: () => kit.open(),
    disconnect: () => kit.disconnect(),
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async signAndSendSolana(tx: Transaction): Promise<string> {
      const provider =
        kit.getProvider?.<SolanaProvider>('solana') ??
        (kit.getWalletProvider?.() as SolanaProvider | undefined);
      if (!provider) throw new Error('No Solana wallet connected. Connect a Solana wallet.');
      if (provider.signAndSendTransaction) {
        const res = await provider.signAndSendTransaction(tx);
        return typeof res === 'string' ? res : res.signature;
      }
      if (provider.sendTransaction) return provider.sendTransaction(tx);
      throw new Error('Connected wallet does not support signing Solana transactions.');
    },

    async switchEvmChain(chainId: number): Promise<void> {
      const network = EVM_BY_ID.get(chainId);
      if (!network) {
        throw new Error(`Source chain ${chainId} is not enabled in the wallet configuration.`);
      }
      await kit.switchNetwork?.(network);
    },

    async sendEvm(req: EvmSendRequest): Promise<string> {
      const browser = new BrowserProvider(getEvmProvider());
      const signer = await browser.getSigner();
      const tx = await signer.sendTransaction({
        to: req.to,
        ...(req.valueWei !== undefined ? { value: req.valueWei } : {}),
        ...(req.data ? { data: req.data } : {}),
      });
      return tx.hash;
    },
  };
}
