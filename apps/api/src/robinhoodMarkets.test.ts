import test from "node:test";
import assert from "node:assert/strict";
import type { AppConfig } from "@pulse/config";
import { isRobinhoodMarket, robinhoodMarketId, parseRobinhoodCandles, assertRobinhoodMarketBinding, robinhoodSettlementMark, assertRobinhoodAutomationHistory, robinhoodDayWindow } from "./robinhoodMarkets.js";
import { ROBINHOOD_USDG, NATIVE_ETH } from "./robinhoodExecutionAssets.js";
import { robinhoodCandles, robinhoodMarketCatalog, assertExecutionMarketIdentity, robinhoodOrderMarket } from "./robinhoodMarkets.js";

test("recovered buy and sell orders retain the same contract-specific USDG market", () => {
  const target = { address: "0x1111111111111111111111111111111111111111", symbol: "NEW" };
  const settlement = { address: ROBINHOOD_USDG, symbol: "USDG" };
  assert.deepEqual(robinhoodOrderMarket(target, settlement), robinhoodOrderMarket(settlement, target));
  assert.equal(robinhoodOrderMarket(target, settlement).pair, robinhoodMarketId(target));
  assert.throws(() => robinhoodOrderMarket(target, { ...target, symbol: "USDG" }), /canonical USDG/);
  assert.throws(() => robinhoodOrderMarket(settlement, settlement), /exactly one/);
});

test("Robinhood execution cannot fall back to ticker-only research prices", () => {
  const pair = robinhoodMarketId({ symbol: "WETH", address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73" });
  assert.doesNotThrow(() => assertExecutionMarketIdentity("robinhood", pair));
  for (const research of ["ETH-USDT", "WETH-USDG", "XAAPL-USDT"])
    assert.throws(() => assertExecutionMarketIdentity("robinhood", research), /contract-specific USDG market/);
  assert.doesNotThrow(() => assertExecutionMarketIdentity("base", "ETH-USDT"));
});

const row = (ts = 1_790_000_000_000): unknown[] => [String(ts), "10", "12", "9", "11", "2", "22", "1"];

test("concurrent market requests share candles, but different configurations and failed requests do not", async () => {
  const original = globalThis.fetch;
  let requests = 0, fail = false;
  const address = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
  const cfg = { hasOkxCredentials: true, OKX_API_KEY: "fixture", OKX_SECRET_KEY: "fixture", OKX_PASSPHRASE: "fixture", OKX_BASE_URL: "https://fixture.invalid" } as AppConfig;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === "api.robinhood.com") return Response.json({ assets: [] });
    if (url.pathname.endsWith("all-tokens")) return Response.json({ code: "0", data: [
      { tokenContractAddress: address, tokenSymbol: "WETH", decimals: 18 },
      { tokenContractAddress: "0x1111111111111111111111111111111111111111", tokenSymbol: "WETH", decimals: 18 },
    ] });
    assert.equal(url.pathname, "/api/v6/dex/market/candles");
    requests++;
    return fail ? Response.json({ code: "denied" }, { status: 401 }) : Response.json({ code: "0", data: [row()] });
  };
  try {
    const pair = robinhoodMarketId({ address, symbol: "WETH" });
    const catalog = await robinhoodMarketCatalog(cfg, true);
    assert.deepEqual(catalog.find(item => item.token.address === address)!.researchPairs, ["ETH-USDT"]);
    assert.deepEqual(catalog.find(item => item.token.address.startsWith("0x1111"))!.researchPairs, []);
    await Promise.all([robinhoodCandles(cfg, pair, "1H"), robinhoodCandles(cfg, pair, "1H")]);
    assert.equal(requests, 1);
    await robinhoodCandles({ ...cfg }, pair, "1H");
    assert.equal(requests, 2);
    fail = true;
    await assert.rejects(robinhoodCandles(cfg, pair, "4H"), /401/);
    fail = false;
    await robinhoodCandles(cfg, pair, "4H");
    assert.equal(requests, 4);
  } finally { globalThis.fetch = original; }
});

test("day statistics require 24 consecutive hourly buckets and exclude future data", () => {
  const hour = 3_600_000, now = Math.floor(1_790_000_000_000 / hour) * hour;
  const data = parseRobinhoodCandles(Array.from({ length: 25 }, (_, i) => row(now - (24 - i) * hour)));
  assert.equal(robinhoodDayWindow(data, now + 1000).length, 24);
  assert.throws(() => robinhoodDayWindow(data.slice(-2), now), /incomplete/);
  assert.throws(() => robinhoodDayWindow(data.filter((_, i) => i !== 12), now), /incomplete/);
  assert.equal(robinhoodDayWindow([...data, ...parseRobinhoodCandles([row(now + hour)])], now).at(-1)!.ts, now);
});

test("automation history rejects insufficient, open, gapped, stale and future candles", () => {
  const now = 1_790_000_000_000, hour = 3_600_000;
  const history = parseRobinhoodCandles(Array.from({ length: 50 }, (_, index) => row(now - (50 - index) * hour)));
  assert.doesNotThrow(() => assertRobinhoodAutomationHistory(history, "1H", now));
  assert.throws(() => assertRobinhoodAutomationHistory(history.slice(1), "1H", now), /50 completed/);
  assert.throws(() => assertRobinhoodAutomationHistory(history.map(c => ({ ...c, confirmed: false })), "1H", now), /50 completed/);
  assert.throws(() => assertRobinhoodAutomationHistory(history.map((c, i) => ({ ...c, ts: c.ts + (i === 20 ? 1 : 0) })), "1H", now), /gaps/);
  assert.throws(() => assertRobinhoodAutomationHistory(history, "1H", now + hour + 1), /stale/);
  assert.throws(() => assertRobinhoodAutomationHistory(history, "1H", now - 1), /invalid/);
});

test("settlement pricing uses actual USDG value and rejects stale or asynchronous marks", () => {
  const ts = 1_790_000_000_000;
  assert.equal(robinhoodSettlementMark({ ts, close: 2000 }, { ts, close: 0.8 }, ts), 2500);
  assert.throws(() => robinhoodSettlementMark({ ts, close: 2000 }, { ts, close: 0 }, ts));
  assert.throws(() => robinhoodSettlementMark({ ts, close: 2000 }, { ts: ts - 60_000, close: 1 }, ts), /synchronized/);
  assert.throws(() => robinhoodSettlementMark({ ts, close: 2000 }, { ts, close: 1 }, ts + 180_001), /stale/);
});

test("automated market binding requires the exact target and canonical settlement contract", () => {
  const target = "0x1111111111111111111111111111111111111111";
  const market = { token: { address: target } };
  assert.doesNotThrow(() => assertRobinhoodMarketBinding(market, target, ROBINHOOD_USDG));
  assert.throws(() => assertRobinhoodMarketBinding(market, ROBINHOOD_USDG, ROBINHOOD_USDG), /target contract/);
  assert.throws(() => assertRobinhoodMarketBinding(market, target, target), /canonical USDG/);
  assert.throws(() => assertRobinhoodMarketBinding({ token: { address: NATIVE_ETH } }, NATIVE_ETH, ROBINHOOD_USDG), /ERC-20/);
});

test("Robinhood market identity distinguishes same-symbol contracts without a CEX listing", () => {
  const first = robinhoodMarketId({ symbol: "NEW", address: "0x1111111111111111111111111111111111111111" });
  const second = robinhoodMarketId({ symbol: "NEW", address: "0x2222222222222222222222222222222222222222" });
  assert.notEqual(first, second);
  assert.ok(isRobinhoodMarket(first));
  assert.ok(isRobinhoodMarket(second));
  assert.equal(isRobinhoodMarket("NEW-USDT"), false);
  assert.throws(() => robinhoodMarketId({ symbol: "NEW", address: "0x123" }));
});

test("DEX candles sort, deduplicate identical records, and honor exclusive pagination", () => {
  const earlier = row(1_789_999_940_000);
  const parsed = parseRobinhoodCandles([row(), earlier, row()]);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].ts, Number(earlier[0]));
  assert.equal(parsed[1].confirmed, true);
  assert.equal(parseRobinhoodCandles([row(), earlier], Number(row()[0])).length, 1);
});

test("malformed or conflicting price history cannot silently enter strategy signals", () => {
  for (const [index, value] of [[0, 1.5], [1, null], [2, "8"], [3, "0"], [5, ""], [6, -1], [7, "yes"]] as const) {
    const invalid = row(); invalid[index] = value;
    assert.throws(() => parseRobinhoodCandles([invalid]));
  }
  const conflicting = row(); conflicting[4] = "10";
  assert.throws(() => parseRobinhoodCandles([row(), conflicting]), /Conflicting/);
});
