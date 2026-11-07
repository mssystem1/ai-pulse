import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalBookHistoryFrame, TerminalLiquidityHistory } from "@pulse/domain";
import { terminalLiquidityCell, terminalLiquidityIntensity, terminalLiquidityModel, terminalLiquidityViewport } from "./terminalLiquidityVisual.js";

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

test("accepted exchange clock lead remains visible without admitting a clock outside the source tolerance", () => {
  const genuine=frame(10_000);genuine.knownAt=genuine.ts-4_500;
  assert.equal(terminalLiquidityModel(history([genuine]))?.representedFrames,1);
  assert.equal(terminalLiquidityViewport(history([genuine]))?.totalFrames,1);
  genuine.knownAt=genuine.ts-5_001;
  assert.equal(terminalLiquidityModel(history([genuine])),null);
  assert.equal(terminalLiquidityViewport(history([genuine])),null);
});

test("sparse history fits the latest captured period while retaining the unchanged full requested interval", () => {
  const input=history([frame(0),frame(sample),frame(3_000_000),frame(3_000_000+sample)]);
  input.requestedEnd=input.observedAt=start+3_600_000;
  const before=JSON.stringify(input),fit=terminalLiquidityViewport(input)!,full=terminalLiquidityViewport(input,"requested")!;
  assert.equal(fit.periods.length,2);assert.equal(fit.totalFrames,4);
  assert.equal(fit.period.start,start+3_000_000);assert.equal(fit.period.frames,2);
  assert.ok(fit.end-fit.start<3_600_000/10);
  assert.deepEqual([full.start,full.end],[input.requestedStart,input.requestedEnd]);
  assert.equal(JSON.stringify(input),before);
  const fitted=terminalLiquidityModel({...input,requestedStart:fit.start,requestedEnd:fit.end})!;
  assert.equal(fitted.representedFrames,2);
  assert.equal(fitted.samples[0].start,start+3_000_000);
  const earlier=terminalLiquidityViewport(input,"available",start)!;
  assert.equal(earlier.period.frames,2);assert.equal(earlier.period.start,start);
});

test("one snapshot remains a one-cadence tile inside a fitted viewport with honest unknown context", () => {
  const input=history([frame(1_800_000)]);input.requestedEnd=input.observedAt=start+3_600_000;
  const fit=terminalLiquidityViewport(input)!,model=terminalLiquidityModel({...input,requestedStart:fit.start,requestedEnd:fit.end})!;
  assert.equal(fit.end-fit.start,sample*6);
  assert.equal(model.samples.length,1);assert.equal(model.samples[0].end-model.samples[0].start,sample);
  const unknownAt=start+1_800_000+sample*1.5;
  const column=Math.floor((unknownAt-model.start)/(model.end-model.start)*model.columns.length);
  assert.equal(terminalLiquidityCell(model,column,0,unknownAt)?.sourceAt,null);
});

test("explicit sub-cadence interruptions split captured periods without shifting real source times", () => {
  const input=history([frame(0),frame(sample),frame(sample*2)],[{start:start+5_000,end:start+10_000,reason:"Missing source seconds"}]);
  const fit=terminalLiquidityViewport(input)!;
  assert.deepEqual(fit.periods,[{start,end:start+5_000,frames:1},{start:start+sample,end:start+sample*3,frames:2}]);
  assert.equal(fit.period.start,start+sample);
});

test("unverified frames cannot distort the fitted period or price scale", () => {
  const excluded=frame(sample);excluded.bids=[{price:900_000,size:5}];excluded.asks=[{price:900_002,size:3}];
  const input=history([frame(0),excluded],[{start:start+sample,end:start+sample*2,reason:"Unverified interval"}]);
  const model=terminalLiquidityModel(input)!;
  assert.equal(model.frameCount,1);assert.ok(model.high<110);
  assert.equal(terminalLiquidityViewport(input)?.period.frames,1);
});

test("long retained periods default to their latest hour with independent 15-minute and full-period views", () => {
  const input=history(Array.from({length:1440},(_,index)=>frame(index*60_000)));
  input.sampleIntervalMs=60_000;input.requestedEnd=input.observedAt=start+86_400_000;
  const hour=terminalLiquidityViewport(input)!,quarter=terminalLiquidityViewport(input,"available",undefined,900_000)!,full=terminalLiquidityViewport(input,"available",undefined,null)!;
  assert.equal(hour.periods.length,1);assert.equal(hour.period.frames,1440);
  assert.equal(hour.end-hour.start,3_600_000);assert.equal(hour.end,input.requestedEnd);
  assert.equal(quarter.end-quarter.start,900_000);assert.equal(quarter.end,input.requestedEnd);
  assert.deepEqual([full.start,full.end],[input.requestedStart,input.requestedEnd]);
  const fullRequested=terminalLiquidityViewport(input,"requested",undefined,900_000)!;
  assert.deepEqual([fullRequested.start,fullRequested.end],[input.requestedStart,input.requestedEnd]);
});

test("bounded verified exchange calibration preserves real skewed frames and exact local retrieval clocks", () => {
  const book=frame(20_000);book.knownAt=book.ts-9_100;
  assert.equal(terminalLiquidityModel(history([book])),null,"No uncalibrated 9.1s clock lead");
  Object.assign(book,{exchangeClockOffsetMs:9_100,exchangeClockUncertaintyMs:650,exchangeClockVerifiedAt:book.knownAt});
  const model=terminalLiquidityModel(history([book]))!,cell=terminalLiquidityCell(model,1,0,book.ts)!;
  assert.equal(model.representedFrames,1);assert.equal(terminalLiquidityViewport(history([book]))?.totalFrames,1);
  assert.equal(cell.sourceAt,book.ts);assert.equal(cell.knownAt,book.knownAt);
  assert.equal(cell.clockOffsetMs,9_100);assert.equal(cell.clockUncertaintyMs,650);
});

test("malformed, expired, overly broad or stale calibration cannot authorize future or old frames", () => {
  const calibrated={...frame(20_000),knownAt:start+10_900,exchangeClockOffsetMs:9_100,exchangeClockUncertaintyMs:650,exchangeClockVerifiedAt:start+10_900};
  for(const invalid of [
    {...calibrated,exchangeClockVerifiedAt:undefined},
    {...calibrated,exchangeClockVerifiedAt:start},
    {...calibrated,exchangeClockVerifiedAt:calibrated.knownAt+1},
    {...calibrated,exchangeClockVerifiedAt:-1},
    {...calibrated,exchangeClockOffsetMs:30_001},
    {...calibrated,exchangeClockOffsetMs:NaN},
    {...calibrated,exchangeClockUncertaintyMs:499},
    {...calibrated,exchangeClockUncertaintyMs:1_501},
    {...calibrated,ts:start+26_000},
    {...calibrated,ts:start+5_000},
  ]) assert.equal(terminalLiquidityModel(history([invalid])),null);
});
