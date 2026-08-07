import type { GrokConfig } from "./grok.js";
import type { SpotMarketContext } from "@pulse/market";
import type { PreparedPredictionContext } from "./predictionContext.js";
import type { FusionFeatures } from "./predictionFeatures.js";

const V5_ANALYSIS_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    headline: { type: "string" }, summary: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 100 },
    stance: { type: "string", enum: ["YES", "NO", "NO_EDGE", "INSUFFICIENT_EVIDENCE"] },
    marketProbabilityPct: { type: "number", minimum: 0, maximum: 100 },
    fairProbabilityRange: { type: "object", additionalProperties: false, properties: { low: { type: "number", minimum: 0, maximum: 100 }, high: { type: "number", minimum: 0, maximum: 100 } }, required: ["low", "high"] },
    decision: { type: "object", additionalProperties: false, properties: { action: { type: "string", enum: ["CONSIDER_YES", "CONSIDER_NO", "WAIT", "AVOID"] }, rationale: { type: "string" } }, required: ["action", "rationale"] },
    evidenceDrivers: { type: "array", items: { type: "string" }, minItems: 1 },
    counterEvidence: { type: "array", items: { type: "string" }, minItems: 1 },
    entryConditions: { type: "array", items: { type: "string" }, minItems: 1 },
    noTradeConditions: { type: "array", items: { type: "string" }, minItems: 1 },
    catalystsForYes: { type: "array", items: { type: "string" }, minItems: 1 },
    catalystsForNo: { type: "array", items: { type: "string" }, minItems: 1 },
    executionRisks: { type: "array", items: { type: "string" }, minItems: 1 },
    limitations: { type: "array", items: { type: "string" }, minItems: 1 },
    invalidationConditions: { type: "array", items: { type: "string" }, minItems: 1 },
    disclaimer: { type: "string" },
  },
  required: ["headline", "summary", "confidence", "stance", "marketProbabilityPct", "fairProbabilityRange", "decision", "evidenceDrivers", "counterEvidence", "entryConditions", "noTradeConditions", "catalystsForYes", "catalystsForNo", "executionRisks", "limitations", "invalidationConditions", "disclaimer"],
} as const;

export type V5Mode = "prediction" | "fused";
export type V5Tier = "standard" | "premium";

/** Compact model input while preserving full raw evidence in the report. */
export function buildFusedAiContext(input: {
  market: SpotMarketContext;
  predictionContext: PreparedPredictionContext;
  fusion: FusionFeatures;
}) {
  return {
    market: {
      source: input.market.source,
      instId: input.market.instId,
      bar: input.market.bar,
      ticker: input.market.ticker,
      summary: input.market.summary,
      recentCandles: input.market.candles.slice(-32),
      fetchedAt: input.market.fetchedAt,
    },
    predictionContext: {
      selectionMode: input.predictionContext.selectionMode,
      primaryMarketId: input.predictionContext.primaryMarketId,
      requestedAdditionalMarketIds: input.predictionContext.requestedAdditionalMarketIds,
      usedMarketIds: input.predictionContext.usedMarketIds,
      rejectedMarkets: input.predictionContext.rejectedMarkets,
      markets: input.predictionContext.markets.map((entry) => ({
        market: {
          id: entry.market.id,
          conditionId: entry.market.conditionId,
          question: entry.market.question,
          resolutionSource: entry.market.resolutionSource,
          active: entry.market.active,
          closed: entry.market.closed,
          archived: entry.market.archived,
          restricted: entry.market.restricted,
          endDate: entry.market.endDate,
          volumeUsd: entry.market.volumeUsd,
          liquidityUsd: entry.market.liquidityUsd,
          eligibility: entry.market.eligibility,
        },
        outcomes: entry.outcomes.map((outcome) => ({ name: outcome.name, tokenId: outcome.tokenId, features: outcome.features })),
        openInterest: entry.openInterest,
        partial: entry.partial,
        missingSources: entry.missingSources,
      })),
      partial: input.predictionContext.partial,
      missingSources: input.predictionContext.missingSources,
      observedAt: input.predictionContext.observedAt,
    },
    fusion: input.fusion,
  };
}

export type V5GeneratedAnalysis = Readonly<{
  headline: string;
  summary: string;
  confidence: number;
  stance: "YES" | "NO" | "NO_EDGE" | "INSUFFICIENT_EVIDENCE";
  marketProbabilityPct: number;
  fairProbabilityRange: Readonly<{ low: number; high: number }>;
  decision: Readonly<{ action: "CONSIDER_YES" | "CONSIDER_NO" | "WAIT" | "AVOID"; rationale: string }>;
  evidenceDrivers: readonly string[]; counterEvidence: readonly string[];
  entryConditions: readonly string[]; noTradeConditions: readonly string[];
  catalystsForYes: readonly string[]; catalystsForNo: readonly string[]; executionRisks: readonly string[];
  limitations: readonly string[];
  invalidationConditions: readonly string[];
  disclaimer: string;
  usage?: Readonly<{ promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number; reasoningTokens: number }>;
  [key: string]: unknown;
}>;

function parseAnalysis(text: string): V5GeneratedAnalysis {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const value = JSON.parse(cleaned) as Record<string, unknown>;
  const allowed = new Set(["headline", "summary", "confidence", "stance", "marketProbabilityPct", "fairProbabilityRange", "decision", "evidenceDrivers", "counterEvidence", "entryConditions", "noTradeConditions", "catalystsForYes", "catalystsForNo", "executionRisks", "limitations", "invalidationConditions", "disclaimer"]);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`Grok V5 response contains unsupported fields: ${unexpected.join(", ")}`);
  if (typeof value.headline !== "string" || typeof value.summary !== "string") {
    throw new Error("Grok V5 response is missing headline or summary");
  }
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    throw new Error("Grok V5 response confidence must be between 0 and 100");
  }
  const strings = (key: string) => Array.isArray(value[key]) && (value[key] as unknown[]).every((v): v is string => typeof v === "string") ? value[key] as string[] : [];
  const limitations = strings("limitations");
  const invalidationConditions = Array.isArray(value.invalidationConditions)
    && value.invalidationConditions.every((v): v is string => typeof v === "string") ? value.invalidationConditions : [];
  if (!limitations.length || !invalidationConditions.length || typeof value.disclaimer !== "string") {
    throw new Error("Grok V5 response must include limitations, invalidationConditions, and disclaimer");
  }
  const stance = value.stance;
  const marketProbabilityPct = Number(value.marketProbabilityPct);
  const fair = value.fairProbabilityRange as Record<string, unknown> | undefined;
  const decision = value.decision as Record<string, unknown> | undefined;
  if (!["YES", "NO", "NO_EDGE", "INSUFFICIENT_EVIDENCE"].includes(String(stance)) || !Number.isFinite(marketProbabilityPct)
    || !fair || !Number.isFinite(Number(fair.low)) || !Number.isFinite(Number(fair.high)) || Number(fair.low) > Number(fair.high)
    || !decision || !["CONSIDER_YES", "CONSIDER_NO", "WAIT", "AVOID"].includes(String(decision.action)) || typeof decision.rationale !== "string") {
    throw new Error("Grok V5 response has an invalid stance, probability range, or decision state");
  }
  const requiredLists = ["evidenceDrivers", "counterEvidence", "entryConditions", "noTradeConditions", "catalystsForYes", "catalystsForNo", "executionRisks"];
  if (requiredLists.some((key) => !strings(key).length)) throw new Error("Grok V5 response is missing required decision-support lists");
  return Object.freeze({ headline: value.headline, summary: value.summary, confidence, stance: stance as V5GeneratedAnalysis["stance"], marketProbabilityPct,
    fairProbabilityRange: Object.freeze({ low: Number(fair.low), high: Number(fair.high) }), decision: Object.freeze({ action: decision.action as V5GeneratedAnalysis["decision"]["action"], rationale: decision.rationale }),
    evidenceDrivers: Object.freeze(strings("evidenceDrivers")), counterEvidence: Object.freeze(strings("counterEvidence")), entryConditions: Object.freeze(strings("entryConditions")), noTradeConditions: Object.freeze(strings("noTradeConditions")), catalystsForYes: Object.freeze(strings("catalystsForYes")), catalystsForNo: Object.freeze(strings("catalystsForNo")), executionRisks: Object.freeze(strings("executionRisks")), limitations, invalidationConditions, disclaimer: value.disclaimer });
}

export async function runPreparedV5Analysis(
  cfg: GrokConfig,
  input: { mode: V5Mode; tier: V5Tier; lang: "en" | "zh"; context: unknown; userNote?: string; fixture?: boolean; maxInputTokens?: number; maxOutputTokens?: number; reasoningEffort?: "none" | "low" },
): Promise<V5GeneratedAnalysis> {
  if (input.fixture) return Object.freeze({
    headline: `Arc fixture ${input.mode} analysis`,
    summary: "Deterministic fixture output validates payment, job, persistence, and UI delivery without incurring live model cost.",
    confidence: 0,
    stance: "INSUFFICIENT_EVIDENCE", marketProbabilityPct: 50, fairProbabilityRange: Object.freeze({ low: 0, high: 100 }),
    decision: Object.freeze({ action: "AVOID", rationale: "Fixture mode does not estimate an edge." }),
    evidenceDrivers: Object.freeze(["Fixture validates delivery only."]), counterEvidence: Object.freeze(["No live inference was performed."]),
    entryConditions: Object.freeze(["Enable live analysis first."]), noTradeConditions: Object.freeze(["Fixture mode is active."]),
    catalystsForYes: Object.freeze(["Not evaluated in fixture mode."]), catalystsForNo: Object.freeze(["Not evaluated in fixture mode."]), executionRisks: Object.freeze(["Do not use fixture output for a market decision."]),
    limitations: Object.freeze(["Fixture mode does not make a market inference."]),
    invalidationConditions: Object.freeze(["Replace fixture mode with live only after the production AI cost gate is approved."]),
    disclaimer: "TEST FIXTURE · NFA / DYOR · not financial advice",
    fixture: true,
    usage: Object.freeze({ promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0 }),
  });
  if (!cfg.apiKey) throw new Error("XAI_API_KEY not configured");
  const rules = [
    "Use only the supplied PULSE context; never introduce another market.",
    "Describe Polymarket prices as market-implied probabilities, not facts.",
    "Distinguish midpoint from executable best bid and best ask.",
    "Account for liquidity, spread, staleness, and resolution horizon.",
    "Do not imply causation from correlation.",
    "Lower confidence for weak, partial, stale, or horizon-mismatched context.",
    "MarketProbabilityPct is the executable or midpoint probability for the primary YES-like outcome; state which was used in the narrative.",
    "FairProbabilityRange must be a conservative evidence-based range. If supplied evidence cannot support an independent estimate, use a wide range and stance INSUFFICIENT_EVIDENCE or NO_EDGE.",
    "Decision must be operational: CONSIDER_YES/NO only when the fair range clears the relevant executable ask after spread; otherwise WAIT or AVOID.",
    "Entry conditions describe observable price/evidence conditions, never position size or guaranteed profit. No-trade conditions must explicitly cover spread, liquidity, stale evidence, and resolution ambiguity when relevant.",
    "Standard is concise; premium must give materially deeper evidence weighting, scenario catalysts, counter-case, timing, and execution analysis.",
    "Return exactly the fields required by the supplied JSON schema; no additional keys.",
  ];
  const systemContent = `You are PULSE ${input.mode} analysis. ${rules.join(" ")} Respond in ${input.lang}.`;
  const userContent = JSON.stringify({ tier: input.tier, userNote: input.userNote, context: input.context });
  // Conservative provider-independent bound. Exact tokenization is model-specific;
  // three UTF-16 characters per token errs toward rejecting oversized prompts.
  const estimatedInputTokens = Math.ceil((systemContent.length + userContent.length) / 3);
  if (input.maxInputTokens && estimatedInputTokens > input.maxInputTokens) {
    throw new Error(`Prepared AI context exceeds input budget (${estimatedInputTokens} > ${input.maxInputTokens} estimated tokens)`);
  }
  const response = await (cfg.fetchImpl ?? fetch)(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      reasoning_effort: input.reasoningEffort || (input.tier === "premium" ? "low" : "none"),
      max_tokens: input.maxOutputTokens || (input.tier === "premium" ? 2400 : 1200),
      response_format: { type: "json_schema", json_schema: { name: `pulse_${input.mode}_${input.tier}`, strict: true, schema: V5_ANALYSIS_JSON_SCHEMA } },
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
      ],
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`xAI HTTP ${response.status}: ${raw.slice(0, 500)}`);
  const payload = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } } };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("xAI returned no V5 analysis content");
  const analysis = parseAnalysis(content);
  const usage = payload.usage ? Object.freeze({ promptTokens: payload.usage.prompt_tokens || 0, completionTokens: payload.usage.completion_tokens || 0, totalTokens: payload.usage.total_tokens || 0, cachedTokens: payload.usage.prompt_tokens_details?.cached_tokens || 0, reasoningTokens: payload.usage.completion_tokens_details?.reasoning_tokens || 0 }) : undefined;
  return Object.freeze({ ...analysis, ...(usage ? { usage } : {}) });
}
