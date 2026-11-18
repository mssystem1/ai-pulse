import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {candleCloseTime,GlobalReportSchema} from "@pulse/schemas";
import {globalDecision,globalTradeCards,globalCurrentMarketLines,globalSetupEvidenceLines} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe,globalPromptEvidence} from "./globalReport.js";
import {applyGlobalDiscretionaryPlan} from "./globalDiscretionaryPlan.js";
import {selectGlobalSetupContext} from "./globalSetupContext.js";
const fixture=JSON.parse(readFileSync(new URL("./globalReport.direction-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
const make=(tf:string,quote?:{last:number;ts:string})=>{const markets=Object.entries(fixture.frames).map(([bar,rows])=>({instId:"BTC-USDT",source:"okx-public-spot",bar,fetchedAt:fixture.observedAt,ticker:{priceCurrency:"USDT",...quote},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true}))}));return prepareGlobalReport({market:markets.find(m=>m.bar===tf)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(tf)),hierarchyMarkets:markets,tier:"premium"});};

for(const tf of ["1H","4H","1Dutc"])test(`${tf} evaluates the October 24 support recovery separately from the older bearish trend`,()=>{
  const r=make(tf),p=r.discretionaryPlan!;assert.equal(r.setupSelection!.assessment,"short");assert.equal(p.side,"long");assert.ok(p.evidence);assert.equal(globalDecision(r).direction,"LONG");
  assert.equal(p.stopBasis.timeframe,tf);assert.equal(p.objectiveTimeframe,tf);assert.ok(p.stop<p.entry&&p.targets.every(t=>t.price>p.entry));
  assert.ok(globalSetupEvidenceLines(r).some(line=>/reclaim and hold/.test(line)));assert.ok(globalTradeCards(r)[0].lines.some(l=>/reclaim and hold/.test(l)));
  assert.equal(GlobalReportSchema.safeParse(r).success,true);
});
test("the daily report retains newer completed hourly context without inventing a completed daily close",()=>{
  const r=make("1Dutc");assert.equal(r.snapshot.price,81188.2);assert.equal(r.entryStudy!.candles.at(-1)!.close,79803.6);
  assert.equal(r.currentMarket!.frames.find(f=>f.timeframe==="1H")!.candles.at(-1)!.close,80539.7);
  assert.equal(r.discretionaryPlan!.evidence!.timeframe,"1H");assert.ok(r.discretionaryPlan!.stop<79220.1);
});
test("15m fast protection retains its own reaction or structural zone rather than the distant session low",()=>{
  const r=make("15m"),p=r.discretionaryPlan!,basis=r.candles.find(c=>c.ts===p.stopBasis.anchorTs)!;
  assert.equal(p.stopBasis.timeframe,"15m");if(p.entryBasis.kind==="structure_zone"){assert.ok(r.horizonContext!.zones.some(z=>z.role===(p.side==="long"?"support":"resistance")&&(p.side==="long"?z.lower:z.upper)===p.stopBasis.price&&z.startTs===p.stopBasis.anchorTs));return;}assert.equal(p.stopBasis.price,basis.low);assert.ok(p.stopBasis.price>79220.1);assert.ok(p.stop<p.entry);
  assert.ok(r.candles.some(c=>c.ts>basis.ts&&c.close>basis.high));
  assert.ok(p.entry-p.stop<r.indicators.atr.points.at(-1)!.value);
});
test("fresh dated quotes are retained separately; old or future quotes cannot masquerade as current data",()=>{
  const now=Date.parse(fixture.observedAt),r=make("1Wutc",{last:80510.1,ts:String(now-1000)});
  assert.equal(r.snapshot.price,82109.3);assert.equal(r.currentMarket!.quote!.price,80510.1);assert.match(globalCurrentMarketLines(r)[0],/19:40:05 UTC/);
  for(const ts of [now-121000,now+6000])assert.equal(make("1Wutc",{last:123,ts:String(ts)}).currentMarket!.quote,undefined);
  const bad=structuredClone(r);bad.currentMarket!.quote!.ts=now-121000;assert.equal(GlobalReportSchema.safeParse(bad).success,false);
  assert.ok(globalPromptEvidence(r).currentMarket);
});
test("entry instructions retain the actual defended source and event requirement across live quote moves",()=>{
  const now=Date.parse(fixture.observedAt),original=make("1H"),boundary=original.discretionaryPlan!.priceZones!.entry.sourceUpper;
  const below=make("1H",{last:boundary-1,ts:String(now-1000)}),above=make("1H",{last:boundary+1,ts:String(now-1000)});
  for(const r of [below,above]){const p=r.discretionaryPlan!,card=globalTradeCards(r)[0];assert.equal(p.executionPolicy!.mode,"confirmed_retest");assert.equal(p.executionPolicy!.sourceBoundary,original.discretionaryPlan!.entryBasis.price);assert.match(card.condition,r.scenario?.confirmationAt===undefined?/acceptance above and a defended retest/:/price-retest event has been observed/);assert.match(card.condition,/confirmation close is not an assumed fill|neither full entry eligibility nor a fill/);assert.equal(card.confirmed,false);}
  assert.equal(below.discretionaryPlan!.reference.price,above.discretionaryPlan!.reference.price);
});
for(const tf of ["15m","1H","4H","1Dutc","1Wutc"])test(`${tf} preserves its own protection, objectives and available current-clock evidence`,()=>{
  const r=make(tf),p=r.discretionaryPlan!,before=JSON.stringify(r);assert.equal(p.version,"discretionary-plan-v8");assert.equal(p.requiresNewTestAfter,undefined);assert.ok(p.executionPolicy!.eventKnownAt<=Date.parse(fixture.observedAt));assert.ok(p.executionPolicy!.eventAfter<=p.reference.completedAt);assert.ok(p.executionPolicy!.expiresAt>Date.parse(fixture.observedAt));assert.ok(r.scenario);
  assert.equal(p.stopBasis.timeframe,tf);assert.ok(p.targets.every(t=>t.timeframe===tf));assert.ok(r.currentMarket!.frames.length);
  for(const f of r.currentMarket!.frames)assert.ok(f.candles.every(c=>c.confirmed&&candleCloseTime(c.ts,f.timeframe)!<=Date.parse(fixture.observedAt)));
  globalTradeCards(r);assert.equal(JSON.stringify(r),before);assert.equal(r.entryStudy!.timeframe,tf==="15m"?"5m":tf==="1H"?"15m":tf==="4H"?"1H":tf==="1Dutc"?"4H":"1Dutc");
});
test("reclaim selection is symmetric rather than hard-coded long",()=>{
  const original=make("1H"),r=structuredClone(original),mirror=(p:number)=>160000-p;
  const flip=(c:typeof r.candles[number])=>({...c,open:mirror(c.open),close:mirror(c.close),high:mirror(c.low),low:mirror(c.high)});
  r.candles=r.candles.map(flip);r.entryStudy!.candles=r.entryStudy!.candles.map(flip);r.currentMarket!.frames.forEach(f=>f.candles=f.candles.map(flip));
  r.indicators.pivots=r.indicators.pivots.map(a=>({...a,price:mirror(a.price),kind:a.kind==="high"?"low":"high"}));r.entryStudy!.pivots=r.entryStudy!.pivots.map(a=>({...a,price:mirror(a.price),kind:a.kind==="high"?"low":"high"}));
  r.indicators.ema?.forEach(e=>e.points=e.points.map(p=>({...p,value:mirror(p.value)})));r.indicators.vwap=null;r.range=null;r.setupSelection!.assessment="long";
  const bars=r.entryStudy!.candles,choice=selectGlobalSetupContext(r,{bars,timeframe:r.entryStudy!.timeframe,completedAt:candleCloseTime(bars.at(-1)!.ts,r.entryStudy!.timeframe)!,primaryClosed:candleCloseTime(r.candles.at(-1)!.ts,"1H")!,primaryAtr:r.indicators.atr.points.at(-1)!.value,cutoff:Date.parse(fixture.observedAt)});
  assert.ok(choice);assert.equal(choice.side,"short");assert.ok(choice.evidence);assert.ok(Math.abs(choice.entryBasis.price-mirror(original.discretionaryPlan!.evidence!.level))<1e-8);
});

test("a trending primary candle that sweeps known support and rejects known resistance gets no distant EMA plan",()=>{
  const r=make("1Dutc");delete r.entryStudy;r.currentMarket!.frames=[];r.indicators.vwap=null;r.range=null;
  r.setupSelection!.assessment="short";r.setupSelection!.regime="trend";
  const last=r.candles.at(-1)!,previous=r.candles.at(-2)!,close=last.close;
  last.high=close+2;last.low=close-2;
  const support={lower:close-2,upper:close-1},resistance={lower:close+1,upper:close+2};
  const knownAt=candleCloseTime(previous.ts,"1Dutc")!,anchorTs=previous.ts-10*86400000;
  r.indicators.pivots=[
    {id:"prior-support",ts:anchorTs,price:support.upper,kind:"high",confirmedAt:anchorTs+2*86400000},
    {id:"prior-resistance",ts:anchorTs+86400000,price:resistance.upper,kind:"high",confirmedAt:anchorTs+3*86400000},
  ];
  r.horizonContext={version:"horizon-context-v1",timeframe:"1Dutc",reading:"position",knownAt:candleCloseTime(last.ts,"1Dutc")!,ranges:[],zones:[
    {id:"support",role:"support",...support,startTs:anchorTs,knownAt:candleCloseTime(last.ts,"1Dutc")!,anchorIds:["prior-support"],basis:"confirmed_pivot_wicks"},
    {id:"resistance",role:"resistance",...resistance,startTs:anchorTs+86400000,knownAt:candleCloseTime(last.ts,"1Dutc")!,anchorIds:["prior-resistance"],basis:"confirmed_pivot_wicks"},
  ]};
  const cutoff=Date.parse(r.snapshot.observedAt),completedAt=candleCloseTime(last.ts,"1Dutc")!;
  const choice=selectGlobalSetupContext(r,{bars:r.candles,timeframe:"1Dutc",completedAt,primaryClosed:completedAt,primaryAtr:r.indicators.atr.points.at(-1)!.value,cutoff});
  assert.equal(choice?.family,"level_retest");assert.equal(choice?.side,"short");
  assert.equal(choice?.entryBasis.price,resistance.lower,"The trend selects the resistance source, before evaluating payoff");
  applyGlobalDiscretionaryPlan(r);
  assert.equal(r.discretionaryPlan?.entry,resistance.upper);assert.equal(r.discretionaryPlan?.executionPolicy?.mode,"passive_limit");
  assert.equal(r.alternatePlan?.side,"long");assert.equal(r.alternatePlan?.entry,support.lower);
  assert.equal(r.alternatePlan?.executionPolicy?.mode,"passive_limit");
  assert.equal(globalTradeCards(r).length,2);

  // A source confirmed on the reaction candle is not prior evidence and must
  // not suppress the ordinary trend choice.
  r.indicators.pivots[0]!.confirmedAt=last.ts;
  const late=selectGlobalSetupContext(r,{bars:r.candles,timeframe:"1Dutc",completedAt,primaryClosed:completedAt,primaryAtr:r.indicators.atr.points.at(-1)!.value,cutoff});
  assert.ok(late);assert.equal(late.family,"ema_pullback");
});

test("the two-sided suppression is limited to aligned trend selections",()=>{
  const r=make("1Wutc");r.setupSelection!.assessment="sideways";r.setupSelection!.regime="transition";
  r.indicators.vwap=null;r.range=null;r.entryStudy!.pivots=[];r.currentMarket!.frames=[];
  const last=r.candles.at(-1)!,previous=r.candles.at(-2)!,close=last.close;last.high=close+2;last.low=close-2;
  const anchorTs=previous.ts-10*7*86400000,knownAt=candleCloseTime(previous.ts,"1Wutc")!;
  r.indicators.pivots=[
    {id:"weekly-support",ts:anchorTs,price:close-1,kind:"high",confirmedAt:anchorTs+2*7*86400000},
    {id:"weekly-resistance",ts:anchorTs+7*86400000,price:close+2,kind:"high",confirmedAt:anchorTs+3*7*86400000},
  ];
  r.horizonContext={version:"horizon-context-v1",timeframe:"1Wutc",reading:"macro",knownAt:candleCloseTime(last.ts,"1Wutc")!,ranges:[],zones:[
    {id:"weekly-support-zone",role:"support",lower:close-2,upper:close-1,startTs:anchorTs,knownAt:candleCloseTime(last.ts,"1Wutc")!,anchorIds:["weekly-support"],basis:"confirmed_pivot_wicks"},
    {id:"weekly-resistance-zone",role:"resistance",lower:close+1,upper:close+2,startTs:anchorTs+7*86400000,knownAt:candleCloseTime(last.ts,"1Wutc")!,anchorIds:["weekly-resistance"],basis:"confirmed_pivot_wicks"},
  ]};
  const choice=selectGlobalSetupContext(r,{bars:r.candles,timeframe:"1Wutc",completedAt:candleCloseTime(last.ts,"1Wutc")!,primaryClosed:candleCloseTime(last.ts,"1Wutc")!,primaryAtr:r.indicators.atr.points.at(-1)!.value,cutoff:Date.parse(r.snapshot.observedAt)});
  assert.equal(choice!.family,"level_retest");assert.equal(choice!.entryBasis.kind,"structure_zone");
  assert.ok(knownAt<=Date.parse(r.snapshot.observedAt));
});

test("a newer fast completed candle can invalidate an older held reclaim",()=>{
  const r=make("1H"),fast=r.currentMarket!.frames.find(f=>f.timeframe==="5m")!,c=fast.candles.at(-1)!;
  c.close=79000;c.low=78900;const bars=r.entryStudy!.candles;
  const choice=selectGlobalSetupContext(r,{bars,timeframe:"15m",completedAt:candleCloseTime(bars.at(-1)!.ts,"15m")!,primaryClosed:candleCloseTime(r.candles.at(-1)!.ts,"1H")!,primaryAtr:r.indicators.atr.points.at(-1)!.value,cutoff:Date.parse(fixture.observedAt)});
  assert.ok(!choice||!choice.evidence||choice.side!=="long","An older 15m hold cannot override the newer completed loss of that support");
});
