// Read-only post-import inventory. Never starts workers, claims jobs or changes passes.
import { runNativeRedisCommand, closeNativeRedisConnections } from "../apps/api/dist/nativeRedis.js";
const url = process.argv.includes("--public") ? process.env.REDIS_PUBLIC_URL : process.env.REDIS_URL;
const command = (...args) => runNativeRedisCommand(url || "", args, 15000);
try {
  const keys = new Set();
  let cursor = "0";
  do {
    const page = await command("SCAN", cursor, "COUNT", 500);
    cursor = String(page[0]);
    for (const key of page[1]) keys.add(key);
  } while (cursor !== "0");
  const counts = { total: keys.size, pulse: 0, unrelated: 0, passes: 0, reports: 0, jobs: 0 };
  const jobStates = {};
  const namespaces = new Set([process.env.PERSISTENCE_NAMESPACE || "pulse"]);
  for (const key of keys) {
    if (!key.startsWith("pulse:")) { counts.unrelated++; continue; }
    counts.pulse++;
    if (key.startsWith("pulse:v6:autopilot:pass:")) counts.passes++;
    if (key.includes(":report:")) { counts.reports++; namespaces.add(key.slice(0, key.indexOf(":report:"))); }
    if (key.includes(":jobs:ready")) namespaces.add(key.slice(0, key.indexOf(":jobs:ready")));
    if (key.includes(":jobs:leased")) namespaces.add(key.slice(0, key.indexOf(":jobs:leased")));
    if (key.includes(":job:")) {
      namespaces.add(key.slice(0, key.indexOf(":job:")));
      counts.jobs++;
      const raw = await command("GET", key);
      if (raw == null) { jobStates.expiredDuringAudit = (jobStates.expiredDuringAudit || 0) + 1; continue; }
      const job = JSON.parse(raw);
      const known = ["payment_authorized", "payment_verified", "payment_settled", "fetching_context", "calculating_features", "generating_analysis", "validating_report", "completed", "completed_partial", "failed_retriable", "failed_terminal", "manual_reconciliation"];
      const state = known.includes(job.stage) ? job.stage : "other";
      jobStates[state] = (jobStates[state] || 0) + 1;
    }
  }
  const persistence = String(await command("INFO", "persistence"));
  const field = name => new RegExp(`^${name}:(.*)$`, "m").exec(persistence)?.[1]?.trim() ?? "unknown";
  const queues = [];
  for (const namespace of namespaces) queues.push({ namespace, ready: Number(await command("ZCARD", `${namespace}:jobs:ready`)), leased: Number(await command("ZCARD", `${namespace}:jobs:leased`)) });
  console.log(JSON.stringify({ counts, registeredStrategies: Number(await command("HLEN", "pulse:v6:autopilot:strategy-map")),
    queues, jobStates,
    persistence: { aofEnabled: field("aof_enabled"), aofLastWrite: field("aof_last_write_status"), aofRewrite: field("aof_last_bgrewrite_status"), aofPendingFsync: field("aof_pending_bio_fsync"), aofBytes: field("aof_current_size") },
    readOnly: true, workersStarted: false }));
} catch (error) {
  console.error(String(error?.message || "Recovery audit failed").replace(/rediss?:\/\/\S+/g, "[redacted]"));
  process.exitCode = 1;
} finally { closeNativeRedisConnections(); }
