import { z } from "zod";

const time = z.number().finite().nonnegative();
const price = z.number().finite().positive();
const zone = z.tuple([price, price]);

/** Immutable priced rules for one research scenario, not an order record. */
export const GlobalScenarioDefinitionSchema = z.object({
  version: z.literal("scenario-definition-v1"),
  scenarioId: z.string().min(1), revisionId: z.string().min(1),
  market: z.string().min(1), timeframe: z.string().min(1),
  family: z.enum(["range_rotation", "ema_pullback", "vwap_reversion", "breakout_retest", "level_retest"]),
  side: z.enum(["long", "short"]), policyId: z.string().min(1), configurationKey: z.string().min(1),
  sourceKey: z.string().min(1), sourceKnownAt: time, sourceTimeframe: z.string().min(1),
  sourceLower: price, sourceUpper: price, sourcePrice: price, createdAt: time,
  stopBasis: z.object({ price, timeframe: z.string().min(1), anchorTs: time, knownAt: time }),
  mode: z.enum(["passive_limit", "confirmed_retest"]),
  entryZone: zone, hardStop: price,
  targets: z.array(z.object({ id: z.string().min(1), lower: price, upper: price, allocation: z.number().finite().positive().max(1) })).min(1).max(3),
  sourceBoundary: price, eventTimeframe: z.string().min(1), eventAfter: time, eventKnownAt: time,
  expiresAt: time, confirmationMaxAgeMs: z.number().finite().positive(), fillWindowMs: z.number().finite().positive(),
  confirmationBars: z.union([z.literal(1), z.literal(2)]),
}).superRefine((d, ctx) => {
  const sign = d.side === "long" ? 1 : -1;
  if (d.entryZone[0] > d.entryZone[1] || d.sourceLower > d.sourceUpper || d.eventAfter < d.sourceKnownAt || d.sourceKnownAt > d.createdAt || d.eventKnownAt > d.createdAt || d.stopBasis.knownAt > d.createdAt || d.expiresAt <= d.createdAt ||
      sign * ((d.side === "long" ? d.entryZone[0] : d.entryZone[1]) - d.hardStop) <= 0 ||
      d.targets.some(t => t.lower > t.upper || sign * ((d.side === "long" ? t.lower : t.upper) - (d.side === "long" ? d.entryZone[1] : d.entryZone[0])) <= 0) ||
      Math.abs(d.targets.reduce((sum, t) => sum + t.allocation, 0) - 1) > 1e-8) {
    ctx.addIssue({ code: "custom", message: "Scenario rules require causal clocks, ordered prices, structural protection and complete target allocations" });
  }
});

export const GlobalScenarioEventSchema = z.object({
  id: z.string().min(1), kind: z.enum(["location_test", "acceptance", "confirmation", "entry_touch", "invalidation", "target_touch", "stop_touch", "failed_retest"]),
  at: time, basis: z.enum(["completed_candle", "reported_event"]),
  candleTs: time.optional(), price: price.optional(), targetId: z.string().optional(),
});

/** Price observations are deliberately separate from exchange fills/PnL. */
export const GlobalScenarioSchema = z.object({
  version: z.literal("scenario-lifecycle-v1"), scenarioId: z.string().min(1), revisionId: z.string().min(1),
  state: z.enum(["awaiting_location", "awaiting_event", "confirmed_awaiting_fill", "entry_observed", "invalidated", "expired", "completed"]),
  startedAt: time, updatedAt: time, expiresAt: time,
  observationOnly: z.literal(true), definition: GlobalScenarioDefinitionSchema,
  confirmationAt: time.optional(), entryObservedAt: time.optional(), lastEventAt: time.optional(),
  reason: z.string().optional(), events: z.array(GlobalScenarioEventSchema).max(256),
  exits: z.array(z.object({ targetId: z.string(), at: time, allocation: z.number().positive().max(1) })).max(3),
  remainingFraction: z.number().min(0).max(1),
  outcome: z.object({ kind: z.enum(["target_observed", "stop_observed", "ambiguous_bar"]), at: time, targetId: z.string().optional() }).optional(),
}).superRefine((s, ctx) => {
  if (s.scenarioId !== s.definition.scenarioId || s.revisionId !== s.definition.revisionId || s.startedAt !== s.definition.createdAt ||
      s.expiresAt !== s.definition.expiresAt || s.updatedAt < s.startedAt ||
      s.events.some(e => e.at > s.updatedAt) || s.confirmationAt !== undefined && s.confirmationAt > s.updatedAt ||
      s.entryObservedAt !== undefined && s.entryObservedAt < s.startedAt) {
    ctx.addIssue({ code: "custom", message: "Scenario state must retain its immutable rules and causal observation times" });
  }
});

export type GlobalScenarioDefinition = z.infer<typeof GlobalScenarioDefinitionSchema>;
export type GlobalScenarioEvent = z.infer<typeof GlobalScenarioEventSchema>;
export type GlobalScenario = z.infer<typeof GlobalScenarioSchema>;
