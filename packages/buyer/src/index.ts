import { wrapFetchWithPaymentFromConfig } from "@okxweb3/x402-fetch";
import { ExactEvmScheme } from "@okxweb3/x402-evm";
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

  return {
    address: account.address,
    async signTypedData(params) {
      // TypedData shapes come from x402 facilitator; cast for viem
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
    async readContract(args) {
      return (publicClient as unknown as {
        readContract: (a: unknown) => Promise<unknown>;
      }).readContract({
        address: args.address,
        abi: args.abi,
        functionName: args.functionName,
        args: args.args,
      });
    },
  };
}

/**
 * Create a fetch() that auto-handles HTTP 402 via OKX x402 (EIP-3009 exact scheme).
 * Used by E2E tests and server checkout (never ship PK to browser).
 */
export function createPaidFetch(cfg: BuyerConfig): typeof fetch {
  const rpc = cfg.rpcUrl || "https://rpc.xlayer.tech";
  const signer = buildSigner(cfg.privateKey, rpc);
  const network = (cfg.network || "eip155:196") as `${string}:${string}`;

  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network,
        client: new ExactEvmScheme(signer),
      },
    ],
  }) as typeof fetch;
}

export function buyerAddress(privateKey: string): string {
  const key = privateKey.startsWith("0x")
    ? (privateKey as Hex)
    : (`0x${privateKey}` as Hex);
  return privateKeyToAccount(key).address;
}
