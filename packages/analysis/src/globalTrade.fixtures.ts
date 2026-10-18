import {deriveGlobalEntryPlan} from "@pulse/domain";
import {strategyFixture} from "./globalStrategy.fixtures.js";
import {globalConfirmedPivots,globalFrameEvidence,globalSma,globalWilderIndicators} from "./globalReport.js";
import {applySingleGlobalSetup} from "./globalTradeMap.js";

export function tradePlanFixture(frame="4H",side:"long"|"short"="long",family:"breakout_retest"|"reaction"="breakout_retest",now=Date.parse("2026-10-19T00:00:00Z")){
  const fixture=strategyFixture(frame,side,family,now),r=fixture.report;
  // Supply an actual rising/falling primary structure as well as the entry
  // chronology. Flat primary bars cannot establish the new directional rule.
  const mirror=(p:number)=>side==="long"?p:200-p;
  for(const [i,o,h,l,c] of [[154,97,98,96.8,97],[158,97,97.2,96,97],[162,99,99.7,98.8,99],[165,99,99.5,97.5,99]])Object.assign(fixture.market.candles[i],{open:mirror(o),high:side==="long"?h:mirror(l),low:side==="long"?l:mirror(h),close:mirror(c)});
  r.candles=fixture.market.candles.map(c=>({...c,confirmed:true}));
  // The named original anchors keep their canonical IDs; additional genuine
  // intermediate pivots supply the HH/HL or LH/LL structure.
  r.indicators.pivots=[...r.indicators.pivots,...globalConfirmedPivots(r.candles).filter(a=>!r.indicators.pivots.some(p=>p.ts===a.ts&&p.kind===a.kind))].sort((a,b)=>a.ts-b.ts);
  const measured=globalWilderIndicators(r.candles);r.indicators.atr.points=measured.atr;r.indicators.rsi.points=measured.rsi;r.indicators.sma.forEach(s=>s.points=globalSma(r.candles,s.period));
  r.hierarchy=r.hierarchy!.map(row=>row.timeframe===frame?globalFrameEvidence(fixture.market):row);
  r.decisionVersion="decision-v5";r.strategy!.version="horizon-v2";r.strategy!.minimumObjectiveAtr=0;
  r.strategy!.targetPolicy="active-zones-v1";applySingleGlobalSetup(r);return fixture;
}
