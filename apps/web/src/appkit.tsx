import type { ReactNode } from "react";
import { createAppKit } from "@reown/appkit/react";
import { appKitNetworks } from "./appkitNetworks";
import { WEB_NETWORKS, type WebNetworkKey } from "./networks";
export { appKitNetworks } from "./appkitNetworks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InjectedProvider } from "./wallet";

const projectId = String(import.meta.env.VITE_REOWN_PROJECT_ID || "").trim();
export const appKitEnabled = /^(1|true)$/i.test(String(import.meta.env.VITE_FEATURE_WALLET_APPKIT || "")) && Boolean(projectId);

const adapter = new WagmiAdapter({ projectId: projectId || "disabled", networks: appKitNetworks });
const queryClient = new QueryClient();
export const appKit = createAppKit({
  adapters: [adapter], networks: appKitNetworks, defaultNetwork: appKitNetworks[0], projectId: projectId || "disabled",
  metadata: { name: "PULSE", description: "Global and Prediction intelligence, wallet-signed Spot execution, and an independent guarded Autopilot.", url: window.location.origin, icons: [`${window.location.origin}/brand/logo.png`] },
  features: { analytics: false }, enableWallets: appKitEnabled,
});
if (appKitEnabled) {
  appKit.subscribeNetwork((network) => {
    window.dispatchEvent(new CustomEvent("pulse:wallet-network-changed", { detail: { chainId: network.chainId } }));
  });
  appKit.subscribeAccount((account) => {
    const target = window as Window & { __pulseAppKitProvider?: InjectedProvider };
    if (account?.isConnected) target.__pulseAppKitProvider = appKit.getWalletProvider() as InjectedProvider;
    else delete target.__pulseAppKitProvider;
    window.dispatchEvent(new CustomEvent("pulse:wallet-session-changed", { detail: { connected: Boolean(account?.isConnected) } }));
  }, "eip155");
}

export function AppKitProvider({ children }: { children: ReactNode }) {
  return <WagmiProvider config={adapter.wagmiConfig}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></WagmiProvider>;
}

export function getAppKitProvider(): InjectedProvider | null {
  return appKitEnabled ? appKit.getWalletProvider() as InjectedProvider | null : null;
}

export async function selectAppKitNetwork(key: WebNetworkKey, onlyDisconnected = false): Promise<void> {
  if (!appKitEnabled || (onlyDisconnected && appKit.getAccount("eip155")?.isConnected)) return;
  const network = appKitNetworks.find(chain => chain.id === WEB_NETWORKS[key].chainId);
  if (!network) throw new Error(`${WEB_NETWORKS[key].label} is not enabled in the wallet kit`);
  if (appKit.getCaipNetwork()?.id !== network.id) await appKit.switchNetwork(network, { throwOnFailure: true });
}

export async function connectAppKit(preferred?: WebNetworkKey): Promise<{ address: string; providerName: string }> {
  if (!appKitEnabled) throw new Error("Reown AppKit is not configured");
  if (preferred) await selectAppKitNetwork(preferred);
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
