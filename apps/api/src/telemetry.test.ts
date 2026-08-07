import assert from "node:assert/strict";
import test from "node:test";
import { prometheusMetrics, recordAiUsage, recordPayment, recordProvider, recordReport, setUnfinishedJobs } from "./telemetry.js";

test("publishes provider, payment, report, queue, and detailed AI metrics", () => {
  recordProvider({ provider: "gamma-test", operation: "markets", durationMs: 12, success: false, retries: 2, cacheHit: true, cacheAgeMs: 25 });
  recordPayment({ provider: "circle-test", network: "eip155:5042002", phase: "verify_settle", durationMs: 30, success: true, amountAtomic: "10000" });
  recordAiUsage(100, 20, 0.001, 40, 5);
  recordReport("partial"); setUnfinishedJobs(3);
  const output = prometheusMetrics();
  assert.match(output, /pulse_provider_retries_total\{provider="gamma-test",operation="markets"\} 2/);
  assert.match(output, /pulse_payment_settlement_amount_atomic_total\{provider="circle-test",network="eip155:5042002",phase="verify_settle"\} 10000/);
  assert.match(output, /pulse_ai_cached_tokens_total 40/);
  assert.match(output, /pulse_ai_reasoning_tokens_total 5/);
  assert.match(output, /pulse_reports_total\{outcome="partial"\}/);
  assert.match(output, /pulse_unfinished_jobs 3/);
});
