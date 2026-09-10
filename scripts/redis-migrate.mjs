// Default: read-only source inventory. --copy requires an explicit stopped-writer
// acknowledgement. Never deletes source keys or overwrites destination records.
import assert from "node:assert/strict";
import { runNativeRedisCommand, closeNativeRedisConnections } from "../apps/api/dist/nativeRedis.js";

const copy = process.argv.includes("--copy");
const prefix = process.argv.find(arg => arg.startsWith("--prefix="))?.slice(9) || "pulse:";
if (!/^[a-zA-Z0-9:_-]{3,100}:$/.test(prefix)) throw new Error("Use one explicit PULSE namespace prefix ending in a colon");
if (copy && !process.argv.includes("--writers-stopped")) throw new Error("Stop API payment acceptance and all database writers first; then explicitly pass --writers-stopped");
const targetUrl = process.argv.includes("--public") ? process.env.REDIS_PUBLIC_URL : process.env.REDIS_URL;
const sourceUrl = process.env.KV_REST_API_URL;
const sourceToken = process.env.KV_REST_API_TOKEN;
const snapshotLua = `local t=redis.call('TYPE',KEYS[1]).ok
if t=='none' then return nil end
local commands={string='GET',hash='HGETALL',list='LRANGE',set='SMEMBERS',zset='ZRANGE'}
if not commands[t] then return redis.error_reply('Unsupported migration key type') end
local v
if t=='list' then v=redis.call(commands[t],KEYS[1],0,-1)
elseif t=='zset' then v=redis.call(commands[t],KEYS[1],0,-1,'WITHSCORES')
else v=redis.call(commands[t],KEYS[1]) end
return {t,redis.call('PTTL',KEYS[1]),v}`;
const restoreLua = `if redis.call('EXISTS',KEYS[1])==1 then return 0 end
local t=ARGV[1]; local v=cjson.decode(ARGV[2]); local ttl=tonumber(ARGV[3])
if ttl~=-1 and ttl<=0 then return -1 end
if t=='string' then redis.call('SET',KEYS[1],v)
elseif t=='hash' then for i=1,#v,2 do redis.call('HSET',KEYS[1],v[i],v[i+1]) end
elseif t=='list' then for i=1,#v do redis.call('RPUSH',KEYS[1],v[i]) end
elseif t=='set' then for i=1,#v do redis.call('SADD',KEYS[1],v[i]) end
elseif t=='zset' then for i=1,#v,2 do redis.call('ZADD',KEYS[1],v[i+1],v[i]) end
else return redis.error_reply('Unsupported migration key type') end
if ttl>0 then redis.call('PEXPIRE',KEYS[1],ttl) end
return 1`;
async function source(command) {
  if (!sourceUrl || !sourceToken) throw new Error("Keep the old Upstash connection variables for migration");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(sourceUrl, { method: "POST", headers: { Authorization: `Bearer ${sourceToken}`, "Content-Type": "application/json" }, body: JSON.stringify(command), signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (!response.ok || body.error) {
        const category = /max requests|limit exceeded/i.test(String(body.error)) ? "quota exhausted"
          : /rate|too many/i.test(String(body.error)) ? "rate limited" : `HTTP ${response.status}, source rejected command`;
        if ((response.status === 429 || response.status >= 500) && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
        throw new Error(`Source read failed (${category}); migration incomplete. Keep the source database.`);
      }
      return body.result;
    } catch (error) {
      if (String(error?.message).startsWith("Source read failed")) throw error;
      if (attempt === 2) throw new Error("Source connection failed after three bounded read attempts; migration incomplete");
    }
  }
}
const target = command => runNativeRedisCommand(targetUrl || "", command, 15000);
async function keys() {
  const found = new Set(); let cursor = "0";
  do {
    const page = await source(["SCAN", cursor, "MATCH", `${prefix}*`, "COUNT", 1000]);
    cursor = String(page[0]);
    for (const key of page[1]) { assert.ok(key.startsWith(prefix)); found.add(key); }
  } while (cursor !== "0");
  return [...found].sort();
}
function normalized(type, value) {
  if (type === "hash" || type === "zset") {
    const pairs = []; for (let i = 0; i < value.length; i += 2) pairs.push([value[i], value[i + 1]]);
    return JSON.stringify(pairs.sort((a, b) => a[0].localeCompare(b[0])));
  }
  return JSON.stringify(type === "set" ? [...value].sort() : value);
}
try {
  const inventory = await keys();
  console.log(JSON.stringify({ sourceKeys: inventory.length, prefix, mode: copy ? "copy-without-overwrite" : "read-only inventory" }));
  if (copy) {
    assert.equal(await target(["PING"]), "PONG");
    const counts = {}; let copied = 0, matched = 0, expired = 0;
    for (const key of inventory) {
      const started = Date.now();
      const snapshot = await source(["EVAL", snapshotLua, 1, key]);
      if (!snapshot) { expired++; continue; }
      const [type, ttl, payload] = snapshot;
      counts[type] = (counts[type] || 0) + 1;
      const remaining = Number(ttl) === -1 ? -1 : Number(ttl) - (Date.now() - started);
      if (remaining !== -1 && remaining <= 0) { expired++; continue; }
      const result = Number(await target(["EVAL", restoreLua, 1, key, type, JSON.stringify(payload), remaining]));
      const check = await target(["EVAL", snapshotLua, 1, key]);
      if (!check && remaining > 0) { expired++; continue; }
      assert.ok(check && check[0] === type && normalized(type, check[2]) === normalized(type, payload), "Destination conflict: refusing to overwrite. No cutover is safe until reconciled.");
      assert.ok(Number(ttl) === -1 ? Number(check[1]) === -1 : Number(check[1]) > 0 && Number(check[1]) <= remaining + 1000,
        "Destination expiry differs; do not cut over");
      if (result === 1) copied++; else matched++;
      if ((copied + matched) % 100 === 0) console.log(JSON.stringify({ copied, matched, expired }));
    }
    const finalKeys = await keys();
    assert.ok(finalKeys.every(key => inventory.includes(key)), "New source records appeared. Writers are not stopped; do not cut over.");
    console.log(JSON.stringify({ copied, matched, expired, types: counts, sourceDeleted: false, deploymentChanged: false }));
  }
} catch (error) {
  console.error(String(error?.message || "Migration failed").replace(/(?:rediss?|https?):\/\/\S+/g, "[redacted endpoint]"));
  process.exitCode = 1;
} finally { closeNativeRedisConnections(); }
