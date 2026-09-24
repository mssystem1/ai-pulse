import assert from "node:assert/strict";
import test from "node:test";
import { RobinhoodPaymentJournal } from "./robinhoodPaymentJournal.js";
import type { StoreRedis } from "./storeRedis.js";
import type { RobinhoodAttempt } from "@pulse/payments";

test("Robinhood claims use a dedicated namespace, NX and no expiry; updates use compare-and-set", async () => {
  const calls: unknown[][] = [];
  const redis = {
    set: async (...args: unknown[]) => { calls.push(["set", ...args]); return "OK"; },
    eval: async (...args: unknown[]) => { calls.push(["eval", ...args]); return 1; },
    get: async (...args: unknown[]) => { calls.push(["get", ...args]); return null; },
  } as unknown as StoreRedis;
  const journal = new RobinhoodPaymentJournal(redis);
  const previous = { id: "a".repeat(64), version: 1, phase: "pending" } as RobinhoodAttempt;
  const next = { ...previous, phase: "settled" as const };
  assert.equal(await journal.claim(previous), true);
  assert.deepEqual(calls[0], ["set", `pulse:payments:robinhood:v1:${previous.id}`, previous, { nx: true }]);
  assert.equal(await journal.replace(previous, next), true);
  assert.match(String(calls[1][1]), /redis.call\('GET', KEYS\[1\]\) == ARGV\[1\]/);
  assert.deepEqual(calls[1][3], [JSON.stringify(previous), JSON.stringify(next)]);
  await assert.rejects(journal.replace(previous, { ...next, id: "b".repeat(64) }), /identity/);
  assert.throws(() => journal.get("../../other-project"), /Invalid/);
});
test("duplicate claims and lost compare-and-set races report false, never overwrite", async () => {
  const redis = { set: async () => null, eval: async () => 0 } as unknown as StoreRedis;
  const journal = new RobinhoodPaymentJournal(redis);
  const row = { id: "b".repeat(64) } as RobinhoodAttempt;
  assert.equal(await journal.claim(row), false);
  assert.equal(await journal.replace(row, row), false);
});
