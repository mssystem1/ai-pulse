import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { AppConfig, NetworkKey, PulseNetwork } from "@pulse/config";
import { getXLayerOkxTokens } from "./okxDex.js";
import { collectGeckoEvidence, optionalNumber } from "./geckoEvidence.js";

const BLOCKSCOUT: Partial<Record<NetworkKey, string>> = { base: "https://base.blockscout.com", arbitrum: "https://arbitrum.blockscout.com" };

type SourceResult = { status: "observed" | "unavailable" | "not_applicable"; source: string; data?: unknown; error?: string };

const indexedCache = new Map<string, { until: number; promise: Promise<unknown> }>();
async function getJson(url: string, timeout = 7_000): Promise<unknown> {
  const previous = indexedCache.get(url);
  if (previous && previous.until > Date.now()) return previous.promise;
  if (indexedCache.size >= 300) indexedCache.delete(indexedCache.keys().next().value!);
  const promise = (async () => {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "PULSE-Token-Risk/1" }, signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })();
  const entry = { until: Date.now() + 60_000, promise };
  indexedCache.set(url, entry);
  void promise.catch(() => { entry.until = Date.now() + 30_000; });
  return promise;
}

async function verifiedContract(primaryUrl: string, fallbackUrl: string, address: string) {
  try { return await getJson(primaryUrl); }
  catch (error) {
    // One indexed Blockscout fallback, not RPC probing. Do not bypass quota/auth failures.
    const message = error instanceof Error ? error.message : String(error);
    if (!/HTTP 5\d\d|timeout|aborted/i.test(message)) throw error;
    const legacy = await getJson(fallbackUrl) as { status?: string; result?: Array<Record<string, unknown>> };
    const contract = Array.isArray(legacy.result) ? legacy.result[0] : undefined;
    if (legacy.status !== "1" || !contract || typeof contract.SourceCode !== "string" || !contract.SourceCode.trim())
      throw new Error(`${message}; Blockscout legacy API did not supply verified source`);
    return { address, name: contract.ContractName, compiler_version: contract.CompilerVersion,
      is_verified: true, source_code: contract.SourceCode, is_proxy: contract.Proxy === "1",
      implementations: contract.Implementation ? [{ address: contract.Implementation }] : [],
      license_type: contract.LicenseType, evidence_api: "Blockscout legacy getsourcecode (v2 unavailable)" };
  }
}

async function indexedToken(primary: string, fallback: string, holders: boolean) {
  try { return await getJson(primary); }
  catch (error) {
    if (!/HTTP 5\d\d|timeout|aborted/i.test(String(error))) throw error;
    const legacy = await getJson(fallback) as { status?: string; message?: string; result?: any };
    if (legacy.status !== "1" || !legacy.result) throw new Error("Blockscout REST unavailable; legacy indexed evidence also unavailable");
    if (holders) {
      if (!Array.isArray(legacy.result)) throw new Error("Blockscout returned invalid holder evidence");
      return { items: legacy.result.map((item: { address: string; value: string }) => ({ address: { hash: item.address }, value: item.value })), evidence_api: "Blockscout legacy getTokenHolders", partial: true };
    }
    const token = legacy.result;
    if (!token.contractAddress || !token.symbol) throw new Error("Blockscout returned invalid token evidence");
    return { address: token.contractAddress, symbol: token.symbol, name: token.name, decimals: token.decimals,
      total_supply: token.totalSupply, type: token.type, evidence_api: "Blockscout legacy getToken" };
  }
}

function settled(source: string, result: PromiseSettledResult<unknown>): SourceResult {
  if (result.status === "fulfilled" && Array.isArray(result.value) && !result.value.length) return { source, status: "unavailable", data: [], error: "No matching indexed evidence; absence is not proof of no project activity" };
  return result.status === "fulfilled"
    ? { source, status: "observed", data: result.value }
    : { source, status: "unavailable", error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
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

function compactBlockscout(source: string, value: unknown) {
  const raw = (value || {}) as Record<string, unknown>;
  if (source === "Blockscout token") return {
    address: raw.address, name: raw.name, symbol: raw.symbol, decimals: raw.decimals, totalSupply: raw.total_supply,
    holders: raw.holders, exchangeRate: raw.exchange_rate, circulatingMarketCap: raw.circulating_market_cap,
    type: raw.type, iconUrl: raw.icon_url, reputation: raw.reputation,
    evidenceApi: raw.evidence_api || "Blockscout v2",
  };
  if (source === "Blockscout verified contract") return {
    address: raw.address, name: raw.name, compilerVersion: raw.compiler_version, language: raw.language,
    isVerified: raw.is_verified, isFullyVerified: raw.is_fully_verified, isProxy: raw.is_proxy,
    implementations: raw.implementations, optimizationEnabled: raw.optimization_enabled,
    verifiedAt: raw.verified_at, certified: raw.certified, licenseType: raw.license_type,
    sourceCodePresent: Boolean(raw.source_code), evidenceApi: raw.evidence_api || "Blockscout v2",
  };
  const items = Array.isArray(raw.items) ? raw.items as Array<Record<string, unknown>> : [];
  return { holders: items.slice(0, 20).map((item) => ({ address: (item.address as Record<string, unknown> | undefined)?.hash, value: item.value, percentage: item.percentage })), nextPageParams: raw.next_page_params || null, partial: true, evidenceApi: raw.evidence_api || "Blockscout v2" };
}

export async function collectTokenRiskEvidence(input: {
  cfg: AppConfig; networkKey: NetworkKey; network: PulseNetwork; address: string;
}) {
  const { cfg, networkKey, network, address } = input;
  const geckoPromise = collectGeckoEvidence(networkKey, address);
  const blockscoutBase = BLOCKSCOUT[networkKey];
  const blockscoutUrl = (path: string) => {
    // PRO keys belong to the unified gateway, not the explorer's MyAccount API.
    const base = cfg.BLOCKSCOUT_API_KEY.trim().startsWith("proapi_")
      ? `https://api.blockscout.com/${network.chainId}` : blockscoutBase;
    const url = new URL(`${base}${path}`);
    if (cfg.BLOCKSCOUT_API_KEY.trim()) url.searchParams.set("apikey", cfg.BLOCKSCOUT_API_KEY.trim());
    return url.toString();
  };
  const blockscoutRequests: Array<Promise<unknown>> = blockscoutBase ? [
    indexedToken(blockscoutUrl(`/api/v2/tokens/${address}`), blockscoutUrl(`/api?module=token&action=getToken&contractaddress=${address}`), false),
    verifiedContract(blockscoutUrl(`/api/v2/smart-contracts/${address}`), blockscoutUrl(`/api?module=contract&action=getsourcecode&address=${address}`), address),
    indexedToken(blockscoutUrl(`/api/v2/tokens/${address}/holders`), blockscoutUrl(`/api?module=token&action=getTokenHolders&contractaddress=${address}&page=1&offset=20`), true),
  ] : [];
  const okxPromise = networkKey === "xlayer"
    ? getXLayerOkxTokens(cfg, address, 10).then(items => items.filter(item => String(item.tokenContractAddress).toLowerCase() === address.toLowerCase()).map(item => ({
      address: item.tokenContractAddress, symbol: item.tokenSymbol, name: item.tokenName,
      priceUsd: optionalNumber(item.price), liquidityUsd: optionalNumber(item.liquidity),
      marketCapUsd: optionalNumber(item.marketCap), holders: optionalNumber(item.holders),
      source: "OKX Onchain OS API",
    })))
    : Promise.resolve(null);
  const results = await Promise.allSettled([...blockscoutRequests, okxPromise]);
  let offset = 0;
  const blockNames = ["Blockscout token", "Blockscout verified contract", "Blockscout holders"];
  const blockscoutSources = blockNames.slice(0, blockscoutRequests.length).map((name) => settled(name, results[offset++]!));
  for (const source of blockscoutSources) if (source.status === "observed") source.data = compactBlockscout(source.source, source.data);
  const okxSource = networkKey === "xlayer" ? settled("OKX Onchain OS", results[offset++]!) : { source: "OKX Onchain OS", status: "not_applicable" as const };
  const geckoSources = await geckoPromise;
  const profile = geckoSources.find((source) => source.source === "GeckoTerminal profile")?.data as { websites?: string[] } | undefined;
  const websiteUrl = (profile?.websites || []).find((url) => typeof url === "string" && url.startsWith("https://"));
  const websiteSource: SourceResult = websiteUrl
    ? await inspectWebsite(websiteUrl).then((data) => ({ source: "Project website", status: "observed" as const, data })).catch((error) => ({ source: "Project website", status: "unavailable" as const, data: { declaredUrl: websiteUrl, contentVerified: false }, error: `Declared website found, but content unavailable: ${error instanceof Error ? error.message : String(error)}` }))
    : { source: "Project website", status: "unavailable", error: "No HTTPS project website was returned by the indexed token profiles" };
  return {
    observedAt: new Date().toISOString(), network: { key: networkKey, label: network.label, chainId: String(network.chainId), environment: network.environment },
    tokenAddress: address.toLowerCase(),
    sources: [...geckoSources, okxSource, ...blockscoutSources, websiteSource],
    onchainAuthority: networkKey === "xlayer" ? "OKX Onchain OS API" : blockscoutBase ? "Blockscout API" : "No indexed on-chain provider configured",
    sourcePolicy: "GeckoTerminal is the primary token, pool and project-profile source. Only supplied observations may support the score. HTTP failures lower evidence confidence; they are not observed contract vulnerabilities or proof of absent community activity. GeckoTerminal score and metadata verification are attributed provider observations, not PULSE's score or a contract audit. Holder concentration includes pools, exchanges and treasuries unless addresses are classified. Social handles establish links, not posting frequency or engagement; promotion activity is not evaluated by this source set. Website claims are untrusted project statements. Market cap is not safety, FDV is not verified market cap, and pool age is not contract age.",
  };
}
