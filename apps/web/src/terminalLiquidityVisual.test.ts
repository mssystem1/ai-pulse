import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalBookHistoryFrame, TerminalLiquidityHistory } from "@pulse/domain";
import { terminalLiquidityCell, terminalLiquidityIntensity, terminalLiquidityModel } from "./terminalLiquidityVisual.js";

const start = Date.parse("2026-11-05T08:00:00Z"), sample = 15_000;
const frame = (offset: number, bidSize = 2): TerminalBookHistoryFrame => ({ ts: start + offset, knownAt: start + offset + 100, bids: [{ price: 100, size: bidSize }], asks: [{ price: 102, size: 3 }] });
function history(frames: TerminalBookHistoryFrame[], gaps: TerminalLiquidityHistory["gaps"] = []): TerminalLiquidityHistory { return { version: "terminal-liquidity-history-v1", instrumentId: "BTC-USDT", source: "test-observed-book", marketType: "spot", quantityUnit: "base", requestedStart: start, requestedEnd: start + 60_000, observedAt: start + 60_000, sampleIntervalMs: sample, priceStep: 1, depthLevels: 50, status: "partial", frames, gaps, backfill: { state: "collecting", pages: 0 } }; }

test("time columns select the latest real book instead of summing repeated resting size", () => {
  const input = history([frame(0, 2), frame(10_000, 5), frame(10_000, 500)]), before = JSON.stringify(input);
  const model = terminalLiquidityModel(input, 1)!;
  assert.equal(model.frameCount, 2); assert.equal(model.columns[0].observations, 2);
  assert.equal(model.columns[0].frame?.ts, start + 10_000);
  assert.equal(model.columns[0].bids.reduce((sum, size) => sum + size, 0), 5);
  assert.equal(JSON.stringify(input), before);
});

test("uncollected history is unknown and the price trace breaks at source gaps", () => {
  const gap = { start: start + sample, end: start + sample * 3, reason: "Collector unavailable" };
  const model = terminalLiquidityModel(history([frame(0), frame(sample * 3)], [gap]), 4)!;
  assert.equal(terminalLiquidityCell(model, 1, 0)?.bid, null);
  assert.equal(terminalLiquidityCell(model, 1, 0)?.sourceAt, null);
  assert.equal(model.midSegments.length, 2);
  assert.equal(model.gaps[0].reason, gap.reason);
});

test("price bins add only genuine ladder levels within the selected snapshot", () => {
  const book = frame(0); book.bids.push({ price: 99.5, size: 4 });
  const model = terminalLiquidityModel(history([book]), 4, 2)!;
  assert.equal(model.columns[0].bids.reduce((sum, size) => sum + size, 0), 6);
  assert.equal(model.columns[0].asks.reduce((sum, size) => sum + size, 0), 3);
  assert.ok(model.rowCount <= 4);
});

test("bad or crossed snapshots do not become zero-depth observations", () => {
  const crossed = frame(0); crossed.asks = [{ price: 99, size: 4 }];
  const future = frame(10_000); future.knownAt = start + 70_000;
  assert.equal(terminalLiquidityModel(history([crossed, future])), null);
});

test("cell inspection retains exact source and bucket clocks with bounded coordinates", () => {
  const model = terminalLiquidityModel(history([frame(0)]), 4)!;
  const cell = terminalLiquidityCell(model, 0, 0)!;
  assert.equal(cell.sourceAt, start); assert.equal(cell.knownAt, start + 100);
  assert.equal(cell.start, start); assert.equal(cell.end, start + sample);
  assert.equal(terminalLiquidityCell(model, -1, 0), null);
  assert.equal(terminalLiquidityCell(model, 0, model.rowCount), null);
});

test("colour scaling is bounded and logarithmic view reveals smaller real sizes", () => {
  assert.equal(terminalLiquidityIntensity(0, 100), 0);
  assert.equal(terminalLiquidityIntensity(100, 100), 1);
  assert.ok(terminalLiquidityIntensity(1, 100, true) > terminalLiquidityIntensity(1, 100, false));
  assert.equal(terminalLiquidityIntensity(NaN, 100), 0);
});

test("an intra-column gap truncates the observed tile and cannot be filled by an older frame", () => {
  const input=history([frame(0),frame(59_000)], [{start:start+10_000,end:start+20_000,reason:"Archive lost these seconds"}]);
  input.sampleIntervalMs=60_000;
  const model=terminalLiquidityModel(input,1)!;
  assert.deepEqual(model.samples.map(s=>[s.start-start,s.end-start]),[[0,10_000],[59_000,60_000]]);
  assert.equal(terminalLiquidityCell(model,0,0,start+5_000)?.sourceAt,start);
  assert.equal(terminalLiquidityCell(model,0,0,start+15_000)?.bid,null);
  assert.equal(terminalLiquidityCell(model,0,0,start+25_000)?.bid,null,"An old snapshot cannot resume after the gap");
  assert.equal(model.midSegments.length,2);
  assert.deepEqual(model.midSegments.flat().map(p=>p.at),[start,start+59_000]);
});

test("a coarse time column keeps exact source times and unobserved leading/trailing spans", () => {
  const model=terminalLiquidityModel(history([frame(20_000)]),1)!;
  assert.equal(model.columns.length,1);
  assert.equal(model.samples[0].start,start+20_000);assert.equal(model.samples[0].end,start+35_000);
  assert.equal(terminalLiquidityCell(model,0,0,start+10_000)?.sourceAt,null);
  assert.equal(terminalLiquidityCell(model,0,0,start+25_000)?.sourceAt,start+20_000);
  assert.equal(terminalLiquidityCell(model,0,0,start+50_000)?.sourceAt,null);
  assert.equal(model.midSegments[0][0].at,start+20_000);
});

test("source gap metadata wins when a returned snapshot itself falls in the missing interval", () => {
  const model=terminalLiquidityModel(history([frame(0),frame(20_000),frame(45_000)],[{start:start+15_000,end:start+30_000,reason:"Unverified source interval"}]),1)!;
  assert.equal(model.samples.some(sample=>sample.frame.ts===start+20_000),false);
  assert.equal(terminalLiquidityCell(model,0,0,start+20_000)?.sourceAt,null);
  assert.equal(model.midSegments.length,2);
});

test("price rows beyond a returned side's depth stay unknown rather than zero", () => {
  const later=frame(30_000);later.bids=[{price:200,size:5}];later.asks=[{price:202,size:3}];
  const model=terminalLiquidityModel(history([frame(0),later]),4,200)!;
  const highRow=Math.floor((200-model.low)/model.priceStep);
  const cell=terminalLiquidityCell(model,0,highRow,start+1_000)!;
  assert.equal(cell.sourceAt,start);assert.equal(cell.bid,0);assert.equal(cell.ask,null);
});

test("invalid response clocks and nonfinite display bounds cannot create a visual observation", () => {
  const input=history([frame(0)]);input.observedAt=NaN;
  assert.equal(terminalLiquidityModel(input),null);
  const model=terminalLiquidityModel(history([frame(0)]),NaN,NaN)!;
  assert.ok(model.columns.length>=1&&model.rowCount>=1);
});
