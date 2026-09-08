import type { NetworkKey } from "@pulse/config";

const NETWORKS: Partial<Record<NetworkKey, string>> = { xlayer: "x-layer", base: "base", arbitrum: "arbitrum" };
const cache = new Map<string, { until: number; promise: Promise<unknown> }>();

// Share in-flight requests and cache failures as well as successes. Empty DEX
// results must not turn every report into an unbounded provider retry loop.
async function cachedJson(url: string): Promise<any> {
  const previous = cache.get(url);
  if (previous && previous.until > Date.now()) return previous.promise;
  if (cache.size >= 300) cache.delete(cache.keys().next().value!);
  const promise = fetch(url, { headers: { Accept: "application/json;version=20230203" }, signal: AbortSignal.timeout(7_000) })
    .then(async (response) => {
      if (!response.ok) throw new Error(`GeckoTerminal HTTP ${response.status}`);
      return response.json();
    });
  cache.set(url, { until: Date.now() + 60_000, promise });
  return promise;
}

export function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export async function collectGeckoEvidence(network: NetworkKey, address: string) {
  const id = NETWORKS[network];
  if (!id) return [];
  const root = `https://api.geckoterminal.com/api/v2/networks/${id}/tokens/${address.toLowerCase()}`;
  const names = ["GeckoTerminal token", "GeckoTerminal pools", "GeckoTerminal profile"];
  const results = await Promise.allSettled([cachedJson(root), cachedJson(`${root}/pools`), cachedJson(`${root}/info`)]);
  return results.map((result, i) => {
    if (result.status === "rejected") return { source: names[i], status: "unavailable" as const, error: String(result.reason?.message || result.reason) };
    const raw = result.value?.data;
    if (!raw || (Array.isArray(raw) && !raw.length)) return { source: names[i], status: "unavailable" as const, error: "No indexed evidence for this network and token" };
    const a = raw.attributes || {};
    const data = i === 0 ? {
      address: a.address, name: a.name, symbol: a.symbol,
      priceUsd: optionalNumber(a.price_usd), marketCapUsd: optionalNumber(a.market_cap_usd),
      fdvUsd: optionalNumber(a.fdv_usd), liquidityUsd: optionalNumber(a.total_reserve_in_usd), volume: a.volume_usd,
    } : i === 1 ? raw.slice(0, 5).map((pool: any) => ({
      ...pool.attributes,
      // Preserve base/quote identity: do not attribute base price changes to a quote token.
      baseToken: pool.relationships?.base_token?.data?.id,
      quoteToken: pool.relationships?.quote_token?.data?.id,
      url: `https://www.geckoterminal.com/${id}/pools/${pool.attributes?.address}`,
    })) : {
      address: a.address, name: a.name, symbol: a.symbol, websites: a.websites || [],
      twitterHandle: a.twitter_handle, telegramHandle: a.telegram_handle, description: a.description,
      // A provider's own score is not PULSE's risk score, nor evidence of future returns.
    };
    return { source: names[i], status: "observed" as const, data };
  });
}
