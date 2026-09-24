import assert from "node:assert/strict";
import test from "node:test";
import type { StoreRedis } from "./storeRedis.js";
import { RedisRobinhoodGasJournal } from "./robinhoodGasJournal.js";
const signer = `0x${"1".repeat(40)}` as const;
test("gas nonce reservation survives lock cleanup and checks ownership before writing", async () => {
  const calls: unknown[][] = [];
  const redis = {
    set: async (...args: unknown[]) => { calls.push(["set", ...args]); return "OK"; },
    get: async () => null,
    eval: async (...args: unknown[]) => { calls.push(["eval", ...args]); return 1; },
  } as unknown as StoreRedis;
  const journal = new RedisRobinhoodGasJournal(redis);
  await journal.exclusive(signer, async (previous, save) => {
    assert.equal(previous, null);
    await save({ nonce: 3, transaction: `0x${"a".repeat(64)}`, payer: signer, authorizationNonce: `0x${"b".repeat(64)}`, recordedAt: new Date().toISOString() });
  });
  assert.deepEqual(calls[0][3], { nx: true, ex: 120 });
  assert.match(String(calls[1][1]), /~= ARGV\[1\]/);
  assert.match(String(calls[1][1]), /'SET', KEYS\[2\], ARGV\[2\]/);
  assert.equal((calls[2][2] as unknown[]).length, 1, "Cleanup must only address the lock, not the prepared nonce record");
});
test("busy or lost signer lock stops before broadcast and never steals a new owner's lock", async () => {
  const busy = new RedisRobinhoodGasJournal({ set: async () => null } as unknown as StoreRedis);
  await assert.rejects(busy.exclusive(signer, async () => { assert.fail("Must not enter"); }), /busy/);
  const lost = new RedisRobinhoodGasJournal({ set: async () => "OK", get: async () => null, eval: async () => 0 } as unknown as StoreRedis);
  await assert.rejects(lost.exclusive(signer, async (_previous, save) => {
    await save({ nonce: 1, transaction: `0x${"a".repeat(64)}`, payer: signer, authorizationNonce: `0x${"b".repeat(64)}`, recordedAt: new Date().toISOString() });
    assert.fail("Must not broadcast");
  }), /lease lost/);
});
