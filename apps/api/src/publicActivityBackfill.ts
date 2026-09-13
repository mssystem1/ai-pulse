/** Operator-only, dry-run by default. Never invoked by public page visits. */
import { loadConfig } from "@pulse/config";
import { createPersistence, type AnalysisJob } from "./jobs.js";
import { createPublicActivityStore, jobResearchDelivery, PublicActivityStore } from "./publicActivity.js";
import { StoreRedis } from "./storeRedis.js";

const cfg = loadConfig();
if (cfg.QUEUE_PROVIDER === "memory") throw new Error("Historical backfill requires the existing durable PULSE store");
const allowed = new Set(["--write"]);
if (process.argv.slice(2).some(arg => !allowed.has(arg))) throw new Error("Usage: publicActivityBackfill.ts [--write]. Default is a read-only preview.");
const write = process.argv.includes("--write");
const source = new StoreRedis(cfg.QUEUE_PROVIDER === "redis" ? cfg.REDIS_URL : cfg.KV_REST_API_URL, cfg.KV_REST_API_TOKEN);
const persistence = createPersistence(cfg);
const projection = write ? createPublicActivityStore(cfg) : new PublicActivityStore();
const prefix = `${cfg.PERSISTENCE_NAMESPACE || "pulse"}:job:`;
let cursor = "0", pages = 0, examined = 0, added = 0, unverifiable = 0, excluded = 0;
const seenKeys = new Set<string>();
do {
  const page = await source.scan(cursor, { match: `${prefix}*`, count: 100 });
  cursor = String(page[0]);
  for (const key of page[1]) {
    if (!key.startsWith(prefix) || seenKeys.has(key)) continue;
    seenKeys.add(key); examined++;
    const job = await source.get<AnalysisJob>(key);
    const delivery = job && jobResearchDelivery(job);
    if (!delivery || !job?.reportId) { excluded++; continue; }
    try {
      // A paid fixture is still synthetic: inspect the checksum-verified private report.
      // Neither its content nor its wallet/recovery credentials are printed or made public.
      const record = await persistence.reports.get(job.reportId);
      const report = record && await persistence.reports.read(record) as { fixture?: boolean; analysisProfile?: { mode?: string } } | null;
      if (!report || report.fixture || report.analysisProfile?.mode !== "live") { unverifiable++; continue; }
      if (await projection.record(delivery)) added++;
    } catch { unverifiable++; }
  }
  pages++;
  if (pages % 10 === 0) console.log(JSON.stringify({ mode: write ? "write" : "preview", pages, examined, added, unverifiable, excluded }));
  // Bound resource use. Never claim that a stopped or concurrent SCAN covers all history.
  if (pages >= 500 || examined >= 50_000) break;
} while (cursor !== "0");
const snapshot = await projection.snapshot();
console.log(JSON.stringify({ mode: write ? "write" : "preview", scanCompleted: cursor === "0", examined, added, unverifiable, excluded,
  research: snapshot.research, note: "Observed surviving live reports only, not all-time totals. Earlier inline Risk Guard deliveries are not recoverable from job records. Re-running is idempotent." }, null, 2));
// Native Redis transports may keep sockets alive; all requested work above is awaited.
process.exit(0);
