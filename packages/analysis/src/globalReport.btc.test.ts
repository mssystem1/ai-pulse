import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {summarizeCandles, type SpotMarketContext} from "@pulse/market";
import {GlobalReportSchema} from "@pulse/schemas";
import {globalTradePlanLines, globalSetupLines, globalReportChartSvg, globalWaveExplanationLines} from "@pulse/domain";
import {prepareGlobalReport,finishGlobalReport,globalWaveCandidate,globalConfirmedPivots,globalWilderIndicators} from "./globalReport.js";

// Only public OHLCV/timeframes, copied from the three reported October 13
// snapshots. No wallet, receipt, recovery token, user note or model output.
const rows=JSON.parse(readFileSync(new URL("./globalReport.btc-fixtures.json",import.meta.url),"utf8")) as Array<{frame:string;observedAt:string;candles:number[][];contextFrame:string;contextCandles:number[][]}>;
const market=(row:typeof rows[number],context=false):SpotMarketContext=>{
  const candles=(context?row.contextCandles:row.candles).map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,volumeCcy:0,confirmed:true}));
  return {instId:"BTC-USDT",bar:context?row.contextFrame:row.frame,source:"okx-public-spot",fetchedAt:row.observedAt,candles,summary:summarizeCandles(candles),ticker:{instId:"BTC-USDT",last:candles.at(-1)!.close,open24h:0,high24h:0,low24h:0,vol24h:0,volCcy24h:0,change24hPct:0,ts:"0",priceCurrency:"USDT"}};
};
for(const row of rows)test(`${row.frame} reproduces a priced directional plan without inventing an executable Spot buy`,()=>{
  const report=prepareGlobalReport({market:market(row),contextMarket:market(row,true),tier:"premium"}),plan=report.tradePlan!;
  assert.equal(GlobalReportSchema.safeParse(report).success,true);
  assert.equal(plan.side,row.frame==="4H"?"short":"long");assert.ok(plan.referenceEntry&&plan.referenceStop&&plan.targetIds.length);
  assert.equal(report.paths.find(p=>p.id===plan.pathId)!.role,"main");
  const target=report.levels.find(l=>l.id===plan.targetIds[0])!.price;
  assert.ok(plan.side==="short"?plan.referenceStop>plan.referenceEntry[1]&&target<plan.referenceEntry[0]:plan.referenceStop<plan.referenceEntry[0]&&target>plan.referenceEntry[1]);
  assert.equal(report.setup.state,"cancelled");assert.equal(report.setup.entryZone,null);assert.equal(report.setup.protectiveStop,null);assert.equal(report.setup.costsBps,null);
  assert.equal(report.waveCount.status,"candidate");assert.ok(report.waveCount.swingScaleAtr!>0);
  assert.ok(report.waveCount.validation.includes("swing_pattern_only_subdivisions_unverified"));
  if(row.frame==="4H") {assert.equal(report.waveCount.activeWave,"2?");assert.match(globalWaveExplanationLines(report).join(" "),/3, 4 and 5 have not been observed/);}
  if(row.frame==="1D") {assert.equal(report.paths[0].id,"pullback");assert.equal(report.waveCount.activeWave,"A?");}
  if(row.frame==="1W")assert.equal(report.waveCount.structure,"abc_correction");
  const finished=finishGlobalReport(report,{headline:"Conditional plan",summary:"Wait for a new valid test",bias:"neutral",regime:"transition",confidence:50,waveCandidateId:report.waveCount.id,setupPathId:null,mainPathId:null,pathNotes:[],reasons:[],riskNotes:[],limitations:[],disclaimer:"Research only"});
  assert.deepEqual(finished.setup,report.setup,"Model null cannot erase cancellation and its mapped path");
  assert.deepEqual(finished.candles,report.candles);assert.deepEqual(finished.levels,report.levels);
  assert.match(globalSetupLines(finished).join("\n"),/Cancelled|Plan cancelled/);
  assert.match(globalTradePlanLines(finished).join("\n"),/Planned entry reference|Planned SL reference/);
  const svg=globalReportChartSvg(finished)!;assert.match(svg,/180 \/ (520|470)/);assert.match(svg,/data-wave-swings/);assert.match(svg,/PLAN SL/);assert.doesNotMatch(svg,/NaN|Infinity/);
});
test("swing scale filtering uses each pivot's confirmation-time ATR, independently of later bars",()=>{
  const row=rows[1],all=market(row).candles.map(c=>({...c,confirmed:true})),prefix=all.slice(0,-20);
  const candidate=globalWaveCandidate(prefix,globalConfirmedPivots(prefix),globalWilderIndicators(prefix).atr);
  const future=all.map((c,i)=>i>=prefix.length?{...c,high:c.high*20,low:c.low/20}:c);
  const replay=globalWaveCandidate(future.slice(0,prefix.length),globalConfirmedPivots(future.slice(0,prefix.length)),globalWilderIndicators(future.slice(0,prefix.length)).atr);
  assert.deepEqual(replay,candidate);
});
