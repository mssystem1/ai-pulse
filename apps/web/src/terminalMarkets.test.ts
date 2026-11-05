import test from "node:test";
import assert from "node:assert/strict";
import { TERMINAL_QUICK_MARKETS, terminalMarketId } from "./terminalMarkets";

test("Terminal quick markets include the exact eight requested spot pairs", () => {
  assert.deepEqual(TERMINAL_QUICK_MARKETS.map(m => m.instId), ["BTC-USDT", "ETH-USDT", "HYPE-USDT", "SOL-USDT", "DOGE-USDT", "BNB-USDT", "ZEC-USDT", "OKB-USDT"]);
  assert.equal(new Set(TERMINAL_QUICK_MARKETS.map(m => m.instId)).size, 8);
  assert.equal(TERMINAL_QUICK_MARKETS.find(m => m.symbol === "ZEC")?.name, "Zcash");
});

test("Terminal market input normalizes case and names without changing the selected quote", () => {
  for (const [input, expected] of [["btc", "BTC-USDT"], [" Ethereum ", "ETH-USDT"], ["Hyperliquid", "HYPE-USDT"], ["Solana", "SOL-USDT"], ["Dogecoin", "DOGE-USDT"], ["Binance coin", "BNB-USDT"], ["ZCASH", "ZEC-USDT"], ["zec", "ZEC-USDT"], ["okb", "OKB-USDT"], ["btc / usdc", "BTC-USDC"], [" Zcash-usdc ", "ZEC-USDC"], ["Bitcoin USD", "BTC-USD"], ["LINK/USDT", "LINK-USDT"]]) assert.equal(terminalMarketId(input), expected, input);
});

test("Terminal market input rejects ambiguous, unsupported and malformed pairs", () => {
  for (const input of ["", " ", "BTCUSDT", "ZCASHUSDT", "USDC", "BTC/ETH", "BTC/EUR", "BTC-USDT-SWAP", "BTC//USDT", "BTC-USDT/path", "<script>", "A-USDT", `${"A".repeat(21)}-USDT`, "BTC\nUSDT\nETH"]) assert.equal(terminalMarketId(input), null, input);
});

test("Every quick pair round trips exactly and Zcash aliases never become a fake ticker", () => {
  for (const market of TERMINAL_QUICK_MARKETS) {
    assert.equal(terminalMarketId(market.instId), market.instId);
    assert.equal(terminalMarketId(market.symbol), market.instId);
    assert.equal(terminalMarketId(market.name), market.instId);
  }
  assert.equal(terminalMarketId("zcash / USDT"), "ZEC-USDT");
  assert.notEqual(terminalMarketId("Zcash"), "ZCASH-USDT");
});
