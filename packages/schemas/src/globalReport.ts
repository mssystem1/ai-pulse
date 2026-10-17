import { z } from "zod";
import {candleCloseTime} from "./candleTimeframe.js";

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
  method: z.enum(["structure-v2","structure-v3","structure-v4"]).optional(),
  strategyId:z.enum(["fast","intraday","swing","position","macro"]).optional(),checkpointIds:z.array(z.string()).optional(),firstObstacleRewardRisk:z.number().finite().nonnegative().nullable().optional(),structureConfirmationTs:time.nullable().optional(),
  family: z.enum(["breakout_retest","support_bounce","resistance_rejection","range_buy","range_sell"]).optional(),
  entryTimeframe: z.string().optional(), zone: z.tuple([price,price]).optional(),
  stopBasis: z.string().optional(), evidenceKind: z.enum(["held_retest","follow_through"]).optional(),
  signalExpiresAt: time.nullable().optional(),
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
  rsi: z.object({ period: z.literal(14), points: z.array(seriesPoint) }),
  atr: z.object({ period: z.literal(14), points: z.array(seriesPoint) }),
  volumeRatio: z.number().finite().nonnegative().nullable(),
  regression: z.object({ bars: z.literal(120), residualSigma: z.number().finite().nonnegative(), mid: z.array(seriesPoint), upper: z.array(seriesPoint), lower: z.array(seriesPoint) }).nullable(),
  fibonacci: z.array(z.object({ ratio: z.number(), price, anchorIds: z.tuple([z.string(), z.string()]) })),
  vwap: z.object({ anchorId: z.string(), points: z.array(seriesPoint) }).nullable(),
  pivots: z.array(GlobalAnchorSchema),
  channel: z.object({ lower: z.tuple([GlobalAnchorSchema, GlobalAnchorSchema]), upper: z.tuple([GlobalAnchorSchema, GlobalAnchorSchema]) }).nullable(),
  channels:z.array(GlobalChannelSchema).max(2).optional(),
});
export const GlobalFrameSchema = z.object({
  timeframe:z.string(), status:z.enum(["available","unavailable"]), source:z.string().nullable(),
  observedAt:z.string(), completedAt:time.nullable(), price:price.nullable(), sma55:price.nullable(), smaChange:z.number().finite().nullable(),
  structure:z.enum(["up","down","range","mixed"]), bias:z.enum(["up","down","range","mixed"]), candles:z.number().int().nonnegative(),
});
export const GlobalReportSchema = z.object({
  version: z.literal("pulse-global-v3"), tier: z.enum(["quick", "pro"]), lang: z.enum(["en", "zh"]),
  evaluationVersion: z.literal("completed-v2").optional(),
  decisionVersion:z.enum(["decision-v1","decision-v2","decision-v3","decision-v4"]).optional(), hierarchy:z.array(GlobalFrameSchema).max(7).optional(),
  strategy:z.object({version:z.literal("horizon-v1"),id:z.enum(["fast","intraday","swing","position","macro"]),name:z.string(),holding:z.string(),entryTimeframe:z.string(),lookbackBars:z.number().int().positive(),majorSwingAtr:z.number().nonnegative(),minimumObjectiveAtr:z.number().positive(),routes:z.array(z.object({pathId:z.string(),side:z.enum(["long","short"]),protectionLevelId:z.string().nullable(),objectiveIds:z.array(z.string()),checkpointIds:z.array(z.string())}))}).optional(),
  entryStudy:GlobalEntryStudySchema.optional(),range:GlobalRangeSchema.nullable().optional(),
  snapshot: z.object({ instId: z.string(), timeframe: z.string(), source: z.string(), venue: z.string(), priceCurrency: z.string(),
    observedAt: z.string(), lastCandleTs: time.nullable(), price: price.nullable(), pricePrecision: z.number().int().min(0).max(10), completedOnly: z.literal(true) }),
  candles: z.array(GlobalCandleSchema), levels: z.array(GlobalLevelSchema), waveCount: GlobalWaveSchema, paths: z.array(GlobalPathSchema).max(3),
  setup: GlobalSetupSchema, tradePlan: GlobalTradePlanSchema.optional(), indicators: GlobalIndicatorsSchema,
  context: z.object({ timeframe: z.string().nullable(), status: z.enum(["available", "unavailable", "not_requested"]), source: z.string().nullable(),
    candles: z.array(GlobalCandleSchema), sma55: z.array(seriesPoint), agreement: z.enum(["supports", "conflicts", "neutral", "unknown"]) }),
  narrative: z.object({ headline: z.string(), summary: z.string(), reasons: z.array(z.string()), riskNotes: z.array(z.string()), limitations: z.array(z.string()), disclaimer: z.string() }),
  view: z.object({ levelIds: z.array(z.string()), pathIds: z.array(z.string()), smaPeriods: z.array(z.number()), defaultLayers: z.array(z.string()) }),
}).superRefine((report, ctx) => {
  if(report.decisionVersion){
    const rows=report.hierarchy??[];
    if(!rows.some(row=>row.timeframe===report.snapshot.timeframe)||new Set(rows.map(r=>r.timeframe)).size!==rows.length||rows.some(r=>r.observedAt!==report.snapshot.observedAt||r.source!==null&&r.source!==report.snapshot.source||r.completedAt!==null&&r.completedAt>Date.parse(report.snapshot.observedAt)||r.status==="available"&&(r.candles<55||r.price===null||r.sma55===null)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Decision hierarchy must retain one source, cutoff and evidenced completed frames"});
  }
  const ids = new Set(report.levels.map(level => level.id));
  if(report.decisionVersion==="decision-v4"&&report.strategy){
    const profiles:Record<string,[string,string]>={"15m":["fast","5m"],"1H":["intraday","15m"],"4H":["swing","1H"],"1D":["position","4H"],"1W":["macro","1Dutc"]},expected=profiles[report.snapshot.timeframe.replace(/utc$/i,"")];
    if(!expected||report.strategy.id!==expected[0]||report.strategy.entryTimeframe!==expected[1])ctx.addIssue({code:z.ZodIssueCode.custom,message:"Strategy and timing must match the primary timeframe profile"});
    if(report.candles.some(c=>(candleCloseTime(c.ts,report.snapshot.timeframe)??Infinity)>Date.parse(report.snapshot.observedAt)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Strategy structure must use completed primary-frame evidence"});
    for(const r of report.strategy.routes){
      const sign=r.side==="long"?1:-1,prices=r.objectiveIds.map(id=>report.levels.find(l=>l.id===id)?.price);
      if(r.objectiveIds.some(id=>r.checkpointIds.includes(id))||prices.some((p,i)=>p===undefined||i>0&&(prices[i-1]===undefined||sign*(p-prices[i-1]!)<=0))||r.objectiveIds.some(id=>{const l=report.levels.find(l=>l.id===id);return l&&(!l.anchorIds.some(id=>report.indicators.pivots.some(a=>a.id===id&&a.confirmedAt!==null))||l.basis!=="swing");}))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Strategy objectives require ordered confirmed primary swings, distinct from checkpoints"});
    }
  }
  if(report.decisionVersion==="decision-v4"&&(!report.strategy||report.strategy.entryTimeframe!==report.entryStudy?.timeframe||report.strategy.routes.some(r=>!report.paths.some(p=>p.id===r.pathId)||[r.protectionLevelId,...r.objectiveIds,...r.checkpointIds].some(id=>id!==null&&!ids.has(id)))))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Strategy reports require a matching horizon, entry frame and canonical objective/checkpoint map"});
  if(["decision-v2","decision-v3","decision-v4"].includes(report.decisionVersion??"")){
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
    if(report.decisionVersion==="decision-v4"&&plan.method!=="structure-v4"||report.decisionVersion==="decision-v3"&&plan.method!=="structure-v3"||report.decisionVersion==="decision-v2"&&["structure-v3","structure-v4"].includes(plan.method??""))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Entry calculation must match its saved decision version"});
    const path = report.paths.find(p => p.id === plan.pathId), level = (id: string | null) => report.levels.find(l => l.id === id)?.price;
    if ([plan.triggerLevelId, plan.invalidationLevelId, ...plan.targetIds].some(id => id !== null && !ids.has(id)) || (plan.pathId !== null && (!path || !report.view.pathIds.includes(plan.pathId)))) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Trade plan must use visible canonical levels and path"});
    if (path && ((path.direction === "up" && plan.side !== "long") || (path.direction === "down" && plan.side !== "short"))) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Trade plan direction must match its path"});
    if(path&&path.direction!=="range"&&(plan.triggerLevelId!==path.triggerLevelId||plan.invalidationLevelId!==path.invalidationLevelId||JSON.stringify(plan.targetIds)!==JSON.stringify(path.targetIds)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Directional plan must retain its path trigger, invalidation and targets"});
    if(plan.method?.startsWith("structure-")&&plan.side!=="none"&&(!plan.family||!plan.zone||plan.entryTimeframe!==report.entryStudy?.timeframe||plan.zone[0]>plan.zone[1]))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Structure-v2 needs a named family, measured zone and matching entry frame"});
    if(plan.method?.startsWith("structure-")&&[plan.confirmationTs,plan.retestTs].some(ts=>ts!==null&&!report.entryStudy?.candles.some(c=>c.ts===ts)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Entry signal times must identify saved entry-study candles"});
    if (plan.side !== "none" && (!path || !plan.referenceEntry || !plan.referenceStop || !plan.targetIds.length || !plan.triggerLevelId || !plan.invalidationLevelId)) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Directional research plan requires a path, entry, risk reference and targets"});
    if (plan.referenceEntry && plan.referenceStop) {
      const [lo,hi] = plan.referenceEntry, targets = plan.targetIds.map(id => level(id)!);
      if (lo > hi || (plan.side === "long" ? plan.referenceStop >= lo || targets.some(p => p <= hi) : plan.referenceStop <= hi || targets.some(p => p >= lo))) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Research plan prices must be ordered for its side"});
    }
    if (plan.state === "confirmed" && (!plan.confirmationTs || !plan.retestTs || plan.blockers.length || plan.grossRewardRisk === null || plan.grossRewardRisk < 1.5)) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Confirmed research plan requires observed confirmation and sufficient gross reward"});
    if(plan.method==="structure-v4"&&plan.side!=="none"){
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
