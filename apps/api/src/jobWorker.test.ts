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

test("temporary persistence loss does not stop the worker from recovering", async () => {
  const store = new MemoryJobStore();
  const acquired = await store.acquire(input("worker-persistence-recovery"));
  await store.enqueue(acquired.job.id);
  const recoverExpired = store.recoverExpired.bind(store);
  let connected = false;
  store.recoverExpired = async () => {
    if (!connected) throw new TypeError("fetch failed");
    return recoverExpired();
  };
  let executions = 0;
  const worker = new DurableJobWorker(store, 1, async (job) => {
    executions += 1;
    await store.transition(job.id, "completed");
  });

  await worker.start();
  assert.equal(executions, 0);

  connected = true;
  await worker.notify();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(executions, 1);
  assert.equal((await store.get(acquired.job.id))?.stage, "completed");
});

test("shutdown aborts generation and releases its receipt-bound job immediately", async () => {
  const store=new MemoryJobStore(),{job}=await store.acquire(input("shutdown"));await store.enqueue(job.id);
  let signal:AbortSignal|undefined;
  const worker=new DurableJobWorker(store,1,async (_job,activeSignal)=>{signal=activeSignal;await new Promise<void>((_,reject)=>activeSignal.addEventListener("abort",()=>reject(activeSignal.reason),{once:true}));});
  await worker.start();await worker.stop();
  assert.equal(signal?.aborted,true);
  const replacement=await store.claim("replacement",60);assert.equal(replacement?.id,job.id);
  assert.equal(replacement?.regenerationAttempts,0);
  await worker.notify();assert.equal((await store.queueStats()).leased,1);
});

test("a worker that lost its lease cannot publish over its replacement", async () => {
  const store=new MemoryJobStore(),{job}=await store.acquire(input("fenced"));await store.enqueue(job.id);
  await store.claim("old",0);await store.recoverExpired();await store.claim("replacement",60);
  await assert.rejects(store.attachReport(job.id,"stale-report",false,"old"),/lease lost/);
  await assert.rejects(store.transition(job.id,"generating_analysis",undefined,"old"),/lease lost/);
  await store.attachReport(job.id,"correct-report",false,"replacement");
  assert.equal((await store.attachReport(job.id,"stale-report",false,"old")).reportId,"correct-report");
  assert.equal((await store.transition(job.id,"failed_terminal")).stage,"completed");
});

test("a lost heartbeat aborts in-flight work without releasing another owner's lease", async () => {
  const store=new MemoryJobStore(),{job}=await store.acquire(input("lost-heartbeat"));await store.enqueue(job.id);
  store.extendLease=async()=>false;
  let aborted!:()=>void,observedAbort=false;const didAbort=new Promise<void>(resolve=>{aborted=resolve;});
  const worker=new DurableJobWorker(store,1,async (_job,signal)=>{
    await new Promise<void>((_,reject)=>signal.addEventListener("abort",()=>{observedAbort=true;aborted();reject(signal.reason);},{once:true}));
  },1.5);
  await worker.start();
  // Keep the test alive; the production heartbeat deliberately uses unref().
  const timeout=setTimeout(()=>aborted(),2000);
  await didAbort;clearTimeout(timeout);assert.equal(observedAbort,true);await worker.stop();
  assert.equal((await store.get(job.id))?.stage,"payment_authorized");
});
