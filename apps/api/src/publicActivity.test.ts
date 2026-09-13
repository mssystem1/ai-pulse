import test from "node:test";
import assert from "node:assert/strict";
import { NETWORK_REGISTRY } from "@pulse/config";
import { PublicActivityStore, researchDelivery, jobResearchDelivery } from "./publicActivity.js";
import type { PaymentReceipt, AnalysisJob } from "./jobs.js";

function receipt(key: keyof typeof NETWORK_REGISTRY, id = "payment"): PaymentReceipt {
  const chain = NETWORK_REGISTRY[key];
  return { id, provider: chain.paymentProvider, network: chain.caip2, chainId: chain.chainId, asset: chain.paymentAsset.address!, amountAtomic: "200000", payer: "private-wallet", payee: "private-payee", authorizationId: id, resourceUrl: "/private", requestHash: "private-request", verificationResult: "accepted_by_middleware", settlementResult: "settled", settlementMode: chain.environment === "testnet" ? "gateway_batch" : "synchronous_onchain", finality: { status: "facilitator_confirmed", scope: "l1" }, createdAt: "2026-09-12T10:00:00.000Z", verifiedAt: "2026-09-12T10:00:00.000Z", settledAt: "2026-09-12T10:00:00.000Z" };
}
test("public analysis totals combine chains including Arc, with separate services and private-data exclusion", async () => {
  const store = new PublicActivityStore();
  for (const key of Object.keys(NETWORK_REGISTRY) as (keyof typeof NETWORK_REGISTRY)[]) {
    for (const service of ["global", "prediction", "risk"] as const) await store.record(researchDelivery(receipt(key), service, "2026-09-12T10:00:00.000Z"));
  }
  const stats = await store.snapshot();
  assert.equal(stats.research.global?.count, 4);
  assert.equal(stats.research.prediction?.count, 4);
  assert.equal(stats.research.risk?.count, 4);
  assert.equal(stats.networks.find(chain => chain.environment === "testnet")?.research.risk?.count, 1);
  assert.equal(stats.execution.spot, null);
  assert.equal(stats.historicalCoverageComplete, false);
  assert.equal(JSON.stringify(stats).includes("private-"), false);
});
test("recovery, migration and retries do not inflate counts; partial delivery is explicit", async () => {
  const store = new PublicActivityStore();
  const delivered = researchDelivery(receipt("base"), "global", "2026-09-12T10:00:00.000Z", true)!;
  assert.equal(await store.record(delivered), true);
  assert.equal(await store.record({ ...delivered, at: "2026-09-13T10:00:00.000Z" }), false);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.research.global?.count, 1);
  assert.equal(snapshot.research.global?.partial, 1);
  assert.equal(snapshot.research.prediction, null);
});
test("mock, unknown chain, mismatched identity and incomplete jobs are excluded", () => {
  const base = receipt("base");
  assert.equal(researchDelivery({ ...base, settlementMode: "mock" }, "risk", base.createdAt), null);
  assert.equal(researchDelivery({ ...base, chainId: 196 }, "risk", base.createdAt), null);
  assert.equal(researchDelivery({ ...base, network: "eip155:999999" }, "risk", base.createdAt), null);
  assert.equal(jobResearchDelivery({ reportId: "report", stage: "failed_terminal", mode: "spot", receipt: base } as AnalysisJob), null);
  assert.equal(jobResearchDelivery({ reportId: null, stage: "completed", mode: "spot", receipt: base } as AnalysisJob), null);
});
test("execution projection counts a confirmed transaction once and keeps exact settlement-asset units", async () => {
  const store = new PublicActivityStore();
  const fill = { chain: "eip155:8453", service: "spot" as const, txHash: `0x${"a".repeat(64)}`, at: "2026-09-12T10:00:00Z", settlementAsset: NETWORK_REGISTRY.base.paymentAsset.address!, settlementAtomic: "1234567" };
  assert.equal(await store.recordExecution(fill), true);
  assert.equal(await store.recordExecution({...fill, service:"autopilot"}), false);
  assert.equal(await store.recordExecution({...fill, chain:NETWORK_REGISTRY["arc-testnet"].caip2}), false);
  assert.equal(await store.recordExecution({...fill, txHash:`0x${"b".repeat(64)}`, settlementAsset:`0x${"c".repeat(40)}`}), false);
  const snapshot=await store.snapshot();
  assert.equal(snapshot.execution.spot?.count,1);
  assert.equal(snapshot.execution.spot?.byChain[0].amount,"1.234567");
  assert.equal(snapshot.execution.spot?.byChain[0].symbol,"USDC");
  assert.equal(snapshot.execution.autopilot,null);
});
