import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "@pulse/config";
import { createTerminalRoutes } from "./terminalRoutes.js";
import { grantTerminalPass, MemoryTerminalStorage, TerminalStore } from "./terminalStore.js";

const account = privateKeyToAccount(`0x${"44".repeat(32)}`), now = Date.parse("2026-11-17T00:00:00Z");
async function listen(app: express.Express) {
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }

test("indicator-assist enforces sign-in, pass, daily quota and validates stubbed provider graphs", async () => {
  let output = "", providerCalls = 0;
  const aiApp = express(); aiApp.use(express.json());
  aiApp.post("/v1/chat/completions", (_req, res) => { providerCalls++; res.json({ model: "fixture-model", choices: [{ message: { content: output } }] }); });
  const ai = await listen(aiApp), storage = new MemoryTerminalStorage(), store = new TerminalStore(storage, `indicator-assist-${Math.random()}`, 180);
  await store.mutate(account.address, value => grantTerminalPass(value, { requestId: "assist_pass_request", duration: "24h", priceUsd: "1.5", amountAtomic: "1500000", network: "base", asset: `0x${"33".repeat(20)}`, paymentId: "assist-pass", purchasedAt: new Date(now).toISOString(), simulated: true }));
  const cfg = { ...loadConfig(), NODE_ENV: "test" as const, FEATURE_TRADING_TERMINAL: true, FEATURE_TELEGRAM: false, X402_MOCK: true, QUEUE_PROVIDER: "memory" as const, STORAGE_PROVIDER: "memory" as const, XAI_API_KEY: "local-ai-fixture", XAI_BASE_URL: `${ai.origin}/v1`, PERSISTENCE_NAMESPACE: `indicator-assist-${Math.random()}` };
  const routes = createTerminalRoutes(cfg, { store, now: () => now, telegramRecipient: async () => null });
  const app = express(); app.use(express.json()); app.use(routes.publicRouter); app.use(routes.beforePayment);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: error.message }));
  const api = await listen(app), endpoint = `${api.origin}/v1/terminal/indicator-assist`;
  const post = (body: unknown, token?: string) => fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const signIn = async () => {
    const challenge = await (await fetch(`${api.origin}/v1/terminal/auth/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: account.address }) })).json() as { challengeId: string; message: string };
    const response = await fetch(`${api.origin}/v1/terminal/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId: challenge.challengeId, signature: await account.signMessage({ message: challenge.message }) }) });
    assert.equal(response.status, 200); return (await response.json() as { token: string }).token;
  };
  try {
    assert.equal((await post({ prompt: "Build an EMA" })).status, 401);
    const token = await signIn(), graph = { nodes: [{ id: "close", kind: "source", field: "close" }, { id: "ema20", kind: "ema", input: "close", period: 20 }], plots: [{ id: "ema_plot", node: "ema20", label: "EMA 20", pane: "price", style: "line", unit: "price", color: "#22d3ee" }], gapPolicy: "reset", warmup: "full-window" };
    output = JSON.stringify({ title: "EMA", description: "Average", explanation: "Causal average", graph });
    const valid = await post({ prompt: "Build an EMA of close" }, token);
    assert.equal(valid.status, 200); const draft = await valid.json() as { graph: unknown; previewRequired: boolean; model: string };
    assert.deepEqual(draft.graph, graph); assert.equal(draft.previewRequired, true); assert.equal(draft.model, "fixture-model");
    assert.equal(providerCalls, 1);

    output = JSON.stringify({ title: "Bad", description: "Bad", explanation: "Bad", graph: { nodes: [{ id: "x", kind: "sample", input: "x", when: "x" }], plots: [], gapPolicy: "reset", warmup: "full-window" } });
    const malformed = await post({ prompt: "Build an unsupported graph" }, token);
    assert.equal(malformed.status, 503); assert.equal(providerCalls, 2);

    const outsider = privateKeyToAccount(`0x${"55".repeat(32)}`);
    await store.mutate(outsider.address, () => undefined);
    const outsiderAuth = await fetch(`${api.origin}/v1/terminal/auth/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: outsider.address }) }).then(response => response.json()) as { challengeId: string; message: string };
    const outsiderToken = await fetch(`${api.origin}/v1/terminal/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId: outsiderAuth.challengeId, signature: await outsider.signMessage({ message: outsiderAuth.message }) }) }).then(response => response.json()) as { token: string };
    const withoutPass = await post({ prompt: "Build an EMA" }, outsiderToken.token);
    assert.equal(withoutPass.status, 403); assert.equal(providerCalls, 2);

    await store.mutate(account.address, value => { value.aiUsage = { day: new Date(now).toISOString().slice(0, 10), count: cfg.TERMINAL_AI_QUESTIONS_PER_DAY }; });
    const exhausted = await post({ prompt: "Build an EMA" }, token);
    assert.equal(exhausted.status, 429); assert.equal(providerCalls, 2);
  } finally { await close(api.server); await close(ai.server); }
});
