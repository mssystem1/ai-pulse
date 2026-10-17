import test from "node:test";
import assert from "node:assert/strict";
import {candleCloseTime,type GlobalAnchor} from "@pulse/schemas";
import {globalChannelBounds,globalChartAnnotations,globalReportChartSvg} from "@pulse/domain";
import {globalPriceStructures} from "./globalStructures.js";
import {globalConfirmedPivots} from "./globalReport.js";
import {entryPlanFixture} from "./globalEntryPlan.fixtures.js";

const candles=(slope:number)=>Array.from({length:180},(_,i)=>{const close=100+slope*i+Math.sin(i*Math.PI/10)*5;return {ts:Date.UTC(2026,0,1)+i*14400000,open:close-.1,high:close+.2,low:close-.2,close,volume:10,confirmed:true};});
for(const slope of [.2,-.2])test(`parallel ${slope>0?"rising":"falling"} channels retain equal slopes, confirmed anchors and bounded projections`,()=>{
  const bars=candles(slope),pivots=globalConfirmedPivots(bars),result=globalPriceStructures(bars,pivots,1,"4H");
  assert.ok(result.channels.length>0);assert.equal(result.range,null);
  const {report}=entryPlanFixture();report.candles=bars;report.snapshot.timeframe="4H";report.snapshot.observedAt=new Date(candleCloseTime(bars.at(-1)!.ts,"4H")!).toISOString();report.indicators.channels=result.channels;
  for(const channel of result.channels){
    const a=globalChannelBounds(report,channel,bars[50].ts)!,b=globalChannelBounds(report,channel,bars[150].ts)!;
    assert.ok(Math.abs((a.upper-a.lower)-(b.upper-b.lower))<1e-9);
    assert.ok(Math.abs((b.upper-a.upper)-(b.lower-a.lower))<1e-9);
    assert.ok(channel.knownAt<=Date.parse(report.snapshot.observedAt));assert.ok(channel.touches.lower>=2&&channel.touches.upper>=2);
  }
  const svg=globalChartAnnotations(report,{x:ts=>(ts-bars[0].ts)/14400000*4,y:p=>350-p,left:0,right:1000,historyEnd:720,top:0,bottom:500});
  assert.ok(svg.includes('data-channel="broad"'));assert.ok(svg.includes('data-channel-projection="broad"'));assert.ok(!/NaN|Infinity/.test(svg));
});
test("a range needs repeated horizontal tests; one mixed pivot pair or an unknown future anchor is insufficient",()=>{
  const bars=candles(0),pivots=globalConfirmedPivots(bars),range=globalPriceStructures(bars,pivots,2,"4H").range;
  assert.ok(range);assert.ok(range.lower[1]<range.upper[0]);assert.ok(range.touches>=4);
  assert.equal(globalPriceStructures(bars,pivots.slice(-2),2,"4H").range,null);
  const future=pivots.map(a=>({...a,confirmedAt:bars.at(-1)!.ts+14400000}));
  assert.equal(globalPriceStructures(bars,future,1,"4H").channels.length,0);
  assert.equal(globalPriceStructures(bars,[],1,"4H").channels.length,0);
});
test("entry-study exports mark the actual lower-frame signal separately from the primary chart",()=>{
  const {report}=entryPlanFixture(),svg=globalReportChartSvg(report)!;
  assert.ok(svg.includes('data-entry-study="1H"'));assert.ok(svg.includes('data-entry-signal="held_retest"'));assert.ok(svg.includes("analysis 4H"));assert.ok(!/WAIT|NO TRADE|EXPIRED|INVALIDATED/.test(svg));
});
