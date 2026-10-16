import { z } from "zod";

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
});
export const GlobalReportSchema = z.object({
  version: z.literal("pulse-global-v3"), tier: z.enum(["quick", "pro"]), lang: z.enum(["en", "zh"]),
  evaluationVersion: z.literal("completed-v2").optional(),
  snapshot: z.object({ instId: z.string(), timeframe: z.string(), source: z.string(), venue: z.string(), priceCurrency: z.string(),
    observedAt: z.string(), lastCandleTs: time.nullable(), price: price.nullable(), pricePrecision: z.number().int().min(0).max(10), completedOnly: z.literal(true) }),
  candles: z.array(GlobalCandleSchema), levels: z.array(GlobalLevelSchema), waveCount: GlobalWaveSchema, paths: z.array(GlobalPathSchema).max(3),
  setup: GlobalSetupSchema, tradePlan: GlobalTradePlanSchema.optional(), indicators: GlobalIndicatorsSchema,
  context: z.object({ timeframe: z.string().nullable(), status: z.enum(["available", "unavailable", "not_requested"]), source: z.string().nullable(),
    candles: z.array(GlobalCandleSchema), sma55: z.array(seriesPoint), agreement: z.enum(["supports", "conflicts", "neutral", "unknown"]) }),
  narrative: z.object({ headline: z.string(), summary: z.string(), reasons: z.array(z.string()), riskNotes: z.array(z.string()), limitations: z.array(z.string()), disclaimer: z.string() }),
  view: z.object({ levelIds: z.array(z.string()), pathIds: z.array(z.string()), smaPeriods: z.array(z.number()), defaultLayers: z.array(z.string()) }),
}).superRefine((report, ctx) => {
  const ids = new Set(report.levels.map(level => level.id));
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
    const path = report.paths.find(p => p.id === plan.pathId), level = (id: string | null) => report.levels.find(l => l.id === id)?.price;
    if ([plan.triggerLevelId, plan.invalidationLevelId, ...plan.targetIds].some(id => id !== null && !ids.has(id)) || (plan.pathId !== null && (!path || !report.view.pathIds.includes(plan.pathId)))) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Trade plan must use visible canonical levels and path"});
    if (path && ((path.direction === "up" && plan.side !== "long") || (path.direction === "down" && plan.side !== "short"))) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Trade plan direction must match its path"});
    if(path&&path.direction!=="range"&&(plan.triggerLevelId!==path.triggerLevelId||plan.invalidationLevelId!==path.invalidationLevelId||JSON.stringify(plan.targetIds)!==JSON.stringify(path.targetIds)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Directional plan must retain its path trigger, invalidation and targets"});
    if (plan.side !== "none" && (!path || !plan.referenceEntry || !plan.referenceStop || !plan.targetIds.length || !plan.triggerLevelId || !plan.invalidationLevelId)) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Directional research plan requires a path, entry, risk reference and targets"});
    if (plan.referenceEntry && plan.referenceStop) {
      const [lo,hi] = plan.referenceEntry, targets = plan.targetIds.map(id => level(id)!);
      if (lo > hi || (plan.side === "long" ? plan.referenceStop >= lo || targets.some(p => p <= hi) : plan.referenceStop <= hi || targets.some(p => p >= lo))) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Research plan prices must be ordered for its side"});
    }
    if (plan.state === "confirmed" && (!plan.confirmationTs || !plan.retestTs || plan.blockers.length || plan.grossRewardRisk === null || plan.grossRewardRisk < 1.5)) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Confirmed research plan requires observed confirmation and sufficient gross reward"});
    if(plan.state==="confirmed"&&plan.referenceEntry&&(report.snapshot.price===null||report.snapshot.price<plan.referenceEntry[0]||report.snapshot.price>plan.referenceEntry[1]||plan.retestTs!<=plan.confirmationTs!))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Confirmed research price must remain in its planned zone after a subsequent retest"});
  }
  if (report.setup.state === "ready" && (!report.setup.entryZone || !report.setup.protectiveStop || report.setup.netRewardRisk === null || report.setup.netRewardRisk < 1.5 || report.setup.missing.length || !report.setup.retestTs || report.setup.protectiveStop >= report.setup.entryZone[0])) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ready setup requires observed protection, net reward and complete evidence" });
  const s=report.setup;
  if(s.entryZone && (s.entryZone[0]>s.entryZone[1] || !s.confirmationTs || !s.retestTs || s.retestTs<=s.confirmationTs))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Priced entry requires a subsequent observed retest"});
  if(s.state==="ready" && (s.costsBps===null || s.expiresAt===null || !selected || !report.view.pathIds.includes(selected.id)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Ready setup requires costs, expiry and a visible path"});
  if(s.state==="ready" && s.entryZone && (report.snapshot.price===null || report.snapshot.price<s.entryZone[0] || report.snapshot.price>s.entryZone[1]))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Ready price must remain inside the observed entry zone"});
  if(s.state==="ready" && report.tier==="pro" && (report.context.status!=="available" || report.context.agreement==="conflicts" || report.context.agreement==="unknown"))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Ready Pro setup requires available, non-conflicting context"});
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
