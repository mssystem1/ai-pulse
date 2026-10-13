import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import { loadConfig } from "@pulse/config";
import { createApp } from "./app.js";

const listen = async (server: Server) => { await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${(server.address() as { port: number }).port}`; };
const close = (server: Server) => new Promise<void>(resolve => server.close(() => resolve()));

test("live X Layer settlement waits for MCP validation and canonical forwarding", async () => {
  const calls: string[] = [], payTo = `0x${"1".repeat(40)}`, payer = `0x${"2".repeat(40)}`, transaction = `0x${"a".repeat(64)}`;
  const facilitator = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    calls.push(req.url!); res.setHeader("Content-Type", "application/json");
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    assert.equal(body.paymentRequirements.network, "eip155:196");
    assert.equal(body.paymentRequirements.amount, "300000");
    res.end(JSON.stringify({ data: req.url?.endsWith("verify") ? { isValid: true, payer } : { success: true, transaction, network: "eip155:196", payer, amount: "300000" } }));
  });
  const facilitatorUrl = await listen(facilitator);
  const cfg = { ...loadConfig(), NODE_ENV: "test" as const, X402_MOCK: false, paymentMode: "okx" as const, OKX_API_KEY: "test", OKX_SECRET_KEY: "test", OKX_PASSPHRASE: "test", OKX_FACILITATOR_URL: facilitatorUrl, PAY_TO_ADDRESS: payTo, BASE_URL: "https://pulse.example", QUEUE_PROVIDER: "memory" as const, STORAGE_PROVIDER: "memory" as const, FEATURE_TELEGRAM: false, FEATURE_BASE_PAYMENTS: false, FEATURE_ARBITRUM_PAYMENTS: false, CIRCLE_GATEWAY_ENABLED: false };
  const api = createServer(createApp(cfg, { startDurableWorker: false, spotInstrumentExists: async () => true }));
  const origin = await listen(api);
  const payload = { x402Version: 2, resource: { url: "https://pulse.example/xlayer/v1/analysis/spot/premium" }, accepted: { scheme: "exact", network: "eip155:196", asset: cfg.X402_ASSET, amount: "300000", payTo }, payload: { signature: "test-only" } };
  const headers = { "Content-Type": "application/json", "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payload)).toString("base64") };
  const call = (args: object) => fetch(origin + "/xlayer/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 8355, method: "tools/call", params: { name: "spot_analysis_premium", arguments: args } }) });
  try {
    const invalid = await call({}); assert.equal(invalid.status, 400); assert.deepEqual(calls, []); assert.equal(invalid.headers.get("payment-response"), null);
    const paid = await call({ instId: "BTC-USDT", timeframe: "1H", lang: "en" });
    assert.equal(paid.status, 202); assert.deepEqual(calls, ["/api/v6/pay/x402/verify", "/api/v6/pay/x402/settle"]);
    const accepted = (await paid.json()).result.structuredContent; assert.ok(accepted.job.id); assert.ok(accepted.recoveryToken);
    assert.equal(JSON.parse(Buffer.from(paid.headers.get("payment-response")!, "base64").toString()).transaction, transaction);
    const recovery = await fetch(origin + "/xlayer/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 8356, method: "tools/call", params: { name: "job_status", arguments: { jobId: accepted.job.id, recoveryToken: accepted.recoveryToken } } }) });
    assert.equal(recovery.status, 200); assert.equal((await recovery.json()).result.structuredContent.job.id, accepted.job.id); assert.equal(calls.length, 2);
  } finally { await close(api); await close(facilitator); }
});
