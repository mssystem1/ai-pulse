import type { SpotMarketContext } from "@pulse/market";
import type { GlobalReport } from "@pulse/schemas";
import type { globalCompatibility } from "./globalReport.js";
import { type AnalysisLang, type AnalysisTier } from "./prompts.js";

export type GrokConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
};

export type AnalysisReasoningEffort = "none" | "low" | "medium";

export type AnalysisRequest = {
  instId: string;
  timeframe?: string;
  tier: AnalysisTier;
  lang?: AnalysisLang;
  /** @deprecated Chart screenshots removed — analysis uses OKX OHLCV only */
  chartImageBase64?: string;
  chartImageMime?: string;
  userNote?: string;
  candleLimit?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  reasoningEffort?: AnalysisReasoningEffort;
  contextMarket?: SpotMarketContext | null;
  hierarchyMarkets?: SpotMarketContext[];
};

export type AnalysisResult = {
  service: "analysis_base" | "analysis_premium";
  tier: AnalysisTier;
  instId: string;
  timeframe: string;
  model: string;
  lang: AnalysisLang;
  market: {
    ticker: unknown;
    summary: unknown;
    bar: string;
    candleCount: number;
    source: string;
  };
  analysis: Record<string, unknown>;
  global: GlobalReport;
  technical: ReturnType<typeof globalCompatibility>["technical"];
  executionPlan: ReturnType<typeof globalCompatibility>["executionPlan"];
  chart: { source: string; timeframe: string; candles: GlobalReport["candles"] };
  rawText?: string;
  generatedAt: string;
  methodology_version: string;
  usage?: Readonly<{ promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number; reasoningTokens: number }>;
  analysisProfile: Readonly<{ mode: "live"; model: string; reasoningEffort: AnalysisReasoningEffort }>;
};

export const SPOT_OUTPUT_TOKEN_FLOORS = Object.freeze({ base: 4096, premium: 8192 });

export function spotOutputTokenLimit(tier: AnalysisTier, configured?: number): number {
  const requested = Number.isFinite(configured) ? Math.max(0, Number(configured)) : 0;
  return Math.max(SPOT_OUTPUT_TOKEN_FLOORS[tier], requested);
}

export { runGrokAnalysis, runPreparedSpotAnalysis } from "./globalGrok.js";
