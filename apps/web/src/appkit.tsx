import type { ReactNode } from "react";
import { createAppKit } from "@reown/appkit/react";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InjectedProvider } from "./wallet";

const projectId = String(import.meta.env.VITE_REOWN_PROJECT_ID || "").trim();
export const appKitEnabled = /^(1|true)$/i.test(String(import.meta.env.VITE_FEATURE_WALLET_APPKIT || "")) && Boolean(projectId);

const allNetworks: Record<string, AppKitNetwork> = {
  xlayer: { id: 196, chainNamespace: "eip155", caipNetworkId: "eip155:196", name: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } }, blockExplorers: { default: { name: "OKX Explorer", url: "https://www.okx.com/web3/explorer/xlayer" } } },
  base: { id: 8453, chainNamespace: "eip155", caipNetworkId: "eip155:8453", name: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://mainnet.base.org"] } }, blockExplorers: { default: { name: "BaseScan", url: "https://basescan.org" } } },
  arbitrum: { id: 42161, chainNamespace: "eip155", caipNetworkId: "eip155:42161", name: "Arbitrum One", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://arb1.arbitrum.io/rpc"] } }, blockExplorers: { default: { name: "Arbiscan", url: "https://arbiscan.io" } } },
  "arc-testnet": { id: 5042002, chainNamespace: "eip155", caipNetworkId: "eip155:5042002", name: "Arc Testnet", nativeCurrency: { name: "Test USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } }, testnet: true },
};
const requested = String(import.meta.env.VITE_ENABLED_NETWORKS || "xlayer").split(",").map((item) => item.trim()).filter(Boolean);
export const appKitNetworks = requested.map((key) => allNetworks[key]).filter(Boolean) as [AppKitNetwork, ...AppKitNetwork[]];
if (!appKitNetworks.length) appKitNetworks.push(allNetworks.xlayer);

const adapter = new WagmiAdapter({ projectId: projectId || "disabled", networks: appKitNetworks });
const queryClient = new QueryClient();
export const appKit = createAppKit({
  adapters: [adapter], networks: appKitNetworks, defaultNetwork: appKitNetworks[0], projectId: projectId || "disabled",
  metadata: { name: "PULSE", description: "Global and Prediction intelligence, wallet-signed Spot execution, and an independent guarded Autopilot.", url: window.location.origin, icons: [`${window.location.origin}/brand/logo.png`] },
  features: { analytics: false }, enableWallets: appKitEnabled,
});
if (appKitEnabled) {
  appKit.subscribeAccount((account) => {
    const target = window as Window & { __pulseAppKitProvider?: InjectedProvider };
    if (account?.isConnected) target.__pulseAppKitProvider = appKit.getWalletProvider() as InjectedProvider;
    else delete target.__pulseAppKitProvider;
  }, "eip155");
}

export function AppKitProvider({ children }: { children: ReactNode }) {
  return <WagmiProvider config={adapter.wagmiConfig}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></WagmiProvider>;
}

export function getAppKitProvider(): InjectedProvider | null {
  return appKitEnabled ? appKit.getWalletProvider() as InjectedProvider | null : null;
}

export async function connectAppKit(): Promise<{ address: string; providerName: string }> {
  if (!appKitEnabled) throw new Error("Reown AppKit is not configured");
  const current = appKit.getAccount("eip155");
  if (current?.isConnected && current.address) return { address: current.address, providerName: "Reown AppKit" };
  await appKit.open({ view: "Connect" });
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => { unsubscribe(); reject(new Error("Wallet connection timed out")); }, 120_000);
    const unsubscribe = appKit.subscribeAccount((account) => {
      if (account?.isConnected && account.address) {
        window.clearTimeout(timeout); unsubscribe();
        resolve({ address: account.address, providerName: "Reown AppKit" });
      }
    }, "eip155");
  });
}

export async function disconnectAppKit(): Promise<void> {
  if (appKitEnabled) await appKit.disconnect("eip155");
}
