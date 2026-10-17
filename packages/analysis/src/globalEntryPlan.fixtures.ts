import {candleTimeframeMs,type GlobalReport} from "@pulse/schemas";
import {deriveGlobalTradePlan} from "@pulse/domain";
import {summarizeCandles,type SpotMarketContext} from "@pulse/market";
import {qualifiedGlobalFixture} from "./globalAssessment.fixtures.js";
import {globalWilderIndicators,globalConfirmedPivots,globalFrameEvidence,globalSma} from "./globalReport.js";

/** Synthetic structure-v2 fixtures. No request or market fallback uses these. */
export function entryPlanFixture(side:"long"|"short"="long",family:"breakout_retest"|"reaction"="breakout_retest",now=Date.parse("2026-10-17T08:00:00Z")){
  const {report,market}=qualifiedGlobalFixture("4H",now);
  report.decisionVersion="decision-v2";report.tier="pro";
  report.setup={...report.setup,state:"none",pathId:null,triggerLevelId:null,retestLevelId:null,invalidationLevelId:null,targetIds:[],missing:[]};
  const step=candleTimeframeMs("1H"),end=Math.floor(now/step)*step;
  const data=Array.from({length:180},(_,i)=>({ts:end-(180-i)*step,open:99,high:99.5,low:98.5,close:99,volume:100,volumeCcy:0,confirmed:true}));
  const tail=family==="breakout_retest"?[[99,100.8,98.9,100.5],[100.5,100.7,99.98,100.4],[100.4,100.6,100.2,100.35]]:[[100.1,100.2,99.5,100.1],[100.1,100.6,100,100.4],[100.4,100.6,100.2,100.35]];
  tail.forEach(([open,high,low,close],i)=>Object.assign(data[data.length-3+i],{open,high,low,close}));
  const mirror=(value:number)=>200-value;
  if(side==="short")for(const c of data){const high=mirror(c.low);c.open=mirror(c.open);c.close=mirror(c.close);c.low=mirror(c.high);c.high=high;}
  const entry:SpotMarketContext={...market,bar:"1H",candles:data,summary:summarizeCandles(data)};
  const dayEnd=Math.floor(now/86400000)*86400000,contextData=Array.from({length:90},(_,i)=>({...data[0],ts:dayEnd-(90-i)*86400000,open:100,high:101,low:99,close:100}));
  const context:SpotMarketContext={...market,bar:"1Dutc",candles:contextData,summary:summarizeCandles(contextData)};
  const frame=globalFrameEvidence(context);
  report.context={timeframe:context.bar,status:"available",source:context.source,candles:contextData,sma55:globalSma(contextData,55),agreement:"neutral"};
  report.hierarchy=[globalFrameEvidence(market),frame];
  report.entryStudy={timeframe:"1H",source:entry.source,status:"available",observedAt:entry.fetchedAt,candles:data,pivots:globalConfirmedPivots(data),atr:globalWilderIndicators(data).atr};
  report.paths[0].confirmation=family==="reaction"?(side==="long"?"support_hold":"hold"):"close_retest";
  if(side==="short"){
    report.paths[0].direction="down";
    report.levels=report.levels.map(l=>({...l,price:mirror(l.price),role:l.role==="support"?"resistance":l.role==="resistance"?"support":l.role}));
    report.indicators.pivots=report.indicators.pivots.map(p=>({...p,price:mirror(p.price),kind:p.kind==="high"?"low":"high"}));
  }
  report.tradePlan=deriveGlobalTradePlan(report);
  return {report:report as GlobalReport,market,entry,context};
}
