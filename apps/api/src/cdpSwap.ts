import { randomUUID } from "node:crypto";
import type { AppConfig } from "@pulse/config";
import { getNetwork, type NetworkKey } from "@pulse/config";
import { createCdpJwt } from "@pulse/payments";

const API_URL = "https://api.cdp.coinbase.com/platform/v2/evm/swaps";
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export type CdpSwapQuote = {
  network: "base" | "arbitrum"; fromAmount: string; toAmount: string; minToAmount: string;
  toToken: string; liquidityAvailable: boolean; blockNumber: string;
  transaction: { to: string; data: string; value: string; gas: string; gasPrice: string };
};

export async function getCdpNativeUsdcSwap(cfg: AppConfig, key: Extract<NetworkKey, "base" | "arbitrum">, amount: string, taker: string): Promise<CdpSwapQuote> {
  if (!cfg.CDP_API_KEY_ID || !cfg.CDP_API_KEY_SECRET) throw new Error("CDP Trade API credentials are not configured");
  const network = getNetwork(key);
  if (!network.paymentAsset.address) throw new Error(`Native USDC is not configured for ${key}`);
  const usdcAddress = network.paymentAsset.address;
  const parsed = new URL(API_URL);
  const jwt = await createCdpJwt({ keyId: cfg.CDP_API_KEY_ID, keySecret: cfg.CDP_API_KEY_SECRET, method: "POST", host: parsed.host, path: parsed.pathname });
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", "X-Idempotency-Key": randomUUID() },
    body: JSON.stringify({ network: key, fromToken: NATIVE, toToken: usdcAddress, fromAmount: amount, taker, slippageBps: 50 }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({})) as Partial<CdpSwapQuote> & { message?: string; error?: string };
  if (!response.ok) throw new Error(body.message || body.error || `CDP Trade API HTTP ${response.status}`);
  if (!body.liquidityAvailable || !body.transaction) throw new Error("No CDP swap liquidity is available for this amount");
  const tx = body.transaction;
  if (!/^0x[a-fA-F0-9]{40}$/.test(tx.to || "") || !/^0x[a-fA-F0-9]*$/.test(tx.data || "")) throw new Error("CDP returned an invalid transaction");
  if (BigInt(tx.value || "0") !== BigInt(amount)) throw new Error("CDP transaction amount mismatch");
  if ((body.toToken || "").toLowerCase() !== usdcAddress.toLowerCase()) throw new Error("CDP quote output token mismatch");
  return { ...(body as CdpSwapQuote), network: key };
}
