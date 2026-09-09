import type { NetworkKey } from "@pulse/config";

const NETWORKS: Partial<Record<NetworkKey, string>> = { xlayer: "x-layer", base: "base", arbitrum: "arbitrum" };
const cache = new Map<string, { until: number; promise: Promise<unknown> }>();

// Share in-flight requests and cache failures as well as successes. Empty DEX
// results must not turn every report into an unbounded provider retry loop.
async function cachedJson(url: string): Promise<any> {
  const previous = cache.get(url);
  if (previous && previous.until > Date.now()) return previous.promise;
  if (cache.size >= 300) cache.delete(cache.keys().next().value!);
  const promise = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7_000) });
      if (response.ok) return response.json();
      if (attempt === 0 && response.status >= 500) {
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, 300));
        continue;
      }
      // Do not immediately retry a quota refusal, invalid request or missing token.
      throw new Error(`GeckoTerminal HTTP ${response.status}${response.status === 429 ? " (rate limited; retry after the cache window)" : ""}`);
    }
  })();
  const entry = { until: Date.now() + 60_000, promise };
  cache.set(url, entry);
  void promise.catch(() => { entry.until = Date.now() + 30_000; });
  return promise;
}

export function optionalNumber(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "string" && !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export async function collectGeckoEvidence(network: NetworkKey, address: string) {
  if (!/^0x[\da-f]{40}$/i.test(address)) throw new Error("Valid token contract address required");
  const id = NETWORKS[network];
  if (!id) return [];
  const root = `https://api.geckoterminal.com/api/v2/networks/${id}/tokens/${address.toLowerCase()}`;
  const names = ["GeckoTerminal token", "GeckoTerminal pools", "GeckoTerminal profile"];
  const urls = [root, `${root}/pools`, `${root}/info`];
  const results = await Promise.allSettled(urls.map(cachedJson));
  return results.map((result, i) => {
    if (result.status === "rejected") return { source: names[i], status: "unavailable" as const, error: String(result.reason?.message || result.reason) };
    const raw = result.value?.data;
    if (!raw || (Array.isArray(raw) && !raw.length)) return { source: names[i], status: "unavailable" as const, error: "No indexed evidence for this network and token" };
    const a = raw.attributes || {};
    if (i !== 1 && String(a.address || "").toLowerCase() !== address.toLowerCase()) return { source: names[i], status: "unavailable" as const, error: "Provider token identity did not match the requested contract" };
    if (i === 1 && !Array.isArray(raw)) return { source: names[i], status: "unavailable" as const, error: "Provider pool list is malformed" };
    const data = i === 0 ? {
      address: a.address, name: a.name, symbol: a.symbol,
      priceUsd: optionalNumber(a.price_usd), marketCapUsd: optionalNumber(a.market_cap_usd),
      fdvUsd: optionalNumber(a.fdv_usd), liquidityUsd: optionalNumber(a.total_reserve_in_usd), volume: a.volume_usd,
    } : i === 1 ? raw.filter((pool: any) => [pool.relationships?.base_token?.data?.id, pool.relationships?.quote_token?.data?.id].some(value => String(value).toLowerCase() === `${id}_${address.toLowerCase()}`))
      .sort((left: any, right: any) => (optionalNumber(right.attributes?.reserve_in_usd) || 0) - (optionalNumber(left.attributes?.reserve_in_usd) || 0)).slice(0, 5).map((pool: any) => ({
      address: pool.attributes?.address, name: pool.attributes?.name,
      liquidityUsd: optionalNumber(pool.attributes?.reserve_in_usd), volume: pool.attributes?.volume_usd,
      transactions: pool.attributes?.transactions, createdAt: pool.attributes?.pool_created_at,
      priceChange: pool.relationships?.base_token?.data?.id?.toLowerCase() === `${id}_${address.toLowerCase()}` ? pool.attributes?.price_change_percentage : null,
      tokenMetricScope: "Pool volume/liquidity describe both assets; price change is supplied only when the requested token is the base asset",
      // Preserve base/quote identity: do not attribute base price changes to a quote token.
      baseToken: pool.relationships?.base_token?.data?.id,
      quoteToken: pool.relationships?.quote_token?.data?.id,
      url: `https://www.geckoterminal.com/${id}/pools/${pool.attributes?.address}`,
    })) : {
      address: a.address, name: a.name, symbol: a.symbol, websites: a.websites || [],
      twitterHandle: a.twitter_handle, telegramHandle: a.telegram_handle, description: a.description,
      coingeckoId: a.coingecko_coin_id, gtScore: optionalNumber(a.gt_score), gtScoreDetails: a.gt_score_details,
      gtVerified: typeof a.gt_verified === "boolean" ? a.gt_verified : null,
      holders: a.holders, mintAuthority: a.mint_authority, freezeAuthority: a.freeze_authority,
      honeypotObservation: a.is_honeypot, categories: a.categories,
      // A provider's own score is not PULSE's risk score, nor evidence of future returns.
    };
    if (Array.isArray(data) && !data.length) return { source: names[i], status: "unavailable" as const, error: "No identity-matched pools returned" };
    return { source: names[i], status: "observed" as const, url: urls[i], observedAt: new Date().toISOString(), data };
  });
}
