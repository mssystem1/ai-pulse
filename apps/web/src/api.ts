const env = (import.meta as ImportMeta & { env: Record<string, string> }).env;

function isLocalHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1" ||
    host.endsWith(".local")
  );
}

/**
 * Resolve API origin.
 * - Prefer VITE_API_URL
 * - Local dev (localhost / 127.0.0.1): always hit :4000 (or same-origin via Vite proxy if VITE_USE_PROXY=1)
 * - Production: same origin (Vercel rewrites)
 */
function resolveApiBase(): string {
  if (env.VITE_API_URL) return env.VITE_API_URL.replace(/\/$/, "");
  if (env.NEXT_PUBLIC_API_URL) return env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");

  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    if (isLocalHost(hostname)) {
      // Use Vite proxy paths if enabled, else direct API port
      if (env.VITE_USE_PROXY === "1") return "";
      return "http://127.0.0.1:4000";
    }
    return origin;
  }
  return "http://127.0.0.1:4000";
}

export const API_BASE = resolveApiBase();

export type CallResult =
  | { ok: true; status: number; data: unknown }
  | {
      ok: false;
      status: number;
      data: unknown;
      paymentRequired?: string | null;
    };

export async function apiGet(path: string): Promise<CallResult> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, data };
    return { ok: true, status: res.status, data };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: { error: e instanceof Error ? e.message : "Network error" },
    };
  }
}

export async function apiPost(
  path: string,
  body?: unknown,
  opts?: { paymentSignature?: string },
): Promise<CallResult> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (opts?.paymentSignature?.trim()) {
      headers["PAYMENT-SIGNATURE"] = opts.paymentSignature.trim();
    }

    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 402) {
      return {
        ok: false,
        status: 402,
        data,
        paymentRequired:
          res.headers.get("PAYMENT-REQUIRED") || res.headers.get("payment-required"),
      };
    }
    if (!res.ok) return { ok: false, status: res.status, data };
    return { ok: true, status: res.status, data };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: { error: e instanceof Error ? e.message : "Network error" },
    };
  }
}
