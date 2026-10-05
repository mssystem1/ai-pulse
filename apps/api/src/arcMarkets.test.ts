import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARC_USDC, ARC_OKX_MARKETS, arcMarketId, parseArcTokens, assertArcExecutionBinding, arcOrderMarket, assertArcAutomationHistory } from "./arcMarkets.js";
const meme = { address: "0xeb64987643db71c76b2a2be7e723decc995e5b37", symbol: "COOL", decimals: 18 };
describe("Arc OKX execution policy", () => {
  it("maps BTC to cirBTC and ETH to WETH by exact address in both trade directions", () => {
    for (const token of ARC_OKX_MARKETS) {
      assert.doesNotThrow(() => assertArcExecutionBinding(token.pair, token.address, ARC_USDC));
      const settlement = { address: ARC_USDC, symbol: "USDC" };
      assert.equal(arcOrderMarket(token, settlement).pair, token.pair);
      assert.equal(arcOrderMarket(settlement, token).pair, token.pair);
      assert.throws(() => assertArcExecutionBinding(token.pair, meme.address, ARC_USDC));
      assert.throws(() => assertArcExecutionBinding(token.pair, token.address, "0x"+"1".repeat(40)));
    }
  });
  it("cannot promote indexed memes or spoofed BTC tickers to execution markets", () => {
    assert.throws(() => assertArcExecutionBinding(arcMarketId(meme), meme.address, ARC_USDC), /Risk Guard only/);
    assert.throws(() => arcOrderMarket(meme, { address: ARC_USDC, symbol: "USDC" }), /Risk Guard/);
    assert.throws(() => arcOrderMarket({ ...meme, symbol: "cirBTC" }, { address: ARC_USDC, symbol: "USDC" }), /Risk Guard/);
    assert.throws(() => assertArcExecutionBinding("COOL-USDT", meme.address, ARC_USDC), /Risk Guard only/);
    assert.throws(() => arcOrderMarket(ARC_OKX_MARKETS[0], ARC_OKX_MARKETS[1]));
  });
  it("keeps broad address-scoped discovery for Risk Guard without inventing price data", () => {
    const rows = parseArcTokens({ tokens: [meme, meme, { ...meme, address: "0x"+"2".repeat(40) },
      { ...meme, chainId: 5042002, address: "0x"+"3".repeat(40) }, { ...meme, address: "bad" }, { ...meme, decimals: 37, address: "0x"+"4".repeat(40) }] });
    assert.equal(rows.length, 2); assert.equal(rows[0].priceUsd, null); assert.equal(rows[0].holders, null);
    assert.equal(rows[0].chainId, "5042"); assert.throws(() => parseArcTokens({}), /unavailable/);
  });
  it("requires sufficient fresh closed OKX history before automated entries", () => {
    const interval = 900_000, now = Date.now(), current = Math.floor(now/interval)*interval;
    const candles = Array.from({length:50}, (_,i) => ({ ts:current-(50-i)*interval,open:2,high:3,low:1,close:2.5,volume:40,volumeCcy:100,confirmed:true }));
    assert.doesNotThrow(() => assertArcAutomationHistory(candles,"15m",now));
    assert.throws(() => assertArcAutomationHistory(candles.slice(1),"15m",now));
    assert.throws(() => assertArcAutomationHistory([...candles.slice(0,20),...candles.slice(21)],"15m",now));
    assert.throws(() => assertArcAutomationHistory(candles,"1H",now));
    assert.throws(() => assertArcAutomationHistory(candles,"15m",now+2*interval));
    assert.throws(() => assertArcAutomationHistory(candles.map((v,i)=>i===49?{...v,confirmed:false}:v),"15m",now));
  });
});
