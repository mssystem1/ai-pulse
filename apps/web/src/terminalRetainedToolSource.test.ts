import test from "node:test";
import assert from "node:assert/strict";
import type {TerminalMarket} from "./terminalClient";
import {terminalRetainedToolSource} from "./terminalRetainedToolSource";

const source = {instId: "BTC-USDT", timeframe: "1H", evidenceSnapshotId: "assessment-original", setupVersionId: "original-plan", tools: {value: {tradeVwap: 80_000}, flow: {buy: 2}, derivatives: {openInterest: 42}, liquidity: {bids: [{price: 79_999, size: 1}]}}} as unknown as TerminalMarket;
const tools = {value: {status: "unavailable", knownAt: 0}, flow: {status: "unavailable", knownAt: 0}, perpetualFlow: {status: "unavailable", knownAt: 0}} as unknown as Pick<TerminalMarket["tools"], "value" | "flow" | "perpetualFlow">;
const retained = {source, result: {session: {}, perpetualSession: {}, tools, evidenceSnapshotId: "empty-session", setupVersionId: "original-plan"}};

test("pending, failed and empty retained sessions keep usable assessment tools with their original evidence ID", () => {
 for (const record of [null, retained, {...retained, result: {...retained.result, session: {totals: null}}}, {...retained, result: {...retained.result, session: {totals: {trades: 0}}}}]) {
  const selected = terminalRetainedToolSource(source, record);
  assert.equal(selected.scope, "assessment");
  assert.equal(selected.market, source);
  assert.equal(selected.market.evidenceSnapshotId, "assessment-original");
  assert.equal(selected.market.tools.value.tradeVwap, 80_000);
 }
});

test("real retained executions select their exact report binding and preserve independently captured book and OI", () => {
 const newer = {...source, setupVersionId: "later-plan", evidenceSnapshotId: "later-assessment"};
 const selected = terminalRetainedToolSource(newer, {...retained, result: {...retained.result, session: {totals: {trades: 1}}, evidenceSnapshotId: "retained-executions"}});
 assert.equal(selected.scope, "session");
 assert.equal(selected.market.evidenceSnapshotId, "retained-executions");
 assert.equal(selected.market.setupVersionId, "original-plan");
 assert.equal(selected.market.tools.value, tools.value);
 assert.equal(selected.market.tools.derivatives, source.tools.derivatives);
 assert.equal(selected.market.tools.liquidity, source.tools.liquidity);
});

test("Futures executions remain inspectable without replacing an unavailable Spot stream with assessment values", () => {
 const selected = terminalRetainedToolSource(source, {...retained, result: {...retained.result, perpetualSession: {totals: {trades: 3}}}});
 assert.equal(selected.scope, "session");
 assert.equal(selected.market.tools.flow.status, "unavailable");
 assert.equal(selected.market.tools.value.tradeVwap, undefined);
 assert.equal(selected.market.tools.perpetualFlow, tools.perpetualFlow);
});
