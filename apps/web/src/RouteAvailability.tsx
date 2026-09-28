import { useEffect, useRef, useState } from "react";
import { apiGet } from "./api";
import { WEB_NETWORKS, type WebNetworkKey } from "./networks";
import { createRouteChecks, type RouteCheck } from "./routeChecks";

export const checkRoute = createRouteChecks(async (network, pair, custody) => {
  const response = await apiGet(`/v1/trading/resolve-pair?network=${network}&pair=${encodeURIComponent(pair)}${custody === "erc20" ? "&custody=erc20" : ""}`);
  const data = response.data as { available?: boolean; reason?: string };
  if (!response.ok || typeof data?.available !== "boolean") return { status: "error" };
  return { status: data.available ? "available" : "unavailable", reason: data.reason };
});

export function useRouteResults() {
  const [, update] = useState(0);
  useEffect(() => checkRoute.subscribe(() => update(value => value + 1)), []);
  return checkRoute.peek;
}

export function RouteAvailability({ network, pair, mapped, fallback, custody = "wallet", enabled = true }: {
  network: WebNetworkKey; pair: string; mapped: boolean; fallback?: string; custody?: "wallet" | "erc20"; enabled?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ key: string; value: RouteCheck } | null>(null);
  const key = `${network}:${custody}:${pair}`;
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (root.current) observer.observe(root.current.closest(".pair-item, article") || root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!enabled || !visible || !mapped) return;
    let current = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      setResult(null);
      void checkRoute(network, pair, custody).then(value => { if (current) setResult({ key, value }); });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { current = false; window.clearInterval(timer); };
  }, [enabled, visible, mapped, network, pair, custody, key]);
  const value = result?.key === key ? result.value : null;
  const status = !mapped ? "research" : value?.status || "checking";
  const label = !mapped ? fallback || `Not mapped · ${WEB_NETWORKS[network].label}`
    : status === "available" ? `Route available · ${WEB_NETWORKS[network].label}`
    : status === "unavailable" ? `No live route · ${WEB_NETWORKS[network].label}`
    : status === "error" ? "Route check unavailable · retrying automatically" : "Checking route automatically…";
  return <small ref={root} className="execution-availability" data-status={status} title={value?.reason || (status === "available" ? "Indicative route verified. The actual order is quoted again for its amount before signing." : undefined)}>{label}</small>;
}
