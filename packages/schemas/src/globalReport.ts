import { z } from "zod";
import {candleCloseTime,candleLevelTouchedAfter} from "./candleTimeframe.js";
import {GlobalOrderFlowSchema} from "./globalOrderFlow.js";

const price = z.number().finite().positive();
const time = z.number().finite().nonnegative();
const seriesPoint = z.object({ ts: time, value: z.number().finite() });
export const GlobalCandleSchema = z.object({ ts: time, open: price, high: price, low: price, close: price, volume: z.number().finite().nonnegative(), confirmed: z.boolean() });
export const GlobalAnchorSchema = z.object({ id: z.string(), ts: time, price, kind: z.enum(["high", "low"]), confirmedAt: time.nullable(), label: z.string().optional() });
export const GlobalLevelSchema = z.object({ id: z.string(), price, role: z.enum(["support", "resistance", "projection"]), anchorIds: z.array(z.string()), basis: z.enum(["swing", "extension", "retracement"]), ratio: z.number().optional() });
export const GlobalWaveSchema = z.object({ id: z.string(), status: z.enum(["candidate", "unclear"]), structure: z.enum(["impulse", "abc_correction", "unclear"]), direction: z.enum(["up", "down", "unclear"]), degree: z.enum(["minor", "local"]), activeWave: z.string(), anchors: z.array(GlobalAnchorSchema), invalidationLevelId: z.string().nullable(), validation: z.array(z.string()), swingScaleAtr: z.number().nonnegative().optional() });
export const GlobalPathSchema = z.object({
  id: z.string(), role: z.enum(["main", "alternative"]), direction: z.enum(["up", "down", "range"]),
  kind: z.enum(["continuation", "recovery", "correction", "recount", "range", "pullback"]),
  state: z.enum(["active", "conditional", "cancelled"]), triggerLevelId: z.string().nullable(),
  targetIds: z.array(z.string()), invalidationLevelId: z.string().nullable(), confirmation: z.enum(["hold", "close_retest", "support_hold"]),
  thesis: z.string(),
  stress: z.object({triggerLevelId:z.string(),targetIds:z.array(z.string()).min(1).max(2)}).optional(),
});
export const GlobalSetupSchema = z.object({
  state: z.enum(["watching", "ready", "cancelled", "expired", "none"]), pathId: z.string().nullable(),
  triggerLevelId: z.string().nullable(), retestLevelId: z.string().nullable(), invalidationLevelId: z.string().nullable(),
  targetIds: z.array(z.string()), entryZone: z.tuple([price, price]).nullable(), protectiveStop: price.nullable(),
  grossRewardRisk: z.number().finite().nonnegative().nullable(), netRewardRisk: z.number().finite().nonnegative().nullable(),
  costsBps: z.number().finite().nonnegative().nullable(), confirmationTs: time.nullable(), retestTs: time.nullable(), expiresAt: time.nullable(),
  missing: z.array(z.enum(["trigger", "retest", "targets", "protection", "reward", "execution_costs", "context", "completed_history", "entry_price"])),
});
/** Research prices are planning references. Only setup contains executable,
 * observed long protection; a short plan never authorizes a Spot short. */
export const GlobalTradePlanSchema = z.object({
  side: z.enum(["long", "short", "none"]), pathId: z.string().nullable(),
  state: z.enum(["conditional", "confirmed", "avoid", "none"]),
  condition: z.enum(["close_retest", "support_hold", "rejection"]),
  triggerLevelId: z.string().nullable(), invalidationLevelId: z.string().nullable(), targetIds: z.array(z.string()),
  referenceEntry: z.tuple([price, price]).nullable(), referenceStop: price.nullable(), grossRewardRisk: z.number().finite().nonnegative().nullable(),
  stopBufferAtr: z.number().positive(), confirmationTs: time.nullable(), retestTs: time.nullable(),
  blockers: z.array(z.enum(["history", "levels", "confirmation", "retest", "reward", "entry_price", "cancelled", "expired"])),
  method: z.enum(["structure-v2","structure-v3","structure-v4","structure-v5"]).optional(),
  strategyId:z.enum(["fast","intraday","swing","position","macro"]).optional(),checkpointIds:z.array(z.string()).optional(),firstObstacleRewardRisk:z.number().finite().nonnegative().nullable().optional(),structureConfirmationTs:time.nullable().optional(),
  family: z.enum(["breakout_retest","support_bounce","resistance_rejection","range_buy","range_sell"]).optional(),
  entryTimeframe: z.string().optional(), zone: z.tuple([price,price]).optional(),
  stopBasis: z.string().optional(), evidenceKind: z.enum(["held_retest","follow_through"]).optional(),
  signalExpiresAt: time.nullable().optional(),
  watchOnly:z.boolean().optional(),
  entryObstacle:z.object({price,timeframe:z.string(),anchorTs:time,knownAt:time}).optional(),
  failure: z.object({ts:time,reason:z.enum(["structure","stop","trigger","objective"])}).nullable().optional(),
});
export const GlobalChannelSchema = z.object({
  id:z.string(),type:z.literal("parallel"),scope:z.enum(["broad","local"]),timeframe:z.string(),scale:z.literal("linear"),
  base:z.tuple([GlobalAnchorSchema,GlobalAnchorSchema]),opposite:GlobalAnchorSchema,offset:z.number().finite(),
  knownAt:time,startTs:time,endTs:time,touches:z.object({lower:z.number().int().nonnegative(),upper:z.number().int().nonnegative()}),
  closeViolations:z.number().int().nonnegative(),
  priceState:z.enum(["inside","above","below"]).optional(),breakTs:time.nullable().optional(),
});
export const GlobalRangeSchema = z.object({lower:z.tuple([price,price]),upper:z.tuple([price,price]),anchorIds:z.array(z.string()),startTs:time,touches:z.number().int().min(4)});
export const GlobalEntryStudySchema = z.object({
  timeframe:z.string(),source:z.string().nullable(),status:z.enum(["available","unavailable"]),observedAt:z.string(),
  candles:z.array(GlobalCandleSchema),pivots:z.array(GlobalAnchorSchema),atr:z.array(seriesPoint),
});
export const GlobalIndicatorsSchema = z.object({
  sma: z.array(z.object({ period: z.number().int().positive(), points: z.array(seriesPoint) })),
  ema: z.array(z.object({ period: z.number().int().positive(), points: z.array(seriesPoint) })).optional(),
  rsi: z.object({ period: z.literal(14), points: z.array(seriesPoint) }),
  atr: z.object({ period: z.literal(14), points: z.array(seriesPoint) }),
  volumeRatio: z.number().finite().nonnegative().nullable(),
  regression: z.object({ bars: z.literal(120), residualSigma: z.number().finite().nonnegative(), mid: z.array(seriesPoint), upper: z.array(seriesPoint), lower: z.array(seriesPoint) }).nullable(),
  fibonacci: z.array(z.object({ ratio: z.number(), price, anchorIds: z.tuple([z.string(), z.string()]) })),
  vwap: z.object({ anchorId: z.string(), points: z.array(seriesPoint), anchorTs: time.optional(), knownAt: time.optional(),
    basis: z.literal("primary_hlc3_volume").optional(),
    anchorReason:z.enum(["session_open","week_open","swing_low","swing_high","cycle_low","cycle_high"]).optional(),selectedAt:time.optional(),
    bands: z.array(z.object({ multiple: z.union([z.literal(1),z.literal(2),z.literal(3)]), upper: z.array(seriesPoint), lower: z.array(seriesPoint) })).optional(),
  }).nullable(),
  pivots: z.array(GlobalAnchorSchema),
  channel: z.object({ lower: z.tuple([GlobalAnchorSchema, GlobalAnchorSchema]), upper: z.tuple([GlobalAnchorSchema, GlobalAnchorSchema]) }).nullable(),
  channels:z.array(GlobalChannelSchema).max(2).optional(),
});
export const GlobalFrameSchema = z.object({
  timeframe:z.string(), status:z.enum(["available","unavailable"]), source:z.string().nullable(),
  observedAt:z.string(), completedAt:time.nullable(), price:price.nullable(), sma55:price.nullable(), smaChange:z.number().finite().nullable(),
  structure:z.enum(["up","down","range","mixed"]), bias:z.enum(["up","down","range","mixed"]), candles:z.number().int().nonnegative(),
});
export const GlobalHorizonContextSchema=z.object({
  version:z.literal("horizon-context-v1"),timeframe:z.string(),reading:z.enum(["session","intraday","swing","position","macro"]),knownAt:time,
  zones:z.array(z.object({id:z.string(),role:z.enum(["support","resistance"]),lower:price,upper:price,startTs:time,knownAt:time,anchorIds:z.array(z.string()).min(1),basis:z.literal("confirmed_pivot_wicks")})).max(6),
  ranges:z.array(z.object({id:z.string(),kind:z.enum(["session","balance","recovery_leg","decline_leg","cycle"]),lower:price,upper:price,startTs:time,endTs:time,knownAt:time,anchorIds:z.array(z.string())})).max(3),
});
/** A priced scenario for the trader's decision, separate from observed signal
 * and order authorization. Every price retains its saved candle provenance. */
export const GlobalDiscretionaryPlanSchema=z.object({
  version:z.enum(["discretionary-plan-v1","discretionary-plan-v2","discretionary-plan-v3","discretionary-plan-v4","discretionary-plan-v5","discretionary-plan-v6"]),side:z.enum(["long","short"]),requiresNewTestAfter:time.optional(),
  priceZones:z.object({version:z.literal("price-zones-v1"),entry:z.object({lower:price,upper:price,sourceLower:price,sourceUpper:price,sourcePrice:price}),stop:z.object({lower:price,upper:price}),targets:z.array(z.object({lower:price,upper:price})).min(1).max(3),payoffFloor:z.literal(1),payoffLimited:z.boolean()}).optional(),
  evidence:z.object({kind:z.enum(["local_reclaim","primary_reclaim"]),timeframe:z.string(),level:price,testTs:time,completedAt:time,extreme:price}).optional(),
  family:z.enum(["range_rotation","ema_pullback","vwap_reversion","breakout_retest","level_retest"]),objectiveTimeframe:z.string(),
  entry:price,stop:price,
  entryBasis:z.object({kind:z.enum(["completed_close","reclaimed_level","ema_ribbon","range_edge","vwap_band","structure_zone"]),timeframe:z.string(),knownAt:time,price}),
  reference:z.object({timeframe:z.string(),candleTs:time,completedAt:time,price}),
  stopBasis:z.object({timeframe:z.string(),anchorTs:time,knownAt:time,price}),
  targets:z.array(z.object({price,timeframe:z.string(),anchorTs:time,knownAt:time,basis:z.enum(["confirmed_swing","observed_extreme","structure_zone","measured_projection","vwap_band","range_boundary","range_midpoint","range_quartile"]),bandMultiple:z.number().int().min(-3).max(3).optional()})).min(1).max(3),
  barriers:z.array(z.object({price,timeframe:z.string(),anchorTs:time,knownAt:time})).max(5),
});
export const GlobalReportSchema = z.object({
  version: z.literal("pulse-global-v3"), tier: z.enum(["quick", "pro"]), lang: z.enum(["en", "zh"]),
  evaluationVersion: z.literal("completed-v2").optional(),
  decisionVersion:z.enum(["decision-v1","decision-v2","decision-v3","decision-v4","decision-v5"]).optional(), hierarchy:z.array(GlobalFrameSchema).max(7).optional(),
  targetReviewOf:z.string().regex(/^[0-9a-f]{8}$/).optional(),
  setupSelection:z.object({version:z.enum(["single-setup-v1","single-setup-v2","single-setup-v3","single-setup-v4"]),assessment:z.enum(["long","short","sideways"]),regime:z.enum(["trend","recovery","range","transition"]),rule:z.enum(["trend_continuation","structural_reversal","structure_break","range_reaction","none"]),pathId:z.string().nullable(),side:z.enum(["long","short","none"]),evidence:z.array(z.string()),limitations:z.array(z.string())}).optional(),
  strategy:z.object({version:z.enum(["horizon-v1","horizon-v2"]),targetPolicy:z.enum(["active-zones-v1","legacy-pivots-v1"]).optional(),id:z.enum(["fast","intraday","swing","position","macro"]),name:z.string(),holding:z.string(),entryTimeframe:z.string(),lookbackBars:z.number().int().positive(),majorSwingAtr:z.number().nonnegative(),minimumObjectiveAtr:z.number().nonnegative(),contextLevelIds:z.array(z.string()).optional(),routes:z.array(z.object({pathId:z.string(),side:z.enum(["long","short"]),protectionLevelId:z.string().nullable(),objectiveIds:z.array(z.string()),checkpointIds:z.array(z.string())}))}).optional(),
  entryStudy:GlobalEntryStudySchema.optional(),range:GlobalRangeSchema.nullable().optional(),horizonContext:GlobalHorizonContextSchema.optional(),
  currentMarket:z.object({source:z.string(),quote:z.object({price,ts:time}).optional(),frames:z.array(z.object({timeframe:z.enum(["5m","15m","1H"]),candles:z.array(GlobalCandleSchema).min(1).max(96)})).max(3)}).optional(),
  snapshot: z.object({ instId: z.string(), timeframe: z.string(), source: z.string(), venue: z.string(), priceCurrency: z.string(),
    observedAt: z.string(), lastCandleTs: time.nullable(), price: price.nullable(), pricePrecision: z.number().int().min(0).max(10), completedOnly: z.literal(true) }),
  candles: z.array(GlobalCandleSchema), levels: z.array(GlobalLevelSchema), waveCount: GlobalWaveSchema, paths: z.array(GlobalPathSchema).max(3),
  setup: GlobalSetupSchema, tradePlan: GlobalTradePlanSchema.optional(), discretionaryPlan:GlobalDiscretionaryPlanSchema.optional(), orderFlow:GlobalOrderFlowSchema.optional(), indicators: GlobalIndicatorsSchema,
  context: z.object({ timeframe: z.string().nullable(), status: z.enum(["available", "unavailable", "not_requested"]), source: z.string().nullable(),
    candles: z.array(GlobalCandleSchema), sma55: z.array(seriesPoint), agreement: z.enum(["supports", "conflicts", "neutral", "unknown"]) }),
  narrative: z.object({ headline: z.string(), summary: z.string(), reasons: z.array(z.string()), riskNotes: z.array(z.string()), limitations: z.array(z.string()), disclaimer: z.string() }),
  view: z.object({ levelIds: z.array(z.string()), pathIds: z.array(z.string()), smaPeriods: z.array(z.number()), defaultLayers: z.array(z.string()) }),
}).superRefine((report, ctx) => {
  if(report.currentMarket){const current=report.currentMarket,cutoff=Date.parse(report.snapshot.observedAt);
    if(current.source!==report.snapshot.source||current.quote&&(current.quote.ts>cutoff+5000||cutoff-current.quote.ts>120000)||current.frames.some(f=>!f.candles.length||cutoff>(candleCloseTime(candleCloseTime(f.candles.at(-1)!.ts,f.timeframe)??0,f.timeframe)??0)+60000||f.candles.some((c,i)=>!c.confirmed||(candleCloseTime(c.ts,f.timeframe)??Infinity)>cutoff||i>0&&c.ts<=f.candles[i-1].ts)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Current market context must retain venue identity, fresh quote time and completed candles available at the snapshot"});
  }
  if(report.horizonContext){const h=report.horizonContext,cutoff=Date.parse(report.snapshot.observedAt),pivots=new Set(report.indicators.pivots.filter(a=>a.confirmedAt!==null&&(candleCloseTime(a.confirmedAt,report.snapshot.timeframe)??Infinity)<=cutoff).map(a=>a.id));
    if(h.timeframe!==report.snapshot.timeframe||h.knownAt>cutoff||h.zones.some(z=>z.lower>z.upper||z.startTs>z.knownAt||z.knownAt>cutoff||z.anchorIds.some(id=>!pivots.has(id)))||h.ranges.some(r=>r.lower>=r.upper||r.startTs>r.endTs||r.endTs>r.knownAt||r.knownAt>cutoff||r.anchorIds.some(id=>!pivots.has(id))))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Horizon context must retain confirmed primary-frame anchors, price zones and available times"});
    const close=report.candles.at(-1)?.close;
    for(const zone of h.zones){
      const anchors=zone.anchorIds.map(id=>report.indicators.pivots.find(a=>a.id===id));
      const wicks=anchors.map(a=>{const c=a&&report.candles.find(c=>c.ts===a.ts);return a&&c?{lower:a.kind==="low"?c.low:Math.max(c.open,c.close),upper:a.kind==="low"?Math.min(c.open,c.close):c.high}:null;});
      if(wicks.some(w=>!w)||zone.lower!==Math.min(...wicks.map(w=>w?.lower??Infinity))||zone.upper!==Math.max(...wicks.map(w=>w?.upper??-Infinity))||zone.startTs!==Math.min(...anchors.map(a=>a?.ts??Infinity))||anchors.some(a=>a?.confirmedAt===null||(candleCloseTime(a?.confirmedAt??Infinity,report.snapshot.timeframe)??Infinity)>zone.knownAt)||close===undefined||(zone.role==="support"?zone.upper>close:zone.lower<close))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Context support and resistance must match saved primary-candle wicks on their evidenced price side"});
    }
    for(const range of h.ranges.filter(r=>r.kind==="cycle"||r.kind==="recovery_leg"||r.kind==="decline_leg")){
      const anchors=range.anchorIds.map(id=>report.indicators.pivots.find(a=>a.id===id)),low=anchors.find(a=>a?.kind==="low"),high=anchors.find(a=>a?.kind==="high");
      if(anchors.length!==2||!low||!high||range.lower!==low.price||range.upper!==high.price||range.startTs!==Math.min(low.ts,high.ts)||range.endTs!==Math.max(low.ts,high.ts)||range.kind==="recovery_leg"&&low.ts>=high.ts||range.kind==="decline_leg"&&high.ts>=low.ts||anchors.some(a=>(candleCloseTime(a?.confirmedAt??Infinity,report.snapshot.timeframe)??Infinity)>range.knownAt))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Macro and position ranges must match their confirmed primary pivot prices, chronology and available times"});
    }
  }
  if(report.orderFlow){const f=report.orderFlow,cutoff=Date.parse(report.snapshot.observedAt);
    if(f.source!==report.snapshot.source||f.instId!==report.snapshot.instId||f.priceCurrency!==report.snapshot.priceCurrency||f.profile.timeframe!==report.snapshot.timeframe||f.coverage.knownAt>cutoff||f.profile.knownAt>cutoff||f.footprints.some(b=>b.knownAt>cutoff)||report.snapshot.source==="okx-public-spot"&&(f.marketType!=="spot"||f.quantityUnit!=="base"))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Report order flow must match its venue, instrument, timeframe, quantity and observation cutoff"});
    const near=(a:number,b:number)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
    if(f.footprints.some(b=>{const c=report.candles.find(c=>c.ts===b.start);return !c||candleCloseTime(c.ts,report.snapshot.timeframe)!==b.end||!near(c.open,b.open)||!near(c.high,b.high)||!near(c.low,b.low)||!near(c.close,b.close)||!near(c.volume,b.volume)}))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Executed footprints must reconcile to their completed primary-candle OHLC and volume"});
  }
  const discretionary=report.discretionaryPlan;
  if(discretionary){
    if(discretionary.entryBasis.kind==="structure_zone"){
      const sourcePrice=discretionary.priceZones?.entry.sourcePrice??discretionary.entry;
      const zone=report.horizonContext?.zones.find(z=>z.role===(discretionary.side==="long"?"support":"resistance")&&(discretionary.side==="long"?z.upper:z.lower)===sourcePrice&&z.knownAt===discretionary.entryBasis.knownAt);
      if(!zone||discretionary.entryBasis.timeframe!==report.snapshot.timeframe||discretionary.stopBasis.price!==(discretionary.side==="long"?zone.lower:zone.upper)||discretionary.stopBasis.anchorTs!==zone.startTs)ctx.addIssue({code:z.ZodIssueCode.custom,message:"A structural retest must retain its primary entry zone and outer invalidation boundary"});
    }
    if(discretionary.version==="discretionary-plan-v6"){
      const p=discretionary,z=p.priceZones,near=(a:number,b:number)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b)),sign=p.side==="long"?1:-1;
      const point=(a:number)=>({lower:a,upper:a}),band=(a:number,b:number)=>({lower:Math.min(a,b),upper:Math.max(a,b)});
      let expected=z?point(z.entry.sourcePrice):point(p.entry);
      if(z){
        const original=z.entry.sourcePrice;
        if(p.entryBasis.kind==="structure_zone"){const source=report.horizonContext?.zones.find(s=>s.role===(p.side==="long"?"support":"resistance")&&(p.side==="long"?s.upper:s.lower)===original&&s.knownAt===p.entryBasis.knownAt);if(source)expected=band(source.lower,source.upper);}
        else if(p.entryBasis.kind==="ema_ribbon"){const values=report.indicators.ema?.filter(e=>e.period===12||e.period===25).flatMap(e=>e.points.at(-1)?.value??[])??[];if(values.length===2)expected=band(values[0],values[1]);}
        else if(p.entryBasis.kind==="range_edge"&&report.range){const source=p.side==="long"?(p.family==="range_rotation"?report.range.lower:report.range.upper):(p.family==="range_rotation"?report.range.upper:report.range.lower);expected=band(source[0],source[1]);}
        else if(p.entryBasis.kind==="vwap_band"){const outer=report.indicators.vwap?.bands?.find(b=>b.multiple===3)?.[p.side==="long"?"lower":"upper"].at(-1)?.value;if(outer!==undefined&&outer>0)expected=band(original,outer);}
        else if(p.evidence){const e=p.evidence,source=[{timeframe:report.snapshot.timeframe,candles:report.candles},...(report.entryStudy?[report.entryStudy]:[]),...(report.currentMarket?.frames??[])].find(s=>s.timeframe===e.timeframe)?.candles.find(c=>c.ts===e.testTs);if(source)expected=band(original,source.close);}
      }
      const invalid=!z||z.entry.lower>z.entry.upper||sign*((p.side==="long"?z.entry.lower:z.entry.upper)-p.stop)<=0||z.entry.lower<z.entry.sourceLower&&!near(z.entry.lower,z.entry.sourceLower)||z.entry.upper>z.entry.sourceUpper&&!near(z.entry.upper,z.entry.sourceUpper)||!near(z.entry.sourceLower,expected.lower)||!near(z.entry.sourceUpper,expected.upper)||!near(p.entry,p.side==="long"?z.entry.upper:z.entry.lower)||!near(z.stop.lower,Math.min(p.stop,p.stopBasis.price))||!near(z.stop.upper,Math.max(p.stop,p.stopBasis.price))||z.targets.length!==p.targets.length||z.targets.some((b,i)=>{
        const t=p.targets[i];if(b.lower>b.upper||sign*((p.side==="long"?b.lower:b.upper)-p.entry)<=0)return true;
        if(near(b.lower,t.price)&&near(b.upper,t.price))return false;
        if(t.basis==="structure_zone")return !report.horizonContext?.zones.some(s=>s.startTs===t.anchorTs&&s.knownAt===t.knownAt&&near(s.lower,b.lower)&&near(s.upper,b.upper)&&(p.side==="long"?s.lower:s.upper)===t.price);
        if(t.basis==="confirmed_swing"||t.basis==="observed_extreme"){const c=report.candles.find(c=>c.ts===t.anchorTs);if(!c)return true;const source=p.side==="long"?band(Math.max(c.open,c.close),c.high):band(c.low,Math.min(c.open,c.close));return !near(b.lower,source.lower)||!near(b.upper,source.upper);}
        return true;
      });
      if(invalid)ctx.addIssue({code:"custom",message:"Price zones must retain evidenced entry bounds, hard-stop protection and primary target bands"});
      if(z){const first=p.side==="long"?z.targets[0].lower:z.targets[0].upper,obstacle=p.barriers[0]?.price??first,rr=sign*(obstacle-p.entry)/Math.abs(p.entry-p.stop);
        if(p.barriers.some(b=>sign*(first-b.price)<=0)||z.payoffLimited!==(rr<1-1e-9)||z.targets.some((b,i)=>i>0&&(p.side==="long"?b.lower<=z.targets[i-1].upper:b.upper>=z.targets[i-1].lower)))ctx.addIssue({code:"custom",message:"Price-zone payoff must use the worst entry, hard stop and nearest obstacle, with nonoverlapping targets"});
      }
    }
    const r=discretionary.reference,bars=r.timeframe===report.snapshot.timeframe?report.candles:r.timeframe===report.entryStudy?.timeframe?report.entryStudy.candles:[],bar=bars.find(c=>c.ts===r.candleTs),sign=discretionary.side==="long"?1:-1;
    if(!bar||bar.close!==r.price||candleCloseTime(r.candleTs,r.timeframe)!==r.completedAt||r.completedAt>Date.parse(report.snapshot.observedAt)||discretionary.entryBasis.price!==discretionary.entry||discretionary.entryBasis.knownAt>Date.parse(report.snapshot.observedAt))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Conditional plan entry must retain its saved completed reference and entry basis"});
    if(sign*(discretionary.entry-discretionary.stop)<=0||discretionary.targets.some((t,i)=>sign*(t.price-discretionary.entry)<=0||i>0&&sign*(t.price-discretionary.targets[i-1].price)<=0||t.knownAt>Date.parse(report.snapshot.observedAt))||discretionary.stopBasis.knownAt>Date.parse(report.snapshot.observedAt))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Conditional plan requires ordered protection, targets and available evidence"});
    if(discretionary.objectiveTimeframe!==report.snapshot.timeframe||discretionary.stopBasis.timeframe!==report.snapshot.timeframe||discretionary.targets.some(t=>t.timeframe!==report.snapshot.timeframe)||sign*(discretionary.stopBasis.price-discretionary.stop)<=0)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Conditional protection and objectives must retain the primary horizon and protect beyond invalidation"});
    if(discretionary.stopBasis.anchorTs>discretionary.stopBasis.knownAt||discretionary.targets.some(t=>t.anchorTs>t.knownAt)||discretionary.barriers.some(b=>b.anchorTs>b.knownAt||b.knownAt>Date.parse(report.snapshot.observedAt)||b.timeframe!==report.entryStudy?.timeframe&&b.timeframe!==report.snapshot.timeframe&&!report.currentMarket?.frames.some(f=>f.timeframe===b.timeframe)||sign*(b.price-discretionary.entry)<=0||sign*(discretionary.targets[0].price-b.price)<=0))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Conditional levels must retain available source times and intermediate-barrier ordering"});
    if(discretionary.version!=="discretionary-plan-v1"){
      const range=report.range,near=(a:number,b:number)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
      if(discretionary.targets.some(t=>{
        if(!["range_midpoint","range_quartile","range_boundary"].includes(t.basis))return false;
        if(!range)return true;
        const low=range.lower[1],high=range.upper[0],fraction=t.basis==="range_midpoint"?.5:discretionary.side==="long"?.75:.25;
        const expected=t.basis==="range_boundary"?(discretionary.side==="long"?high:low):low+(high-low)*fraction;
        return !near(t.price,expected)||t.anchorTs!==range.startTs;
      }))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Conditional range objectives must match the saved geometric range"});
    }
    if(discretionary.version==="discretionary-plan-v3"||["discretionary-plan-v4","discretionary-plan-v5","discretionary-plan-v6"].includes(discretionary.version)){
      const cutoff=Date.parse(report.snapshot.observedAt),sources=[{candles:report.candles,timeframe:report.snapshot.timeframe},...(report.entryStudy?.source===report.snapshot.source?[report.entryStudy]:[]),...(report.currentMarket?.frames??[])];
      const latest=sources.flatMap(s=>{const c=s.candles.at(-1);return c?[{price:c.close,at:candleCloseTime(c.ts,s.timeframe)??0}]:[];}).sort((a,b)=>b.at-a.at)[0]?.price??r.price;
      const current=["discretionary-plan-v4","discretionary-plan-v5","discretionary-plan-v6"].includes(discretionary.version)?report.currentMarket?.quote?.price??latest:r.price;
      if(discretionary.requiresNewTestAfter!==cutoff||discretionary.targets.some(t=>sign*(t.price-current)<=0||["confirmed_swing","observed_extreme","structure_zone"].includes(t.basis)&&sources.some(s=>candleLevelTouchedAfter(s.candles,s.timeframe,t.price,discretionary.side,t.knownAt,cutoff))))ctx.addIssue({code:z.ZodIssueCode.custom,message:"A fresh conditional setup requires a new test after its snapshot and objectives not already reached by completed execution candles"});
      if(["discretionary-plan-v4","discretionary-plan-v5","discretionary-plan-v6"].includes(discretionary.version)&&discretionary.targets.some(t=>{
        if(t.basis==="confirmed_swing")return !report.indicators.pivots.some(a=>a.kind===(discretionary.side==="long"?"high":"low")&&a.ts===t.anchorTs&&a.price===t.price&&a.confirmedAt!==null&&candleCloseTime(a.confirmedAt,report.snapshot.timeframe)===t.knownAt);
        if(t.basis==="observed_extreme")return !report.candles.some(c=>c.ts===t.anchorTs&&(discretionary.side==="long"?c.high:c.low)===t.price&&candleCloseTime(c.ts,report.snapshot.timeframe)===t.knownAt);
        if(t.basis==="structure_zone")return !report.horizonContext?.zones.some(z=>z.role===(discretionary.side==="long"?"resistance":"support")&&(discretionary.side==="long"?z.lower:z.upper)===t.price&&z.startTs===t.anchorTs&&z.knownAt===t.knownAt);
        return false;
      }))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Current structural objectives must retain their actual primary pivot, extreme or zone"});
      if(discretionary.evidence){const e=discretionary.evidence,source=sources.find(s=>s.timeframe===e.timeframe),test=source?.candles.find(c=>c.ts===e.testTs);if(!test||e.completedAt>cutoff||e.testTs>e.completedAt||sign*(latest-e.level)<=0||!source?.candles.some(c=>candleCloseTime(c.ts,e.timeframe)===e.completedAt&&sign*(c.close-e.level)>0))ctx.addIssue({code:z.ZodIssueCode.custom,message:"A reclaim setup must retain its actual completed test and held direction"});}
    }
  }
  if(report.decisionVersion){
    const rows=report.hierarchy??[];
    if(!rows.some(row=>row.timeframe===report.snapshot.timeframe)||new Set(rows.map(r=>r.timeframe)).size!==rows.length||rows.some(r=>r.observedAt!==report.snapshot.observedAt||r.source!==null&&r.source!==report.snapshot.source||r.completedAt!==null&&r.completedAt>Date.parse(report.snapshot.observedAt)||r.status==="available"&&(r.candles<55||r.price===null||r.sma55===null)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Decision hierarchy must retain one source, cutoff and evidenced completed frames"});
  }
  const ids = new Set(report.levels.map(level => level.id));
  if(report.setupSelection){
    const selected=report.setupSelection;
    if(selected.pathId===null?selected.side!=="none"||selected.rule!=="none":selected.side==="none"||selected.rule==="none")ctx.addIssue({code:z.ZodIssueCode.custom,message:"A selected setup requires a side and strategy; unavailable setups have neither"});
    if(selected.assessment!=="sideways"&&selected.side!=="none"&&selected.assessment!==selected.side||selected.regime==="range"&&selected.assessment!=="sideways")ctx.addIssue({code:z.ZodIssueCode.custom,message:"Market assessment must agree with the selected strategy direction"});
    if(selected.pathId===null?(report.paths.length>0||report.view.pathIds.length>0||Boolean(report.strategy?.routes.length)):(report.paths.length!==1||report.paths[0].id!==selected.pathId||report.view.pathIds.length!==1||report.view.pathIds[0]!==selected.pathId||report.strategy?.routes.length!==1||report.strategy.routes[0].pathId!==selected.pathId||report.strategy.routes[0].side!==selected.side))ctx.addIssue({code:z.ZodIssueCode.custom,message:"A selected strategy publishes at most one path, one route and one setup"});
    if(report.tradePlan?.side!=="none"&&report.tradePlan&&(report.tradePlan.side!==selected.side||report.tradePlan.pathId!==selected.pathId))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Entry plan must match the single selected strategy"});
  }
  if(["decision-v4","decision-v5"].includes(report.decisionVersion??"")&&report.strategy){
    const current=report.decisionVersion==="decision-v5";
    if(report.strategy.version!==(current?"horizon-v2":"horizon-v1"))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Strategy method must match its saved report version"});
    if(current&&((report.strategy.contextLevelIds??[]).some(id=>!ids.has(id))||report.strategy.routes.some(r=>r.objectiveIds.length>3||r.checkpointIds.length>0)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Current trade plans require canonical context and at most three TP levels without a competing checkpoint map"});
    const profiles:Record<string,[string,string]>={"15m":["fast","5m"],"1H":["intraday","15m"],"4H":["swing","1H"],"1D":["position","4H"],"1W":["macro","1Dutc"]},expected=profiles[report.snapshot.timeframe.replace(/utc$/i,"")];
    if(!expected||report.strategy.id!==expected[0]||report.strategy.entryTimeframe!==expected[1])ctx.addIssue({code:z.ZodIssueCode.custom,message:"Strategy and timing must match the primary timeframe profile"});
    if(report.candles.some(c=>(candleCloseTime(c.ts,report.snapshot.timeframe)??Infinity)>Date.parse(report.snapshot.observedAt)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Strategy structure must use completed primary-frame evidence"});
    for(const r of report.strategy.routes){
      const sign=r.side==="long"?1:-1,prices=r.objectiveIds.map(id=>report.levels.find(l=>l.id===id)?.price);
      if(r.objectiveIds.some(id=>r.checkpointIds.includes(id))||prices.some((p,i)=>p===undefined||i>0&&(prices[i-1]===undefined||sign*(p-prices[i-1]!)<=0))||r.objectiveIds.some(id=>{const l=report.levels.find(l=>l.id===id);return l&&(!l.anchorIds.some(id=>report.indicators.pivots.some(a=>a.id===id&&a.confirmedAt!==null))||l.basis!=="swing");}))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Strategy objectives require ordered confirmed primary swings, distinct from checkpoints"});
      if(report.strategy.targetPolicy==="active-zones-v1")for(const id of r.objectiveIds){
        const level=report.levels.find(l=>l.id===id);if(!level)continue;
        const tick=10**-report.snapshot.pricePrecision,anchors=report.indicators.pivots.filter(a=>level.anchorIds.includes(a.id));
        if(!anchors.length||anchors.some(a=>a.kind!==(r.side==="long"?"high":"low")||a.confirmedAt===null||(candleCloseTime(a.confirmedAt,report.snapshot.timeframe)??Infinity)>Date.parse(report.snapshot.observedAt)||report.candles.some(c=>c.ts>=(candleCloseTime(a.confirmedAt!,report.snapshot.timeframe)??Infinity)&&sign*(c.close-a.price)>tick*.5))||Math.abs(level.price-(r.side==="long"?Math.min(...anchors.map(a=>a.price)):Math.max(...anchors.map(a=>a.price))))>tick*.5)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Active targets require unconsumed, confirmed same-side pivots and the nearest zone edge"});
      }
    }
  }
  if(["decision-v4","decision-v5"].includes(report.decisionVersion??"")&&(!report.strategy||report.strategy.entryTimeframe!==report.entryStudy?.timeframe||report.strategy.routes.some(r=>!report.paths.some(p=>p.id===r.pathId)||[r.protectionLevelId,...r.objectiveIds,...r.checkpointIds].some(id=>id!==null&&!ids.has(id)))))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Strategy reports require a matching horizon, entry frame and canonical objective/checkpoint map"});
  if(["decision-v2","decision-v3","decision-v4","decision-v5"].includes(report.decisionVersion??"")){
    const study=report.entryStudy;
    if(!Number.isFinite(Date.parse(report.snapshot.observedAt)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Structure-v2 needs a valid observation cutoff"});
    if(!study||study.observedAt!==report.snapshot.observedAt||study.source!==null&&study.source!==report.snapshot.source||study.candles.some((c,i)=>!c.confirmed||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||(candleCloseTime(c.ts,study.timeframe)??Infinity)>Date.parse(study.observedAt)||i>0&&c.ts<=study.candles[i-1].ts)||study.status==="available"&&(study.candles.length<55||!study.source))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Entry study must preserve source, cutoff and completed chronological evidence"});
    for(const channel of report.indicators.channels??[]){
      if(channel.base[0].ts>=channel.base[1].ts||channel.offset===0||channel.knownAt>Date.parse(report.snapshot.observedAt)||channel.timeframe!==report.snapshot.timeframe)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Channel needs ordered anchors, nonzero width and known evidence on its named frame"});
      if([...channel.base,channel.opposite].some(a=>a.confirmedAt===null||(candleCloseTime(a.confirmedAt!,channel.timeframe)??Infinity)>channel.knownAt)||channel.base[0].kind!==channel.base[1].kind||channel.opposite.kind===channel.base[0].kind||channel.base[0].kind==="low"&&channel.offset<=0||channel.base[0].kind==="high"&&channel.offset>=0)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Parallel channel must use confirmed same-side anchors and an opposite boundary"});
      const a=report.candles.findIndex(c=>c.ts===channel.base[0].ts),b=report.candles.findIndex(c=>c.ts===channel.base[1].ts),opposite=report.candles.findIndex(c=>c.ts===channel.opposite.ts);
      const offset=channel.opposite.price-(channel.base[0].price+(channel.base[1].price-channel.base[0].price)*(opposite-a)/(b-a));
      if(a<0||b<=a||opposite<0||!Number.isFinite(offset)||Math.abs(offset-channel.offset)>Math.max(10**-report.snapshot.pricePrecision,Math.abs(offset)*1e-9))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Channel width must match its saved opposite anchor in candle-index space"});
    }
    if(study&&study.atr.some(p=>p.value<0||!study.candles.length||p.ts>study.candles.at(-1)!.ts))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Entry ATR must use the saved completed study horizon"});
    if(report.range&&(report.range.lower[0]>report.range.lower[1]||report.range.upper[0]>report.range.upper[1]||report.range.lower[1]>=report.range.upper[0]))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Range support and resistance zones must be ordered"});
  }
  if (ids.size !== report.levels.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate level IDs" });
  const refs = [report.waveCount.invalidationLevelId, ...report.paths.flatMap(p => [p.triggerLevelId, p.invalidationLevelId, ...p.targetIds,...(p.stress?[p.stress.triggerLevelId,...p.stress.targetIds]:[])]),
    report.setup.triggerLevelId, report.setup.retestLevelId, report.setup.invalidationLevelId, ...report.setup.targetIds, ...report.view.levelIds];
  if (refs.some(id => id !== null && !ids.has(id))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown level reference" });
  const pathIds = new Set(report.paths.map(p => p.id));
  if (pathIds.size !== report.paths.length || report.view.pathIds.some(id => !pathIds.has(id)) || (report.setup.pathId !== null && !pathIds.has(report.setup.pathId))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown or duplicate path reference" });
  const selected = report.paths.find(p => p.id === report.setup.pathId);
  if (selected && (selected.direction !== "up" || selected.triggerLevelId !== report.setup.triggerLevelId || report.setup.retestLevelId !== report.setup.triggerLevelId || selected.invalidationLevelId !== report.setup.invalidationLevelId || JSON.stringify(selected.targetIds) !== JSON.stringify(report.setup.targetIds))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Setup must match its plotted upside path" });
  const plan = report.tradePlan;
  if (plan) {
    if(report.decisionVersion==="decision-v5"&&plan.method!=="structure-v5"||report.decisionVersion==="decision-v4"&&plan.method!=="structure-v4"||report.decisionVersion==="decision-v3"&&plan.method!=="structure-v3"||report.decisionVersion==="decision-v2"&&["structure-v3","structure-v4","structure-v5"].includes(plan.method??""))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Entry calculation must match its saved decision version"});
    const path = report.paths.find(p => p.id === plan.pathId), level = (id: string | null) => report.levels.find(l => l.id === id)?.price;
    if ([plan.triggerLevelId, plan.invalidationLevelId, ...plan.targetIds].some(id => id !== null && !ids.has(id)) || (plan.pathId !== null && (!path || !report.view.pathIds.includes(plan.pathId)))) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Trade plan must use visible canonical levels and path"});
    if (path && ((path.direction === "up" && plan.side !== "long") || (path.direction === "down" && plan.side !== "short"))) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Trade plan direction must match its path"});
    if(path&&path.direction!=="range"&&(plan.triggerLevelId!==path.triggerLevelId||plan.invalidationLevelId!==path.invalidationLevelId||JSON.stringify(plan.targetIds)!==JSON.stringify(path.targetIds)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Directional plan must retain its path trigger, invalidation and targets"});
    if(plan.method?.startsWith("structure-")&&plan.side!=="none"&&(!plan.family||!plan.zone||plan.entryTimeframe!==report.entryStudy?.timeframe||plan.zone[0]>plan.zone[1]))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Structure-v2 needs a named family, measured zone and matching entry frame"});
    if(plan.method?.startsWith("structure-")&&[plan.confirmationTs,plan.retestTs].some(ts=>ts!==null&&!report.entryStudy?.candles.some(c=>c.ts===ts)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Entry signal times must identify saved entry-study candles"});
    if(plan.watchOnly&&(plan.state==="confirmed"||plan.referenceEntry!==null||plan.referenceStop!==null||plan.grossRewardRisk!==null||plan.retestTs!==null))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Watch references cannot claim observed entry, stop, reward or signal"});
    if(plan.entryObstacle){
      const obstacle=plan.entryObstacle,study=report.entryStudy,anchor=study?.pivots.find(a=>a.ts===obstacle.anchorTs&&a.price===obstacle.price&&a.kind===(plan.side==="long"?"high":"low"));
      if(!study||obstacle.timeframe!==study.timeframe||!anchor||anchor.confirmedAt===null||candleCloseTime(anchor.confirmedAt,study.timeframe)!==obstacle.knownAt||obstacle.knownAt>Date.parse(report.snapshot.observedAt))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Entry barrier must retain its confirmed entry-frame source and knowledge time"});
    }
    if (plan.side !== "none" && (!path || !plan.watchOnly&&(!plan.referenceEntry || !plan.referenceStop) || !plan.targetIds.length || !plan.triggerLevelId || !plan.invalidationLevelId)) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Directional research plan requires a path, observed entry/risk or explicit watch status, and targets"});
    if (plan.referenceEntry && plan.referenceStop) {
      const [lo,hi] = plan.referenceEntry, targets = plan.targetIds.map(id => level(id)!);
      if (lo > hi || (plan.side === "long" ? plan.referenceStop >= lo || targets.some(p => p <= hi) : plan.referenceStop <= hi || targets.some(p => p >= lo))) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Research plan prices must be ordered for its side"});
    }
    if (plan.state === "confirmed" && (!plan.confirmationTs || !plan.retestTs || plan.blockers.length || plan.grossRewardRisk === null || plan.grossRewardRisk < 1.5)) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Confirmed research plan requires observed confirmation and sufficient gross reward"});
    if(["structure-v4","structure-v5"].includes(plan.method??"")&&plan.side!=="none"){
      const route=report.strategy?.routes.find(r=>r.pathId===plan.pathId&&r.side===plan.side);
      if(plan.strategyId!==report.strategy?.id||!route||JSON.stringify(plan.targetIds)!==JSON.stringify(route.objectiveIds)||JSON.stringify(plan.checkpointIds)!==JSON.stringify(route.checkpointIds))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Strategy plan must retain its strategy objectives and intervening checkpoints"});
      if(plan.state==="confirmed"&&(!plan.structureConfirmationTs||!report.candles.some(c=>c.ts===plan.structureConfirmationTs)||(candleCloseTime(plan.structureConfirmationTs,report.snapshot.timeframe)??Infinity)>plan.confirmationTs!||plan.firstObstacleRewardRisk==null||plan.firstObstacleRewardRisk<1.5))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Strategy entry requires completed primary-frame confirmation and sufficient nearest-checkpoint reward"});
    }
    const entryPrice=plan.method?.startsWith("structure-")?report.entryStudy?.candles.at(-1)?.close:report.snapshot.price;
    if(plan.state==="confirmed"&&plan.referenceEntry&&(entryPrice==null||entryPrice<plan.referenceEntry[0]||entryPrice>plan.referenceEntry[1]||plan.retestTs!<=plan.confirmationTs!))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Confirmed research price must remain in its planned zone after a subsequent test"});
  }
  if (report.setup.state === "ready" && (!report.setup.entryZone || !report.setup.protectiveStop || report.setup.netRewardRisk === null || report.setup.netRewardRisk < 1.5 || report.setup.missing.length || !report.setup.retestTs || report.setup.protectiveStop >= report.setup.entryZone[0])) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ready setup requires observed protection, net reward and complete evidence" });
  const s=report.setup;
  if(s.entryZone && (s.entryZone[0]>s.entryZone[1] || !s.confirmationTs || !s.retestTs || s.retestTs<=s.confirmationTs))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Priced entry requires a subsequent observed retest"});
  if(s.state==="ready" && (s.costsBps===null || s.expiresAt===null || !selected || !report.view.pathIds.includes(selected.id)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Ready setup requires costs, expiry and a visible path"});
  if(s.state==="ready" && s.entryZone && (report.snapshot.price===null || report.snapshot.price<s.entryZone[0] || report.snapshot.price>s.entryZone[1]))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Ready price must remain inside the observed entry zone"});
  if(s.state==="ready" && (report.tier==="pro"||report.decisionVersion) && (report.context.status!=="available" || (report.decisionVersion?report.hierarchy?.find(r=>r.timeframe===report.context.timeframe)?.bias==="down":report.context.agreement==="conflicts"||report.context.agreement==="unknown")))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Ready setup requires available, non-conflicting context"});
  if(report.tier==="quick"&&report.view.pathIds.length>2)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Quick shows at most two material paths"});
  if (report.candles.some(c => !c.confirmed || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) || report.candles.some((c, i) => i > 0 && c.ts <= report.candles[i - 1].ts)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Chart requires valid chronological completed candles" });
});

/** The model selects and explains supplied candidates. It never prices a setup. */
export const GlobalNarrativeSchema = z.object({
  headline: z.string(), summary: z.string(), regime: z.enum(["trend_up", "trend_down", "range", "transition"]), bias: z.enum(["bullish", "bearish", "neutral"]), confidence: z.number().min(0).max(100),
  waveCandidateId: z.string().nullable(), mainPathId: z.string().nullable(), setupPathId: z.string().nullable(),
  reasons: z.array(z.string()), pathNotes: z.array(z.object({ pathId: z.string(), thesis: z.string() }).strict()).max(3),
  riskNotes: z.array(z.string()), limitations: z.array(z.string()), disclaimer: z.string(),
}).strict();
export type GlobalReport = z.infer<typeof GlobalReportSchema>;
export type GlobalCandle = z.infer<typeof GlobalCandleSchema>;
export type GlobalAnchor = z.infer<typeof GlobalAnchorSchema>;
export type GlobalLevel = z.infer<typeof GlobalLevelSchema>;
export type GlobalPath = z.infer<typeof GlobalPathSchema>;
export type GlobalNarrative = z.infer<typeof GlobalNarrativeSchema>;
export type GlobalFrame = z.infer<typeof GlobalFrameSchema>;
export type GlobalChannel = z.infer<typeof GlobalChannelSchema>;
export type GlobalRange = z.infer<typeof GlobalRangeSchema>;
