import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {candleCloseTime,GlobalReportSchema} from "@pulse/schemas";
import {globalTradeCards,globalSetupEvidenceLines,globalReportChartSvg} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe} from "./globalReport.js";
import {selectGlobalSetupContext} from "./globalSetupContext.js";
const fixture=JSON.parse(readFileSync(new URL("./globalReport.oct25-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
const cutoffs:Record<string,string>={"1H":"2026-10-25T06:55:44.735Z","4H":"2026-10-25T06:54:42.366Z","1Dutc":"2026-10-25T06:48:34.437Z"};
const make=(tf:string)=>{
  const observedAt=cutoffs[tf]??fixture.observedAt;
  const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:"BTC-USDT",source:"okx-public-spot",fetchedAt:observedAt,ticker:{priceCurrency:"USDT"},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true})).filter(c=>candleCloseTime(c.ts,bar)!<=Date.parse(observedAt)).slice(-520)}));
  return prepareGlobalReport({market:markets.find(m=>m.bar===tf)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(tf)),hierarchyMarkets:markets,tier:"premium"});
};
test("October 25 daily mixed structure uses its own support, not the October 24 local breakdown",()=>{
  const r=make("1Dutc"),p=r.discretionaryPlan!;
  assert.equal(r.setupSelection!.assessment,"sideways");assert.equal(p.family,"level_retest");assert.equal(p.side,"long");
  assert.equal(p.entry,80018.2);assert.equal(p.stopBasis.price,78649.3);assert.equal(p.evidence,undefined);
  assert.deepEqual(p.targets.map(t=>t.price),[81260.1,83763.7,84899.6]);
  assert.ok(globalSetupEvidenceLines(r).some(l=>/0.69R/.test(l)));assert.equal(GlobalReportSchema.safeParse(r).success,true);
  const forged=structuredClone(r);forged.discretionaryPlan!.entry+=1;forged.discretionaryPlan!.entryBasis.price+=1;
  assert.equal(GlobalReportSchema.safeParse(forged).success,false);
});
test("mixed structural location is symmetric and does not force a bullish answer",()=>{
  const r=make("1Dutc"),mid=170000,flip=(v:number)=>mid-v;
  r.horizonContext!.zones=r.horizonContext!.zones.map(z=>({...z,lower:flip(z.upper),upper:flip(z.lower),role:z.role==="support"?"resistance":"support"}));
  r.entryStudy!.pivots=[];r.indicators.pivots=[];r.indicators.vwap=null;r.currentMarket!.frames.forEach(f=>f.candles=f.candles.map(c=>({...c,open:flip(c.open),close:flip(c.close),high:flip(c.low),low:flip(c.high)})));
  r.entryStudy!.candles=r.entryStudy!.candles.map(c=>({...c,open:flip(c.open),close:flip(c.close),high:flip(c.low),low:flip(c.high)}));
  const bars=r.entryStudy!.candles,choice=selectGlobalSetupContext(r,{bars,timeframe:r.entryStudy!.timeframe,completedAt:candleCloseTime(bars.at(-1)!.ts,r.entryStudy!.timeframe)!,primaryClosed:candleCloseTime(r.candles.at(-1)!.ts,"1Dutc")!,primaryAtr:r.indicators.atr.points.at(-1)!.value,cutoff:Date.parse(r.snapshot.observedAt)});
  assert.equal(choice.side,"short");assert.equal(choice.entryBasis.price,flip(80018.2));
});
test("1H and 4H retain independent trend evidence and price risk, while explaining common support",()=>{
  const hour=make("1H"),swing=make("4H"),a=hour.discretionaryPlan!,b=swing.discretionaryPlan!;
  assert.equal(a.side,"short");assert.equal(b.side,"short");assert.notEqual(a.entry,b.entry);assert.notEqual(a.stop,b.stop);
  assert.deepEqual(a.targets.map(t=>t.price),b.targets.map(t=>t.price));
  for(const r of [hour,swing]){const text=globalSetupEvidenceLines(r).join(" ");assert.match(text,/falling SMA55/);assert.match(text,/new retest reaction is still required/);assert.equal(globalTradeCards(r)[0].confirmed,false);}
  assert.match(globalSetupEvidenceLines(hour).join(" "),/Nearest obstacle: 15m 80,306 offers 0.99R/);
  assert.match(globalSetupEvidenceLines(swing).join(" "),/TP1 offers 0.98R/);
});
test("weekly recovery retains its limiting resistance and does not claim a confirmed trend",()=>{
  const r=make("1Wutc"),p=r.discretionaryPlan!,text=globalSetupEvidenceLines(r).join(" ");
  assert.equal(p.side,"long");assert.equal(p.objectiveTimeframe,"1Wutc");assert.equal(p.reference.timeframe,"1Dutc");
  assert.match(text,/rising SMA21 71,678.23/);assert.match(text,/SMA55 has not confirmed/);
  assert.equal(p.barriers[0].price,82213.9);assert.match(text,/Nearest obstacle: 1W \(UTC\) 82,213.9 offers 0.79R/);
  assert.ok(p.stop<p.entry&&p.targets.every(t=>t.timeframe==="1Wutc"));
});
test("fast protection uses the latest completed primary reaction for a new local breakdown",()=>{
  const r=make("15m"),p=r.discretionaryPlan!,bar=r.candles.find(c=>c.ts===p.stopBasis.anchorTs)!;
  assert.equal(p.side,"short");assert.equal(p.stopBasis.timeframe,"15m");assert.equal(p.stopBasis.price,bar.high);
  assert.ok(p.stopBasis.price<80959.7);assert.ok(r.candles.some(c=>c.ts>bar.ts&&c.close<bar.low));
});
test("all horizons preserve provenance and exact chart ledger without creating an observed fill",()=>{
  for(const tf of ["15m","1H","4H","1Dutc","1Wutc"]){
    const r=make(tf),p=r.discretionaryPlan!,before=JSON.stringify(r),svg=globalReportChartSvg(r)!;
    assert.equal(GlobalReportSchema.safeParse(r).success,true,tf);assert.equal(p.version,"discretionary-plan-v5");assert.equal(p.stopBasis.timeframe,tf);
    assert.ok(p.targets.every(t=>t.timeframe===tf));assert.ok(svg.includes(`data-price="${p.entry}"`));assert.equal(globalTradeCards(r)[0].confirmed,false);assert.equal(JSON.stringify(r),before);
  }
});
