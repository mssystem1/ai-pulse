import assert from "node:assert/strict";
import test from "node:test";
import { clearJobRecovery, forgetJobRecovery, listJobRecoveries, readJobRecovery, saveJobRecovery } from "./jobRecovery.js";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

test("persists, restores, and clears an opaque paid-job recovery capability", () => {
  const storage = memoryStorage();
  const handle = { jobId: "12345678-1234-1234-1234-123456789abc", recoveryToken: "x".repeat(43) };
  saveJobRecovery(storage, "arbitrum", handle);
  assert.deepEqual(readJobRecovery(storage, "arbitrum"), handle);
  assert.equal(readJobRecovery(storage, "base"), null);
  clearJobRecovery(storage, "arbitrum");
  assert.equal(readJobRecovery(storage, "arbitrum"), null);
});

test("keeps spot and prediction recovery capabilities independent", () => {
  const storage = memoryStorage();
  const prediction = { jobId: "12345678-1234-1234-1234-123456789abc", recoveryToken: "p".repeat(43) };
  const spot = { jobId: "abcdefab-1234-1234-1234-abcdefabcdef", recoveryToken: "s".repeat(43) };
  saveJobRecovery(storage, "base", prediction, "prediction");
  saveJobRecovery(storage, "base", spot, "spot");
  assert.deepEqual(readJobRecovery(storage, "base", "prediction"), prediction);
  assert.deepEqual(readJobRecovery(storage, "base", "spot"), spot);
});

test("removes malformed recovery data instead of issuing an unauthenticated request", () => {
  const storage = memoryStorage();
  storage.setItem("pulse:last-job:prediction:xlayer", JSON.stringify({ jobId: "bad", recoveryToken: "short" }));
  assert.equal(readJobRecovery(storage, "xlayer"), null);
  assert.equal(storage.length, 0);
});

test("keeps a device-local report history after the latest-job pointer clears", () => {
  const storage = memoryStorage();
  const first = { jobId: "12345678-1234-1234-1234-123456789abc", recoveryToken: "x".repeat(43), label: "ETH-USDT · 4H", tier: "premium" };
  const second = { jobId: "abcdefab-1234-1234-1234-abcdefabcdef", recoveryToken: "y".repeat(43), label: "BTC-USDT · 1D", tier: "base" };
  saveJobRecovery(storage, "base", first, "spot");
  saveJobRecovery(storage, "base", second, "spot");
  clearJobRecovery(storage, "base", "spot");
  assert.equal(listJobRecoveries(storage, "base", "spot").length, 2);
  forgetJobRecovery(storage, "base", "spot", first.jobId);
  assert.deepEqual(listJobRecoveries(storage, "base", "spot").map((item) => item.jobId), [second.jobId]);
});
