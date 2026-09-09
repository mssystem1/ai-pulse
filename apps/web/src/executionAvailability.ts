import { useEffect, useState } from "react";
import { apiGet } from "./api";
import { WEB_NETWORKS, type WebNetworkKey } from "./networks";

type Catalog = { network: WebNetworkKey; status: "ready" | "unavailable"; pairs: Set<string> };
const cache = new Map<WebNetworkKey, { until: number; promise: Promise<Catalog> }>();
export function useExecutionAvailability(network: WebNetworkKey) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    let current = true;
    if (network === "arc-testnet") { setCatalog({ network, status: "ready", pairs: new Set() }); return; }
    let entry = cache.get(network);
    if (!entry || entry.until < Date.now()) {
      const promise = apiGet(`/v1/trading/pairs?network=${network}&limit=1000`).then(response => {
        if (!response.ok) return { network, status: "unavailable" as const, pairs: new Set<string>() };
        const data = response.data as { pairs?: Array<{ pair: string }> };
        if (!Array.isArray(data?.pairs)) return { network, status: "unavailable" as const, pairs: new Set<string>() };
        return { network, status: "ready" as const, pairs: new Set((data.pairs || []).map(item => item.pair.toUpperCase())) };
      }).catch(() => ({ network, status: "unavailable" as const, pairs: new Set<string>() }));
      entry = { until: Date.now() + 60_000, promise };
      cache.set(network, entry);
    }
    void entry.promise.then(value => { if (current) setCatalog(value); });
    return () => { current = false; };
  }, [network]);
  return (pair: string) => {
    if (network === "arc-testnet") return { mapped: false, label: "Research only · Arc Testnet", status: "research" };
    if (!catalog || catalog.network !== network) return { mapped: false, label: "Checking Spot availability…", status: "loading" };
    if (catalog.status !== "ready") return { mapped: false, label: "Spot availability unavailable", status: "unavailable" };
    const mapped = catalog.pairs.has(pair.toUpperCase());
    return { mapped, label: mapped ? `Spot mapped · ${WEB_NETWORKS[network].label}` : `Research only · not mapped on ${WEB_NETWORKS[network].label}`, status: mapped ? "mapped" : "research" };
  };
}
