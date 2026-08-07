import assert from "node:assert/strict";
import test from "node:test";
import { DurableJobWorker } from "./jobWorker.js";
import { MemoryJobStore } from "./jobs.js";

const input = (key: string) => ({
  idempotencyKey: key, requestHash: key, resourceUrl: "/v1/analysis/spot/standard",
  network: "eip155:196", mode: "spot" as const, tier: "standard" as const,
  payer: "0x0000000000000000000000000000000000000001", maxRegenerationAttempts: 2,
  input: { instId: "BTC-USDT" }, networkKey: "xlayer" as const, requesterIp: "127.0.0.1",
});

test("durable worker claims queued jobs and acknowledges completed work", async () => {
  const store = new MemoryJobStore();
  const acquired = await store.acquire(input("worker-success"));
  await store.enqueue(acquired.job.id);
  let executions = 0;
  const worker = new DurableJobWorker(store, 1, async (job) => {
    executions += 1;
    await store.transition(job.id, "completed");
  });
  await worker.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(executions, 1);
  assert.equal((await store.get(acquired.job.id))?.stage, "completed");
  assert.equal(await store.claim("other", 10), null);
});

test("expired leases are recoverable by a replacement worker", async () => {
  const store = new MemoryJobStore();
  const acquired = await store.acquire(input("worker-restart"));
  await store.enqueue(acquired.job.id);
  assert.equal((await store.claim("dead-worker", 0))?.id, acquired.job.id);
  assert.equal(await store.recoverExpired(), 1);
  let recovered = false;
  const replacement = new DurableJobWorker(store, 1, async (job) => {
    recovered = true;
    await store.transition(job.id, "completed");
  });
  await replacement.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(recovered, true);
});
