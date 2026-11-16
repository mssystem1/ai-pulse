import test from "node:test";
import assert from "node:assert/strict";
import { candleTimeframeMs } from "@pulse/schemas";
import type { buildMarketContext, TerminalParticipation } from "@pulse/market";
import { createTerminalMarketSnapshot, TerminalMarketSourceUnavailableError } from "./terminalMarket.js";

const NOW = Date.UTC(2026, 10, 9, 0, 0, 1);
const unavailable: TerminalParticipation = { capture: null, derivatives: { instId: "BTC-USDT-SWAP", knownAt: 0 }, liquidity: { knownAt: 0 } };
const source: typeof buildMarketContext = async input => {
  const bar = input.timeframe ?? "1H", ms = candleTimeframeMs(bar) || 31 * 86400000, last = Math.floor(NOW / ms) * ms - ms;
  return { source: "okx-public-spot", instId: input.instId, bar, fetchedAt: new Date(NOW).toISOString(), summary: null,
    ticker: { instId: input.instId, last: 120, open24h: 119, high24h: 121, low24h: 118, vol24h: 10, volCcy24h: 1200, change24hPct: 1, ts: String(NOW) },
    candles: Array.from({ length: 100 }, (_, i) => { const price = 100 + i * .2 + Math.sin(i / 5); return { ts: last - (99 - i) * ms, open: price, high: price + 1, low: price - 1, close: price + .1, volume: 10, volumeCcy: price * 10, confirmed: true }; }) };
};

test("primary exchange failure is typed and does not expose provider URLs or credentials", async () => {
  const secret = "https://provider.invalid/key-sensitive-upstream-credential";
  await assert.rejects(createTerminalMarketSnapshot({ instId: "BTC-USDT", timeframe: "1H", now: NOW, loadMarket: async input => { if (input.timeframe === "1H") throw Error(secret); return source(input); }, loadParticipation: async () => unavailable }), error => {
    assert(error instanceof TerminalMarketSourceUnavailableError); assert.equal(error.reason, "upstream"); assert.equal(error.code, "terminal_market_source_unavailable"); assert(!error.message.includes(secret)); return true;
  });
});

test("empty completed primary data is not published as a successful market chart", async () => {
  await assert.rejects(createTerminalMarketSnapshot({ instId: "BTC-USDT", timeframe: "1H", now: NOW, loadMarket: async input => ({ ...await source(input), candles: [] }), loadParticipation: async () => unavailable }), error => error instanceof TerminalMarketSourceUnavailableError && error.reason === "invalid_source");
});

test("malformed primary response fields fail validation without an untyped server exception", async () => {
  for (const part of [{ candles: [null] }, { ticker: null }]) await assert.rejects(createTerminalMarketSnapshot({ instId: "BTC-USDT", timeframe: "1H", now: NOW, loadMarket: async input => ({ ...await source(input), ...part } as unknown as Awaited<ReturnType<typeof source>>), loadParticipation: async () => unavailable }), error => error instanceof TerminalMarketSourceUnavailableError && error.reason === "invalid_source");
});

test("a stalled primary request ends at the source deadline and a stalled optional execution source cannot erase price", async () => {
  const started = Date.now(), never = () => new Promise<never>(() => {});
  await assert.rejects(createTerminalMarketSnapshot({ instId: "BTC-USDT", timeframe: "1H", now: NOW, sourceTimeoutMs: 15, loadMarket: never, loadParticipation: never }), error => error instanceof TerminalMarketSourceUnavailableError && error.reason === "timeout");
  assert(Date.now() - started < 2000);
  const price = await createTerminalMarketSnapshot({ instId: "BTC-USDT", timeframe: "1H", now: NOW, sourceTimeoutMs: 15, loadMarket: source, loadParticipation: never });
  assert.equal(price.report.snapshot.timeframe, "1H"); assert(price.report.candles.length > 0); assert.equal(price.tools.flow.status, "unavailable"); assert.deepEqual(price.tools.flow.points, []);
});

test("secondary frame failure retains primary evidence and independent source failures remain explicit", async () => {
  const market = await createTerminalMarketSnapshot({ instId: "BTC-USDT", timeframe: "1H", now: NOW, loadMarket: async input => { if (input.timeframe !== "1H") throw Error("secondary source unavailable"); return source(input); }, loadParticipation: async () => { throw Error("execution source unavailable"); } });
  assert.equal(market.instId, "BTC-USDT"); assert.equal(market.report.candles.length, 100); assert.equal(market.tools.flow.status, "unavailable"); assert.deepEqual(market.observations, []); assert.equal(market.sources.find(s => s.id === "price")?.status, "stale");
});

test("UTC week rollover excludes previous-session trades instead of relabelling them as new-week indicator history", async () => {
  const market = await createTerminalMarketSnapshot({ instId: "BTC-USDT", timeframe: "1H", now: NOW, loadMarket: source, loadParticipation: async () => ({ ...unavailable, capture: { source: "okx-public-history-trades", instId: "BTC-USDT", priceCurrency: "USDT", marketType: "spot", quantityUnit: "base", capturedAt: new Date(NOW).toISOString(), coverage: { start: NOW - 10000, end: NOW - 1000, knownAt: NOW, complete: true, sha256: ["a".repeat(64)] }, trades: [{ id: "previous-week", ts: NOW - 1001, price: 120, size: 1, side: "buy" }] } }) });
  assert.equal(market.report.candles.length, 100); assert.equal(market.tools.flow.status, "unavailable"); assert.deepEqual(market.tools.flow.points, []); assert.equal(market.tools.value.orderFlow, undefined);
});
