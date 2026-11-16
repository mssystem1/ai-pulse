import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "@pulse/config";
import { TerminalMarketSourceUnavailableError } from "@pulse/analysis";
import type { TerminalMarketSnapshot } from "@pulse/domain";
import { createTerminalRoutes } from "./terminalRoutes.js";
import { TerminalRuntime } from "./terminalRuntime.js";
import { grantTerminalPass, MemoryTerminalStorage, TerminalStore } from "./terminalStore.js";

const signer = privateKeyToAccount(`0x${"11".repeat(32)}`), owner = signer.address.toLowerCase(), now = Date.UTC(2026, 10, 9);
const config = () => ({ ...loadConfig(), NODE_ENV: "test" as const, FEATURE_TRADING_TERMINAL: true, FEATURE_TELEGRAM: false, X402_MOCK: true, QUEUE_PROVIDER: "memory" as const, STORAGE_PROVIDER: "memory" as const });
const snapshot = (): TerminalMarketSnapshot => ({ version: "terminal-market-v1", instId: "BTC-USDT", timeframe: "1H", observedAt: now, report: { snapshot: { instId: "BTC-USDT", timeframe: "1H", observedAt: new Date(now).toISOString() } } as TerminalMarketSnapshot["report"], tools: { flow: { id: "flow", label: "Flow", source: "fixture", status: "unavailable", knownAt: now, points: [], marketType: "spot" } } as TerminalMarketSnapshot["tools"], observations: [], sources: [] });

test("rejected source promise is evicted immediately so Retry market fetches new evidence", async () => {
  let calls = 0;
  const runtime = new TerminalRuntime(config(), { store: new TerminalStore(new MemoryTerminalStorage(), "source-retry", 180), now: () => now, snapshot: async () => { if (++calls === 1) throw new TerminalMarketSourceUnavailableError("upstream"); return snapshot(); } });
  await assert.rejects(runtime.snapshot("BTC-USDT", "1H"), TerminalMarketSourceUnavailableError);
  assert.equal((await runtime.snapshot("BTC-USDT", "1H")).timeframe, "1H"); assert.equal(calls, 2);
  await runtime.snapshot("BTC-USDT", "1H"); assert.equal(calls, 2, "A successful fresh source is still shared within its cache window");
});

test("market route distinguishes malformed selection and recoverable source failure from formula creation", async t => {
  let failure: "timeout" | "upstream" | "invalid_source" | undefined = "upstream", calls = 0;
  const state = new TerminalStore(new MemoryTerminalStorage(), "source-route", 180);
  await state.mutate(owner, value => { grantTerminalPass(value, { requestId: "existing-test-pass", duration: "24h", priceUsd: "1.5", amountAtomic: "1500000", network: "base", asset: "USDC", paymentId: "existing-test-pass", purchasedAt: new Date(now).toISOString(), simulated: true }); });
  const routes = createTerminalRoutes(config(), { store: state, now: () => now, snapshot: async () => { calls++; if (failure) throw new TerminalMarketSourceUnavailableError(failure, Error("secret provider payload")); return snapshot(); } });
  const app = express(); app.use(express.json()); app.use(routes.publicRouter); app.use(routes.beforePayment); app.use((_error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: "Unexpected failure" }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const challenge = await (await fetch(origin + "/v1/terminal/auth/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: owner }) })).json();
    const auth = await (await fetch(origin + "/v1/terminal/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId: challenge.challengeId, signature: await signer.signMessage({ message: challenge.message }) }) })).json();
    const read = (query: string) => fetch(origin + "/v1/terminal/market?" + query, { headers: { authorization: `Bearer ${auth.token}` } });
    const before = await state.get(owner);
    await t.test("invalid selection returns 400 without calling any source", async () => {
      for (const query of ["instId=BTC-USDT", "instId=BTC-USDT&timeframe=2H", "instId=BTC-USDT&timeframe=1H&extra=true"]) { const response = await read(query); assert.equal(response.status, 400); assert.equal((await response.json()).code, "terminal_market_input"); }
      assert.equal(calls, 0);
    });
    for (const reason of ["upstream", "timeout", "invalid_source"] as const) await t.test(`${reason} exposes safe retry information and preserves wallet state`, async () => {
      failure = reason;
      const response = await read("instId=BTC-USDT&timeframe=1H"), body = await response.json();
      assert.equal(response.status, 503); assert.equal(response.headers.get("retry-after"), "5"); assert.equal(body.code, "terminal_market_source_unavailable"); assert.equal(body.reason, reason); assert.equal(body.recoverable, true); assert.equal(body.instId, "BTC-USDT"); assert.equal(body.timeframe, "1H"); assert.match(body.error, /draft is preserved/); assert(!JSON.stringify(body).includes("secret")); assert.deepEqual(await state.get(owner), before);
    });
    failure = undefined;
    const recovered = await read("instId=BTC-USDT&timeframe=1H"), body = await recovered.json();
    assert.equal(recovered.status, 200); assert.equal(body.instId, "BTC-USDT"); assert.match(body.evidenceSnapshotId, /^tes_[\da-f]{32}$/); assert.deepEqual(await state.get(owner), before);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
