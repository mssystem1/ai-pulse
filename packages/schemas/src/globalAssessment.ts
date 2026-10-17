import { z } from "zod";

/** Separate from the purchased report. No provider narrative or wallet data. */
export const GlobalAssessmentSchema = z.object({
  version: z.literal("pulse-global-assessment-v1"),
  sourceRef: z.string(), sourceObservedAt: z.string(), assessedAt: z.string(),
  instId: z.string(), timeframe: z.string(), priceCurrency: z.string(),
  state: z.enum(["no_trade","invalidated","expired","waiting_confirmation","waiting_retest","technical_valid"]),
  side: z.enum(["long","short","none"]), pathId: z.string().nullable(),
  lastCompletedClose: z.number().finite().positive().nullable(), lastCompletedAt: z.number().finite().nullable(),
  confirmationTs: z.number().finite().nullable(), retestTs: z.number().finite().nullable(),
  retestDeadline: z.number().finite().nullable(), expiresAt: z.number().finite().nullable(),
  permittedEntry: z.tuple([z.number().finite().positive(),z.number().finite().positive()]).nullable(),
  observedStop: z.number().finite().positive().nullable(), targets: z.array(z.number().finite().positive()),
  grossRewardRisk: z.number().finite().nullable(), stopDistancePercent: z.number().finite().nullable(), stopDistanceAtr: z.number().finite().nullable(),
  context: z.enum(["supports","conflicts","neutral","unknown"]),
  analysisTimeframe:z.string().optional(),entryTimeframe:z.string().optional(),family:z.string().optional(),
  strategyId:z.string().optional(),structureConfirmationTs:z.number().finite().nullable().optional(),checkpointTargets:z.array(z.number().finite().positive()).optional(),firstObstacleRewardRisk:z.number().finite().nullable().optional(),
  blockers: z.array(z.string()), lines: z.array(z.string()),
});
export type GlobalAssessment = z.infer<typeof GlobalAssessmentSchema>;
