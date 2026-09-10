import { Redis } from "ioredis";

// One connection per backend per process. Never buffer or automatically replay
// writes after disconnect: an acknowledged-lost payment update may have executed.
const connections = new Map<string, { client: Redis; connecting?: Promise<void>; lastError?: string }>();

export function validateRedisUrl(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("REDIS_URL must be a valid redis:// or rediss:// connection URL"); }
  if (!["redis:", "rediss:"].includes(parsed.protocol) || !parsed.hostname || /\$\{\{|[<>\s]/.test(url)) {
    throw new Error("REDIS_URL must be a valid redis:// or rediss:// connection URL");
  }
}

export async function runNativeRedisCommand(url: string, command: unknown[], timeoutMs = 6_000): Promise<unknown> {
  validateRedisUrl(url);
  let connection = connections.get(url);
  if (!connection) {
    const client = new Redis(url, {
      lazyConnect: true, connectTimeout: timeoutMs, commandTimeout: timeoutMs,
      enableOfflineQueue: false, autoResendUnfulfilledCommands: false,
      maxRetriesPerRequest: 0, retryStrategy: () => null,
      connectionName: "pulse", family: 0,
    });
    // Callers receive errors through command/connect promises; don't emit raw
    // connection errors (which can contain a credential-bearing URL) to logs.
    connection = { client };
    const entry = connection;
    client.on("error", error => { entry.lastError = String(error); });
    connections.set(url, connection);
  }
  try {
    if (connection.client.status !== "ready") {
      connection.connecting ??= connection.client.connect().finally(() => { connection!.connecting = undefined; });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([connection.connecting, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Redis connection timeout")), timeoutMs);
        })]);
      } finally { if (timer) clearTimeout(timer); }
    }
    const [name, ...args] = command;
    if (typeof name !== "string" || !name) throw new Error("Redis command name required");
    return await connection.client.call(name, ...args.map((arg) => String(arg)));
  } catch (error) {
    connection.client.disconnect();
    if (connections.get(url) === connection) connections.delete(url);
    // Whitelist useful categories, never echo server replies or command values.
    const detail = `${String(error)} ${connection.lastError || ""}`;
    const category = /WRONGPASS|NOAUTH|AUTH/i.test(detail) ? "authentication failed"
      : /ENOTFOUND|EAI_AGAIN/i.test(detail) ? "hostname unavailable (private Railway hosts require Railway networking)"
      : /OOM/i.test(detail) ? "memory limit reached"
      : /READONLY/i.test(detail) ? "server is read-only"
      : /timeout/i.test(detail) ? "request timed out; outcome may be unknown"
      : "connection or command failed";
    throw new Error(`Redis ${category}`);
  }
}

export function closeNativeRedisConnections() {
  for (const { client } of connections.values()) client.disconnect();
  connections.clear();
}
