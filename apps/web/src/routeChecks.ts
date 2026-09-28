export type RouteCheck = { status: "available" | "unavailable" | "error"; reason?: string };
type FetchRoute = (network: string, pair: string, custody: string) => Promise<RouteCheck>;

// Shared by visible rows and selected markets. Never scan an entire catalog
// concurrently or confuse transport failure with a confirmed missing route.
export function createRouteChecks(fetchRoute: FetchRoute, now = Date.now) {
  const cache = new Map<string, { until: number; promise: Promise<RouteCheck>; result?: RouteCheck }>();
  const listeners = new Set<() => void>();
  const keyFor = (network: string, pair: string, custody: string) => `${network}:${custody}:${pair.toUpperCase()}`;
  const queue: Array<() => void> = [];
  let active = 0;
  const drain = () => { while (active < 2 && queue.length) { active++; queue.shift()!(); } };
  const check = (network: string, pair: string, custody: string) => {
    const key = keyFor(network, pair, custody);
    const existing = cache.get(key);
    if (existing && existing.until > now()) return existing.promise;
    const entry: { until: number; promise: Promise<RouteCheck>; result?: RouteCheck } = { until: Infinity, promise: null as unknown as Promise<RouteCheck> };
    entry.promise = new Promise<RouteCheck>(resolve => {
      queue.push(() => {
        void Promise.resolve().then(() => fetchRoute(network, pair, custody))
          .catch((): RouteCheck => ({ status: "error", reason: "Route check temporarily unavailable" }))
          .then(result => {
            entry.until = now() + (result.status === "error" ? 15_000 : 60_000);
            entry.result = result;
            resolve(result);
            listeners.forEach(listener => listener());
          })
          .finally(() => { active--; drain(); });
      });
    });
    cache.set(key, entry); drain();
    return entry.promise;
  };
  return Object.assign(check, {
    peek(network: string, pair: string, custody: string) {
      const entry = cache.get(keyFor(network, pair, custody));
      return entry && entry.until > now() ? entry.result : undefined;
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  });
}

export function routeSortRank(mapped: boolean, result?: RouteCheck) {
  if (!mapped) return 4;
  if (result?.status === "available") return 0;
  if (result?.status === "unavailable") return 3;
  if (result?.status === "error") return 2;
  return 1;
}
