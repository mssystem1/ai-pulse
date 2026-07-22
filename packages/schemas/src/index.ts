import { z } from "zod";

export const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");

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
