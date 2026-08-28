import type { WebNetworkKey } from "./networks";

export type JobRecoveryHandle = Readonly<{ jobId: string; recoveryToken: string; createdAt?: string; label?: string; tier?: string }>;

export type JobRecoveryScope = "prediction" | "spot";
function key(network: WebNetworkKey, scope: JobRecoveryScope) { return `pulse:last-job:${scope}:${network}`; }
function historyKey(network: WebNetworkKey, scope: JobRecoveryScope) { return `pulse:report-history:${scope}:${network}`; }

function valid(value: unknown): value is JobRecoveryHandle {
  const item = value as Partial<JobRecoveryHandle> | null;
  return Boolean(item && typeof item.jobId === "string" && /^[0-9a-f-]{36}$/i.test(item.jobId)
    && typeof item.recoveryToken === "string" && item.recoveryToken.length >= 32);
}

export function saveJobRecovery(storage: Storage, network: WebNetworkKey, handle: JobRecoveryHandle, scope: JobRecoveryScope = "prediction") {
  if (!valid(handle)) throw new Error("Invalid paid-job recovery capability");
  storage.setItem(key(network, scope), JSON.stringify(handle));
  const history = listJobRecoveries(storage, network, scope).filter((item) => item.jobId !== handle.jobId);
  storage.setItem(historyKey(network, scope), JSON.stringify([{ ...handle, createdAt: handle.createdAt || new Date().toISOString() }, ...history].slice(0, 30)));
}

export function readJobRecovery(storage: Storage, network: WebNetworkKey, scope: JobRecoveryScope = "prediction"): JobRecoveryHandle | null {
  const raw = storage.getItem(key(network, scope));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (valid(parsed)) return parsed;
  } catch { /* remove malformed or obsolete capability below */ }
  storage.removeItem(key(network, scope));
  return null;
}

export function clearJobRecovery(storage: Storage, network: WebNetworkKey, scope: JobRecoveryScope = "prediction") {
  storage.removeItem(key(network, scope));
}

export function listJobRecoveries(storage: Storage, network: WebNetworkKey, scope: JobRecoveryScope): JobRecoveryHandle[] {
  const raw = storage.getItem(historyKey(network, scope));
  if (!raw) return [];
  try {
    const items = JSON.parse(raw) as unknown[];
    if (!Array.isArray(items)) throw new Error("not an array");
    return items.filter(valid).slice(0, 30);
  } catch {
    storage.removeItem(historyKey(network, scope));
    return [];
  }
}

export function forgetJobRecovery(storage: Storage, network: WebNetworkKey, scope: JobRecoveryScope, jobId: string) {
  const history = listJobRecoveries(storage, network, scope).filter((item) => item.jobId !== jobId);
  storage.setItem(historyKey(network, scope), JSON.stringify(history));
  const latest = readJobRecovery(storage, network, scope);
  if (latest?.jobId === jobId) clearJobRecovery(storage, network, scope);
}
