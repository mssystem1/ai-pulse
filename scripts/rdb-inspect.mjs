// Offline only. Prints counts and schema metadata, never keys, values or secrets.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readRdb } from "./rdb-reader.mjs";
const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/rdb-inspect.mjs <local.rdb>");
const input = await readFile(path);
const rdb = readRdb(input);
const types = {}, groups = {}, databases = {};
let expired = 0;
for (const record of rdb.records) {
  types[record.type] = (types[record.type] || 0) + 1;
  databases[record.db] = (databases[record.db] || 0) + 1;
  if (record.expiresAt != null && record.expiresAt <= Date.now()) expired++;
  const key = record.key.toString();
  const group = key.includes("autopilot:pass:") ? "autopilot_passes" : key.includes("autopilot:strategy") || key.endsWith("autopilot:strategies") ? "autopilot_strategies"
    : key.includes("autopilot:") ? "autopilot_other" : key.includes("activity") ? "trading_activity" : key.includes("job") ? "jobs_and_indexes"
    : key.includes("report") ? "report_metadata" : key.includes("telegram") ? "telegram" : "other";
  groups[group] = (groups[group] || 0) + 1;
}
console.log(JSON.stringify({ bytes: input.length, sha256: createHash("sha256").update(input).digest("hex"), version: rdb.version,
  checksum: rdb.checksum, redisVersion: rdb.auxiliary["redis-ver"], snapshotAt: rdb.auxiliary.ctime ? new Date(Number(rdb.auxiliary.ctime) * 1000).toISOString() : null,
  records: rdb.records.length, databases, types, groups, expiredAtInspection: expired, productionWrites: 0 }, null, 2));
