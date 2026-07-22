import { createHmac } from "node:crypto";
import type { AppConfig } from "@pulse/config";

const CHAIN_ID = "196";
const NATIVE_OKB = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const USDT0 = "0x779ded0c9e1022225f8e0630b35a9b54be713736";

type OkxEnvelope = { code?: string; msg?: string; data?: unknown[] };

async function okxDexGetMany(
  cfg: AppConfig,
  path: string,
  params: Record<string, string>,
  timeoutMs = 12_000,
): Promise<Record<string, unknown>[]> {
  if (!cfg.hasOkxCredentials) {
    throw new Error("OKX DEX credentials are not configured");
  }
  const query = `?${new URLSearchParams(params)}`;
  const timestamp = new Date().toISOString();
  const signature = createHmac("sha256", cfg.OKX_SECRET_KEY)
    .update(`${timestamp}GET${path}${query}`)
    .digest("base64");
  const response = await fetch(`${cfg.OKX_BASE_URL.replace(/\/$/, "")}${path}${query}`, {
    headers: {
      "OK-ACCESS-KEY": cfg.OKX_API_KEY,
      "OK-ACCESS-SIGN": signature,
      "OK-ACCESS-PASSPHRASE": cfg.OKX_PASSPHRASE,
      "OK-ACCESS-TIMESTAMP": timestamp,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.json().catch(() => ({}))) as OkxEnvelope;
  if (!response.ok || body.code !== "0" || !Array.isArray(body.data)) {
    throw new Error(`OKX DEX ${body.msg || `HTTP ${response.status}`}`);
  }
  return body.data as Record<string, unknown>[];
}

async function okxDexGet(
  cfg: AppConfig,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const data = await okxDexGetMany(cfg, path, params);
  if (!data[0]) throw new Error("OKX DEX returned no data");
  return data[0];
}

function routeNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => {
    const protocol = (item as { dexProtocol?: { dexName?: unknown } })?.dexProtocol;
    return typeof protocol?.dexName === "string" ? protocol.dexName : "";
  }).filter(Boolean))];
}

function quoteSummary(raw: Record<string, unknown>) {
  const fromToken = raw.fromToken as Record<string, unknown> | undefined;
  const toToken = raw.toToken as Record<string, unknown> | undefined;
  return {
    chainId: CHAIN_ID,
    fromTokenAmount: String(raw.fromTokenAmount ?? "0"),
    toTokenAmount: String(raw.toTokenAmount ?? "0"),
    fromSymbol: String(fromToken?.tokenSymbol ?? "OKB"),
    toSymbol: String(toToken?.tokenSymbol ?? "USDT0"),
    priceImpactPercent: String(raw.priceImpactPercent ?? "0"),
    estimateGas: String(raw.estimateGasFee ?? "0"),
    tradeFee: String(raw.tradeFee ?? "0"),
    route: routeNames(raw.dexRouterList),
    quoteId: String(raw.quoteId ?? ""),
  };
}

export async function getOkbUsdt0Quote(cfg: AppConfig, amount: string) {
  const raw = await okxDexGet(cfg, "/api/v6/dex/aggregator/quote", {
    chainIndex: CHAIN_ID,
    fromTokenAddress: NATIVE_OKB,
    toTokenAddress: USDT0,
    amount,
    swapMode: "exactIn",
  });
  return quoteSummary(raw);
}

export async function getOkbUsdt0Swap(
  cfg: AppConfig,
  amount: string,
  userWalletAddress: string,
  slippagePercent: string,
) {
  const raw = await okxDexGet(cfg, "/api/v6/dex/aggregator/swap", {
    chainIndex: CHAIN_ID,
    fromTokenAddress: NATIVE_OKB,
    toTokenAddress: USDT0,
    amount,
    swapMode: "exactIn",
    slippagePercent,
    userWalletAddress,
  });
  const tx = raw.tx as Record<string, unknown> | undefined;
  const router = raw.routerResult as Record<string, unknown> | undefined;
  if (!tx || typeof tx.to !== "string" || typeof tx.data !== "string") {
    throw new Error("OKX DEX returned no executable transaction");
  }
  return {
    quote: router ? quoteSummary(router) : null,
    tx: {
      from: String(tx.from ?? userWalletAddress),
      to: tx.to,
      data: tx.data,
      value: String(tx.value ?? "0"),
      gas: String(tx.gas ?? "0"),
      gasPrice: String(tx.gasPrice ?? "0"),
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas == null
        ? null
        : String(tx.maxPriorityFeePerGas),
    },
  };
}

export async function getXLayerOkxTokens(
  cfg: AppConfig,
  search: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const requested = Math.min(Math.max(limit, 1), 100);
  const normalizedSearch = search.trim();
  const catalogRequest = okxDexGetMany(cfg, "/api/v6/dex/aggregator/all-tokens", {
    chainIndex: CHAIN_ID,
  });
  const marketRequest = (normalizedSearch
      ? okxDexGetMany(cfg, "/api/v6/dex/market/token/search", {
          chains: CHAIN_ID,
          search: normalizedSearch,
          limit: String(requested),
        }, 3_500)
      : okxDexGetMany(cfg, "/api/v6/dex/market/token/hot-token", {
          rankingType: "4",
          chainIndex: CHAIN_ID,
          rankingTimeFrame: "4",
          riskFilter: "false",
          stableTokenFilter: "false",
          limit: String(requested),
        }, 3_500))
    .catch(() => [] as Record<string, unknown>[]);
  const [catalog, market] = await Promise.all([catalogRequest, marketRequest]);

  const query = normalizedSearch.toLowerCase();
  const filteredCatalog = catalog.filter((item) => {
    if (!query) return true;
    return [item.tokenSymbol, item.tokenName, item.tokenContractAddress]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
  return [...market, ...filteredCatalog].slice(0, requested * 2);
}
