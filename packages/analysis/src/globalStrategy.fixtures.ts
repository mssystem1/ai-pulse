import {candleTimeframeMs,type GlobalReport} from "@pulse/schemas";
import {deriveGlobalEntryPlan,globalStrategyProfile} from "@pulse/domain";
import {summarizeCandles,type SpotMarketContext} from "@pulse/market";
import {entryPlanFixture} from "./globalEntryPlan.fixtures.js";
import {globalConfirmedPivots,globalFrameEvidence,globalWilderIndicators} from "./globalReport.js";

/** Synthetic chronology for strategy qualification. Never used as market data. */
export function strategyFixture(frame="4H",side:"long"|"short"="long",family:"breakout_retest"|"reaction"="breakout_retest",now=Date.parse("2026-10-19T00:00:00Z")){
  const fixture=entryPlanFixture(side,family,now),{report,market,entry}=fixture,profile=globalStrategyProfile(frame)!;
  const step=candleTimeframeMs(frame),end=Math.floor(now/step)*step,entryStep=candleTimeframeMs(profile.entryTimeframe),entryEnd=Math.floor(now/entryStep)*entryStep;
  const mirror=(p:number)=>side==="long"?p:200-p;
  market.bar=frame;market.fetchedAt=new Date(now).toISOString();
  market.candles=market.candles.map((c,i)=>({...c,ts:end-(180-i)*step,open:mirror(99),high:mirror(side==="long"?99.5:98.5),low:mirror(side==="long"?98.5:99.5),close:mirror(99)}));
  const set=(index:number,o:number,h:number,l:number,c:number)=>Object.assign(market.candles[index],{open:mirror(o),high:side==="long"?h:mirror(l),low:side==="long"?l:mirror(h),close:mirror(c)});
  set(150,99,110,98.5,99);set(160,99,99.5,98,99);set(168,99,100,98.5,99);
  if(family==="breakout_retest")set(178,99,100.6,98.9,100.4);else set(178,100.1,100.3,99.5,100.1);
  set(179,100.4,100.7,100.2,100.4);
  market.summary=summarizeCandles(market.candles);
  entry.bar=profile.entryTimeframe;entry.fetchedAt=market.fetchedAt;
  entry.candles=entry.candles.map((c,i)=>({...c,ts:entryEnd-(180-i)*entryStep}));entry.summary=summarizeCandles(entry.candles);
  report.decisionVersion="decision-v4";report.snapshot={...report.snapshot,timeframe:frame,observedAt:market.fetchedAt,lastCandleTs:market.candles.at(-1)!.ts,price:market.candles.at(-1)!.close};
  report.candles=market.candles.map(c=>({...c,confirmed:true}));report.indicators.atr={period:14,points:globalWilderIndicators(report.candles).atr};
  report.indicators.pivots=report.indicators.pivots.map(a=>({...a,ts:market.candles[a.id==="trigger-anchor"?168:a.id==="floor-anchor"?160:150].ts,confirmedAt:market.candles[a.id==="trigger-anchor"?171:a.id==="floor-anchor"?163:153].ts}));
  report.indicators.channels=[];report.indicators.channel=null;report.range=undefined;
  const entryBars=entry.candles.map(c=>({...c,confirmed:true}));
  report.entryStudy={timeframe:entry.bar,source:entry.source,status:"available",observedAt:entry.fetchedAt,candles:entryBars,pivots:globalConfirmedPivots(entryBars),atr:globalWilderIndicators(entryBars).atr};
  report.hierarchy=[globalFrameEvidence(market),...report.hierarchy!.filter(r=>r.timeframe!==frame).map(r=>({...r,observedAt:market.fetchedAt,completedAt:Math.min(r.completedAt??end,end)}))];
  report.strategy={version:"horizon-v1",...profile,routes:[{pathId:report.paths[0].id,side,protectionLevelId:"floor",objectiveIds:["target"],checkpointIds:[]}]};
  report.tradePlan=deriveGlobalEntryPlan(report);
  return {...fixture,report:report as GlobalReport,market,entry:entry as SpotMarketContext};
}
