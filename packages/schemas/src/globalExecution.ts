import { z } from "zod";

/** A saved execution contract, independent from when its report is rendered. */
export const GlobalExecutionPolicySchema = z.object({
  version: z.literal("execution-policy-v1"),
  id: z.string().min(1),
  configurationKey: z.string().min(1),
  mode: z.enum(["passive_limit", "confirmed_retest"]),
  family: z.enum(["range_rotation", "ema_pullback", "vwap_reversion", "breakout_retest", "level_retest"]),
  sourceBoundary: z.number().finite().positive(),
  eventTimeframe: z.string().min(1),
  eventKnownAt: z.number().finite().nonnegative(),
  eventAfter: z.number().finite().nonnegative(),
  expiresAt: z.number().finite().positive(),
  confirmationBars: z.union([z.literal(1), z.literal(2)]),
  fillWindowBars: z.number().int().positive(),
  stopManagement: z.literal("structural_fixed"),
  targetAllocations: z.array(z.number().finite().positive().max(1)).min(1).max(3),
  entryRegion: z.enum(["source_zone", "defended_retest"]),
}).superRefine((p, ctx) => {
  if (p.expiresAt <= Math.max(p.eventAfter, p.eventKnownAt) || Math.abs(p.targetAllocations.reduce((a, b) => a + b, 0) - 1) > 1e-9) {
    ctx.addIssue({ code: "custom", message: "Execution policies require causal event times, a later expiry and complete target allocations" });
  }
});

export type GlobalExecutionPolicy = z.infer<typeof GlobalExecutionPolicySchema>;
