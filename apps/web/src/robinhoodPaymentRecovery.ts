import { saveJobRecovery, type JobRecoveryScope } from "./jobRecovery";

type StoredPayment = { version: 1; fingerprint: string; headers: Record<string, string>; recoveredAt?: number };
type Dependencies = {
  storage: Storage;
  exclusive: <T>(key: string, run: () => Promise<T>) => Promise<T>;
  fetch: typeof fetch;
  sign: (challenge: Response, request: Request) => Promise<Record<string, string>>;
};
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Pending authorizations are sensitive, limited merchant-payment capabilities,
 * not private keys. Keep them same-origin, wallet/endpoint scoped, never in logs.
 * No expiry on uncertain payments: an expired signature can still recover a
 * settled purchase. Web Locks serialize both tabs and repeated button clicks. */
export function createRecoverableRobinhoodFetch(wallet: string, deps: Dependencies): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.method !== "POST") return deps.fetch(request);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");
    const key = `pulse:pending-payment:robinhood:${wallet.toLowerCase()}:${await digest(`${url.origin}${path}`)}`;
    const rawBody = await request.clone().text();
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { throw new Error("Robinhood paid requests require JSON."); }
    const fingerprint = await digest(JSON.stringify({ method: request.method, url: `${url.origin}${path}${url.search}`, body: canonical(body) }));
    return deps.exclusive(key, async () => {
      // Storage must work BEFORE requesting a signature. Never silently switch
      // to memory and lose the authorization on refresh.
      let stored: StoredPayment | null = null;
      const raw = deps.storage.getItem(key);
      if (raw) {
        try {
          stored = JSON.parse(raw);
          if (!stored || stored.version !== 1 || typeof stored.fingerprint !== "string"
            || !stored.headers || typeof stored.headers["PAYMENT-SIGNATURE"] !== "string") throw new Error();
        } catch { throw new Error("Saved Robinhood payment recovery is unreadable. Do not pay again; contact support."); }
      }
      // Only completed deliveries with a persisted recovery handle may release
      // this fence. Keep a short completed fence against accidental double clicks.
      if (stored?.recoveredAt && (stored.fingerprint !== fingerprint || Date.now() - stored.recoveredAt > 30_000)) {
        deps.storage.removeItem(key);
        stored = null;
      }
      if (stored && stored.fingerprint !== fingerprint) throw new Error("A Robinhood payment for this service is still pending. Restore your original selection and retry to recover it without paying again.");
      if (!stored) {
        const probe = `${key}:storage-check`;
        deps.storage.setItem(probe, "1");
        if (deps.storage.getItem(probe) !== "1") throw new Error("Browser storage is required for payment recovery.");
        deps.storage.removeItem(probe);
        const challenge = await deps.fetch(request.clone());
        if (challenge.status !== 402) return challenge;
        const signed = new Headers(await deps.sign(challenge, request));
        const header = signed.get("PAYMENT-SIGNATURE");
        if (!header) throw new Error("The wallet did not return a payment authorization.");
        stored = { version: 1, fingerprint, headers: { "PAYMENT-SIGNATURE": header } };
        const encoded = JSON.stringify(stored);
        deps.storage.setItem(key, encoded);
        if (deps.storage.getItem(key) !== encoded) throw new Error("Payment recovery could not be saved. No payment was submitted.");
      }
      const headers = new Headers(request.headers);
      Object.entries(stored.headers).forEach(([name, value]) => headers.set(name, value));
      const response = await deps.fetch(new Request(request, { headers }));
      if (response.ok && response.headers.has("PAYMENT-RESPONSE")) {
        const delivered = await response.clone().json().catch(() => null);
        const handle = delivered?.history || (delivered?.job?.id && delivered?.recoveryToken
          ? { jobId: delivered.job.id, recoveryToken: delivered.recoveryToken } : null);
        if (handle) {
          const scope: JobRecoveryScope = path.includes("/prediction/") ? "prediction" : path.endsWith("/preflight") ? "risk" : "spot";
          // If any write fails, retain the original payment and allow replay.
          saveJobRecovery(deps.storage, "robinhood", handle, scope);
          deps.storage.setItem(key, JSON.stringify({ ...stored, recoveredAt: stored.recoveredAt || Date.now() }));
        }
      }
      return response;
    });
  }) as typeof fetch;
}
