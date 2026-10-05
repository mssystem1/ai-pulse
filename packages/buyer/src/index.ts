import { wrapFetchWithPaymentFromConfig } from "@okxweb3/x402-fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@okxweb3/x402-evm";
import { getNetworkByCaip2 } from "@pulse/config";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { ExactEvmScheme as StandardExactEvmScheme } from "@x402/evm/exact/client";
import { BatchEvmScheme, CompositeEvmScheme } from "@circle-fin/x402-batching/client";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { memoryBuyerPaymentRecovery, recoverableArcBuyerFetch, type BuyerPaymentRecoveryStore } from "./paymentRecovery.js";
export type { BuyerPaymentRecoveryStore, BuyerPendingPayment } from "./paymentRecovery.js";

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
  maxPaymentUsd?: number;
  expectedPayTo?: string;
  fetchImpl?: typeof fetch;
  paymentRecoveryStore?: BuyerPaymentRecoveryStore;
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

function buildSigner(privateKey: string, rpcUrl: string, chain: typeof xLayer | { id: number; name: string; nativeCurrency: { name: string; symbol: string; decimals: number }; rpcUrls: { default: { http: string[] } } }): ClientEvmSigner {
  const key = privateKey.startsWith("0x")
    ? (privateKey as Hex)
    : (`0x${privateKey}` as Hex);
  const account = privateKeyToAccount(key);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  }) as WalletClient;
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  void walletClient;
  return toClientEvmSigner(account as never, publicClient as never) as ClientEvmSigner;
}

/**
 * Create a network-scoped paid fetch. Arc uses Circle Gateway nanopayments.
 * Used by E2E tests and server checkout (never ship PK to browser).
 */
export function createPaidFetch(cfg: BuyerConfig): typeof fetch {
  const network = (cfg.network || "eip155:196") as `${string}:${string}`;
  const selected = getNetworkByCaip2(network);
  if (!selected) throw new Error("Unsupported or retired payment network");
  if (cfg.maxPaymentUsd !== undefined && (!Number.isFinite(cfg.maxPaymentUsd) || cfg.maxPaymentUsd <= 0)) throw new Error("Payment budget must be positive");
  if (cfg.expectedPayTo !== undefined && !/^0x(?!0{40}$)[a-fA-F0-9]{40}$/.test(cfg.expectedPayTo)) throw new Error("Expected payment recipient must be a nonzero address");
  const rpc = cfg.rpcUrl || selected.rpcUrls[0];
  const chain = { id: selected.chainId, name: selected.label, nativeCurrency: selected.nativeAsset, rpcUrls: { default: { http: [rpc] } } };
  const signer = buildSigner(cfg.privateKey, rpc, chain);
  const fetchImpl = cfg.fetchImpl ?? fetch;
  if (selected.key === "xlayer") return wrapFetchWithPaymentFromConfig(fetchImpl, { schemes: [{ network, client: new ExactEvmScheme(signer) }] }) as typeof fetch;
  const exact = new StandardExactEvmScheme(signer as never);
  const scheme = selected.key === "arc" ? new CompositeEvmScheme(new BatchEvmScheme(signer as never), exact) : exact;
  const client = new x402HTTPClient(new x402Client().register(network, scheme as never));
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init);
    let resource = request.url;
    const url = new URL(resource);
    if (request.method === "POST" && url.pathname.replace(/\/$/, "") === `/${selected.key}/mcp`) {
      const call = await request.clone().json().catch(() => null) as { jsonrpc?: string; method?: string; params?: { name?: string } } | null;
      const routes: Record<string, string> = { preflight: "/v1/preflight", spot_analysis_standard: "/v1/analysis/spot/standard", spot_analysis_premium: "/v1/analysis/spot/premium",
        prediction_analysis_standard: "/v1/analysis/prediction/standard", prediction_analysis_premium: "/v1/analysis/prediction/premium",
        start_autopilot_24h: "/v1/autopilot/pass/24h", start_autopilot_7d: "/v1/autopilot/pass/7d", start_autopilot_30d: "/v1/autopilot/pass/30d" };
      const tool = call?.params?.name;
      if (call?.jsonrpc === "2.0" && call.method === "tools/call" && typeof tool === "string" && routes[tool]) resource = new URL(`/${selected.key}${routes[tool]}`, url.origin).href;
    }
    const authorize = async (first: Response) => {
      const body = await first.clone().json().catch(() => ({}));
      const required = client.getPaymentRequiredResponse(name => first.headers.get(name), body);
      const accepted = required.accepts;
      if (required.x402Version !== 2 || accepted.length !== 1) throw new Error("Ambiguous payment challenge");
      const payment = accepted[0];
      if (payment.scheme !== "exact" || payment.network !== network || payment.asset.toLowerCase() !== selected.paymentAsset.address?.toLowerCase()
        || !/^0x(?!0{40}$)[a-fA-F0-9]{40}$/.test(payment.payTo) || !/^[1-9][0-9]*$/.test(payment.amount)) throw new Error("Payment challenge does not match the selected network and asset");
      if (cfg.expectedPayTo && payment.payTo.toLowerCase() !== cfg.expectedPayTo.toLowerCase()) throw new Error("Payment recipient does not match the configured merchant");
      if (selected.key === "arc" && (payment.extra?.name !== "GatewayWalletBatched" || String(payment.extra?.version) !== "1"
        || String(payment.extra?.verifyingContract).toLowerCase() !== "0x77777777dcc4d5a8b6e418fd04d8997ef11000ee")) throw new Error("Wrong Arc mainnet Gateway signing domain");
      if (required.resource?.url !== resource) throw new Error("Payment resource does not match this request");
      if (cfg.maxPaymentUsd !== undefined && BigInt(payment.amount) > BigInt(Math.floor(cfg.maxPaymentUsd * 10 ** selected.paymentAsset.decimals))) throw new Error("Payment exceeds the configured budget");
      const headers = new Headers(client.encodePaymentSignatureHeader(await client.createPaymentPayload(required)));
      const header = headers.get("PAYMENT-SIGNATURE");
      if (!header) throw new Error("Payment signer did not return an authorization");
      return header;
    };
    if (selected.key === "arc" && request.method === "POST") return recoverableArcBuyerFetch({ request, resource, wallet: signer.address,
      store: cfg.paymentRecoveryStore || memoryBuyerPaymentRecovery, fetch: fetchImpl, authorize });
    const first = await fetchImpl(request.clone());
    if (first.status !== 402) return first;
    const headers = new Headers(request.headers); headers.set("PAYMENT-SIGNATURE", await authorize(first));
    return fetchImpl(new Request(request, { headers }));
  }) as typeof fetch;
}

export function buyerAddress(privateKey: string): string {
  const key = privateKey.startsWith("0x")
    ? (privateKey as Hex)
    : (`0x${privateKey}` as Hex);
  return privateKeyToAccount(key).address;
}
