import test from "node:test";
import assert from "node:assert/strict";
import { reviewedAutopilotSignalMarket } from "./autopilotPreflight";

const reviewed = {
  network: "arc" as const, pair: "BTC-USDT", historyScope: "arc:BTC-USDT:15m",
  history: { scope: "arc:BTC-USDT:15m", ready: true, signalMarket: "BTC-USDT" },
  preflight: { ready: true, pair: "BTC-USDT", signalMarket: "BTC-USDT" },
};
test("Arc preflight accepts the same reviewed OKX signal used in its signed policy", () => {
  assert.equal(reviewedAutopilotSignalMarket(reviewed), "BTC-USDT");
});
test("the observed HTTP-200 Arc response without signalMarket cannot be treated as a source change or start setup", () => {
  assert.throws(() => reviewedAutopilotSignalMarket({ ...reviewed, preflight: { ready: true, pair: "BTC-USDT" } }), /API did not confirm/);
});
test("stale or unavailable reviewed history, an unready preflight and another market block setup", () => {
  for (const history of [null, { ...reviewed.history, ready: false }, { ...reviewed.history, scope: "arc:BTC-USDT:4H" }])
    assert.throws(() => reviewedAutopilotSignalMarket({ ...reviewed, history }), /history review/);
  for (const preflight of [null, { ...reviewed.preflight, ready: false }, { ...reviewed.preflight, pair: "ETH-USDT" }])
    assert.throws(() => reviewedAutopilotSignalMarket({ ...reviewed, preflight }), /selected market/);
  assert.throws(() => reviewedAutopilotSignalMarket({ ...reviewed, preflight: { ...reviewed.preflight, signalMarket: "ETH-USDT" } }), /signal source changed/);
  assert.throws(() => reviewedAutopilotSignalMarket({ ...reviewed, history: { ...reviewed.history, signalMarket: "ETH-USDT" }, preflight: { ...reviewed.preflight, signalMarket: "ETH-USDT" } }), /signal source changed/);
});
test("Robinhood keeps its explicit reviewed reference source and refuses an unnoticed switch", () => {
  const robinhood = { ...reviewed, network: "robinhood" as const, pair: "WETH.0BD7D308F8E1639F-USDG", historyScope: "robinhood:WETH.0BD7D308F8E1639F-USDG:4H" };
  const history = { scope: robinhood.historyScope, ready: true, signalMarket: "ETH-USDT" };
  const preflight = { ready: true, pair: robinhood.pair, signalMarket: "ETH-USDT" };
  assert.equal(reviewedAutopilotSignalMarket({ ...robinhood, history, preflight }), "ETH-USDT");
  assert.throws(() => reviewedAutopilotSignalMarket({ ...robinhood, history, preflight: { ...preflight, signalMarket: robinhood.pair } }), /signal source changed/);
});
