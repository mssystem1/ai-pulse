import { useEffect, useState } from "react";
import { apiGet } from "./api";
import { WEB_NETWORKS, type WebNetworkKey } from "./networks";

type Catalog = { network: WebNetworkKey; status: "ready" | "unavailable"; pairs: Set<string> };
const cache = new Map<string, { until: number; promise: Promise<Catalog> }>();
export function useExecutionAvailability(network: WebNetworkKey, custody: "spot" | "erc20" = "spot") {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    let current = true;
    const cacheKey = `${network}:${custody}`;
    let entry = cache.get(cacheKey);
    if (!entry || entry.until < Date.now()) {
      const promise = apiGet(`/v1/trading/pairs?network=${network}&limit=1000${custody === "erc20" ? "&custody=erc20" : ""}`).then(response => {
        if (!response.ok) return { network, status: "unavailable" as const, pairs: new Set<string>() };
        const data = response.data as { pairs?: Array<{ pair: string; researchPairs?: string[] }> };
        if (!Array.isArray(data?.pairs)) return { network, status: "unavailable" as const, pairs: new Set<string>() };
        return { network, status: "ready" as const, pairs: new Set(data.pairs.flatMap(item => [item.pair, ...(network === "robinhood" ? item.researchPairs || [] : [])]).map(pair => pair.toUpperCase())) };
      }).catch(() => ({ network, status: "unavailable" as const, pairs: new Set<string>() }));
      entry = { until: Date.now() + 60_000, promise };
      cache.set(cacheKey, entry);
    }
    void entry.promise.then(value => { if (current) setCatalog(value); });
    return () => { current = false; };
  }, [network, custody]);
  return (pair: string) => {
    if (!catalog || catalog.network !== network) return { mapped: false, label: "Checking Spot availability…", status: "loading" };
    if (catalog.status !== "ready") return { mapped: false, label: "Spot availability unavailable", status: "unavailable" };
    const mapped = catalog.pairs.has(pair.toUpperCase());
    return { mapped, label: mapped ? `Spot mapped · ${WEB_NETWORKS[network].label}` : `Research only · not mapped on ${WEB_NETWORKS[network].label}`, status: mapped ? "mapped" : "research" };
  };
}
