import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "@pulse/config";
import type { SpotTicker } from "@pulse/market";
import type { TerminalTapeoutComponent } from "@pulse/domain";
import { createTerminalRoutes } from "./terminalRoutes.js";
import { grantTerminalPass, MemoryTerminalStorage, TerminalStore } from "./terminalStore.js";

const signer = privateKeyToAccount(`0x${"11".repeat(32)}`), other = privateKeyToAccount(`0x${"22".repeat(32)}`), OWNER = signer.address.toLowerCase(), OTHER = other.address.toLowerCase(), NOW = Date.parse("2026-11-05T12:00:00Z");
const component: TerminalTapeoutComponent = { version: "tapeout-xlayer-nand-v1", chainId: 196, processor: "0x839bdd6fa7a66416a609a735e11de5411b98574e", circuitId: "2", factory: "0x1f09daefa827f02cbb40967cc91b259763760761", blockNumber: "1", blockHash: `0x${"a".repeat(64)}`, observedAt: NOW, netlist: "0x000000020000030000000400000400000005000005", codeHash: "sha256:fixture", truthTable: [1, 1, 1, 0], verified: true, endpoints: [] };
const ticker = (instId: string, ts: number, last = 80000): SpotTicker => ({ instId, ts: String(ts), last, priceCurrency: instId.split("-").at(-1) as "USDT", open24h: 0, high24h: 0, low24h: 0, vol24h: 0, volCcy24h: 0, change24hPct: 0 });

test("Radar creation retries preserve the original owner-scoped rule and deadline, including races and ended records", async () => {
  let now = NOW, circuitCalls = 0;
  const state = new TerminalStore(new MemoryTerminalStorage(), `radar-retry-${Math.random()}`, 180);
  for (const owner of [OWNER, OTHER]) await state.mutate(owner, value => { grantTerminalPass(value, { requestId: "radar_fixture_grant", duration: "24h", priceUsd: "1.5", amountAtomic: "1500000", network: "base", asset: `0x${"33".repeat(20)}`, paymentId: "fixture-no-payment", purchasedAt: new Date(NOW).toISOString(), simulated: true }); });
  const cfg = { ...loadConfig(), NODE_ENV: "test" as const, FEATURE_TELEGRAM: false, FEATURE_TRADING_TERMINAL: true, QUEUE_PROVIDER: "memory" as const, TERMINAL_MAX_RADARS: 1 };
  const routes = createTerminalRoutes(cfg, { store: state, now: () => now, tapeout: async () => { circuitCalls++; return component; } });
  const app = express(); app.use(express.json()); app.use(routes.publicRouter); app.use(routes.beforePayment);
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/terminal`;
  const post = (path: string, body: unknown, token?: string) => fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const login = async (account: typeof signer) => { const c = await (await post("auth/challenge", { wallet: account.address })).json(); return (await (await post("auth/verify", { challengeId: c.challengeId, signature: await account.signMessage({ message: c.message }) })).json()).token as string; };
  const input = { requestId: "radar_retry_request_001", instId: "BTC-USDT", timeframe: "1D", detector: "sweep_reclaim", boundary: 80000, side: "below", tolerance: 0, expiresAt: new Date(NOW + 3600_000).toISOString(), telegram: false };
  try {
    const token = await login(signer), otherToken = await login(other);
    const raced = await Promise.all([post("radars", input, token), post("radars", input, token)]);
    assert.ok(raced.every(response => response.status === 201));
    let saved = await state.get(OWNER); assert.equal(saved.radars.length, 1); assert.equal(saved.activity.filter(event => event.kind === "radar_started").length, 1);
    const accepted = structuredClone(saved.radars[0]); assert.equal(accepted.timeframe, "1Dutc"); assert.equal(circuitCalls, 1);
    now += 10_000;
    assert.equal((await post("radars", { ...input, timeframe: "1Dutc" }, token)).status, 201, "Equivalent frame aliases retry the accepted rule");
    assert.equal((await state.get(OWNER)).radars[0].expiresAt, accepted.expiresAt); assert.equal(circuitCalls, 1, "Identical recovery does not require another circuit/source fetch");
    for (const change of [{ boundary: 79999 }, { expiresAt: new Date(NOW + 7200_000).toISOString() }, { detector: "breakout_acceptance" }, { telegram: true }, { instId: "ETH-USDT" }]) {
      const response = await post("radars", { ...input, ...change }, token); assert.equal(response.status, 409); assert.equal((await response.json()).code, "terminal_radar_request_conflict");
    }
    const capacity = await post("radars", { ...input, requestId: "radar_new_request_002" }, token); assert.equal(capacity.status, 409);
    await state.mutate(OWNER, value => { value.radars[0].paused = true; value.radars[0].telegram = true; value.radars[0].state = "expired"; });
    now = NOW + 7200_000;
    assert.equal((await post("radars", input, await login(signer))).status, 201, "A past deadline still permits recovery of that exact accepted request after normal session renewal");
    saved = await state.get(OWNER); assert.equal(saved.radars[0].state, "expired"); assert.equal(saved.radars[0].paused, true); assert.equal(saved.radars[0].expiresAt, accepted.expiresAt);
    const independent = await post("radars", { ...input, expiresAt: new Date(now + 3600_000).toISOString() }, await login(other)); assert.equal(independent.status, 201); assert.equal((await state.get(OTHER)).radars.length, 1, "A different owner has an independent request scope");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("read-only current Spot quotes are asset-scoped, frame-independent, cache-bounded and source-validated", async () => {
  let now = NOW, calls = 0, reports = 0;
  const values = new Map<string, SpotTicker>(), state = new TerminalStore(new MemoryTerminalStorage(), `quote-read-${Math.random()}`, 180);
  await state.mutate(OWNER, value => { grantTerminalPass(value, { requestId: "quote_fixture_grant", duration: "24h", priceUsd: "1.5", amountAtomic: "1500000", network: "base", asset: `0x${"33".repeat(20)}`, paymentId: "fixture-no-payment", purchasedAt: new Date(NOW).toISOString(), simulated: true }); });
  const cfg = { ...loadConfig(), NODE_ENV: "test" as const, FEATURE_TELEGRAM: false, FEATURE_TRADING_TERMINAL: true, QUEUE_PROVIDER: "memory" as const };
  const routes = createTerminalRoutes(cfg, { store: state, now: () => now, quote: async instId => { calls++; return values.get(instId) ?? ticker(instId, now); }, snapshot: async () => { reports++; throw new Error("A quote must not regenerate a report or advance a scenario"); } });
  const app = express(); app.use(express.json()); app.use(routes.publicRouter); app.use(routes.beforePayment);
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/terminal`;
  const post = (path: string, body: unknown) => fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const login = async (account: typeof signer) => { const c = await (await post("auth/challenge", { wallet: account.address })).json(); return (await (await post("auth/verify", { challengeId: c.challengeId, signature: await account.signMessage({ message: c.message }) })).json()).token as string; };
  const read = (query: string, token?: string) => fetch(`${base}/quote?${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  try {
    assert.equal((await read("instId=BTC-USDT")).status, 401);
    const token = await login(signer), otherToken = await login(other);
    assert.equal((await read("instId=BTC-USDT", otherToken)).status, 403);
    const original = await state.get(OWNER), first = await read("instId=BTC-USDT", token);
    assert.equal(first.status, 200); assert.equal(first.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await first.json(), { instId: "BTC-USDT", price: 80000, ts: now, source: "okx-public-spot", observedAt: now });
    const parallel = await Promise.all(Array.from({ length: 5 }, () => read("instId=BTC-USDT", token))); assert.ok(parallel.every(response => response.status === 200)); assert.equal(calls, 1);
    assert.equal((await read("instId=ETH-USDT", token)).status, 200); assert.equal(calls, 2, "Another asset has its own ticker cache");
    assert.equal((await read("instId=BTC-USDT&timeframe=4H", token)).status, 400); assert.equal((await read("instId=btc-usdt", token)).status, 400);
    for (const [asset, supplied] of [["SOL-USDT", ticker("SOL-USDT", now - 15001)], ["XRP-USDT", ticker("XRP-USDT", now + 5001)], ["ZEC-USDT", ticker("ETH-USDT", now)], ["HYPE-USDT", ticker("HYPE-USDT", now, 0)], ["DOGE-USDT", { ...ticker("DOGE-USDT", now), priceCurrency: "USDC" }]] as const) {
      values.set(asset, supplied); const response = await read(`instId=${asset}`, token); assert.equal(response.status, 503); assert.equal((await response.json()).code, "terminal_quote_unavailable");
    }
    values.set("SOL-USDT", ticker("SOL-USDT", now)); assert.equal((await read("instId=SOL-USDT", token)).status, 200, "A failed quote cache entry is retried, never replaced by the report close");
    values.set("ADA-USDT", ticker("ADA-USDT", now - 14999)); assert.equal((await read("instId=ADA-USDT", token)).status, 200);
    now += 2; assert.equal((await read("instId=ADA-USDT", token)).status, 503, "Freshness is revalidated even within the one-second cache");
    now += 1000; assert.equal((await read("instId=BTC-USDT", token)).status, 200);
    assert.equal(reports, 0); assert.deepEqual(await state.get(OWNER), original, "Quotes do not mutate pass, private journal, report or lifecycle state");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
