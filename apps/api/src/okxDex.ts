import { createHmac } from "node:crypto";
import type { AppConfig } from "@pulse/config";

const CHAIN_ID = "196";
const NATIVE_OKB = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const USDT0 = "0x779ded0c9e1022225f8e0630b35a9b54be713736";

type OkxEnvelope = { code?: string; msg?: string; data?: unknown[] };

export function createOkxSignature(
  secretKey: string,
  timestamp: string,
  method: "GET" | "POST",
  requestPath: string,
  body = "",
): string {
  return createHmac("sha256", secretKey)
    .update(`${timestamp}${method}${requestPath}${body}`)
    .digest("base64");
}

export function createOkxDexHeaders(
  cfg: Pick<AppConfig, "OKX_API_KEY" | "OKX_SECRET_KEY" | "OKX_PASSPHRASE">,
  timestamp: string,
  method: "GET" | "POST",
  requestPath: string,
  body = "",
): Record<string, string> {
  return {
    "OK-ACCESS-KEY": cfg.OKX_API_KEY.trim(),
    "OK-ACCESS-SIGN": createOkxSignature(cfg.OKX_SECRET_KEY.trim(), timestamp, method, requestPath, body),
    "OK-ACCESS-PASSPHRASE": cfg.OKX_PASSPHRASE.trim(),
    "OK-ACCESS-TIMESTAMP": timestamp,
    Accept: "application/json",
  };
}

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
  const requestPath = `${path}${query}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const timestamp = new Date().toISOString();
      const response = await fetch(`${cfg.OKX_BASE_URL.replace(/\/$/, "")}${path}${query}`, {
        headers: createOkxDexHeaders(cfg, timestamp, "GET", requestPath),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = (await response.json().catch(() => ({}))) as OkxEnvelope;
      if (response.ok && body.code === "0" && Array.isArray(body.data))
        return body.data as Record<string, unknown>[];
      const providerCode = body.code ? ` code=${body.code}` : "";
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500 || ["50011", "50040", "50061"].includes(String(body.code || ""));
      const error = Object.assign(new Error(`OKX DEX upstream HTTP ${response.status}${providerCode}: ${body.msg || "unexpected response"}`), { retryable });
      if (!retryable || attempt === 2) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if ((error as { retryable?: boolean }).retryable === false || attempt === 2) throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error("OKX DEX request failed");
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

export type GenericDexRequest = {
  chainId: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
  userWalletAddress?: string;
  slippagePercent?: string;
  autoSlippage?: boolean;
  maxAutoSlippagePercent?: string | number;
};

export type DefiOpportunity = {
  investmentId: string;
  name: string;
  protocol: string;
  apyPercent: number;
  tvlUsd: number;
  chainId: string;
  productGroup: string;
  tokenSymbol: string;
  tokenAddress: string;
  investable: boolean;
  redeemable: boolean;
  claimable: boolean;
  feePercent: number | null;
  score: number;
  riskFlags: string[];
  source: "OKX Onchain OS DeFi API";
};

async function getOkxDefiProductDetail(cfg: AppConfig, investmentId: string) {
  const path = "/api/v6/defi/product/detail";
  const query = `?${new URLSearchParams({ investmentId })}`;
  const timestamp = new Date().toISOString();
  const response = await fetch(`${cfg.OKX_BASE_URL.replace(/\/$/, "")}${path}${query}`, {
    headers: createOkxDexHeaders(cfg, timestamp, "GET", `${path}${query}`), signal: AbortSignal.timeout(10_000),
  });
  const envelope = await response.json().catch(() => ({})) as { code?: string | number; msg?: string; data?: Record<string, unknown> };
  if (!response.ok || String(envelope.code) !== "0" || !envelope.data) throw new Error(`OKX DeFi detail unavailable for ${investmentId}: ${envelope.msg || response.status}`);
  return envelope.data;
}

export function matchesUnderlyingToken(
  entry: Record<string, unknown>,
  tokenSymbol: string,
  expectedTokenAddress?: string,
): boolean {
  if (expectedTokenAddress) {
    return String(entry.tokenAddress || "").toLowerCase() === expectedTokenAddress.toLowerCase();
  }
  return String(entry.tokenSymbol || "").toUpperCase() === tokenSymbol.toUpperCase();
}

/** Live selected-chain DeFi discovery, verified against the execution token contract. */
export async function searchOkxDefiOpportunities(cfg: AppConfig, tokenSymbol: string, chainId: string, expectedTokenAddress?: string): Promise<DefiOpportunity[]> {
  if (!cfg.hasOkxCredentials) throw new Error("OKX DeFi credentials are not configured");
  const path = "/api/v6/defi/product/search";
  const groups = ["SINGLE_EARN", "LENDING", "DEX_POOL"];
  const searchResults = await Promise.allSettled(groups.map(async (productGroup) => {
    const requestBody = JSON.stringify({ tokenKeywordList: [tokenSymbol], chainIndex: chainId, productGroup, pageNum: 1 });
    const timestamp = new Date().toISOString();
    const response = await fetch(`${cfg.OKX_BASE_URL.replace(/\/$/, "")}${path}`, {
      method: "POST", headers: { ...createOkxDexHeaders(cfg, timestamp, "POST", path, requestBody), "Content-Type": "application/json" }, body: requestBody, signal: AbortSignal.timeout(12_000),
    });
    const envelope = await response.json().catch(() => ({})) as { code?: string | number; msg?: string; data?: { list?: Array<Record<string, unknown>> } };
    if (!response.ok || String(envelope.code) !== "0" || !Array.isArray(envelope.data?.list)) throw new Error(`OKX DeFi ${productGroup} search failed: ${envelope.msg || response.status}`);
    return envelope.data.list.map((item) => ({ ...item, productGroup: String(item.productGroup || productGroup) }) as Record<string, unknown>);
  }));
  const searches = searchResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (!searches.length) throw new Error("All OKX DeFi product groups were temporarily unavailable");
  const candidates = [...new Map(searches.flat()
    .filter((item) => String(item.chainIndex || chainId) === chainId && item.investmentId != null)
    .map((item) => [String(item.investmentId), item])).values()]
    .sort((a, b) => Number(b.tvl || 0) - Number(a.tvl || 0)).slice(0, 12);
  const expected = expectedTokenAddress?.toLowerCase();
  const detailed = await Promise.all(candidates.map(async (item) => ({ item, detail: await getOkxDefiProductDetail(cfg, String(item.investmentId)).catch(() => null) })));
  return detailed.flatMap(({ item, detail }) => {
    if (!detail || String(detail.chainIndex || chainId) !== chainId) return [];
    const underlying = Array.isArray(detail.underlyingToken) ? detail.underlyingToken as Array<Record<string, unknown>> : [];
    const token = underlying.find((entry) => matchesUnderlyingToken(entry, tokenSymbol, expected));
    if (!token) return [];
    const apyPercent = Number(detail.rate ?? item.rate ?? 0) * 100;
    const tvlUsd = Number(detail.tvl ?? item.tvl ?? 0);
    const investable = detail.isInvestable === true;
    const redeemable = detail.isSupportRedeem === true;
    const claimable = detail.isSupportClaim === true;
    const riskFlags = ["variable_apy", ...(!investable ? ["not_currently_investable"] : []), ...(!redeemable ? ["no_direct_redeem"] : []), ...(tvlUsd < 100_000 ? ["low_tvl"] : []), ...(apyPercent > 100 ? ["extreme_observed_apy"] : [])];
    const feeRaw = detail.feeRate ?? item.feeRate;
    const feePercent = feeRaw == null || feeRaw === "" ? null : Number(feeRaw) * 100;
    const score = Math.round((Math.min(20, Math.max(0, apyPercent)) + Math.min(35, Math.log10(Math.max(1, tvlUsd)) * 4) + (investable ? 20 : 0) + (redeemable ? 15 : 0) + (claimable ? 5 : 0) - (riskFlags.includes("extreme_observed_apy") ? 20 : 0)) * 10) / 10;
    return [{ investmentId: String(item.investmentId), name: String(detail.investmentName ?? item.name ?? tokenSymbol), protocol: String(detail.platformName ?? item.platformName ?? "Unknown protocol"), apyPercent, tvlUsd, chainId, productGroup: String(item.productGroup ?? "UNKNOWN"), tokenSymbol: String(token.tokenSymbol || tokenSymbol), tokenAddress: String(token.tokenAddress || expectedTokenAddress || ""), investable, redeemable, claimable, feePercent: Number.isFinite(feePercent) ? feePercent : null, score, riskFlags, source: "OKX Onchain OS DeFi API" as const }];
  }).filter((item) => Number.isFinite(item.apyPercent) && Number.isFinite(item.tvlUsd)).sort((a, b) => b.score - a.score).slice(0, 3);
}

function genericQuoteSummary(raw: Record<string, unknown>, chainId: string) {
  const fromToken = raw.fromToken as Record<string, unknown> | undefined;
  const toToken = raw.toToken as Record<string, unknown> | undefined;
  return {
    chainId,
    fromTokenAmount: String(raw.fromTokenAmount ?? "0"),
    toTokenAmount: String(raw.toTokenAmount ?? "0"),
    fromToken: {
      address: String(fromToken?.tokenContractAddress ?? ""),
      symbol: String(fromToken?.tokenSymbol ?? "TOKEN"),
      decimals: Number(fromToken?.decimal ?? 18),
    },
    toToken: {
      address: String(toToken?.tokenContractAddress ?? ""),
      symbol: String(toToken?.tokenSymbol ?? "TOKEN"),
      decimals: Number(toToken?.decimal ?? 18),
    },
    priceImpactPercent: String(raw.priceImpactPercent ?? "0"),
    estimateGasFee: String(raw.estimateGasFee ?? "0"),
    tradeFee: String(raw.tradeFee ?? "0"),
    route: routeNames(raw.dexRouterList),
    quoteId: String(raw.quoteId ?? ""),
  };
}

/** Live Onchain OS quote for any exact token pair supported by its chain router. */
export async function getGenericOkxQuote(cfg: AppConfig, input: GenericDexRequest) {
  const raw = await okxDexGet(cfg, "/api/v6/dex/aggregator/quote", {
    chainIndex: input.chainId,
    fromTokenAddress: input.fromTokenAddress,
    toTokenAddress: input.toTokenAddress,
    amount: input.amount,
    swapMode: "exactIn",
  });
  return genericQuoteSummary(raw, input.chainId);
}

/** Prepare, but never broadcast, a live Onchain OS swap for the connected wallet. */
export async function getGenericOkxSwap(cfg: AppConfig, input: GenericDexRequest & { userWalletAddress: string }) {
  const raw = await okxDexGet(cfg, "/api/v6/dex/aggregator/swap", {
    chainIndex: input.chainId,
    fromTokenAddress: input.fromTokenAddress,
    toTokenAddress: input.toTokenAddress,
    amount: input.amount,
    swapMode: "exactIn",
    // Onchain OS v6 requires a concrete slippagePercent. PULSE may calculate
    // that value automatically, but the value submitted to OKX is explicit.
    slippagePercent: input.slippagePercent || "0.5",
    userWalletAddress: input.userWalletAddress,
  });
  const tx = raw.tx as Record<string, unknown> | undefined;
  const router = raw.routerResult as Record<string, unknown> | undefined;
  if (!tx || typeof tx.to !== "string" || typeof tx.data !== "string") {
    throw new Error("OKX Onchain OS returned no executable transaction");
  }
  return {
    quote: router ? genericQuoteSummary(router, input.chainId) : null,
    tx: {
      from: String(tx.from ?? input.userWalletAddress),
      to: tx.to,
      data: tx.data,
      value: String(tx.value ?? "0"),
      gas: String(tx.gas ?? "0"),
      gasPrice: String(tx.gasPrice ?? "0"),
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas == null ? null : String(tx.maxPriorityFeePerGas),
    },
    slippage: {
      mode: input.autoSlippage ? "auto" : "manual",
      percent: String(router?.slippagePercent ?? raw.slippagePercent ?? input.slippagePercent ?? ""),
      maxPercent: input.autoSlippage ? String(input.maxAutoSlippagePercent || "1") : null,
    },
  };
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

const tradeTokenCache = new Map<string, { expiresAt: number; tokens: Record<string, unknown>[] }>();

// Official wrapped assets may be routable by contract before they appear in
// OKX's discovery catalog. These addresses are additive; a live quote is still
// required before the UI enables a wallet transaction.
const OFFICIAL_WRAPPED_ASSETS: Record<string, Record<string, unknown>[]> = {
  "196": [
    { tokenSymbol: "USDT0", tokenName: "Tether USD0", tokenContractAddress: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736", decimals: 6, tokenSource: "X Layer official token list" },
    { tokenSymbol: "WOKB", tokenName: "Wrapped OKB", tokenContractAddress: "0xe538905cf8410324e03A5A23C1c177a474D59b2b", decimals: 18, tokenSource: "X Layer official token list" },
    { tokenSymbol: "WETH", tokenName: "Wrapped Ether", tokenContractAddress: "0x5A77f1443D16ee5761d310e38b62f77f726bC71c", decimals: 18, tokenSource: "X Layer official token list" },
  ],
  "8453": [
    { tokenSymbol: "WETH", tokenName: "Wrapped Ether", tokenContractAddress: "0x4200000000000000000000000000000000000006", decimals: 18, tokenSource: "Base canonical WETH" },
    { tokenSymbol: "cbBTC", tokenName: "Coinbase Wrapped BTC", tokenContractAddress: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, tokenSource: "Coinbase" },
    { tokenSymbol: "cbDOGE", tokenName: "Coinbase Wrapped DOGE", tokenContractAddress: "0xcbD06E5A2B0C65597161de254AA074E489dEb510", decimals: 8, tokenSource: "Coinbase" },
    { tokenSymbol: "cbXRP", tokenName: "Coinbase Wrapped XRP", tokenContractAddress: "0xcb585250f852C6c6bf90434AB21A00f02833a4af", decimals: 6, tokenSource: "Coinbase" },
    { tokenSymbol: "cbLTC", tokenName: "Coinbase Wrapped LTC", tokenContractAddress: "0xcb17C9Db87B595717C857a08468793f5bAb6445F", decimals: 8, tokenSource: "Coinbase" },
    { tokenSymbol: "cbADA", tokenName: "Coinbase Wrapped ADA", tokenContractAddress: "0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c", decimals: 6, tokenSource: "Coinbase" },
    { tokenSymbol: "cbZEC", tokenName: "Coinbase Wrapped ZEC", tokenContractAddress: "0xB2000000000000000000008501b13360000cb2EC", decimals: 8, tokenSource: "Coinbase" },
    { tokenSymbol: "cbHYPE", tokenName: "Coinbase Wrapped HYPE", tokenContractAddress: "0xB200000000000000000000451d033a5000cb479e", decimals: 18, tokenSource: "Coinbase" },
    { tokenSymbol: "NVDAc", tokenName: "Coinbase Tokenized NVIDIA", tokenContractAddress: "0xb20000000000000000000078ee7ce2fE4908108C", decimals: 8, tokenSource: "Coinbase" },
    { tokenSymbol: "METAc", tokenName: "Coinbase Tokenized Meta", tokenContractAddress: "0xb2000000000000000000008bC8786B856E61707C", decimals: 8, tokenSource: "Coinbase" },
    { tokenSymbol: "AAPLc", tokenName: "Coinbase Tokenized Apple", tokenContractAddress: "0xb200000000000000000000C2e324d24d7eEcd1fb", decimals: 8, tokenSource: "Coinbase" },
    { tokenSymbol: "GOOGLc", tokenName: "Coinbase Tokenized Alphabet", tokenContractAddress: "0xb2000000000000000000002D0BA3164cc74f58B7", decimals: 8, tokenSource: "Coinbase" },
  ],
  "42161": [
    { tokenSymbol: "WETH", tokenName: "Wrapped Ether", tokenContractAddress: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, tokenSource: "Arbitrum canonical WETH" },
    { tokenSymbol: "cbBTC", tokenName: "Coinbase Wrapped BTC", tokenContractAddress: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, tokenSource: "Coinbase" },
  ],
};

/**
 * Analysis instruments use the exchange symbol (BTC, ETH, DOGE...). On-chain
 * execution must use the selected chain's real representation. Keep this list
 * deliberately identity-preserving: a liquid staking derivative is not a
 * substitute for its underlying asset, even when its ticker contains it.
 */
const EXECUTION_ASSET_ALIASES: Record<string, Record<string, string[]>> = {
  "196": {
    // xBTC is OKX's wrapped BTC on X Layer and currently has the safe liquid
    // USDT0 route. The similarly named WBTC catalog entry is retained only as
    // a fallback and must independently pass a live quote check.
    BTC: ["XBTC", "WBTC", "BTC"],
    ETH: ["WETH", "ETH"],
    // OKX catalogs the canonical bridged token as SOL while its ERC-20
    // metadata reports xSOL at the same contract address.
    SOL: ["SOL", "XSOL"],
    // Autopilot and protected-order vaults are ERC-20 accounts. Native OKB is
    // routable for a direct wallet swap, while WOKB is the contract-safe
    // representation for capital that must remain inside a vault.
    OKB: ["WOKB", "OKB"],
  },
  "8453": {
    BTC: ["CBBTC", "WBTC", "BTC"],
    ETH: ["WETH", "CBETH", "ETH"],
    DOGE: ["CBDOGE", "DOGE"],
    XRP: ["CBXRP", "XRP"],
    LTC: ["CBLTC", "LTC"],
    ADA: ["CBADA", "ADA"],
    ZEC: ["CBZEC", "ZEC"],
    HYPE: ["CBHYPE", "HYPE"],
    XNVDA: ["NVDAC", "XNVDA"],
    XMETA: ["METAC", "XMETA"],
    XAAPL: ["AAPLC", "XAAPL"],
    XGOOGL: ["GOOGLC", "XGOOGL"],
  },
  "42161": {
    BTC: ["WBTC", "CBBTC", "BTC"],
    ETH: ["WETH", "ETH"],
  },
};

export function executionAssetAliases(symbol: string, chainId: string, assetClass?: "crypto" | "tokenized_stock" | "tokenized_etf" | "rwa") {
  const normalized = symbol.trim().toUpperCase();
  const xStock = (chainId === "196" || chainId === "42161")
    && (assetClass === "tokenized_stock" || assetClass === "tokenized_etf")
    && normalized.startsWith("X") && normalized.length > 1
    ? [`${normalized.slice(1)}X`]
    : [];
  const official = (OFFICIAL_WRAPPED_ASSETS[chainId] || [])
    .map((item) => String(item.tokenSymbol || "").toUpperCase())
    .filter((candidate) => candidate === normalized || candidate === `CB${normalized}` || candidate === `W${normalized}`);
  return [...new Set([...(EXECUTION_ASSET_ALIASES[chainId]?.[normalized] || []), ...xStock, ...official, normalized])];
}

export function analysisSymbolForExecutionToken(symbol: string, chainId?: string, tokenName?: string) {
  const normalized = symbol.trim().toUpperCase().replaceAll("₮", "T").replace(/\.E$/, "");
  for (const [analysis, aliases] of Object.entries(EXECUTION_ASSET_ALIASES[chainId || ""] || {}))
    if (aliases.includes(normalized)) return analysis;
  const official = (OFFICIAL_WRAPPED_ASSETS[chainId || ""] || [])
    .map((item) => String(item.tokenSymbol || "").toUpperCase());
  if (official.includes(normalized) && normalized.startsWith("CB") && normalized.length > 2)
    return normalized.slice(2);
  if ((chainId === "196" || chainId === "42161") && /xstock/i.test(tokenName || "") && normalized.endsWith("X") && normalized.length > 1)
    return `X${normalized.slice(0, -1)}`;
  if (normalized === "USDBC") return "USDC";
  return normalized;
}

export function executionSymbolRepresentsAnalysis(
  executionSymbol: string,
  analysisSymbol: string,
  chainId: string,
  assetClass?: "crypto" | "tokenized_stock" | "tokenized_etf" | "rwa",
  tokenName?: string,
) {
  const execution = executionSymbol.trim().toUpperCase();
  const analysis = analysisSymbol.trim().toUpperCase();
  return (chainId === "196" || chainId === "42161")
    && (assetClass === "tokenized_stock" || assetClass === "tokenized_etf")
    && /xstock/i.test(tokenName || "")
    && analysis.startsWith("X") && analysis.length > 1
    && execution === `${analysis.slice(1)}X`;
}

/** Chain-specific token contracts supported by OKX Onchain OS swap routing. */
export async function getOkxTradeTokens(
  cfg: AppConfig,
  chainId: string,
  search: string,
  limit = 40,
) {
  const cacheKey = chainId;
  let cached = tradeTokenCache.get(cacheKey);
  if (!cached || cached.expiresAt <= Date.now()) {
    const tokens = await okxDexGetMany(cfg, "/api/v6/dex/aggregator/all-tokens", { chainIndex: chainId });
    cached = { expiresAt: Date.now() + 5 * 60_000, tokens };
    tradeTokenCache.set(cacheKey, cached);
  }
  const query = search.trim().toLowerCase();
  const aliases = new Set([query]);
  if (query === "btc" || query === "wbtc") { aliases.add("btc"); aliases.add("wbtc"); }
  if (query === "eth" || query === "weth") { aliases.add("eth"); aliases.add("weth"); }
  if (query === "usdt" || query === "usdt0" || query === "usdc") { aliases.add("usdt"); aliases.add("usdt0"); aliases.add("usdc"); }
  const candidates = [...(OFFICIAL_WRAPPED_ASSETS[chainId] || []), ...cached.tokens]
    .filter((item, index, all) => all.findIndex((candidate) => String(candidate.tokenContractAddress).toLowerCase() === String(item.tokenContractAddress).toLowerCase()) === index);
  return candidates.filter((item) => !query || [item.tokenSymbol, item.tokenName, item.tokenContractAddress]
    .some((value) => [...aliases].some((alias) => String(value || "").toLowerCase().includes(alias))))
    .slice(0, Math.min(Math.max(limit, 1), 1_000))
    .map((item) => ({
      symbol: String(item.tokenSymbol || "TOKEN"),
      name: String(item.tokenName || item.tokenSymbol || "Token"),
      address: String(item.tokenContractAddress || ""),
      decimals: Number(item.decimals ?? item.decimal ?? 18),
      logoUrl: typeof item.tokenLogoUrl === "string" ? item.tokenLogoUrl : null,
      chainId,
      provider: item.tokenSource === "Coinbase" ? "Coinbase wrapped asset · OKX Onchain OS route" : String(item.tokenSource || "OKX Onchain OS"),
    }))
    .filter((item) => /^0x[a-fA-F0-9]{40}$/.test(item.address));
}
