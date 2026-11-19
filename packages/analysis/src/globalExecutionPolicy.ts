import {candleCloseTime,type GlobalReport} from "@pulse/schemas";

type Plan=NonNullable<GlobalReport["discretionaryPlan"]>;
export type GlobalExecutionBand={lower:number;upper:number};
export type GlobalExecutionSettings={
  timeToLiveBars:number;
  fillWindowBars:number;
  confirmationBars:1|2;
};
export type GlobalExecutionPolicy={
  version:"execution-policy-v1";
  id:string;
  configurationKey:string;
  family:Plan["family"];
  mode:"passive_limit"|"confirmed_retest";
  sourceBoundary:number;
  eventTimeframe:string;
  eventKnownAt:number;
  eventAfter:number;
  expiresAt:number;
  confirmationBars:1|2;
  fillWindowBars:number;
  stopManagement:"structural_fixed";
  targetAllocations:number[];
  entryRegion:"source_zone"|"source_edge"|"defended_retest";
};

const families:Record<Plan["family"],{id:string;mode:GlobalExecutionPolicy["mode"];ttl:number;fill:number;confirmation:1|2}>={
  range_rotation:{id:"range-edge-passive-v1",mode:"passive_limit",ttl:12,fill:3,confirmation:1},
  ema_pullback:{id:"ema-ribbon-passive-v1",mode:"passive_limit",ttl:8,fill:3,confirmation:1},
  vwap_reversion:{id:"vwap-extreme-passive-v1",mode:"passive_limit",ttl:6,fill:2,confirmation:1},
  breakout_retest:{id:"accepted-breakout-retest-v1",mode:"confirmed_retest",ttl:12,fill:3,confirmation:2},
  level_retest:{id:"structural-zone-passive-v1",mode:"passive_limit",ttl:16,fill:4,confirmation:1},
};

/** Execution and location are specified together before payoff is measured.
 * A passive source bid/offer never borrows a later price confirmation. A
 * confirmed breakout uses its actual broken boundary, not a deeper R-fitted
 * region. These conventions do not move structural protection or objectives. */
export function deriveGlobalExecutionPolicy(
  report:GlobalReport,
  plan:Plan,
  source:GlobalExecutionBand,
  overrides:Partial<GlobalExecutionSettings>&{boundaryRetest?:boolean}={},
):{policy:GlobalExecutionPolicy;entry:GlobalExecutionBand}{
  const spec=families[plan.family],cutoff=Date.parse(report.snapshot.observedAt);
  // A lower-frame reclaim can inform context, but cannot silently turn a
  // daily position's declared 4H entry policy into an hourly setup.
  const frame=plan.reference.timeframe;
  const reference=plan.reference.timeframe===frame?plan.reference.candleTs:
    [{timeframe:report.snapshot.timeframe,candles:report.candles},...(report.entryStudy?[report.entryStudy]:[]),...(report.currentMarket?.frames??[])].find(f=>f.timeframe===frame)?.candles.at(-1)?.ts??plan.reference.candleTs;
  const duration=Math.max(1,(candleCloseTime(reference,frame)??plan.reference.completedAt)-reference);
  const settings={timeToLiveBars:spec.ttl,fillWindowBars:spec.fill,confirmationBars:spec.confirmation,...overrides};
  if(!Number.isInteger(settings.timeToLiveBars)||settings.timeToLiveBars<1||!Number.isInteger(settings.fillWindowBars)||settings.fillWindowBars<1||![1,2].includes(settings.confirmationBars))throw new RangeError("Execution settings require positive bar counts and one or two confirmation bars");
  const observed=plan.evidence!==undefined;
  const mode=observed||overrides.boundaryRetest?"confirmed_retest":spec.mode;
  const sourceEdge=plan.entryBasis.kind==="structure_zone"&&plan.family==="level_retest"&&!observed&&!overrides.boundaryRetest;
  const sourceBoundary=observed?plan.evidence!.level:sourceEdge?(plan.side==="long"?source.lower:source.upper):plan.entryBasis.price;
  // Existing reclaimed-level sources retain the causal level-to-test-close
  // interval. Pending breakouts quote the boundary they actually must defend.
  const entry=sourceEdge||overrides.boundaryRetest||mode==="confirmed_retest"&&!observed?{lower:sourceBoundary,upper:sourceBoundary}:{...source};
  const eventKnownAt=plan.evidence?.completedAt??plan.entryBasis.knownAt;
  const eventAfter=Math.max(plan.entryBasis.knownAt,plan.reference.completedAt-duration*settings.timeToLiveBars);
  const targetAllocations=plan.targets.length===1?[1]:plan.targets.length===2?[.5,.5]:[.5,.3,.2];
  if(plan.entryReaction){
    // The completed execution-frame source fixes the limit, volatility and
    // lifetime together. A refresh is not a new order or a renewed deadline.
    const reaction=plan.entryReaction;
    return {entry:{lower:plan.entryBasis.price,upper:plan.entryBasis.price},policy:{
      version:"execution-policy-v1",id:"entry-reaction-passive-v1",
      configurationKey:`${report.snapshot.instId}:${report.snapshot.timeframe}:${plan.family}:entry-reaction-v1`,
      family:plan.family,mode:"passive_limit",sourceBoundary:plan.entryBasis.price,
      eventTimeframe:reaction.timeframe,eventKnownAt:reaction.knownAt,eventAfter:reaction.knownAt,
      expiresAt:reaction.expiresAt,confirmationBars:1,fillWindowBars:4,
      stopManagement:"structural_fixed",targetAllocations,entryRegion:"source_zone",
    }};
  }
  return {entry,policy:{
    version:"execution-policy-v1",
    id:overrides.boundaryRetest?`${plan.family}-boundary-retest-v1`:observed?"observed-reclaim-retest-v1":sourceEdge?"structural-edge-passive-v3":spec.id,
    configurationKey:`${report.snapshot.instId}:${report.snapshot.timeframe}:${plan.family}:${sourceEdge?"source-edge-v3":"v1"}`,
    family:plan.family,mode,sourceBoundary,eventTimeframe:frame,eventKnownAt,eventAfter,
    expiresAt:cutoff+duration*settings.timeToLiveBars,
    confirmationBars:observed?1:settings.confirmationBars,fillWindowBars:settings.fillWindowBars,
    stopManagement:"structural_fixed",targetAllocations,
    entryRegion:sourceEdge?"source_edge":mode==="passive_limit"?"source_zone":"defended_retest",
  }};
}
