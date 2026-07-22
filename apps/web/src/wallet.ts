const X_LAYER_ID = 196;
const X_LAYER_HEX = "0xc4"; // 196
const WALLET_DISCONNECTED_KEY = "pulse.wallet.disconnected";

export type InjectedProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void> | void;
  chainId?: string;
  selectedAddress?: string | null;
  isOkxWallet?: boolean;
  isMetaMask?: boolean;
};

declare global {
  interface Window {
    ethereum?: InjectedProvider;
    okxwallet?: InjectedProvider;
  }
}

export const xLayer = {
  id: X_LAYER_ID,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } },
} as const;

export function getInjectedProvider(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  // Prefer OKX Wallet when available
  if (window.okxwallet) return window.okxwallet;
  if (window.ethereum) return window.ethereum;
  return null;
}

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function walletProviderName(provider: InjectedProvider): string {
  return provider.isOkxWallet
    ? "OKX Wallet"
    : provider.isMetaMask
      ? "MetaMask"
      : "Browser wallet";
}

export function wasWalletDisconnected(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(WALLET_DISCONNECTED_KEY) === "1";
}

export function clearWalletDisconnected(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(WALLET_DISCONNECTED_KEY);
}

/**
 * EIP-1193 has no universal disconnect method. Persist the user's app-level
 * choice and also revoke account permissions when the wallet supports it.
 */
export async function disconnectWallet(): Promise<void> {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(WALLET_DISCONNECTED_KEY, "1");
  }
  const provider = getInjectedProvider();
  if (!provider) return;

  try {
    await provider.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch {
    // Not every injected wallet implements EIP-2255 permission revocation.
  }

  try {
    await provider.disconnect?.();
  } catch {
    // App-level disconnect above remains authoritative.
  }
}

export async function connectWallet(): Promise<{ address: string; providerName: string }> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error(
      "No wallet found. Install OKX Wallet (recommended) or MetaMask, then refresh.",
    );
  }

  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("Wallet returned no account");

  // Switch / add X Layer (eip155:196)
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: X_LAYER_HEX }],
    });
  } catch (e: unknown) {
    const code = (e as { code?: number })?.code;
    if (code === 4902 || code === -32603) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: X_LAYER_HEX,
            chainName: "X Layer",
            nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
            rpcUrls: ["https://rpc.xlayer.tech"],
            blockExplorerUrls: ["https://www.okx.com/web3/explorer/xlayer"],
          },
        ],
      });
    } else if (code !== 4001) {
      // user rejection or other — continue; pay may still fail if wrong chain
      console.warn("chain switch:", e);
    }
  }

  const providerName = walletProviderName(provider);

  return { address, providerName };
}

/**
 * Browser x402 pay: user signs EIP-3009 auth with their wallet; no server private key.
 */
export async function createWalletPaidFetch(userAddress: string): Promise<typeof fetch> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("Wallet not connected");

  const [{ wrapFetchWithPaymentFromConfig }, { ExactEvmScheme }, { createWalletClient, custom }] =
    await Promise.all([
      import("@okxweb3/x402-fetch"),
      import("@okxweb3/x402-evm"),
      import("viem"),
    ]);

  const account = userAddress as `0x${string}`;
  const walletClient = createWalletClient({
    account,
    chain: xLayer,
    transport: custom(provider as never),
  });

  const signer = {
    address: account,
    async signTypedData(params: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) {
      return (walletClient as unknown as {
        signTypedData: (a: unknown) => Promise<`0x${string}`>;
      }).signTypedData({
        account,
        domain: params.domain,
        types: params.types,
        primaryType: params.primaryType,
        message: params.message,
      });
    },
  };

  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: "eip155:196",
        client: new ExactEvmScheme(signer),
      },
    ],
  }) as typeof fetch;
}
