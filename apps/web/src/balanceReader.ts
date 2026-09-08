/** Shared bounded balance reads. An unavailable RPC response is never a zero balance. */
export function createBalanceReader(fetcher: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<string, { expires: number; pending: boolean; request: Promise<bigint> }>();
  return function read(rpc: string, method: "eth_call" | "eth_getBalance", params: unknown[], fresh = false): Promise<bigint> {
    const key = JSON.stringify([rpc, method, params]);
    const previous = cache.get(key);
    if (previous && (previous.pending || (!fresh && previous.expires > now()))) return previous.request;
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    const entry = { expires: Infinity, pending: true, request: Promise.resolve(0n) };
    entry.request = (async () => {
      try {
        const response = await fetcher(rpc, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8_000),
        });
        const body = await response.json() as { result?: unknown; error?: { message?: string } };
        if (!response.ok || body.error) throw new Error(body.error?.message || `Balance feed unavailable (${response.status})`);
        if (typeof body.result !== "string" || !/^0x[0-9a-f]+$/i.test(body.result)) throw new Error("Balance feed returned no valid value");
        entry.expires = now() + 5_000;
        return BigInt(body.result);
      } catch (error) {
        entry.expires = now() + 3_000;
        throw error;
      } finally { entry.pending = false; }
    })();
    cache.set(key, entry);
    return entry.request;
  };
}
