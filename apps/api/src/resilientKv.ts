type KvCircuit = {
  failures: number;
  openUntil: number;
  probeInFlight: boolean;
  lastError: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
};

const circuit: KvCircuit = {
  failures: 0,
  openUntil: 0,
  probeInFlight: false,
  lastError: null,
  lastFailureAt: null,
  lastSuccessAt: null,
};

function boundedEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

/** Shared transport bounds for stores that use the official Upstash client. */
export function kvClientResilienceOptions() {
  const timeoutMs = boundedEnv("KV_REQUEST_TIMEOUT_MS", 6_000, 250, 15_000);
  const retries = boundedEnv("KV_REQUEST_RETRIES", 1, 0, 2);
  return {
    signal: () => AbortSignal.timeout(timeoutMs),
    retry: retries === 0 ? false as const : {
      retries,
      backoff: (retryCount: number) => Math.min(500, 150 * Math.max(1, retryCount)),
    },
  };
}

export class KvUnavailableError extends Error {
  readonly code = "KV_TEMPORARILY_UNAVAILABLE";
  constructor(message: string, readonly retryAfterSeconds: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "KvUnavailableError";
  }
}

export function kvConfigured() {
  return Boolean(process.env.KV_REST_API_URL?.trim() && process.env.KV_REST_API_TOKEN?.trim());
}

export function kvCircuitStatus(now = Date.now()) {
  return Object.freeze({
    configured: kvConfigured(),
    state: !kvConfigured() ? "local" : circuit.failures === 0 ? "online" : now < circuit.openUntil ? "degraded" : "recovering",
    retryAfterSeconds: Math.max(0, Math.ceil((circuit.openUntil - now) / 1000)),
    lastError: circuit.lastError,
    lastFailureAt: circuit.lastFailureAt,
    lastSuccessAt: circuit.lastSuccessAt,
  });
}

function unavailable(message = circuit.lastError || "KV connection is temporarily unavailable", cause?: unknown) {
  return new KvUnavailableError(message, Math.max(1, Math.ceil((circuit.openUntil - Date.now()) / 1000)), { cause });
}

/**
 * Executes one Upstash REST command with a short timeout, bounded retries and
 * a process-wide circuit breaker. A successful half-open probe closes the
 * circuit, so normal worker/request traffic resumes without a restart.
 */
export async function runKvCommand(command: unknown[], consumer = "PULSE"): Promise<unknown> {
  const url = process.env.KV_REST_API_URL?.replace(/\/$/, "").trim();
  const token = process.env.KV_REST_API_TOKEN?.trim();
  if (!url || !token) return undefined;

  const now = Date.now();
  if (now < circuit.openUntil) throw unavailable();
  const recovering = circuit.failures > 0;
  if (recovering && circuit.probeInFlight) throw unavailable("KV recovery probe is already running");
  if (recovering) circuit.probeInFlight = true;

  const timeoutMs = boundedEnv("KV_REQUEST_TIMEOUT_MS", 6_000, 250, 15_000);
  const retries = boundedEnv("KV_REQUEST_RETRIES", 1, 0, 2);
  let lastError: unknown;
  try {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(command),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = await response.json().catch(() => ({})) as { result?: unknown; error?: unknown };
        if (!response.ok || body.error) throw new Error(`KV command failed (${response.status}): ${String(body.error || response.statusText)}`);
        const wasRecovering = circuit.failures > 0;
        circuit.failures = 0; circuit.openUntil = 0; circuit.lastError = null; circuit.lastSuccessAt = new Date().toISOString();
        if (wasRecovering) console.info(`[KV] connection restored by ${consumer}; queued work can resume`);
        return body.result;
      } catch (error) {
        lastError = error;
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }

    circuit.failures += 1;
    const baseCooldown = boundedEnv("KV_CIRCUIT_COOLDOWN_MS", 15_000, 1_000, 120_000);
    const cooldown = Math.min(120_000, baseCooldown * 2 ** Math.min(circuit.failures - 1, 3));
    circuit.openUntil = Date.now() + cooldown;
    circuit.lastError = lastError instanceof Error ? lastError.message : String(lastError);
    circuit.lastFailureAt = new Date().toISOString();
    console.warn(`[KV] connection unavailable for ${consumer}; retrying automatically in ${Math.ceil(cooldown / 1000)}s`);
    throw unavailable(circuit.lastError, lastError);
  } finally {
    if (recovering) circuit.probeInFlight = false;
  }
}

export function isKvUnavailableError(error: unknown): error is KvUnavailableError {
  return error instanceof KvUnavailableError || (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "KV_TEMPORARILY_UNAVAILABLE");
}

export function isTransientConnectivityError(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const value = current as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
    if (["UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENETUNREACH", "EAI_AGAIN"].includes(String(value.code || ""))) return true;
    if (String(value.name || "") === "TimeoutError" || String(value.name || "") === "AbortError") return true;
    current = value.cause;
  }
  return false;
}

export function resetKvCircuitForTests() {
  circuit.failures = 0; circuit.openUntil = 0; circuit.probeInFlight = false;
  circuit.lastError = null; circuit.lastFailureAt = null; circuit.lastSuccessAt = null;
}
