import type { AppConfig } from "@pulse/config";
import { getXLayerOkxTokens } from "./okxDex.js";

const X_LAYER_DEXSCREENER_IDS = new Set(["xlayer", "x-layer", "xlayermainnet"]);
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

type TokenItem = {
  address: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  priceUsd: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  holders: number | null;
  communityRecognized: boolean;
  dexUrl: string | null;
  sources: string[];
};

type DexPair = {
  chainId?: string;
  url?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  quoteToken?: { address?: string; symbol?: string; name?: string };
  priceUsd?: string | null;
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  info?: { imageUrl?: string };
};

const cache = new Map<string, { expires: number; value: TokenItem[] }>();

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function okxToken(raw: Record<string, unknown>): TokenItem | null {
  const address = String(raw.tokenContractAddress || "");
  if (!ADDRESS.test(address)) return null;
  const tags = raw.tagList as { communityRecognized?: unknown } | undefined;
  const isUsdt0 = address.toLowerCase() === "0x779ded0c9e1022225f8e0630b35a9b54be713736";
  return {
    address,
    symbol: isUsdt0 ? "USDT0" : String(raw.tokenSymbol || "TOKEN"),
    name: isUsdt0 ? "USD₮0" : String(raw.tokenName || raw.tokenSymbol || "X Layer token"),
    logoUrl: safeHttpsUrl(raw.tokenLogoUrl),
    priceUsd: finite(raw.price),
    change24h: finite(raw.change),
    liquidityUsd: finite(raw.liquidity),
    marketCapUsd: finite(raw.marketCap),
    holders: finite(raw.holders),
    communityRecognized: Boolean(tags?.communityRecognized),
    dexUrl: safeHttpsUrl(raw.explorerUrl),
    sources: ["OKX Onchain OS"],
  };
}

function isXLayer(pair: DexPair): boolean {
  return X_LAYER_DEXSCREENER_IDS.has(String(pair.chainId || "").toLowerCase().replace(/\s+/g, ""));
}

function dexToken(pair: DexPair, candidate?: string): TokenItem | null {
  if (!isXLayer(pair)) return null;
  const preferred = candidate?.toLowerCase();
  const token = preferred && pair.quoteToken?.address?.toLowerCase() === preferred
    ? pair.quoteToken
    : pair.baseToken;
  const address = String(token?.address || "");
  if (!ADDRESS.test(address)) return null;
  return {
    address,
    symbol: String(token?.symbol || "TOKEN"),
    name: String(token?.name || token?.symbol || "X Layer token"),
    logoUrl: safeHttpsUrl(pair.info?.imageUrl),
    priceUsd: finite(pair.priceUsd),
    change24h: finite(pair.priceChange?.h24),
    liquidityUsd: finite(pair.liquidity?.usd),
    marketCapUsd: finite(pair.marketCap ?? pair.fdv),
    holders: null,
    communityRecognized: false,
    dexUrl: safeHttpsUrl(pair.url),
    sources: ["DexScreener"],
  };
}

async function dexScreenerSearch(query: string): Promise<TokenItem[]> {
  if (!query.trim()) return [];
  const response = await fetch(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query.trim())}`,
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(3_500) },
  );
  if (!response.ok) return [];
  const body = (await response.json().catch(() => ({}))) as { pairs?: DexPair[] };
  return (body.pairs || []).map((pair) => dexToken(pair)).filter((item): item is TokenItem => Boolean(item));
}

async function dexScreenerEnrichment(addresses: string[]): Promise<TokenItem[]> {
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))].slice(0, 30);
  if (!unique.length) return [];
  const response = await fetch(
    `https://api.dexscreener.com/tokens/v1/xlayer/${unique.join(",")}`,
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(3_500) },
  );
  if (!response.ok) return [];
  const pairs = (await response.json().catch(() => [])) as DexPair[];
  return pairs.map((pair) => {
    const base = pair.baseToken?.address?.toLowerCase();
    const quote = pair.quoteToken?.address?.toLowerCase();
    const candidate = unique.find((address) => address === base || address === quote);
    return dexToken(pair, candidate);
  }).filter((item): item is TokenItem => Boolean(item));
}

function mergeTokens(items: TokenItem[]): TokenItem[] {
  const merged = new Map<string, TokenItem>();
  for (const item of items) {
    const key = item.address.toLowerCase();
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, item);
      continue;
    }
    const richer = (item.liquidityUsd || 0) > (previous.liquidityUsd || 0) ? item : previous;
    merged.set(key, {
      ...previous,
      ...richer,
      logoUrl: richer.logoUrl || previous.logoUrl,
      name: previous.name !== previous.symbol ? previous.name : richer.name,
      holders: previous.holders ?? richer.holders,
      communityRecognized: previous.communityRecognized || richer.communityRecognized,
      sources: [...new Set([...previous.sources, ...item.sources])],
    });
  }
  return [...merged.values()];
}

export async function getXLayerTokenCatalog(cfg: AppConfig, query: string, limit: number) {
  const safeLimit = Math.min(Math.max(limit, 1), 60);
  const cacheKey = `${query.trim().toLowerCase()}:${safeLimit}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;

  const okx = (await getXLayerOkxTokens(cfg, query, safeLimit * 2))
    .map(okxToken)
    .filter((item): item is TokenItem => Boolean(item));
  const [search, enrichment] = await Promise.all([
    dexScreenerSearch(query).catch(() => []),
    dexScreenerEnrichment(okx.map((item) => item.address)).catch(() => []),
  ]);
  const normalizedQuery = query.trim().toLowerCase();
  const tokens = mergeTokens([...okx, ...search, ...enrichment])
    .filter((item) => !normalizedQuery || [item.symbol, item.name, item.address]
      .some((value) => value.toLowerCase().includes(normalizedQuery)))
    .sort((a, b) => {
      const aExact = a.symbol.toLowerCase() === normalizedQuery ? 1 : 0;
      const bExact = b.symbol.toLowerCase() === normalizedQuery ? 1 : 0;
      return bExact - aExact || (b.liquidityUsd || 0) - (a.liquidityUsd || 0);
    })
    .slice(0, safeLimit);
  cache.set(cacheKey, { expires: Date.now() + 30_000, value: tokens });
  return tokens;
}
