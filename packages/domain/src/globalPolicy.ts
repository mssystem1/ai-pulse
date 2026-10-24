import { parseCandleTimeframe, type GlobalReport, type GlobalLevel } from "@pulse/schemas";
import { globalTradePlan } from "./globalTradePlan.js";
import { fnv1a } from "./hash.js";
import {globalContextRelation,globalContextRequired} from "./globalContext.js";
import {globalStructuralWindow} from "./globalViewport.js";
import {globalDiscretionaryCard} from "./globalDiscretionaryPlan.js";
import {globalSetupStrategyProfile} from "./globalSetupStrategies.js";

export function globalArtifactReference(report:GlobalReport):string {
  return fnv1a(JSON.stringify([report.snapshot,report.tradePlan,report.levels,...(report.discretionaryPlan?[report.discretionaryPlan]:[]),...(report.horizonContext?[report.horizonContext,report.indicators.vwap,report.indicators.ema]:[]),...(report.orderFlow?[report.orderFlow]:[])])).toString(16).padStart(8,"0");
}
export function globalArtifactTag(report:GlobalReport):string {
  return `${report.snapshot.observedAt.replace(/\D/g,"").slice(0,14)}-${globalArtifactReference(report)}`;
}

/** A consistency bound for this map's horizon, not a probability of arrival.
 * The nearest obstacle is retained even outside the bound; never skip it to
 * manufacture reward. More distant archive extremes remain context only. */
export const GLOBAL_LOCAL_ATR = 4;
export function globalLocalLevels(levels: GlobalLevel[], close: number, atr: number): GlobalLevel[] {
  const nearest = [...levels].sort((a,b)=>Math.abs(a.price-close)-Math.abs(b.price-close))[0];
  return levels.filter(l=>l===nearest || Math.abs(l.price-close)<=atr*GLOBAL_LOCAL_ATR);
}

export function globalRemoteLevels(report: GlobalReport) {
  const close=report.snapshot.price,atr=report.indicators.atr.points.at(-1)?.value;
  if(close===null||!atr)return [];
  const nearest=new Set([report.levels.filter(l=>l.price>close).sort((a,b)=>a.price-b.price)[0]?.id,
    report.levels.filter(l=>l.price<close).sort((a,b)=>b.price-a.price)[0]?.id]);
  const structural=new Set(report.strategy?.routes.flatMap(r=>[r.protectionLevelId,...r.objectiveIds,...r.checkpointIds])??[]);
  return report.levels.filter(l=>Math.abs(l.price-close)>GLOBAL_LOCAL_ATR*atr&&!nearest.has(l.id)&&!structural.has(l.id));
}
/** Presentation-only compatibility filter. Purchased prices/paths are immutable. */
export function globalSetupMap(report:GlobalReport):GlobalReport {
  const remote=new Set(globalRemoteLevels(report).map(l=>l.id));
  if(!remote.size)return report;
  const paths=report.paths.flatMap(p=>{
    if(p.triggerLevelId&&remote.has(p.triggerLevelId))return [];
    const targetIds=p.targetIds.filter(id=>!remote.has(id));
    if(!targetIds.length)return [];
    const stress=p.stress&&!remote.has(p.stress.triggerLevelId)?{...p.stress,targetIds:p.stress.targetIds.filter(id=>!remote.has(id))}:undefined;
    return [{...p,targetIds,stress:stress?.targetIds.length?stress:undefined}];
  });
  return {...report,tradePlan:report.tradePlan??globalTradePlan(report),paths,view:{...report.view,pathIds:report.view.pathIds.filter(id=>paths.some(p=>p.id===id)),levelIds:report.view.levelIds.filter(id=>!remote.has(id))}};
}

export type GlobalEligibility = "no_trade"|"invalidated"|"expired"|"waiting_confirmation"|"waiting_retest"|"technical_valid";
export function globalEligibility(report:GlobalReport):GlobalEligibility {
  const p=globalTradePlan(report);
  if(p.side==="none"||p.blockers.some(b=>["reward","history","levels"].includes(b)))return "no_trade";
  if(p.blockers.includes("cancelled"))return "invalidated";
  if(p.blockers.includes("expired"))return "expired";
  if(!p.confirmationTs||p.blockers.includes("confirmation"))return "waiting_confirmation";
  if(!p.retestTs||p.blockers.includes("retest"))return "waiting_retest";
  if(p.blockers.includes("entry_price")||globalContextRequired(report)&&["opposing","unavailable"].includes(globalContextRelation(report,p.side)))return "no_trade";
  return "technical_valid";
}
export function globalRiskMeasurement(report:GlobalReport) {
  if(report.discretionaryPlan){const p=report.discretionaryPlan,source=p.stopBasis.timeframe===report.snapshot.timeframe?report.indicators.atr.points:report.entryStudy?.atr,atr=source?.at(-1)?.value,distance=Math.abs(p.entry-p.stop);return {entry:p.entry,distance,percent:distance/p.entry*100,atr:atr?distance/atr:null,timeframe:p.stopBasis.timeframe};}
  const p=globalDiscretionaryCard(report)?.plan??globalTradePlan(report),atr=p.method==="structure-v4"?report.indicators.atr.points.at(-1)?.value:p.method?.startsWith("structure-")?report.entryStudy?.atr.at(-1)?.value:report.indicators.atr.points.at(-1)?.value;
  if(!p.referenceEntry||p.referenceStop===null)return null;
  const entry=p.side==="long"?p.referenceEntry[1]:p.referenceEntry[0],distance=Math.abs(entry-p.referenceStop);
  return {entry,distance,percent:distance/entry*100,atr:atr?distance/atr:null,timeframe:p.method==="structure-v4"?report.snapshot.timeframe:p.entryTimeframe??report.snapshot.timeframe};
}
/** A timeframe changes the scale of market context. Entry-study detail is
 * separate; the primary chart must not collapse to the latest reaction. */
export function globalSetupWindow(report:GlobalReport):number {
  const profile=globalSetupStrategyProfile(report.snapshot.timeframe);
  if(profile)return Math.min(report.candles.length,profile.window);
  if(report.decisionVersion)return globalStructuralWindow(report);
  const p=globalTradePlan(report),ids=[p.triggerLevelId,p.invalidationLevelId];
  const unit=parseCandleTimeframe(report.snapshot.timeframe)?.unit;
  const maximum=unit==="week"||unit==="month"?24:unit==="day"?32:64,minimum=maximum===24?20:32;
  const earliestRecent=report.candles.slice(-(maximum-8))[0]?.ts??0;
  const relevant=report.indicators.pivots.filter(a=>a.ts>=earliestRecent&&ids.some(id=>report.levels.find(l=>l.id===id)?.anchorIds.includes(a.id)));
  const earliest=Math.min(...relevant.map(a=>a.ts));
  const index=report.candles.findIndex(c=>c.ts>=earliest);
  const count=index<0?Math.min(48,maximum):report.candles.length-index+8;
  return Math.min(report.candles.length,maximum,Math.max(minimum,count));
}
