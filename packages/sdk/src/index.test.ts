import assert from "node:assert/strict";
import test from "node:test";
import { PulseClient } from "./index.js";

test("Arc OKX catalog and readiness SDK methods preserve research IDs and never attach a payment", async () => {
  const calls: { url: string; signature: string | null }[] = [];
  const client = new PulseClient({ baseUrl: "https://pulse.example", network: "arc", paymentSignature: "unused", fetchImpl: (async (input, init) => {
    calls.push({ url: String(input), signature: new Headers(init?.headers).get("PAYMENT-SIGNATURE") }); return Response.json({});
  }) as typeof fetch });
  const pair = "BTC-USDT";
  await client.tradingPairs("cirBTC"); await client.resolveTradeMarket(pair); await client.autopilotMarketReadiness(pair, "15m");
  for (const call of calls) { const url = new URL(call.url); assert.equal(url.searchParams.get("network"), "arc"); assert.equal(call.signature, null); }
  assert.equal(new URL(calls[0].url).searchParams.get("limit"), "5000");
  assert.equal(new URL(calls[1].url).searchParams.get("pair"), pair);
  assert.equal(new URL(calls[2].url).searchParams.get("pair"), pair);
});

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

test("Arc services use the mainnet alias while report recovery stays free", async () => {
  const calls: { url: string; signature: string | null }[] = [];
  const client = new PulseClient({ baseUrl: "https://pulse.example", network: "arc", paymentSignature: "arc-signed", fetchImpl: (async (input, init) => {
    calls.push({ url: String(input), signature: new Headers(init?.headers).get("PAYMENT-SIGNATURE") });
    return Response.json({});
  }) as typeof fetch });
  await client.spotAnalysis({ instId: "BTC-USDT", timeframe: "1H", lang: "en" });
  await client.eventRiskPreflight({} as never);
  await client.getJob("job-arc", "recovery");
  assert.deepEqual(calls, [
    { url: "https://pulse.example/arc/v1/analysis/spot/standard", signature: "arc-signed" },
    { url: "https://pulse.example/arc/v1/preflight/event-risk", signature: "arc-signed" },
    { url: "https://pulse.example/v1/jobs/job-arc", signature: null },
  ]);
});

test("Arc execution SDK calls select the same network and pay only for an Autopilot pass", async () => {
  const calls: { url: string; body?: Record<string, unknown>; signature: string | null }[] = [];
  const client = new PulseClient({ baseUrl: "https://pulse.example", network: "arc", paymentSignature: "arc-signed", fetchImpl: (async (input, init) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined, signature: new Headers(init?.headers).get("PAYMENT-SIGNATURE") });
    return Response.json({});
  }) as typeof fetch });
  await client.tradingCapabilities();
  await client.prepareTrade({ fromTokenAddress: "USDC", toTokenAddress: "WETH", amount: "100000", userWalletAddress: "owner" });
  await client.registerAutopilotStrategy({ network: "arc-testnet", vault: "vault", authorization: "signed-policy" });
  await client.autopilotPass({ owner: "owner", vault: "vault" });
  assert.equal(calls[0].url, "https://pulse.example/v1/trading/capabilities?network=arc");
  assert.equal(calls[1].body?.network, "arc");
  assert.equal(calls[1].body?.amount, "100000");
  assert.equal(calls[2].body?.network, "arc");
  assert.equal(calls[2].body?.authorization, "signed-policy");
  assert.equal(calls[3].url, "https://pulse.example/arc/v1/autopilot/pass/24h");
  assert.deepEqual(calls.map(call => call.signature), [null, null, null, "arc-signed"]);
});

test("an Arc-prefixed SDK base URL keeps execution and recovery on the shared API", async () => {
  const urls: string[] = [];
  const client = new PulseClient({ baseUrl: "https://pulse.example/arc", network: "arc", fetchImpl: (async input => { urls.push(String(input)); return Response.json({}); }) as typeof fetch });
  await client.meta();
  await client.tradingCapabilities();
  await client.getJob("job", "recover");
  await client.spotAnalysis({ instId: "ETH-USDT", timeframe: "1H" });
  assert.deepEqual(urls, ["https://pulse.example/v1/meta?network=arc", "https://pulse.example/v1/trading/capabilities?network=arc", "https://pulse.example/v1/jobs/job", "https://pulse.example/arc/v1/analysis/spot/standard"]);
});
