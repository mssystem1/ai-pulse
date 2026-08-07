import type { WebNetworkKey } from "./networks";

export type JobRecoveryHandle = Readonly<{ jobId: string; recoveryToken: string }>;

export type JobRecoveryScope = "prediction" | "spot";
function key(network: WebNetworkKey, scope: JobRecoveryScope) { return `pulse:last-job:${scope}:${network}`; }

function valid(value: unknown): value is JobRecoveryHandle {
  const item = value as Partial<JobRecoveryHandle> | null;
  return Boolean(item && typeof item.jobId === "string" && /^[0-9a-f-]{36}$/i.test(item.jobId)
    && typeof item.recoveryToken === "string" && item.recoveryToken.length >= 32);
}

export function saveJobRecovery(storage: Storage, network: WebNetworkKey, handle: JobRecoveryHandle, scope: JobRecoveryScope = "prediction") {
  if (!valid(handle)) throw new Error("Invalid paid-job recovery capability");
  storage.setItem(key(network, scope), JSON.stringify(handle));
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
