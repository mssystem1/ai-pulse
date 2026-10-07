import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { loadConfig, NETWORK_KEYS } from "@pulse/config";
import { createApp, estimateAiCostUsd } from "./app.js";
import type { PolymarketClient } from "@pulse/market";

it("prices cached xAI input at the configured cached-token rate", () => {
  const cost = estimateAiCostUsd({
    XAI_INPUT_COST_PER_MILLION_USD: 1.25,
    XAI_CACHED_INPUT_COST_PER_MILLION_USD: 0.20,
    XAI_OUTPUT_COST_PER_MILLION_USD: 2.50,
  }, { promptTokens: 1_000, cachedTokens: 200, completionTokens: 100 });
  assert.equal(cost, 0.00129);
  assert.equal(estimateAiCostUsd({
    XAI_INPUT_COST_PER_MILLION_USD: 1.25,
    XAI_CACHED_INPUT_COST_PER_MILLION_USD: undefined as unknown as number,
    XAI_OUTPUT_COST_PER_MILLION_USD: 2.50,
  }, { promptTokens: 1_000, cachedTokens: 200, completionTokens: 100 }), 0.0015);
});

let server: Server;
let port: number;
let testConfig: ReturnType<typeof loadConfig>;
const ADDRESS = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const apiUrl = () => `http://127.0.0.1:${port}`;

async function jfetch(path: string, init?: RequestInit & { pay?: boolean }) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (init?.pay) headers["PAYMENT-SIGNATURE"] = "test-payment-signature-ok";
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers });
  const json = await res.json().catch(() => null);
  return { res, json };
}

describe("PULSE API", () => {
  it("all eight marketplace services preserve POST and complete input discovery through the X Layer alias", async () => {
    for (const path of ["analysis/spot/standard", "analysis/spot/premium", "analysis/prediction/standard", "analysis/prediction/premium", "preflight", "autopilot/pass/24h", "autopilot/pass/7d", "autopilot/pass/30d"]) {
      const { res, json } = await jfetch(`/xlayer/v1/${path}`);
      assert.equal(res.status, 400, path);
      assert.equal(json.method, "POST", path);
      assert.equal(json.requestSpec.method, "POST", path);
      assert.deepEqual(json.requestSpec.fields, json.fields, path);
      assert.equal(res.headers.get("payment-required"), null);
      if (path.startsWith("analysis/spot")) for (const name of ["instId", "timeframe", "lang"]) assert.equal(json.fields.find((field: { name: string }) => field.name === name).required, true);
    }
  });
  it("Risk Guard reports have private authenticated history and replay without regeneration", async () => {
    const body = JSON.stringify({ tokenAddress: "0x0cc24c51bf89c00c5affbfcf5e856c25ecbdb48e", lang: "en" });
    const first = await jfetch("/v1/preflight", { method: "POST", pay: true, body });
    assert.equal(first.res.status, 200);
    assert.ok(first.json.history.recoveryToken);
    const reportPath = `/v1/jobs/${first.json.history.jobId}/report`;
    assert.equal((await jfetch(reportPath)).res.status, 403);
    const recovered = await jfetch(reportPath, { headers: { "PULSE-RECOVERY-TOKEN": first.json.history.recoveryToken } });
    assert.equal(recovered.res.status, 200);
    assert.equal(recovered.json.job.mode, "risk");
    assert.equal(recovered.json.report.address, "0x0cc24c51bf89c00c5affbfcf5e856c25ecbdb48e");
    assert.ok(recovered.json.reportMarkdown.includes("intelligence"));
    const replay = await jfetch("/v1/preflight", { method: "POST", pay: true, body });
    assert.equal(replay.res.status, 200);
    assert.equal(replay.json.replay, true);
    assert.equal(replay.json.generatedAt, first.json.generatedAt);
    assert.equal(replay.json.history.jobId, first.json.history.jobId);
    assert.ok(replay.json.history.recoveryToken);
    const replayRecovered = await jfetch(reportPath, { headers: { "PULSE-RECOVERY-TOKEN": replay.json.history.recoveryToken } });
    assert.equal(replayRecovered.res.status, 200);
    assert.equal((await jfetch(reportPath, { headers: { "PULSE-RECOVERY-TOKEN": first.json.history.recoveryToken } })).res.status, 200);
  });
  it("Risk Guard accepts normalized chain IDs after payment on every network and trailing-slash input remains validated", async () => {
    for (const [alias, chainId] of [["xlayer", "196"], ["base", "8453"], ["arbitrum", "42161"], ["arc", "5042"], ["robinhood", "4663"]]) {
      const path = `/${alias}/v1/preflight/`;
      const invalid = await jfetch(path, { method: "POST", body: "{}" });
      assert.equal(invalid.res.status, 400);
      assert.equal(invalid.res.headers.has("PAYMENT-REQUIRED"), false);
      const { res, json } = await jfetch(path, { method: "POST", pay: true,
        body: JSON.stringify({ tokenAddress: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", chainId, lang: "en" }) });
      assert.equal(res.status, 200, `${alias}: ${JSON.stringify(json)}`);
      assert.equal(json.chainId, chainId);
      assert.ok(json.history.recoveryToken);
    }
  });
  it("serves public cross-chain aggregates without payment or wallet parameters", async () => {
    const first = await jfetch("/v1/public/activity");
    const filtered = await jfetch("/v1/public/activity?network=base&wallet=ignored");
    assert.equal(first.res.status, 200);
    assert.equal(first.res.headers.has("PAYMENT-REQUIRED"), false);
    assert.equal(first.json.scope, "platform");
    assert.equal(first.json.networks.length, NETWORK_KEYS.length + 1);
    assert.equal(first.json.networks.some((item: {environment:string}) => item.environment === "testnet"), true);
    assert.deepEqual(filtered.json, first.json);
    assert.equal(JSON.stringify(first.json).includes("payer"), false);
  });
  it("reissues private recovery on paid asynchronous research replays without replacing the original capability", async () => {
    // No provider calls or background job consumption: test payment/job wiring.
    const app = createApp(testConfig, { startDurableWorker: false, spotInstrumentExists: async () => true,
      polymarket: { getMarket: async () => ({ id: "pm:replay", active: true, closed: false, archived: false,
        enableOrderBook: true, outcomes: [{ tokenId: "1" }, { tokenId: "2" }] }),
        getOrderBook: async () => ({ bids: [], asks: [] }) } as unknown as PolymarketClient });
    const local = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => local.once("listening", resolve));
    const origin = `http://127.0.0.1:${(local.address() as { port: number }).port}`;
    try {
      for (const mode of ["spot", "prediction"]) for (const tier of ["standard", "premium"]) {
        const route = `${origin}/robinhood/v1/analysis/${mode}/${tier}`;
        const input = mode === "spot" ? { instId: "ETH-USDT", timeframe: "1H", lang: "en" }
          : { primaryMarketId: "pm:replay", lang: "en" };
        const post = () => fetch(route, { method: "POST", headers: { "Content-Type": "application/json",
          "PAYMENT-SIGNATURE": "test-payment-signature-ok" }, body: JSON.stringify(input) });
        const firstResponse = await post(); const first = await firstResponse.json();
        assert.equal(firstResponse.status, 202);
        assert.ok(first.recoveryToken);
        const replayResponse = await post(); const replay = await replayResponse.json();
        assert.equal(replayResponse.status, 202);
        assert.equal(replay.job.id, first.job.id);
        assert.equal(replay.replay, true);
        assert.match(replay.recoveryToken, /^ppr1_/);
        const jobUrl = `${origin}/robinhood/v1/jobs/${first.job.id}`;
        assert.equal((await fetch(jobUrl)).status, 403);
        for (const token of [first.recoveryToken, replay.recoveryToken]) {
          assert.equal((await fetch(jobUrl, { headers: { "PULSE-RECOVERY-TOKEN": token } })).status, 200);
        }
        assert.equal((await fetch(jobUrl,
          { headers: { "PULSE-RECOVERY-TOKEN": `${replay.recoveryToken}corrupt` } })).status, 403);
      }
    } finally { local.closeAllConnections(); await new Promise<void>(resolve => local.close(() => resolve())); }
  });
  it("rejects invalid candle cursors and limits before querying the provider", async () => {
    for (const query of ["limit=-1", "limit=301", "limit=NaN", "before=garbage", "before=-1", "before=1.5"]) {
      assert.equal((await jfetch(`/v1/market/candles?instId=BTC-USDT&${query}`)).res.status, 400);
    }
  });
  it("validates free Robinhood funding without an x402 challenge or payment", async () => {
    for (const body of [{}, { amount: "0", userWalletAddress: ADDRESS }, { amount: "1", userWalletAddress: "bad" },
      { amount: "1", userWalletAddress: ADDRESS, toToken: ADDRESS }]) {
      const { res } = await jfetch("/v1/dex/robinhood/native-usdg", { method: "POST", body: JSON.stringify(body) });
      assert.equal(res.status, 400);
      assert.equal(res.headers.has("PAYMENT-REQUIRED"), false);
      assert.equal(res.headers.has("PAYMENT-RESPONSE"), false);
    }
  });
  before(async () => {
    // Complete, secret-free test profile; do not depend on the operator's .env.
    Object.assign(process.env, {
      ENABLED_NETWORKS: "xlayer,base,arbitrum,arc,robinhood",
      REPORT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
      FEATURE_BASE_PAYMENTS: "1", FEATURE_ARBITRUM_PAYMENTS: "1", FEATURE_ARC_PAYMENTS: "1",
      FEATURE_POLYMARKET: "1", FEATURE_PREDICTION_ANALYSIS: "1", FEATURE_JOBS: "1",
      FEATURE_FUSED_ANALYSIS: "0", FEATURE_DIVERGENCE_ANALYSIS: "0", FEATURE_EVENT_RISK_ANALYSIS: "0",
      CDP_API_KEY_ID: "fixture", CDP_API_KEY_SECRET: "fixture", CIRCLE_GATEWAY_ENABLED: "1", PAY_TO_ADDRESS: ADDRESS, ARC_AI_MODE: "fixture",
      QUEUE_PROVIDER: "memory", STORAGE_PROVIDER: "memory", REDIS_URL: "", KV_REST_API_URL: "", KV_REST_API_TOKEN: "",
      OKX_API_KEY: "", OKX_XLAYER_API_KEY: "", OKX_SECRET_KEY: "", OKX_PASSPHRASE: "",
      AUTOMATION_WORKER_ENABLED: "0", TEST_WALLET_PRIVATE_KEY: "", AUTOMATION_EXECUTOR_PRIVATE_KEY: "",
    });
    process.env.X402_MOCK = "1";
    process.env.NODE_ENV = "test";
    process.env.XAI_API_KEY = "";
    process.env.PRICE_TOKEN_SCAN = "0.20";
    process.env.PRICE_PREFLIGHT = "0.20";
    const cfg = {
      ...loadConfig(),
      X402_MOCK: true,
      paymentMode: "mock" as const,
      FEATURE_LIVE_SAFETY: false,
      QUEUE_PROVIDER: "memory" as const,
      STORAGE_PROVIDER: "memory" as const,
    };
    testConfig = cfg;
    const polymarket = {
      async getMarket(id: string) {
        const closed = id === "pm:closed";
        const missingBook = id === "pm:missing-book";
        return {
          id, gammaMarketId: "fixture", eventIds: [], conditionId: `0x${"a".repeat(64)}`,
          questionId: null, slug: null, question: "Fixture market", description: null, resolutionSource: null,
          outcomes: [{ name: "Yes", tokenId: missingBook ? "missing-book" : "1", referencePrice: .5 }, { name: "No", tokenId: "2", referencePrice: .5 }],
          active: !closed, closed, archived: false, restricted: false, enableOrderBook: true, negRisk: false,
          endDate: null, updatedAt: null, volumeUsd: 1, liquidityUsd: 1,
          eligibility: closed ? "closed" : "active", observedAt: new Date().toISOString(),
        };
      },
      async getOrderBook(tokenId: string) {
        if (tokenId === "missing-book") throw new Error("order book unavailable");
        return { asset_id: tokenId, bids: [], asks: [] };
      },
    } as unknown as PolymarketClient;
    const app = createApp(cfg, { polymarket, passTargetExists: async ({ vault }) => {
      if (vault === `0x${"4".repeat(40)}`) throw new Error("Fixture storage unavailable");
      return false;
    }, spotInstrumentExists: async (id) => {
      if (id === "UNAVAILABLE-USDT") throw new Error("Provider unavailable");
      return ["BTC-USDT", "ETH-USDT"].includes(id);
    } });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("never accepts client-declared confirmed trading activity", async () => {
    const { res } = await jfetch("/v1/trading/activity", {
      method: "POST",
      body: JSON.stringify({
        owner: ADDRESS,
        network: "base",
        source: "wallet",
        kind: "market_buy",
        status: "confirmed",
        txHash: `0x${"a".repeat(64)}`,
      }),
    });
    assert.equal(res.status, 400);
  });

  it("rejects malformed inputs before challenging OR verifying payment on every Global route", async () => {
    for (const prefix of ["", "/xlayer", "/base", "/arbitrum"]) {
      for (const route of ["/v1/analysis/base", "/v1/analysis/premium", "/v1/analysis/spot/standard", "/v1/analysis/spot/premium"]) {
        for (const body of [{}, { instId: "BTC-USDT", timeframe: "garbage" }, { instId: "BTC", timeframe: "4H" }]) {
          for (const pay of [false, true]) {
            const { res, json } = await jfetch(`${prefix}${route}`, { method: "POST", body: JSON.stringify(body), pay });
            assert.equal(res.status, 400, `${prefix}${route}: ${JSON.stringify(body)}`);
            assert.equal(res.headers.get("PAYMENT-REQUIRED"), null);
            assert.equal(res.headers.get("PAYMENT-RESPONSE"), null);
            assert.ok(json);
          }
        }
      }
    }
  });

  it("rejects missing legacy priced-service inputs before payment", async () => {
    for (const route of ["/v1/wallet/scan", "/v1/market/pulse", "/v1/swap/quote"]) {
      const { res } = await jfetch(route, { method: "POST", body: "{}" });
      assert.equal(res.status, 400, route);
      assert.equal(res.headers.get("PAYMENT-REQUIRED"), null);
    }
  });

  it("rejects an invalid Autopilot pass target before x402 payment", async () => {
    const malformed = await jfetch("/xlayer/v1/autopilot/pass/24h", {
      method: "POST",
      body: JSON.stringify({ owner: "bad", vault: ADDRESS }),
    });
    assert.equal(malformed.res.status, 400);

    const unknownVault = await jfetch("/xlayer/v1/autopilot/pass/24h", {
      method: "POST",
      body: JSON.stringify({ owner: ADDRESS, vault: `0x${"1".repeat(40)}` }),
    });
    assert.equal(unknownVault.res.status, 409);
    assert.doesNotMatch(JSON.stringify(unknownVault.json), /payment required/i);
  });

  it("healthz", async () => {
    const { res, json } = await jfetch("/healthz");
    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
  });

  it("emits correlation IDs and Prometheus request metrics", async () => {
    const health = await fetch(`${apiUrl()}/healthz`, { headers: { "X-Correlation-ID": "pulse-test-correlation" } });
    assert.equal(health.headers.get("x-correlation-id"), "pulse-test-correlation");
    const metrics = await fetch(`${apiUrl()}/metrics`);
    const text = await metrics.text();
    assert.equal(metrics.status, 200);
    assert.match(text, /pulse_http_requests_total/);
    assert.match(text, /pulse_process_uptime_seconds/);
  });

  it("validates the in-app Base and Arbitrum native-USDC swap request", async () => {
    const { res, json } = await jfetch("/v1/dex/cdp/native-usdc", { method: "POST", body: JSON.stringify({ network: "ethereum", amount: "0", userWalletAddress: "bad" }) });
    assert.equal(res.status, 400);
    assert.ok(json.error);
  });

  it("publishes the free X Layer catalog route", async () => {
    const { res, json } = await jfetch("/v1/meta");
    assert.equal(res.status, 200);
    const route = json.routes.find((item: { route: string }) => item.route === "GET /v1/xlayer/tokens");
    assert.ok(route);
    assert.equal(route.free, true);
    assert.equal(route.priceUsd, 0);
    const multichainRoute = json.routes.find((item: { route: string }) => item.route === "GET /v1/tokens");
    assert.ok(multichainRoute);
    assert.equal(multichainRoute.free, true);
    assert.equal(multichainRoute.priceUsd, 0);
  });

  it("Arc metadata describes mainnet settlement and rejects the retired testnet", async () => {
    const { res, json } = await jfetch("/v1/meta?network=arc");
    assert.equal(res.status, 200);
    assert.equal(json.network, "eip155:5042");
    assert.equal(json.chainId, 5042);
    assert.equal(json.asset, "USDC");
    assert.equal(json.paymentProvider, "circle-gateway");
    assert.equal(json.paymentMode, "mock");
    assert.equal((await jfetch("/v1/meta?network=arc-testnet")).res.status, 400);
  });

  it("live selected-network metadata reports its own payment provider rather than the default OKX mode", async () => {
    const original = { X402_MOCK: testConfig.X402_MOCK, paymentMode: testConfig.paymentMode };
    try {
      testConfig.X402_MOCK = false;
      testConfig.paymentMode = "okx";
      for (const [path, mode] of [["/v1/meta?network=arc", "circle-gateway"], ["/arc/v1/meta", "circle-gateway"], ["/v1/meta?network=base", "cdp"], ["/v1/meta?network=xlayer", "okx"]]) {
        const { res, json } = await jfetch(path);
        assert.equal(res.status, 200);
        assert.equal(json.paymentMode, mode);
        assert.equal(json.paymentProvider, mode);
      }
    } finally { Object.assign(testConfig, original); }
  });

  it("ownership lookup outages reject REST and MCP before payment without hanging", async () => {
    const args = { owner: ADDRESS, vault: `0x${"4".repeat(40)}` };
    for (const mcp of [false, true]) {
      const response = await fetch(`${apiUrl()}${mcp ? "/mcp" : "/v1/autopilot/pass/24h"}`, {
        method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": "test-payment-signature-ok" },
        body: JSON.stringify(mcp ? { jsonrpc: "2.0", id: 82, method: "tools/call", params: { name: "start_autopilot_24h", arguments: args } } : args),
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("PAYMENT-REQUIRED"), null);
      assert.equal(response.headers.get("PAYMENT-RESPONSE"), null);
    }
  });

  it("serves the selected-network token catalog without native pseudo-contracts", async () => {
    const { res, json } = await jfetch("/arc/v1/tokens?q=USDC&limit=5");
    assert.equal(res.status, 200);
    assert.equal(json.network, "arc");
    assert.equal(json.tokens[0].symbol, "USDC");
    assert.equal(json.tokens.some((token: { address: string }) => /^0x[eE]{40}$/.test(token.address)), false);
  });

  it("publishes the Risk Guard POST body contract in focused ASP metadata", async () => {
    const { res, json } = await jfetch("/v1/metadata");
    assert.equal(res.status, 200);
    const service = json.asp.services.find(
      (item: { path: string }) => item.path === "/v1/preflight",
    );
    assert.ok(service);
    assert.equal(service.outputSchema.method, "POST");
    assert.equal(service.outputSchema.input.intent.carrier, "body");
  });

  it("publishes provider-specific multichain payment aliases", async () => {
    const { res, json } = await jfetch("/v1/metadata");
    assert.equal(res.status, 200);
    const services = json.asp.networkServices as Array<{ path: string; network: string; paymentProvider: string }>;
    for (const service of json.asp.networkServices) {
      assert.equal(service.requestSpec.method, "POST");
      assert.ok(service.requestSpec.fields.length > 0);
      assert.equal(service.outputSchema.method, "POST");
      assert.ok(service.serviceGuide);
      if (service.path.endsWith("/preflight")) {
        const chain = service.requestSpec.fields.find((field: { name: string }) => field.name === "chainId");
        assert.equal(chain.default, service.network.split(":")[1]);
      }
    }
    assert.ok(services.some((item) => item.path === "/xlayer/v1/analysis/prediction/premium" && item.paymentProvider === "okx"));
    assert.ok(services.some((item) => item.path === "/base/v1/analysis/prediction/premium" && item.network === "eip155:8453" && item.paymentProvider === "cdp"));
    assert.ok(services.some((item) => item.path === "/arc/v1/analysis/prediction/premium" && item.network === "eip155:5042" && item.paymentProvider === "circle-gateway"));
    assert.equal(services.some((item) => item.path === "/base/v1/token/scan"), false);
    assert.equal(json.asp.name, "PULSE");
    assert.equal(json.asp.product, "PULSE");
    assert.equal(json.asp.version, undefined);
    assert.equal(json.asp.methodology_version, undefined);
    assert.ok(json.asp.tags.includes("polymarket"));
    assert.ok(json.asp.tags.includes("multichain"));
    assert.equal(json.asp.discovery.okxAi.publicUrl, "https://www.okx.ai/agents/8355");
    assert.deepEqual(json.asp.discovery.cdpBazaar.servicePrefixes, ["/base", "/arbitrum"]);
    assert.equal(json.asp.discovery.circleAgentMarketplace.servicePrefix, "/arc");
    assert.equal(json.asp.autopilotAiPass.plans[0].priceUsd, 1.5);
    const publicPaths = (json.asp.services as Array<{ path: string }>).map((item) => item.path);
    for (const hidden of ["/v1/wallet/scan", "/v1/market/pulse", "/v1/swap/quote", "/v1/analysis/fused/standard", "/v1/analysis/fused/premium", "/v1/analysis/divergence", "/v1/preflight/event-risk"]) {
      assert.equal(publicPaths.includes(hidden), false, hidden);
    }
    assert.ok(publicPaths.includes("/v1/analysis/prediction/standard"));
    assert.ok(publicPaths.includes("/v1/analysis/prediction/premium"));
    assert.deepEqual(new Set(publicPaths), new Set([
      "/v1/analysis/spot/standard",
      "/v1/analysis/spot/premium",
      "/v1/analysis/prediction/standard",
      "/v1/analysis/prediction/premium",
      "/v1/preflight",
      "/v1/autopilot/pass/24h",
      "/v1/autopilot/pass/7d",
      "/v1/autopilot/pass/30d",
    ]));
    assert.ok(services.some((item) => item.path === "/xlayer/v1/autopilot/pass/24h" && item.paymentProvider === "okx"));
    assert.ok(services.some((item) => item.path === "/base/v1/autopilot/pass/7d" && item.network === "eip155:8453"));
    assert.ok(services.some((item) => item.path === "/arbitrum/v1/autopilot/pass/30d" && item.network === "eip155:42161"));
    assert.equal(services.some((item) => item.path.startsWith("/arc/v1/autopilot/pass/")), false);
  });

  it("returns 402 without payment", async () => {
    const { res, json } = await jfetch("/v1/token/scan", {
      method: "POST",
      body: JSON.stringify({
        address: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      }),
    });
    assert.equal(res.status, 402);
    assert.ok(res.headers.get("payment-required") || res.headers.get("PAYMENT-REQUIRED"));
    assert.equal(json.status, "payment_required");
    assert.equal(json.outputSchema.method, "POST");
    assert.equal(json.outputSchema.input.address.carrier, "body");
    assert.equal(json.outputSchema.input.address.required, true);
  });

  it("self-describes token scan input before payment", async () => {
    const { res, json } = await jfetch("/v1/token/scan");
    assert.equal(res.status, 400);
    assert.equal(json.status, "input_required");
    assert.ok(json.requiredAnyOf.includes("address"));
    assert.equal(json.fields.find((field: { name: string }) => field.name === "address").required, true);
  });

  it("rejects an invalid token scan before payment", async () => {
    const { res, json } = await jfetch("/v1/token/scan", {
      method: "POST",
      body: JSON.stringify({ address: "not-an-address", chainId: "196" }),
    });
    assert.equal(res.status, 400);
    assert.equal(json.status, "input_required");
    assert.ok(json.validationErrors.length > 0);
    assert.equal(res.headers.get("payment-required"), null);
  });

  it("rejects a non-X-Layer token scan before payment", async () => {
    const { res, json } = await jfetch("/v1/token/scan", {
      method: "POST",
      body: JSON.stringify({
        address: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
        chainId: "1",
      }),
    });
    assert.equal(res.status, 400);
    assert.equal(json.status, "input_required");
    assert.match(json.validationErrors[0].message, /Selected X Layer route requires chain 196/);
    assert.equal(res.headers.get("payment-required"), null);
  });

  it("validates V5 prediction selection before payment", async () => {
    const invalid = await jfetch("/v1/analysis/prediction/standard", {
      method: "POST", body: JSON.stringify({ additionalMarketIds: [] }),
    });
    assert.equal(invalid.res.status, 400);
    assert.equal(invalid.res.headers.get("payment-required"), null);

    const unpaid = await jfetch("/v1/analysis/prediction/standard", {
      method: "POST", body: JSON.stringify({ primaryMarketId: "pm:condition" }),
    });
    assert.equal(unpaid.res.status, 402);
    assert.equal(unpaid.json.priceUsd, testConfig.PRICE_ANALYSIS_PREDICTION_STANDARD);
    assert.ok(unpaid.res.headers.get("payment-required"));

    const ineligible = await jfetch("/v1/analysis/prediction/standard", {
      method: "POST", body: JSON.stringify({ primaryMarketId: "pm:closed" }),
    });
    assert.equal(ineligible.res.status, 422);
    assert.equal(ineligible.json.code, "market_closed");
    assert.equal(ineligible.res.headers.get("payment-required"), null);

    const missingEvidence = await jfetch("/v1/analysis/prediction/standard", {
      method: "POST", body: JSON.stringify({ primaryMarketId: "pm:missing-book" }),
    });
    assert.equal(missingEvidence.res.status, 503);
    assert.equal(missingEvidence.json.code, "prediction_evidence_unavailable");
    assert.equal(missingEvidence.res.headers.get("payment-required"), null);
  });

  it("publishes Arc Gateway-shaped payment requirements on the Arc alias", async () => {
    const { res, json } = await jfetch("/arc/v1/analysis/prediction/standard", {
      method: "POST", body: JSON.stringify({ primaryMarketId: "pm:condition" }),
    });
    assert.equal(res.status, 402);
    assert.equal(json.network, "eip155:5042");
    const encoded = res.headers.get("payment-required");
    assert.ok(encoded);
    const challenge = JSON.parse(Buffer.from(encoded!, "base64").toString("utf8"));
    assert.match(challenge.resource.url, /\/arc\/v1\/analysis\/prediction\/standard$/);
    assert.equal(challenge.accepts[0].asset.toLowerCase(), "0x3600000000000000000000000000000000000000");
  });

  it("namespaces Base and Arbitrum payment challenges", async () => {
    for (const expected of [
      { alias: "base", network: "eip155:8453", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
      { alias: "arbitrum", network: "eip155:42161", asset: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
    ]) {
      const { res } = await jfetch(`/${expected.alias}/v1/analysis/prediction/standard`, {
        method: "POST", body: JSON.stringify({ primaryMarketId: "pm:condition" }),
      });
      assert.equal(res.status, 402);
      const challenge = JSON.parse(Buffer.from(res.headers.get("payment-required")!, "base64").toString("utf8"));
      assert.equal(challenge.accepts[0].network, expected.network);
      assert.equal(challenge.accepts[0].asset.toLowerCase(), expected.asset);
      assert.match(challenge.resource.url, new RegExp(`/${expected.alias}/v1/analysis/prediction/standard$`));
    }
  });

  it("returns the token risk JSON inline on paid replay", async () => {
    const address = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
    const { res, json } = await jfetch("/v1/token/scan", {
      method: "POST",
      pay: true,
      body: JSON.stringify({ address, chainId: "196" }),
    });
    assert.equal(res.status, 200);
    assert.equal(json.service, "token_scan");
    assert.equal(json.address.toLowerCase(), address);
    assert.equal(json.chainId, "196");
    assert.equal(typeof json.riskScore, "number");
    assert.ok(Array.isArray(json.components));
    assert.ok(res.headers.get("payment-response"));
  });

  it("serves paid preflight with mock signature", async () => {
    const { res, json } = await jfetch("/v1/preflight", {
      method: "POST",
      pay: true,
      body: JSON.stringify({
        intent: "hire_agent",
        counterparty: "0x1111111111111111111111111111111111111111",
        tokenAddress: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(json.service, "preflight");
    assert.ok(json.shareId);
  });

  it("free resolve works", async () => {
    const { res, json } = await jfetch("/v1/resolve", {
      method: "POST",
      body: JSON.stringify({ query: "USDT" }),
    });
    assert.equal(res.status, 200);
    assert.ok(json.matches.length >= 1);
  });

  it("validates free X Layer contract inspection before RPC", async () => {
    const { res, json } = await jfetch("/v1/contract/inspect", {
      method: "POST",
      body: JSON.stringify({ address: "not-an-address" }),
    });
    assert.equal(res.status, 400);
    assert.match(json.error, /Invalid EVM address/);
  });

  it("returns explicit unknown evidence when live safety is disabled", async () => {
    const { res, json } = await jfetch("/v1/safety/evidence", {
      method: "POST", body: JSON.stringify({ address: ADDRESS }),
    });
    assert.equal(res.status, 503);
    assert.equal(json.evidenceStatus, "unavailable");
    assert.equal(json.safetyVerdict, "unknown");
    assert.equal("riskScore" in json, false);
  });

  it("preserves legacy paid-route discovery probes", async () => {
    for (const path of [
      "/v1/analysis/base",
      "/v1/analysis/premium",
      "/v1/token/scan",
      "/v1/preflight",
      "/v1/wallet/scan",
      "/v1/market/pulse",
      "/v1/swap/quote",
    ]) {
      const res = await fetch(`${apiUrl()}${path}`);
      assert.equal(res.status, 400, path);
      const body = await res.json() as { status?: string; outputSchema?: { method?: string } };
      assert.equal(body.status, "input_required", path);
      assert.equal(body.outputSchema?.method, "POST", path);
      assert.equal(res.headers.get("payment-required"), null, path);
    }
  });

  it("publishes durable-job delivery semantics for every canonical V5 route", async () => {
    for (const path of [
      "/v1/analysis/spot/standard", "/v1/analysis/spot/premium",
      "/v1/analysis/prediction/standard", "/v1/analysis/prediction/premium",
      "/v1/analysis/fused/standard", "/v1/analysis/fused/premium",
      "/v1/analysis/divergence", "/v1/preflight/event-risk",
    ]) {
      const response = await fetch(`${apiUrl()}${path}`);
      assert.equal(response.status, 400, path);
      const body = await response.json() as { outputSchema?: { output?: { status?: number; delivery?: string; reportPath?: string } } };
      assert.equal(body.outputSchema?.output?.status, 202, path);
      assert.equal(body.outputSchema?.output?.delivery, "durable_job", path);
      assert.equal(body.outputSchema?.output?.reportPath, "/v1/jobs/{jobId}/report", path);
    }
  });

  it("preserves MCP protocol and current tool names", async () => {
    const initialize = await fetch(`${apiUrl()}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    const initialized = await initialize.json() as {
      result?: { protocolVersion?: string; serverInfo?: { name?: string; version?: string } };
    };
    assert.equal(initialized.result?.protocolVersion, "2024-11-05");
    assert.equal(initialized.result?.serverInfo?.name, "pulse");
    assert.equal(initialized.result?.serverInfo?.version, "2.0.0");

    const list = await fetch(`${apiUrl()}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    const listed = await list.json() as { result?: { tools?: Array<{ name: string }> } };
    const names = listed.result?.tools?.map((tool) => tool.name) || [];
    assert.deepEqual(names, [
      "preflight",
      "spot_analysis_standard",
      "prediction_analysis_standard",
      "spot_analysis_premium",
      "prediction_analysis_premium",
      "start_autopilot_24h",
      "start_autopilot_7d",
      "start_autopilot_30d",
      "job_status",
      "job_report",
    ]);
  });

  it("publishes the configured V5 MCP payment challenge", async () => {
    const response = await fetch(`${apiUrl()}/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 20, method: "tools/call", params: {
        name: "prediction_analysis_premium", arguments: { primaryMarketId: "pm:condition" },
      } }),
    });
    const body = await response.json() as { priceUsd?: number; tool?: string };
    assert.equal(response.status, 402);
    assert.equal(body.tool, "prediction_analysis_premium");
    assert.equal(body.priceUsd, testConfig.PRICE_ANALYSIS_PREDICTION_PREMIUM);
  });

  it("discovers all three Autopilot POST contracts without payment or registration", async () => {
    for (const prefix of ["", "/xlayer", "/base", "/arbitrum"]) for (const duration of ["24h", "7d", "30d"]) {
      const path = `${prefix}/v1/autopilot/pass/${duration}`;
      for (const method of ["GET", "POST"]) {
        const { res, json } = await jfetch(path, { method, ...(method === "POST" ? { body: "{}" } : {}) });
        assert.equal(res.status, 400, path);
        assert.equal(res.headers.get("payment-required"), null);
        assert.equal(json.status, "input_required");
        assert.deepEqual(json.requiredArgs, ["owner", "vault"]);
        assert.equal(json.outputSchema.method, "POST");
        assert.equal(json.outputSchema.output.status, 201);
      }
    }
  });

  it("validates all eight published MCP service arguments before payment", async () => {
    for (const name of ["spot_analysis_standard", "spot_analysis_premium", "prediction_analysis_standard", "prediction_analysis_premium", "preflight", "start_autopilot_24h", "start_autopilot_7d", "start_autopilot_30d"]) {
      const response = await fetch(`${apiUrl()}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": "test-payment-signature-ok" }, body: JSON.stringify({ jsonrpc: "2.0", id: 50, method: "tools/call", params: { name, arguments: {} } }) });
      assert.equal(response.status, 400, name);
      assert.equal(response.headers.get("PAYMENT-REQUIRED"), null);
      const body = await response.json() as any;
      assert.equal(body.error.code, -32602);
    }
  });

  it("rejects nonexistent instruments and unavailable lookups before charging REST or MCP", async () => {
    for (const [instId, expected] of [["MISSING-USDT", 422], ["UNAVAILABLE-USDT", 503]] as const) {
      for (const mcp of [false, true]) {
        const response = await fetch(`${apiUrl()}${mcp ? "/mcp" : "/v1/analysis/spot/standard"}`, {
          method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": "test-payment-signature-ok" },
          body: JSON.stringify(mcp ? { jsonrpc: "2.0", id: 60, method: "tools/call", params: { name: "spot_analysis_standard", arguments: { instId } } } : { instId }),
        });
        assert.equal(response.status, expected);
        assert.equal(response.headers.get("PAYMENT-REQUIRED"), null);
        assert.equal(response.headers.get("PAYMENT-RESPONSE"), null);
      }
    }
  });

  it("MCP uses the same prediction-evidence checks as REST before a challenge", async () => {
    for (const [primaryMarketId, expected] of [["pm:closed", 422], ["pm:missing-book", 503]] as const) {
      const response = await fetch(`${apiUrl()}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 61, method: "tools/call", params: { name: "prediction_analysis_standard", arguments: { primaryMarketId } } }) });
      assert.equal(response.status, expected);
      assert.equal(response.headers.get("PAYMENT-REQUIRED"), null);
    }
  });

  it("MCP preserves Base/Arbitrum payment networks and refuses mismatched Risk Guard chains", async () => {
    for (const [prefix, chain] of [["base", "8453"], ["arbitrum", "42161"]]) {
      const request = (chainId: string) => fetch(`${apiUrl()}/${prefix}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 62, method: "tools/call", params: { name: "preflight", arguments: { tokenAddress: ADDRESS, chainId } } }) });
      const bad = await request("196");
      assert.equal(bad.status, 400);
      assert.equal(bad.headers.get("PAYMENT-REQUIRED"), null);
      const good = await request(chain);
      assert.equal(good.status, 402);
      const challenge = JSON.parse(Buffer.from(good.headers.get("PAYMENT-REQUIRED")!, "base64").toString());
      assert.equal(challenge.accepts[0].network, `eip155:${chain}`);
    }
  });

  it("preserves MCP x402 challenge headers and replay shape", async () => {
    const call = (pay = false) => fetch(`${apiUrl()}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(pay ? { "PAYMENT-SIGNATURE": "test-payment-signature-ok" } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "token_scan", arguments: { address: ADDRESS, chainId: "196" } },
      }),
    });

    const unpaid = await call();
    assert.equal(unpaid.status, 402);
    assert.ok(unpaid.headers.get("payment-required"));

    const paid = await call(true);
    assert.equal(paid.status, 200);
    const body = await paid.json() as {
      result?: { content?: Array<{ type?: string; text?: string }>; structuredContent?: { service?: string } };
    };
    assert.equal(body.result?.content?.[0]?.type, "text");
    assert.equal(body.result?.structuredContent?.service, "token_scan");
    assert.equal(JSON.parse(body.result?.content?.[0]?.text || "{}").service, "token_scan");
  });
});
