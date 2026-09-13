import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { StoreRedis } from "./storeRedis.js";
import { PublicActivityStore, researchDelivery } from "./publicActivity.js";
import type { PaymentReceipt } from "./jobs.js";
import { NETWORK_REGISTRY } from "@pulse/config";
import { closeNativeRedisConnections } from "./nativeRedis.js";

const endpoint=process.env.PUBLIC_ACTIVITY_REDIS_TEST_URL;
test("local Redis-compatible TCP/Lua: concurrent dedupe, exact volume and cold-reader persistence", {skip:!endpoint}, async()=>{
  const url=new URL(endpoint!);
  assert.ok(url.protocol==='redis:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname) && !url.username && !url.password,"This test only writes to an unauthenticated loopback test server");
  const namespace=`pulse-local-activity-test:${randomUUID()}`;
  const redis=new StoreRedis(endpoint!);
  const store=new PublicActivityStore(redis,namespace);
  const chain=NETWORK_REGISTRY['arc-testnet'];
  const receipt={network:chain.caip2,chainId:chain.chainId,provider:chain.paymentProvider,authorizationId:'fixture-local-only',requestHash:'local-hash',verificationResult:'accepted_by_middleware',settlementResult:'settled',settlementMode:'gateway_batch',finality:{status:'gateway_batch_accepted',scope:'gateway'}} as PaymentReceipt;
  const delivery=researchDelivery(receipt,'prediction','2026-09-12T12:00:00Z')!;
  const suffixes=['seen','research','executions-seen','executions','volume'];
  try{
    const added=await Promise.all(Array.from({length:25},()=>store.record(delivery)));
    assert.equal(added.filter(Boolean).length,1);
    const fill={chain:'eip155:8453',service:'spot' as const,txHash:`0x${'a'.repeat(64)}`,at:'2026-09-12T12:00:00Z',settlementAsset:NETWORK_REGISTRY.base.paymentAsset.address!,settlementAtomic:'999999999999999999'};
    assert.equal(await store.recordExecution(fill),true);
    assert.equal(await store.recordExecution({...fill,txHash:`0x${'b'.repeat(64)}`,settlementAtomic:'1'}),true);
    assert.equal(await store.recordExecution(fill),false);
    const cold=await new PublicActivityStore(new StoreRedis(endpoint!),namespace).snapshot();
    assert.equal(cold.research.prediction?.count,1);
    assert.equal(cold.execution.spot?.count,2);
    assert.equal(cold.execution.spot?.byChain[0].amount,'1000000000000.000000');
    assert.equal(cold.persistence,'durable');
    assert.equal(await redis.eval("return redis.call('TTL',KEYS[1])",[`${namespace}:public-activity:research:v1`],[]),-1);
  }finally{
    // Exact keys in this test's random namespace only. Never FLUSHDB or scan-delete.
    try { await redis.del(...suffixes.map(suffix=>`${namespace}:public-activity:${suffix}:v1`)); }
    finally { closeNativeRedisConnections(); }
  }
});
