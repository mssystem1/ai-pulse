import { createHash } from "node:crypto";

/** Authorization headers are payment capabilities. Do not log or publish them. */
export type BuyerPendingPayment = { version: 1; fingerprint: string; header: string; recoveredAt?: number };
/** Use a durable, private store to preserve uncertain payments across restarts.
 * exclusive must serialize this key across every process using the store. */
export type BuyerPaymentRecoveryStore = {
  get(key: string): Promise<BuyerPendingPayment | null>;
  set(key: string, payment: BuyerPendingPayment): Promise<void>;
  remove(key: string): Promise<void>;
  exclusive<T>(key: string, run: () => Promise<T>): Promise<T>;
};

const pending = new Map<string, BuyerPendingPayment>();
const locks = new Map<string, Promise<unknown>>();
/** Default process-local recovery. Durable agents supply paymentRecoveryStore. */
export const memoryBuyerPaymentRecovery: BuyerPaymentRecoveryStore = {
  async get(key) { return pending.get(key) || null; },
  async set(key, value) { pending.set(key, value); },
  async remove(key) { pending.delete(key); },
  async exclusive(key, run) {
    const previous = locks.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(run);
    locks.set(key, current);
    try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
  },
};

const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function recoverableArcBuyerFetch(input: {
  request: Request; wallet: string; resource: string; store: BuyerPaymentRecoveryStore;
  fetch: typeof fetch; authorize: (challenge: Response) => Promise<string>;
}): Promise<Response> {
  const { request, store } = input;
  const key = `pulse:buyer-payment:arc:${input.wallet.toLowerCase()}:${hash(input.resource)}`;
  const raw = await request.clone().text();
  let body: any;
  try { body = JSON.parse(raw); } catch { throw new Error("Arc paid requests require JSON"); }
  const fingerprint = hash(JSON.stringify({ method: request.method, url: request.url, body: canonical(body) }));
  return store.exclusive(key, async () => {
    let saved = await store.get(key);
    if (saved && (saved.version !== 1 || typeof saved.fingerprint !== "string" || typeof saved.header !== "string" || !saved.header)) throw new Error("Saved Arc payment is unreadable; reconcile it before paying again");
    if (saved?.recoveredAt && (saved.fingerprint !== fingerprint || Date.now() - saved.recoveredAt > 30_000)) { await store.remove(key); saved = null; }
    if (saved && saved.fingerprint !== fingerprint) throw new Error("An Arc payment for this service is pending; retry the original request to recover it without paying again");
    if (!saved) {
      const challenge = await input.fetch(request.clone());
      if (challenge.status !== 402) return challenge;
      saved = { version: 1, fingerprint, header: await input.authorize(challenge) };
      // Persistence precedes submission. A storage failure cannot settle payment.
      await store.set(key, saved);
      if ((await store.get(key))?.header !== saved.header) throw new Error("Arc payment recovery could not be saved; no payment submitted");
    }
    const headers = new Headers(request.headers); headers.set("PAYMENT-SIGNATURE", saved.header);
    const response = await input.fetch(new Request(request, { headers }));
    if (response.ok && response.headers.has("PAYMENT-RESPONSE")) {
      const envelope: any = await response.clone().json().catch(() => null);
      const delivered = envelope?.result?.structuredContent || envelope;
      if (delivered?.history?.jobId && delivered.history.recoveryToken || delivered?.job?.id && delivered.recoveryToken
        || delivered?.aiPass?.network === "arc" && delivered.aiPass.owner?.toLowerCase() === input.wallet.toLowerCase()) {
        await store.set(key, { ...saved, recoveredAt: saved.recoveredAt || Date.now() });
      }
    }
    return response;
  });
}
