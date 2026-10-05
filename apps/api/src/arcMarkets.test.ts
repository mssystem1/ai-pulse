import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARC_USDC, arcMarketId, isArcMarket, parseArcTokens, parseArcCandles, assertArcMarketBinding, assertArcExecutionBinding, arcOrderMarket, assertArcAutomationHistory } from "./arcMarkets.js";
const address = "0xeb64987643db71c76b2a2be7e723decc995e5b37";
const token = { address, symbol: "COOL", name: "usdc is cool", decimals: 18, hasUsdc: true, price: null, liquidityUsdc: 50 };
describe("Arc contract markets", () => {
  it("uses the entire contract address and rejects malformed targets", () => {
    const pair = arcMarketId(token);
    assert.ok(isArcMarket(pair)); assert.ok(pair.length <= 64);
    assert.notEqual(pair, arcMarketId({ ...token, address: address.slice(0,-1) + "8" }));
    assert.equal(isArcMarket("COOL-USDC"), false);
    assert.equal(isArcMarket("COOL.1234-USDC"), false);
    assert.throws(() => arcMarketId({ ...token, address: "0x1234" }));
    assert.throws(() => arcMarketId({ ...token, address: ARC_USDC }));
  });
  it("requires the exact target contract and Arc USDC for buys and sells", () => {
    const pair = arcMarketId(token), settlement = { address: ARC_USDC, symbol: "USDC" };
    assert.doesNotThrow(() => assertArcMarketBinding(pair, address.toUpperCase(), ARC_USDC));
    assert.throws(() => assertArcMarketBinding(pair, "0x" + "1".repeat(40), ARC_USDC));
    assert.throws(() => assertArcMarketBinding(pair, address, "0xaf88d065e77c8cc2239327c5edb3a432268e5831"));
    assert.equal(arcOrderMarket(token, settlement).pair, pair);
    assert.equal(arcOrderMarket(settlement, token).pair, pair);
    assert.throws(() => arcOrderMarket(token, token));
  });
  it("deduplicates by address, retains duplicate tickers, and rejects other-chain entries", () => {
    const rows = parseArcTokens({ tokens: [token, token, { ...token, address: "0x"+"2".repeat(40) },
      { ...token, chainId: 5042002, address: "0x"+"3".repeat(40) }, { ...token, address: "bad" }, { ...token, decimals: 37, address: "0x"+"4".repeat(40) }] });
    assert.equal(rows.length, 2); assert.equal(rows[0].priceUsd, null);
    assert.equal(rows[0].holders, null); assert.equal(rows[0].liquidityUsd, 50);
    assert.equal(rows[0].chainId, "5042");
    assert.throws(() => parseArcTokens({}), /unavailable/);
  });
  it("does not map an arbitrary ETH or BTC ticker to a canonical wrapper", () => {
    assert.doesNotThrow(() => assertArcExecutionBinding("ETH-USDT", "0x128cc466b61f542da60c70e3aa11c10e19b84edb", ARC_USDC));
    assert.throws(() => assertArcExecutionBinding("ETH-USDT", address, ARC_USDC));
    assert.throws(() => assertArcExecutionBinding("BTC-USDT", address, ARC_USDC));
    assert.throws(() => assertArcExecutionBinding("COOL-USDT", address, ARC_USDC));
  });
});
describe("Arc price history", () => {
  const interval = 900, now = 1_791_200_700_000;
  const current = Math.floor(now / (interval*1000)) * interval;
  const candle = (time: number) => ({ time, open: 2, high: 3, low: 1, close: 2.5, vol: 100 });
  it("preserves quote volume and distinguishes the open candle", () => {
    const c = parseArcCandles({ tf: interval, candles: [candle(current), candle(current-interval)] }, interval, now);
    assert.deepEqual(c.map(c => c.confirmed), [true,false]);
    assert.equal(c[0].volumeCcy,100); assert.equal(c[0].volume,40);
    assert.equal(parseArcCandles({ tf: interval, candles: [candle(current)] }, interval, now, current*1000).length,0);
  });
  it("rejects mismatched timeframes, invented zero prices, malformed and conflicting observations", () => {
    assert.throws(() => parseArcCandles({ tf: 3600, candles: [] }, interval, now));
    for(const overrides of [{close:0},{low:4},{vol:-1},{time:current+interval},{time:current+1},{open:null}])
      assert.throws(() => parseArcCandles({tf:interval,candles:[{...candle(current-interval),...overrides}]},interval,now));
    assert.throws(() => parseArcCandles({tf:interval,candles:[candle(current-interval),{...candle(current-interval),close:2}]},interval,now), /Conflicting/);
  });
  it("requires 50 consecutive, fresh completed candles for Autopilot", () => {
    const c=parseArcCandles({tf:interval,candles:Array.from({length:50},(_,i)=>candle(current-(50-i)*interval))},interval,now);
    assert.doesNotThrow(() => assertArcAutomationHistory(c,"15m",now));
    assert.throws(() => assertArcAutomationHistory(c.slice(1),"15m",now));
    assert.throws(() => assertArcAutomationHistory([...c.slice(0,20),...c.slice(21)],"15m",now));
    assert.throws(() => assertArcAutomationHistory(c,"1H",now));
    assert.throws(() => assertArcAutomationHistory(c,"15m",now+2*interval*1000));
    assert.throws(() => assertArcAutomationHistory(c.map((v,i)=>i===49?{...v,confirmed:false}:v),"15m",now));
  });
});
