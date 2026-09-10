// No workers, wallet keys, payments or AI calls. Default is read-only.
// --write-test creates only random pulse:readiness:* keys with short TTLs.
import { randomUUID } from "node:crypto";
import { runNativeRedisCommand, closeNativeRedisConnections, validateRedisUrl } from "../apps/api/dist/nativeRedis.js";

const url = (process.argv.includes("--public") ? process.env.REDIS_PUBLIC_URL : process.env.REDIS_URL) || "";
const prefix = `pulse:readiness:${randomUUID()}`;
const key = `${prefix}:probe`;
const command = (...args) => runNativeRedisCommand(url, args);
try {
  validateRedisUrl(url);
  console.log(JSON.stringify({ configuration: "valid", privateHost: new URL(url).hostname.endsWith(".internal"), tls: new URL(url).protocol === "rediss:" }));
  console.log("Redis PING:", await command("PING"));
  console.log(JSON.stringify({ destinationKeyCount: Number(await command("DBSIZE")) }));
  const serverInfo = String(await command("INFO", "server"));
  const uptimeSeconds = Number(/^uptime_in_seconds:(\d+)/m.exec(serverInfo)?.[1]);
  console.log(JSON.stringify({ uptimeSeconds: Number.isFinite(uptimeSeconds) ? uptimeSeconds : null }));
  const info = String(await command("INFO", "persistence"));
  const field = name => new RegExp(`^${name}:(.*)$`, "m").exec(info)?.[1]?.trim() ?? "unknown";
  const config = await command("CONFIG", "GET", "maxmemory-policy", "appendonly", "appendfsync", "dir", "save");
  // Only the named, non-secret persistence settings are emitted.
  console.log(JSON.stringify({ persistence: { aofEnabled: field("aof_enabled"), aofLastWrite: field("aof_last_write_status"), rdbLastSave: field("rdb_last_bgsave_status") }, configuration: config }));
  if (process.argv.includes("--write-test")) {
    const first = await command("SET", key, "initial", "NX", "EX", 60);
    if (first !== "OK") throw new Error("Probe key already exists; refusing to overwrite");
    const contenders = await Promise.all(Array.from({ length: 4 }, () => command("SET", key, "wrong", "NX", "EX", 60)));
    if (contenders.some(value => value !== null)) throw new Error("NX lock failed");
    const cas = "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2],'EX',60); return 1";
    const changed = await command("EVAL", cas, 1, key, "initial", "updated");
    if (Number(changed) !== 1 || await command("GET", key) !== "updated") throw new Error("Atomic update failed");
    if (Number(await command("TTL", key)) <= 0) throw new Error("Expiry missing");
    console.log("Isolated write / read / NX lock / Lua CAS / TTL: passed");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Redis readiness check failed");
  process.exitCode = 1;
} finally {
  if (process.argv.includes("--write-test")) {
    try { await command("DEL", key); } catch { /* short TTL is the cleanup fallback */ }
  }
  closeNativeRedisConnections();
}
