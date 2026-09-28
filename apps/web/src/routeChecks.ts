export type RouteCheck = { status: "available" | "unavailable" | "error"; reason?: string };
type FetchRoute = (network: string, pair: string, custody: string) => Promise<RouteCheck>;

// Shared by visible rows and selected markets. Never scan an entire catalog
// concurrently or confuse transport failure with a confirmed missing route.
export function createRouteChecks(fetchRoute: FetchRoute, now = Date.now) {
  const cache = new Map<string, { until: number; promise: Promise<RouteCheck> }>();
  const queue: Array<() => void> = [];
  let active = 0;
  const drain = () => { while (active < 2 && queue.length) { active++; queue.shift()!(); } };
  return (network: string, pair: string, custody: string) => {
    const key = `${network}:${custody}:${pair.toUpperCase()}`;
    const existing = cache.get(key);
    if (existing && existing.until > now()) return existing.promise;
    const entry = { until: Infinity, promise: null as unknown as Promise<RouteCheck> };
    entry.promise = new Promise<RouteCheck>(resolve => {
      queue.push(() => {
        void Promise.resolve().then(() => fetchRoute(network, pair, custody))
          .catch((): RouteCheck => ({ status: "error", reason: "Route check temporarily unavailable" }))
          .then(result => { entry.until = now() + (result.status === "error" ? 15_000 : 60_000); resolve(result); })
          .finally(() => { active--; drain(); });
      });
    });
    cache.set(key, entry); drain();
    return entry.promise;
  };
}
