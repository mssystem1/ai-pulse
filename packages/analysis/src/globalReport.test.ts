import test from "node:test";
import assert from "node:assert/strict";
import { summarizeCandles, type SpotMarketContext } from "@pulse/market";
import { GlobalReportSchema, candleCloseTime } from "@pulse/schemas";
import { globalDesignFixture } from "../../domain/dist/globalReport.fixtures.js";
import { prepareGlobalReport, finishGlobalReport, globalWilderIndicators, globalSma, globalConfirmedPivots, completedGlobalCandles, evaluateGlobalSetup, globalContextTimeframe, globalBarMs } from "./globalReport.js";

const market=(length=520,flat=false):SpotMarketContext=>{const candles=Array.from({length},(_,i)=>{const close=flat?100:110+Math.sin(i/14)*10+i*.02;return {ts:Date.parse("2026-08-01T00:00:00Z")+i*3600000,open:close-.05,high:close+1,low:close-1,close,volume:100+i%7,volumeCcy:10000,confirmed:true};});return {instId:"SOL-USDT",bar:"1H",source:"okx-public-spot",candles,summary:summarizeCandles(candles),ticker:{instId:"SOL-USDT",last:999,open24h:100,high24h:150,low24h:90,vol24h:1,volCcy24h:100,change24hPct:0,ts:"1"},fetchedAt:new Date(candles.at(-1)!.ts+3600000).toISOString()};};
test("context follows the selected timeframe and calendar months never become minutes",()=>{
  for(const [primary,context] of [["1m","15m"],["15m","1H"],["30m","1H"],["1H","4H"],["4H","1Dutc"],["1D","1Wutc"],["1Dutc","1Wutc"],["1W","1Mutc"],["1Wutc","1Mutc"]])assert.equal(globalContextTimeframe(primary),context);
  assert.equal(globalBarMs("15m"),900000);assert.equal(globalBarMs("1Wutc"),604800000);assert.equal(globalBarMs("1Mutc"),0);
  assert.equal(candleCloseTime(Date.parse("2024-02-01T00:00:00Z"),"1Mutc"),Date.parse("2024-03-01T00:00:00Z"));
  assert.equal(candleCloseTime(Date.parse("2025-01-31T16:00:00Z"),"1M"),Date.parse("2025-02-28T16:00:00Z"));
  const input=market(3);input.bar="1Mutc";input.fetchedAt="2024-02-29T23:59:00Z";input.candles=input.candles.map((c,i)=>({...c,ts:Date.UTC(2023,11+i,1)}));
  assert.equal(completedGlobalCandles(input).length,2,"The current calendar month is still incomplete even if marked confirmed");
});
test("15-minute, daily and weekly plans confirm and expire in their own candle intervals",()=>{
  for(const frame of ["15m","1D","1W"]){
    const report=retestFixture(),oldTimes=report.candles.map(c=>c.ts),interval=globalBarMs(frame),start=Date.parse("2016-01-01T00:00:00Z");
    const shifted=(ts:number)=>start+oldTimes.indexOf(ts)*interval;
    report.snapshot.timeframe=frame;report.candles=report.candles.map((c,i)=>({...c,ts:start+i*interval}));
    report.indicators.pivots=report.indicators.pivots.map(a=>({...a,ts:shifted(a.ts),confirmedAt:a.confirmedAt===null?null:shifted(a.confirmedAt)}));
    report.indicators.atr.points=report.indicators.atr.points.map(p=>({...p,ts:shifted(p.ts)}));
    report.snapshot.observedAt=new Date(report.candles.at(-1)!.ts+interval).toISOString();
    const setup=evaluateGlobalSetup(report,10);assert.equal(setup.state,"ready");assert.equal(setup.expiresAt,setup.confirmationTs!+4*interval);
    report.snapshot.observedAt=new Date(setup.expiresAt!+1).toISOString();assert.equal(evaluateGlobalSetup(report,10).state,"expired");
  }
});
test("same saved primary candles and levels feed Quick/Pro; live ticker never replaces the completed close",()=>{const input=market(),quick=prepareGlobalReport({market:input,tier:"base"}),pro=prepareGlobalReport({market:input,tier:"premium"});assert.deepEqual(quick.candles,pro.candles);assert.deepEqual(quick.levels,pro.levels);assert.equal(quick.snapshot.price,input.candles.at(-1)!.close);assert.notEqual(quick.snapshot.price,999);assert.equal(pro.context.status,"unavailable");assert.ok(quick.view.pathIds.length<=2);assert.ok(pro.view.pathIds.length<=3);assert.ok(pro.paths.every(p=>p.targetIds.length>0));assert.equal(quick.setup.state,"watching");assert.equal(quick.setup.entryZone,null);});
test("the full market map keeps a recently reclaimed S1 and recognizes its observed retest",()=>{
  const input=market(520,true);
  for(let i=480;i<520;i++)input.candles[i]={...input.candles[i],open:115.95,high:116.2,low:115.8,close:116};
  for(const [i,open,high,low,close] of [[486,121,121.2,120.8,121],[492,114,114.2,113.8,114],[512,116.9,117.3,116.8,117.05],[513,116.8,117,116.4,116.8],[514,116.8,117,116.4,116.8],[515,116.8,117,116.4,116.8],[516,116.8,117,116.4,116.8],[517,116.8,117.8,116.7,117.6],[518,117.5,117.6,117.2,117.4],[519,117.4,118,117.35,117.4]])input.candles[i]={...input.candles[i],open,high,low,close};
  const report=prepareGlobalReport({market:input,tier:"base",executionCostsBps:5});
  assert.equal(report.levels.find(l=>l.id===report.setup.triggerLevelId)?.price,117.3);
  assert.equal(report.setup.state,"ready");assert.deepEqual(report.setup.entryZone,[117.3,117.4]);assert.ok(report.setup.netRewardRisk!>=1.5);
  assert.equal(prepareGlobalReport({market:input,tier:"base"}).setup.state,"watching");
});
test("flat, short, unconfirmed and incomplete data cannot fabricate a wave count",()=>{for(const input of [market(520,true),market(3)]){const report=prepareGlobalReport({market:input,tier:"base"});assert.equal(report.waveCount.status,"unclear");assert.equal(report.waveCount.anchors.length,0);assert.notEqual(report.setup.state,"ready");}const input=market(55);input.candles.push({...input.candles.at(-1)!,ts:input.candles.at(-1)!.ts+3600000,confirmed:false});assert.equal(completedGlobalCandles(input).length,55);input.candles[0].confirmed=undefined;assert.equal(completedGlobalCandles(input).length,54);});
test("SMA and Wilder indicators use their stated definitions; flat RSI is neutral",()=>{const data=market(20,true).candles.map(c=>({...c,confirmed:true}));assert.deepEqual(globalSma(data,55),[]);assert.equal(globalSma(data,5).at(-1)!.value,100);const {atr,rsi}=globalWilderIndicators(data);assert.equal(atr[0].value,2);assert.equal(atr.at(-1)!.value,2);assert.equal(rsi.at(-1)!.value,50);});
test("confirmed pivots require three subsequent completed bars",()=>{const data=market(90).candles.map(c=>({...c,confirmed:true}));const all=globalConfirmedPivots(data);assert.ok(all.length>1);for(const anchor of all){const i=data.findIndex(c=>c.ts===anchor.ts);assert.ok(i>=3&&i+3<data.length);assert.equal(anchor.confirmedAt,data[i+3].ts);assert.ok(!globalConfirmedPivots(data.slice(0,i+3)).some(a=>a.id===anchor.id));}});
test("Pro context is independently observed for the same instrument, currency and snapshot",()=>{const input=market(),context=market(300);context.bar="4H";context.fetchedAt=new Date(Date.parse(input.fetchedAt)+86400000).toISOString();const pro=prepareGlobalReport({market:input,tier:"premium",contextMarket:context});assert.ok(pro.context.candles.every(c=>c.ts+14400000<=Date.parse(input.fetchedAt)));context.instId="ETH-USDT";assert.equal(prepareGlobalReport({market:input,tier:"premium",contextMarket:context}).context.status,"unavailable");context.instId=input.instId;context.ticker.priceCurrency="USD";assert.equal(prepareGlobalReport({market:input,tier:"premium",contextMarket:context}).context.status,"unavailable");});
function retestFixture(){const report=globalDesignFixture();const last=report.candles.at(-1)!.ts,tail=report.candles.slice(-10).map((c,i)=>({...c,open:116,high:116.5,low:115.5,close:116}));tail[7]={...tail[7],open:116,high:118.1,low:115.9,close:117.6};tail[8]={...tail[8],open:117.6,high:117.7,low:117.2,close:117.4};tail[9]={...tail[9],open:117.4,high:118,low:117.35,close:117.4};report.candles=[...report.candles.slice(0,-10),...tail];report.snapshot.observedAt=new Date(last+3600000).toISOString();report.snapshot.price=117.4;report.indicators.pivots.push({id:"actual-resistance",ts:tail[0].ts,price:117.3,kind:"high",confirmedAt:tail[3].ts});report.levels.find(l=>l.id==="reclaim")!.anchorIds=["actual-resistance"];return report;}
test("retest state machine prices protection from evidence, costs gate readiness and cancellation/expiry clear executable levels",()=>{const report=retestFixture(),pending=evaluateGlobalSetup(report,null);assert.equal(pending.state,"watching");assert.deepEqual(pending.entryZone,[117.3,117.4]);assert.ok(pending.protectiveStop!<117.2);assert.equal(pending.netRewardRisk,null);assert.ok(pending.missing.includes("execution_costs"));const ready=evaluateGlobalSetup(report,10);assert.equal(ready.state,"ready");assert.ok(ready.netRewardRisk!>=1.5);report.setup=ready;assert.equal(GlobalReportSchema.safeParse(report).success,true);report.candles.at(-1)!.close=117;assert.equal(evaluateGlobalSetup(report,10).state,"cancelled");assert.equal(evaluateGlobalSetup(report,10).entryZone,null);report.candles.at(-1)!.close=117.8;report.snapshot.observedAt=new Date(ready.expiresAt!+1).toISOString();assert.equal(evaluateGlobalSetup(report,10).state,"expired");});
test("a close without a later held retest never preloads an entry or thesis floor as stop",()=>{const report=retestFixture();report.candles=report.candles.slice(0,-2);report.snapshot.observedAt=new Date(report.candles.at(-1)!.ts+3600000).toISOString();const setup=evaluateGlobalSetup(report,10);assert.equal(setup.state,"watching");assert.equal(setup.entryZone,null);assert.equal(setup.protectiveStop,null);assert.ok(setup.missing.includes("retest"));});
test("a completed thesis-floor break cancels a plan before any reclaim or retest exists",()=>{const report=globalDesignFixture();report.candles.at(-1)!.close=112;report.candles.at(-1)!.low=111.8;const setup=evaluateGlobalSetup(report,10);assert.equal(setup.state,"cancelled");assert.equal(setup.confirmationTs,null);assert.equal(setup.entryZone,null);assert.equal(setup.protectiveStop,null);});
test("a move beyond the observed entry zone stays Watching even after reclaim and retest",()=>{const report=retestFixture();report.candles.at(-1)!.close=117.8;report.snapshot.price=117.8;const setup=evaluateGlobalSetup(report,10);assert.equal(setup.state,"watching");assert.ok(setup.missing.includes("entry_price"));assert.deepEqual(setup.entryZone,[117.3,117.4]);report.setup={...setup,state:"ready",missing:[]};assert.equal(GlobalReportSchema.safeParse(report).success,false);});
test("model can reject a count/setup, but cannot change numeric evidence",()=>{const prepared=prepareGlobalReport({market:market(),tier:"premium"}),before=structuredClone(prepared);const finished=finishGlobalReport(prepared,{headline:"Wait",summary:"Evidence first",regime:"transition",bias:"neutral",confidence:50,waveCandidateId:null,mainPathId:null,setupPathId:null,reasons:[],pathNotes:[],riskNotes:[],limitations:[],disclaimer:"Research only"});assert.deepEqual(finished.levels,before.levels);assert.deepEqual(finished.indicators,before.indicators);assert.equal(finished.waveCount.status,"unclear");assert.equal(finished.setup.state,"none");assert.equal(finished.setup.protectiveStop,null);});
test("Pro never becomes ready with missing or conflicting independent context",()=>{
  const report=retestFixture();report.tier="pro";
  for(const context of [{status:"unavailable",agreement:"unknown"},{status:"available",agreement:"conflicts"},{status:"available",agreement:"unknown"}] as const){
    report.context={...report.context,...context};const setup=evaluateGlobalSetup(report,10);
    assert.equal(setup.state,"watching");assert.ok(setup.missing.includes("context"));
    report.setup={...setup,state:"ready",missing:[]};assert.equal(GlobalReportSchema.safeParse(report).success,false);
  }
  report.context={...report.context,status:"available",agreement:"supports"};
  report.setup=evaluateGlobalSetup(report,10);assert.equal(report.setup.state,"ready");assert.equal(GlobalReportSchema.safeParse(report).success,true);
});
test("a completed close through a candidate origin removes the wave hypothesis before prompting",()=>{
  for(const sign of [1,-1]){
    const controls=[108,100,112,105,130,118,140,125,134,115,118];
    const prices=controls.slice(0,-1).flatMap((p,i)=>Array.from({length:12},(_,j)=>p+(controls[i+1]-p)*j/12)).concat(controls.at(-1)!);
    const input=market(prices.length);input.candles=input.candles.map((c,i)=>{const close=sign===1?prices[i]:240-prices[i];return {...c,open:close-.01,high:close+.2,low:close-.2,close};});
    const candidate=prepareGlobalReport({market:input,tier:"base"});assert.equal(candidate.waveCount.status,"candidate");
    const origin=candidate.waveCount.anchors[0].price,last=input.candles.at(-1)!;
    last.close=origin-sign;last.open=last.close-.01;last.high=last.close+.2;last.low=last.close-.2;
    const broken=prepareGlobalReport({market:input,tier:"base"});assert.equal(broken.waveCount.status,"unclear");assert.equal(broken.waveCount.anchors.length,0);assert.ok(broken.waveCount.validation.includes("origin_invalidated_by_completed_close"));
    const recoveredClose=origin+sign*2;input.candles.push({...last,ts:last.ts+3600000,open:recoveredClose-.01,high:recoveredClose+.2,low:recoveredClose-.2,close:recoveredClose});input.fetchedAt=new Date(last.ts+7200000).toISOString();
    const recovered=prepareGlobalReport({market:input,tier:"base"});assert.equal(recovered.waveCount.status,"unclear","A rebound cannot restore the same invalidated count");
  }
});
