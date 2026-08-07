import { z } from "zod";

export const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");

export const AnalysisTierSchema = z.enum(["standard", "premium"]);
export const PolymarketIdSchema = z.string().min(1).max(256);
export const PredictionSelectionSchema = z.object({
  primaryMarketId: PolymarketIdSchema,
  additionalMarketIds: z.array(PolymarketIdSchema).max(7).default([]),
});
export const PredictionAnalysisRequestSchema = PredictionSelectionSchema.extend({
  lang: z.enum(["en", "zh"]).default("en"),
  userNote: z.string().max(500).optional(),
});
export const FusedAnalysisRequestSchema = PredictionAnalysisRequestSchema.extend({
  instId: z.string().min(1).max(64),
  timeframe: z.string().min(1).max(16).default("1H"),
});
export const DivergenceAnalysisRequestSchema = FusedAnalysisRequestSchema;
export const EventRiskPreflightRequestSchema = PredictionAnalysisRequestSchema.extend({
  intent: z.enum(["swap", "transfer", "approve", "hire_agent", "generic"]).default("generic"),
  tokenAddress: AddressSchema.optional(),
  walletAddress: AddressSchema.optional(),
  amount: z.string().optional(),
});

const RejectedPredictionMarketSchema = z.object({
  id: z.string(),
  reason: z.string(),
});
const PredictionContextReportSchema = z.object({
  selectionMode: z.literal("user"),
  primaryMarketId: z.string(),
  requestedAdditionalMarketIds: z.array(z.string()),
  usedMarketIds: z.array(z.string()),
  rejectedMarkets: z.array(RejectedPredictionMarketSchema),
  markets: z.array(z.record(z.string(), z.unknown())),
  partial: z.boolean(),
  missingSources: z.array(z.string()),
});
const GeneratedAnalysisSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(100),
  stance: z.enum(["YES", "NO", "NO_EDGE", "INSUFFICIENT_EVIDENCE"]),
  marketProbabilityPct: z.number().min(0).max(100),
  fairProbabilityRange: z.object({ low: z.number().min(0).max(100), high: z.number().min(0).max(100) }).strict().refine((value) => value.low <= value.high),
  decision: z.object({ action: z.enum(["CONSIDER_YES", "CONSIDER_NO", "WAIT", "AVOID"]), rationale: z.string() }).strict(),
  evidenceDrivers: z.array(z.string()).min(1), counterEvidence: z.array(z.string()).min(1),
  entryConditions: z.array(z.string()).min(1), noTradeConditions: z.array(z.string()).min(1),
  catalystsForYes: z.array(z.string()).min(1), catalystsForNo: z.array(z.string()).min(1), executionRisks: z.array(z.string()).min(1),
  limitations: z.array(z.string()),
  invalidationConditions: z.array(z.string()),
  disclaimer: z.string(),
  usage: z.object({ promptTokens: z.number().int().nonnegative(), completionTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative(), cachedTokens: z.number().int().nonnegative().optional().default(0), reasoningTokens: z.number().int().nonnegative().optional().default(0) }).optional(),
  fixture: z.literal(true).optional(),
}).strict();
const AiCostSchema = z.object({ promptTokens: z.number().int().nonnegative(), completionTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative(), cachedTokens: z.number().int().nonnegative().optional().default(0), reasoningTokens: z.number().int().nonnegative().optional().default(0), estimatedCostUsd: z.number().nonnegative(), pricingConfigured: z.boolean() });
export const AnalysisProfileSchema = z.object({
  mode: z.enum(["live", "fixture", "deterministic"]),
  model: z.string(),
  reasoningEffort: z.enum(["none", "low"]),
});

export const SpotGeneratedAnalysisSchema = z.object({
  headline: z.string(),
  regime: z.enum(["trend_up", "trend_down", "range", "transition"]),
  bias: z.enum(["bullish", "bearish", "neutral"]),
  confidence: z.number().min(0).max(100),
  summary: z.string(),
  keyLevels: z.object({ support: z.array(z.number()), resistance: z.array(z.number()) }).strict(),
  targets: z.array(z.object({ label: z.string(), price: z.number(), rationale: z.string() }).strict()),
  invalidation: z.object({ price: z.number().nullable(), condition: z.string() }).strict(),
  scenarios: z.array(z.object({
    name: z.enum(["bull", "base", "bear"]), thesis: z.string(),
    target: z.number().nullable(), invalidation: z.number().nullable(),
  }).strict()),
  chartNotes: z.string(),
  agentAction: z.string(),
  agentChecklist: z.array(z.string()),
  riskNotes: z.array(z.string()),
  limitations: z.array(z.string()),
  disclaimer: z.string(),
}).strict();

export const PredictionAnalysisResponseSchema = z.object({
  service: z.enum(["prediction_analysis_standard", "prediction_analysis_premium"]),
  tier: AnalysisTierSchema,
  predictionContext: PredictionContextReportSchema,
  analysis: GeneratedAnalysisSchema,
  aiCost: AiCostSchema.optional(),
  analysisProfile: AnalysisProfileSchema,
  methodology_version: z.string(),
  generatedAt: z.string().datetime(),
});

export const FusionFeaturesSchema = z.object({
  spotDirection: z.enum(["bullish", "bearish", "neutral"]),
  predictionDirection: z.enum(["rising", "falling", "flat", "unknown"]),
  agreement: z.enum(["agreement", "divergence", "neutral", "incompatible"]),
  divergenceStrength: z.number().min(0).max(100),
  horizonCompatibility: z.enum(["high", "medium", "low", "unknown"]),
});

export const FusedAnalysisResponseSchema = z.object({
  service: z.enum(["fused_analysis_standard", "fused_analysis_premium"]),
  tier: AnalysisTierSchema,
  instId: z.string(),
  timeframe: z.string(),
  market: z.record(z.string(), z.unknown()),
  predictionContext: PredictionContextReportSchema,
  fusion: FusionFeaturesSchema,
  analysis: GeneratedAnalysisSchema,
  aiCost: AiCostSchema.optional(),
  analysisProfile: AnalysisProfileSchema,
  methodology_version: z.string(),
  generatedAt: z.string().datetime(),
});

export const DivergenceAnalysisResponseSchema = FusedAnalysisResponseSchema.omit({ analysis: true, tier: true })
  .extend({ service: z.literal("divergence_analysis") });

export const EventRiskPreflightResponseSchema = z.object({
  service: z.literal("event_risk_preflight"),
  predictionContext: PredictionContextReportSchema,
  eventRisk: z.object({
    verdict: z.enum(["PASS", "WARN", "FAIL"]),
    score: z.number().min(0).max(100),
    reasons: z.array(z.string()),
  }),
  analysisProfile: AnalysisProfileSchema,
  methodology_version: z.string(),
  generatedAt: z.string().datetime(),
});

export const ChainIdSchema = z.enum(["196", "1", "56", "137", "8453", "42161"]).default("196");

export const ResolveRequestSchema = z.object({
  query: z.string().min(1).max(128),
  chainId: ChainIdSchema.optional(),
});

export const TokenScanRequestSchema = z.object({
  address: AddressSchema,
  chainId: ChainIdSchema.optional(),
});

export const WalletScanRequestSchema = z.object({
  address: AddressSchema,
  chainId: ChainIdSchema.optional(),
});

export const MarketPulseRequestSchema = z.object({
  address: AddressSchema.optional(),
  symbol: z.string().min(1).max(32).optional(),
  chainId: ChainIdSchema.optional(),
}).refine((v) => Boolean(v.address || v.symbol), {
  message: "Provide address or symbol",
});

export const SwapQuoteRequestSchema = z.object({
  fromToken: AddressSchema,
  toToken: AddressSchema,
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Amount must be a decimal string"),
  chainId: ChainIdSchema.optional(),
  slippageBps: z.number().int().min(1).max(5000).optional().default(50),
});

export const PreflightRequestSchema = z.object({
  intent: z.enum(["swap", "transfer", "approve", "hire_agent", "generic"]).default("generic"),
  tokenAddress: AddressSchema.optional(),
  walletAddress: AddressSchema.optional(),
  counterparty: AddressSchema.optional(),
  fromToken: AddressSchema.optional(),
  toToken: AddressSchema.optional(),
  amount: z.string().optional(),
  chainId: ChainIdSchema.optional(),
  notes: z.string().max(500).optional(),
});

export const RiskGradeSchema = z.enum(["A", "B", "C", "D", "F"]);
export const VerdictSchema = z.enum(["PASS", "WARN", "FAIL"]);

export const ComponentScoreSchema = z.object({
  key: z.string(),
  label: z.string(),
  score: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
  reason: z.string(),
});

export const TokenScanResponseSchema = z.object({
  service: z.literal("token_scan"),
  methodology_version: z.string(),
  chainId: z.string(),
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  riskScore: z.number().min(0).max(100),
  grade: RiskGradeSchema,
  verdict: VerdictSchema,
  components: z.array(ComponentScoreSchema),
  flags: z.array(z.string()),
  liquidityUsd: z.number(),
  holdersEstimate: z.number(),
  contractAgeDays: z.number(),
  isVerified: z.boolean(),
  limitations: z.array(z.string()),
  generatedAt: z.string(),
});

export const WalletScanResponseSchema = z.object({
  service: z.literal("wallet_scan"),
  methodology_version: z.string(),
  chainId: z.string(),
  address: z.string(),
  riskScore: z.number().min(0).max(100),
  grade: RiskGradeSchema,
  verdict: VerdictSchema,
  components: z.array(ComponentScoreSchema),
  labels: z.array(z.string()),
  txCountEstimate: z.number(),
  ageDays: z.number(),
  nativeBalance: z.string(),
  limitations: z.array(z.string()),
  generatedAt: z.string(),
});

export const MarketPulseResponseSchema = z.object({
  service: z.literal("market_pulse"),
  methodology_version: z.string(),
  chainId: z.string(),
  address: z.string(),
  symbol: z.string(),
  priceUsd: z.number(),
  change24hPct: z.number(),
  volume24hUsd: z.number(),
  liquidityUsd: z.number(),
  momentum: z.enum(["hot", "warm", "cold", "frozen"]),
  pulseScore: z.number().min(0).max(100),
  summary: z.string(),
  limitations: z.array(z.string()),
  generatedAt: z.string(),
});

export const SwapQuoteResponseSchema = z.object({
  service: z.literal("swap_quote"),
  methodology_version: z.string(),
  chainId: z.string(),
  fromToken: z.string(),
  toToken: z.string(),
  amountIn: z.string(),
  amountOut: z.string(),
  amountOutMin: z.string(),
  priceImpactBps: z.number(),
  route: z.array(z.string()),
  gasEstimate: z.string(),
  qualityScore: z.number().min(0).max(100),
  verdict: VerdictSchema,
  notes: z.array(z.string()),
  limitations: z.array(z.string()),
  generatedAt: z.string(),
});

export const PreflightResponseSchema = z.object({
  service: z.literal("preflight"),
  methodology_version: z.string(),
  intent: z.string(),
  chainId: z.string(),
  overallScore: z.number().min(0).max(100),
  grade: RiskGradeSchema,
  verdict: VerdictSchema,
  headline: z.string(),
  checklist: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum(["pass", "warn", "fail", "skip"]),
      detail: z.string(),
    }),
  ),
  token: TokenScanResponseSchema.optional(),
  wallet: WalletScanResponseSchema.optional(),
  market: MarketPulseResponseSchema.optional(),
  quote: SwapQuoteResponseSchema.optional(),
  recommendations: z.array(z.string()),
  shareId: z.string(),
  limitations: z.array(z.string()),
  generatedAt: z.string(),
});

export const ResolveResponseSchema = z.object({
  service: z.literal("resolve"),
  query: z.string(),
  matches: z.array(
    z.object({
      address: z.string(),
      symbol: z.string(),
      name: z.string(),
      chainId: z.string(),
      kind: z.enum(["token", "native", "stable", "unknown"]),
    }),
  ),
  generatedAt: z.string(),
});

export type ResolveRequest = z.infer<typeof ResolveRequestSchema>;
export type TokenScanRequest = z.infer<typeof TokenScanRequestSchema>;
export type WalletScanRequest = z.infer<typeof WalletScanRequestSchema>;
export type MarketPulseRequest = z.infer<typeof MarketPulseRequestSchema>;
export type SwapQuoteRequest = z.infer<typeof SwapQuoteRequestSchema>;
export type PreflightRequest = z.infer<typeof PreflightRequestSchema>;
export type TokenScanResponse = z.infer<typeof TokenScanResponseSchema>;
export type WalletScanResponse = z.infer<typeof WalletScanResponseSchema>;
export type MarketPulseResponse = z.infer<typeof MarketPulseResponseSchema>;
export type SwapQuoteResponse = z.infer<typeof SwapQuoteResponseSchema>;
export type PreflightResponse = z.infer<typeof PreflightResponseSchema>;
export type ResolveResponse = z.infer<typeof ResolveResponseSchema>;
export type RiskGrade = z.infer<typeof RiskGradeSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type PredictionAnalysisRequest = z.infer<typeof PredictionAnalysisRequestSchema>;
export type FusedAnalysisRequest = z.infer<typeof FusedAnalysisRequestSchema>;
export type DivergenceAnalysisRequest = z.infer<typeof DivergenceAnalysisRequestSchema>;
export type EventRiskPreflightRequest = z.infer<typeof EventRiskPreflightRequestSchema>;
export type PredictionAnalysisResponse = z.infer<typeof PredictionAnalysisResponseSchema>;
export type FusedAnalysisResponse = z.infer<typeof FusedAnalysisResponseSchema>;
export type DivergenceAnalysisResponse = z.infer<typeof DivergenceAnalysisResponseSchema>;
export type EventRiskPreflightResponse = z.infer<typeof EventRiskPreflightResponseSchema>;
