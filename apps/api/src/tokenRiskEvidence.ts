import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { AppConfig, NetworkKey, PulseNetwork } from "@pulse/config";
import { getXLayerTokenCatalog } from "./tokenCatalog.js";

const DEX_CHAIN: Partial<Record<NetworkKey, string>> = { xlayer: "xlayer", base: "base", arbitrum: "arbitrum" };
const BLOCKSCOUT: Partial<Record<NetworkKey, string>> = { base: "https://base.blockscout.com", arbitrum: "https://arbitrum.blockscout.com" };

type SourceResult = { status: "observed" | "unavailable" | "not_applicable"; source: string; data?: unknown; error?: string };

async function getJson(url: string, timeout = 7_000): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "PULSE-Token-Risk/1" }, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function settled(source: string, result: PromiseSettledResult<unknown>): SourceResult {
  return result.status === "fulfilled"
    ? { source, status: "observed", data: result.value }
    : { source, status: "unavailable", error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
}

function compactPair(raw: unknown, tokenAddress: string) {
  const pair = raw as Record<string, unknown>;
  const info = (pair.info || {}) as Record<string, unknown>;
  const token = ((String(((pair.baseToken as Record<string, unknown> | undefined)?.address) || "").toLowerCase() === tokenAddress.toLowerCase()
    ? pair.baseToken : pair.quoteToken) || {}) as Record<string, unknown>;
  return {
    chainId: pair.chainId, dexId: pair.dexId, pairAddress: pair.pairAddress, url: pair.url,
    token: { address: token.address, symbol: token.symbol, name: token.name }, priceUsd: pair.priceUsd,
    txns: pair.txns, volume: pair.volume, priceChange: pair.priceChange, liquidity: pair.liquidity,
    fdv: pair.fdv, marketCap: pair.marketCap, pairCreatedAt: pair.pairCreatedAt,
    websites: Array.isArray(info.websites) ? info.websites : [], socials: Array.isArray(info.socials) ? info.socials : [],
  };
}

function bestDexPair(value: unknown, address: string) {
  const pairs = Array.isArray(value) ? value : ((value as { pairs?: unknown[] } | null)?.pairs || []);
  return pairs.map((pair) => compactPair(pair, address)).sort((a, b) => Number(((b.liquidity as { usd?: unknown } | undefined)?.usd) || 0) - Number(((a.liquidity as { usd?: unknown } | undefined)?.usd) || 0)).slice(0, 5);
}

function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

async function assertPublicWebsite(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Only public HTTPS project sites are inspected");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) throw new Error("Local project host is not allowed");
  if (isIP(url.hostname) && isPrivateIp(url.hostname)) throw new Error("Private project host is not allowed");
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) throw new Error("Project host did not resolve to public addresses");
  return url;
}

function htmlText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;/g, "'").replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ").trim().slice(0, 12_000);
}

async function inspectWebsite(value: string) {
  let current = await assertPublicWebsite(value);
  for (let redirect = 0; redirect < 3; redirect += 1) {
    const response = await fetch(current, { redirect: "manual", headers: { Accept: "text/html,text/plain", "User-Agent": "PULSE-Token-Risk/1" }, signal: AbortSignal.timeout(7_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Project site redirect had no location");
      current = await assertPublicWebsite(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Project site HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!/text\/(html|plain)/i.test(contentType)) throw new Error("Project site did not return text");
    const text = htmlText((await response.text()).slice(0, 256_000));
    return { url: current.toString(), title: text.slice(0, 180), excerpt: text.slice(0, 8_000), contentType };
  }
  throw new Error("Too many project site redirects");
}

function matchingItems(value: unknown, address: string) {
  const items = Array.isArray(value) ? value : [];
  return items.filter((item) => String((item as Record<string, unknown>).tokenAddress || "").toLowerCase() === address.toLowerCase()).slice(0, 10);
}

function compactBlockscout(source: string, value: unknown) {
  const raw = (value || {}) as Record<string, unknown>;
  if (source === "Blockscout token") return {
    address: raw.address, name: raw.name, symbol: raw.symbol, decimals: raw.decimals, totalSupply: raw.total_supply,
    holders: raw.holders, exchangeRate: raw.exchange_rate, circulatingMarketCap: raw.circulating_market_cap,
    type: raw.type, iconUrl: raw.icon_url, reputation: raw.reputation,
  };
  if (source === "Blockscout verified contract") return {
    address: raw.address, name: raw.name, compilerVersion: raw.compiler_version, language: raw.language,
    isVerified: raw.is_verified, isFullyVerified: raw.is_fully_verified, isProxy: raw.is_proxy,
    implementations: raw.implementations, optimizationEnabled: raw.optimization_enabled,
    verifiedAt: raw.verified_at, certified: raw.certified, licenseType: raw.license_type,
    sourceCodeSha256: raw.source_code ? `present:${String(raw.source_code).length}_chars` : "absent",
  };
  const items = Array.isArray(raw.items) ? raw.items as Array<Record<string, unknown>> : [];
  return { holders: items.slice(0, 20).map((item) => ({ address: (item.address as Record<string, unknown> | undefined)?.hash, value: item.value, percentage: item.percentage })), nextPageParams: raw.next_page_params || null };
}

export async function collectTokenRiskEvidence(input: {
  cfg: AppConfig; networkKey: NetworkKey; network: PulseNetwork; address: string;
}) {
  const { cfg, networkKey, network, address } = input;
  const dexChain = DEX_CHAIN[networkKey];
  const dexRequests: Array<Promise<unknown>> = dexChain ? [
    getJson(`https://api.dexscreener.com/token-pairs/v1/${dexChain}/${address}`),
    getJson("https://api.dexscreener.com/token-profiles/latest/v1").then((body) => matchingItems(body, address)),
    getJson("https://api.dexscreener.com/token-boosts/latest/v1").then((body) => matchingItems(body, address)),
    getJson("https://api.dexscreener.com/ads/latest/v1").then((body) => matchingItems(body, address)),
    getJson("https://api.dexscreener.com/community-takeovers/latest/v1").then((body) => matchingItems(body, address)),
  ] : [];
  const blockscoutBase = BLOCKSCOUT[networkKey];
  const blockscoutUrl = (path: string) => {
    const url = new URL(`${blockscoutBase}${path}`);
    if (cfg.BLOCKSCOUT_API_KEY.trim()) url.searchParams.set("apikey", cfg.BLOCKSCOUT_API_KEY.trim());
    return url.toString();
  };
  const blockscoutRequests: Array<Promise<unknown>> = blockscoutBase ? [
    getJson(blockscoutUrl(`/api/v2/tokens/${address}`)),
    getJson(blockscoutUrl(`/api/v2/smart-contracts/${address}`)),
    getJson(blockscoutUrl(`/api/v2/tokens/${address}/holders?items_count=20`)),
  ] : [];
  const okxPromise = networkKey === "xlayer"
    ? getXLayerTokenCatalog(cfg, address, 10).then((items) => items.filter((item) => item.address.toLowerCase() === address.toLowerCase()))
    : Promise.resolve(null);
  const results = await Promise.allSettled([...dexRequests, ...blockscoutRequests, okxPromise]);
  let offset = 0;
  const dexNames = ["DexScreener pairs", "DexScreener profile", "DexScreener boosts", "DexScreener ads", "DexScreener community takeover"];
  const dexSources = dexNames.slice(0, dexRequests.length).map((name) => settled(name, results[offset++]!));
  if (dexSources[0]?.status === "observed") dexSources[0].data = bestDexPair(dexSources[0].data, address);
  const blockNames = ["Blockscout token", "Blockscout verified contract", "Blockscout holders"];
  const blockscoutSources = blockNames.slice(0, blockscoutRequests.length).map((name) => settled(name, results[offset++]!));
  for (const source of blockscoutSources) if (source.status === "observed") source.data = compactBlockscout(source.source, source.data);
  const okxSource = networkKey === "xlayer" ? settled("OKX Onchain OS", results[offset++]!) : { source: "OKX Onchain OS", status: "not_applicable" as const };
  const pairs = (dexSources[0]?.data as Array<Record<string, unknown>> | undefined) || [];
  const websites = pairs.flatMap((pair) => Array.isArray(pair.websites) ? pair.websites : []) as Array<Record<string, unknown>>;
  const websiteUrl = websites.map((item) => String(item.url || "")).find((url) => url.startsWith("https://"));
  const websiteSource: SourceResult = websiteUrl
    ? await inspectWebsite(websiteUrl).then((data) => ({ source: "Project website", status: "observed" as const, data })).catch((error) => ({ source: "Project website", status: "unavailable" as const, error: error instanceof Error ? error.message : String(error) }))
    : { source: "Project website", status: "unavailable", error: "No HTTPS website was declared in the DexScreener pair profile" };
  return {
    observedAt: new Date().toISOString(), network: { key: networkKey, label: network.label, chainId: String(network.chainId), environment: network.environment },
    tokenAddress: address.toLowerCase(),
    sources: [...dexSources, okxSource, ...blockscoutSources, websiteSource],
    onchainAuthority: networkKey === "xlayer" ? "OKX Onchain OS API" : blockscoutBase ? "Blockscout API" : "No indexed on-chain provider configured",
    sourcePolicy: "Only supplied source observations may support the score. Unavailable evidence must remain unknown.",
  };
}
