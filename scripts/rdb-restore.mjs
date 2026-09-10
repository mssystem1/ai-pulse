// Offline plan by default. --stage round-trips disposable, namespaced keys only.
// --restore is a production write and requires explicit maintenance + volume
// acknowledgements, the exact file hash, durable Redis, and an EMPTY destination.
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { readRdb } from "./rdb-reader.mjs";
import { selectPulseRecords } from "./rdb-scope.mjs";
import { runNativeRedisCommand, closeNativeRedisConnections } from "../apps/api/dist/nativeRedis.js";
const file = process.argv[2];
if (!file || file.startsWith("--")) throw new Error("Usage: node --env-file=.env scripts/rdb-restore.mjs <local.rdb> [--stage|--restore] [--public]");
const restore = process.argv.includes("--restore"), stage = process.argv.includes("--stage");
if (restore && stage) throw new Error("Choose stage or restore, never both");
const data = await readFile(file), sha256 = createHash("sha256").update(data).digest("hex"), rdb = readRdb(data);
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const decode = buffer => { const text = textDecoder.decode(buffer); assert.ok(Buffer.from(text).equals(buffer), "Binary/noncanonical UTF-8 data requires a binary-safe importer"); return text; };
const scopedRecords = selectPulseRecords(rdb.records);
const records = scopedRecords.map(record => {
  assert.equal(record.db, 0, "Multiple logical databases require a separate restoration plan");
  const key = decode(record.key);
  assert.ok(key.startsWith("pulse:"), "Non-PULSE namespace present; review before restoring");
  const payload = record.type === "string" ? decode(record.value) : record.type === "hash"
    ? record.value.flatMap(([field, value]) => [decode(field), decode(value)]) : record.type === "zset"
      ? record.value.flatMap(([member, score]) => [decode(member), String(score)]) : record.value.map(decode);
  return { key, type: record.type, payload, expiresAt: record.expiresAt };
});
console.log(JSON.stringify({ sha256, checksum: rdb.checksum, snapshotAt: rdb.auxiliary.ctime ? new Date(Number(rdb.auxiliary.ctime) * 1000).toISOString() : null,
  mode: restore ? "production restore" : stage ? "disposable staging round trip" : "offline plan only", records: records.length, unrelatedRecordsExcluded: rdb.records.length - scopedRecords.length,
  expiredNow: records.filter(record => record.expiresAt != null && record.expiresAt <= Date.now()).length }));
if (!restore && !stage) process.exit(0);
if (restore && (!process.argv.includes("--writers-stopped") || !process.argv.includes("--volume-verified")
  || !process.argv.includes(`--sha256=${sha256}`))) throw new Error("Restore requires --writers-stopped --volume-verified --sha256=<exact export hash>; do not use these flags without completing those checks");
const url = process.argv.includes("--public") ? process.env.REDIS_PUBLIC_URL : process.env.REDIS_URL;
const command = (...args) => runNativeRedisCommand(url || "", args, 15000);
const stagePrefix = `pulse:recovery-test:${randomUUID()}:`;
const attemptedKeys = new Set();
const restoreLua = `if redis.call('EXISTS',KEYS[1])==1 then return redis.error_reply('DESTINATION_CONFLICT') end
local kind=ARGV[1];local v=cjson.decode(ARGV[2]);local expiry=tonumber(ARGV[3])
local now=redis.call('TIME');local ms=tonumber(now[1])*1000+math.floor(tonumber(now[2])/1000)
if expiry>0 and expiry<=ms then return 0 end
if kind=='string' then redis.call('SET',KEYS[1],v)
elseif kind=='hash' then for i=1,#v,2 do redis.call('HSET',KEYS[1],v[i],v[i+1]) end
elseif kind=='list' then for i=1,#v do redis.call('RPUSH',KEYS[1],v[i]) end
elseif kind=='set' then for i=1,#v do redis.call('SADD',KEYS[1],v[i]) end
elseif kind=='zset' then for i=1,#v,2 do redis.call('ZADD',KEYS[1],v[i+1],v[i]) end
else return redis.error_reply('UNSUPPORTED_TYPE') end
if expiry>0 then redis.call('PEXPIREAT',KEYS[1],expiry) end
return 1`;
const inspectLua = `local t=redis.call('TYPE',KEYS[1]).ok
if t=='none' then return nil end
local v
if t=='string' then v=redis.call('GET',KEYS[1])
elseif t=='hash' then v=redis.call('HGETALL',KEYS[1])
elseif t=='list' then v=redis.call('LRANGE',KEYS[1],0,-1)
elseif t=='set' then v=redis.call('SMEMBERS',KEYS[1])
elseif t=='zset' then v=redis.call('ZRANGE',KEYS[1],0,-1,'WITHSCORES') end
local ttl=redis.call('PTTL',KEYS[1]);local now=redis.call('TIME')
return {t,v,ttl,now[1],now[2]}`;
function canonical(type, payload) {
  if (type === "hash" || type === "zset") {
    const pairs = []; for (let i = 0; i < payload.length; i += 2) pairs.push([payload[i], type === "zset" ? Number(payload[i + 1]) : payload[i + 1]]);
    return JSON.stringify(pairs.sort((a, b) => a[0].localeCompare(b[0])));
  }
  return JSON.stringify(type === "set" ? [...payload].sort() : payload);
}
let verified = 0, expired = 0;
try {
  assert.equal(await command("PING"), "PONG");
  if (restore) {
    const config = await command("CONFIG", "GET", "appendonly", "maxmemory-policy");
    const settings = Object.fromEntries(Array.from({ length: config.length / 2 }, (_, i) => [config[2 * i], config[2 * i + 1]]));
    assert.equal(settings.appendonly, "yes", "Enable persistent AOF before production recovery");
    assert.equal(settings["maxmemory-policy"], "noeviction", "Paid records must not be evicted");
    assert.equal(Number(await command("DBSIZE")), 0, "Destination is not empty; merge/reconciliation is required, never overwrite it");
  }
  for (let start = 0; start < records.length; start += 8) {
    const results = await Promise.allSettled(records.slice(start, start + 8).map(async record => {
      const key = stage ? stagePrefix + record.key : record.key;
      const expiration = stage ? Date.now() + 15 * 60000 : record.expiresAt ?? -1;
      attemptedKeys.add(key);
      const wrote = Number(await command("EVAL", restoreLua, 1, key, record.type, JSON.stringify(record.payload), expiration));
      if (wrote === 0) { expired++; return; }
      const check = await command("EVAL", inspectLua, 1, key);
      if (!check && !stage && expiration > 0 && expiration <= Date.now()) { expired++; return; }
      assert.ok(check && check[0] === record.type && canonical(record.type, check[1]) === canonical(record.type, record.payload), "Restored content differs; do not start workers");
      if (expiration === -1) assert.equal(Number(check[2]), -1);
      else {
        const serverNow = Number(check[3]) * 1000 + Math.floor(Number(check[4]) / 1000);
        assert.ok(Number(check[2]) >= 0 && Math.abs(serverNow + Number(check[2]) - expiration) < 50, "Restored expiration differs");
      }
      verified++;
    }));
    const failure = results.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    if (start % 400 === 0) console.log(JSON.stringify({ verified, expired }));
  }
  console.log(JSON.stringify({ verified, expired, complete: verified + expired === records.length, sourceModified: false, workersStarted: false }));
} catch (error) {
  console.error("Restore check failed:", String(error?.message || "unknown").replace(/rediss?:\/\/\S+/g, "[redacted]"));
  if (restore) console.error("Partial restore may exist. Keep workers stopped; do not delete records or retry against a non-empty destination.");
  process.exitCode = 1;
} finally {
  if (stage) {
    const keys = [...attemptedKeys];
    for (const key of keys) assert.ok(key.startsWith(stagePrefix));
    try {
      for (let i = 0; i < keys.length; i += 100) await command("DEL", ...keys.slice(i, i + 100));
      console.log("Removed exact disposable staging keys; live PULSE records untouched.");
    } catch { console.error("Staging cleanup incomplete. Exact namespace:", stagePrefix); process.exitCode = 1; }
  }
  closeNativeRedisConnections();
}
