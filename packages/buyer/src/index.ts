import { wrapFetchWithPaymentFromConfig } from "@okxweb3/x402-fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@okxweb3/x402-evm";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** X Layer mainnet — CAIP-2 eip155:196 */
export const xLayer = {
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.xlayer.tech"] },
  },
} as const;

export type BuyerConfig = {
  privateKey: string;
  rpcUrl?: string;
  network?: string;
};

type ClientEvmSigner = {
  readonly address: `0x${string}`;
  signTypedData(message: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
  readContract?(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
};

function buildSigner(privateKey: string, rpcUrl: string): ClientEvmSigner {
  const key = privateKey.startsWith("0x")
    ? (privateKey as Hex)
    : (`0x${privateKey}` as Hex);
  const account = privateKeyToAccount(key);
  const walletClient = createWalletClient({
    account,
    chain: xLayer,
    transport: http(rpcUrl),
  }) as WalletClient;
  const publicClient = createPublicClient({
    chain: xLayer,
    transport: http(rpcUrl),
  });

  void walletClient;
  return toClientEvmSigner(account as never, publicClient as never) as ClientEvmSigner;
}

/**
 * Create a fetch() that auto-handles HTTP 402 via OKX x402 (EIP-3009 exact scheme).
 * Used by E2E tests and server checkout (never ship PK to browser).
 */
export function createPaidFetch(cfg: BuyerConfig): typeof fetch {
  const rpc = cfg.rpcUrl || "https://rpc.xlayer.tech";
  const signer = buildSigner(cfg.privateKey, rpc);
  const network = (cfg.network || "eip155:196") as `${string}:${string}`;

  return wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network, client: new ExactEvmScheme(signer) }] }) as typeof fetch;
}

export function buyerAddress(privateKey: string): string {
  const key = privateKey.startsWith("0x")
    ? (privateKey as Hex)
    : (`0x${privateKey}` as Hex);
  return privateKeyToAccount(key).address;
}
