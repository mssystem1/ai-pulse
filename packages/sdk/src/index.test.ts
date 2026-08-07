import assert from "node:assert/strict";
import test from "node:test";
import { PulseClient } from "./index.js";

test("canonical analysis returns a job and polls it without another payment", async () => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const responses = [
    new Response(JSON.stringify({ job: { id: "job-1", stage: "payment_settled" }, recoveryToken: "recover", pollUrl: "/v1/jobs/job-1" }), { status: 202, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ job: { id: "job-1", stage: "completed", reportId: "report-1" } }), { status: 200, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ job: { id: "job-1", stage: "completed" }, report: { service: "prediction_analysis_standard" }, metadata: {} }), { status: 200, headers: { "content-type": "application/json" } }),
  ];
  const client = new PulseClient({
    baseUrl: "https://pulse.example",
    paymentSignature: "signed-once",
    fetchImpl: (async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return responses.shift()!;
    }) as typeof fetch,
  });
  const accepted = await client.predictionAnalysis({ primaryMarketId: "pm:condition", additionalMarketIds: [], lang: "en" });
  const delivered = await client.waitForJobReport<{ service: string }>(accepted);
  assert.equal(delivered.report.service, "prediction_analysis_standard");
  assert.equal(calls[0].headers.get("PAYMENT-SIGNATURE"), "signed-once");
  assert.equal(calls[1].headers.get("PAYMENT-SIGNATURE"), null);
  assert.equal(calls[2].headers.get("PAYMENT-SIGNATURE"), null);
  assert.equal(calls[1].headers.get("PULSE-RECOVERY-TOKEN"), "recover");
  assert.equal(calls[2].headers.get("PULSE-RECOVERY-TOKEN"), "recover");
});

test("replay without the original recovery capability never attempts another payment", async () => {
  const client = new PulseClient({ baseUrl: "https://pulse.example", fetchImpl: fetch });
  await assert.rejects(() => client.waitForJobReport({
    job: { id: "job-1", mode: "spot", tier: "standard", network: "eip155:196", stage: "payment_settled", reportId: null, events: [], createdAt: "", updatedAt: "" },
    replay: true,
  }), /one-time recovery capability/);
});
