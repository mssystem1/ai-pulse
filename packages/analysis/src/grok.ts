import { buildMarketContext, type SpotMarketContext } from "@pulse/market";
import { SpotGeneratedAnalysisSchema } from "@pulse/schemas";
import { systemPrompt, userPromptPayload, type AnalysisLang, type AnalysisTier } from "./prompts.js";

export type GrokConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
};

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
  reasoningEffort?: "none" | "low";
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
  rawText?: string;
  generatedAt: string;
  methodology_version: string;
  usage?: Readonly<{ promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number; reasoningTokens: number }>;
  analysisProfile: Readonly<{ mode: "live"; model: string; reasoningEffort: "none" | "low" }>;
};

const SPOT_ANALYSIS_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    headline: { type: "string" }, regime: { type: "string", enum: ["trend_up", "trend_down", "range", "transition"] },
    bias: { type: "string", enum: ["bullish", "bearish", "neutral"] }, confidence: { type: "number", minimum: 0, maximum: 100 }, summary: { type: "string" },
    keyLevels: { type: "object", additionalProperties: false, properties: { support: { type: "array", items: { type: "number" } }, resistance: { type: "array", items: { type: "number" } } }, required: ["support", "resistance"] },
    targets: { type: "array", items: { type: "object", additionalProperties: false, properties: { label: { type: "string" }, price: { type: "number" }, rationale: { type: "string" } }, required: ["label", "price", "rationale"] } },
    invalidation: { type: "object", additionalProperties: false, properties: { price: { type: ["number", "null"] }, condition: { type: "string" } }, required: ["price", "condition"] },
    elliottWave: {
      type: "object", additionalProperties: false,
      properties: {
        degree: { type: "string", enum: ["primary", "intermediate", "minor", "unclear"] },
        structure: { type: "string", enum: ["impulse", "diagonal", "abc_correction", "complex_correction", "unclear"] },
        direction: { type: "string", enum: ["up", "down", "unclear"] },
        currentWave: { type: "string", enum: ["1", "2", "3", "4", "5", "A", "B", "C", "unclear"] },
        confidence: { type: "number", minimum: 0, maximum: 100 },
        rationale: { type: "string" },
        invalidation: { type: ["number", "null"] },
        paths: {
          type: "array", minItems: 1, maxItems: 3,
          items: {
            type: "object", additionalProperties: false,
            properties: {
              type: { type: "string", enum: ["wave_3_continuation", "wave_5_continuation", "abc_correction", "wave_c_continuation", "count_invalidation", "recount"] },
              label: { type: "string" }, thesis: { type: "string" },
              trigger: { type: ["number", "null"] }, target: { type: ["number", "null"] }, invalidation: { type: ["number", "null"] },
              sequence: { type: "array", items: { type: "string" } },
            },
            required: ["type", "label", "thesis", "trigger", "target", "invalidation", "sequence"],
          },
        },
      },
      required: ["degree", "structure", "direction", "currentWave", "confidence", "rationale", "invalidation", "paths"],
    },
    chartNotes: { type: "string" }, agentAction: { type: "string" }, agentChecklist: { type: "array", items: { type: "string" } }, riskNotes: { type: "array", items: { type: "string" } }, limitations: { type: "array", items: { type: "string" } }, disclaimer: { type: "string" },
  },
  required: ["headline", "regime", "bias", "confidence", "summary", "keyLevels", "targets", "invalidation", "elliottWave", "chartNotes", "agentAction", "agentChecklist", "riskNotes", "limitations", "disclaimer"],
} as const;

/**
 * A paid report must not become unrecoverable merely because a provider still
 * serves an older cached structured-output grammar.  Keep the narrative model
 * output, but supply a conservative, explicitly labelled Elliott hypothesis
 * from the exact OHLCV window when only that newly-required field is absent or
 * malformed.
 */
function deterministicElliottFallback(market: SpotMarketContext) {
  const candles = market.candles;
  const first = candles[0];
  const last = candles.at(-1);
  const values = candles.flatMap((candle) => [candle.high, candle.low]).filter(Number.isFinite);
  const high = values.length ? Math.max(...values) : Number(market.ticker.high24h) || Number(last?.close) || 0;
  const low = values.length ? Math.min(...values) : Number(market.ticker.low24h) || Number(last?.close) || 0;
  const close = Number(last?.close) || Number(market.ticker.last) || 0;
  const opening = Number(first?.open) || close;
  const up = close >= opening;
  const range = Math.max(Math.abs(high - low), Math.abs(close) * 0.01, 1e-9);
  const currentWave = candles.length >= 80 ? "5" as const : "3" as const;
  const continuationType = currentWave === "5" ? "wave_5_continuation" as const : "wave_3_continuation" as const;
  const continuationTarget = up ? high + range * 0.272 : Math.max(0, low - range * 0.272);
  const correctionTarget = up ? high - range * 0.5 : low + range * 0.5;
  const round = (value: number) => Number(value.toPrecision(10));
  return {
    degree: "minor" as const,
    structure: "impulse" as const,
    direction: up ? "up" as const : "down" as const,
    currentWave,
    confidence: 45,
    rationale: "The provider omitted a valid Elliott object, so PULSE derived this conservative candidate count deterministically from the complete supplied OHLCV window. Treat it as a hypothesis until its trigger holds.",
    invalidation: round(up ? low : high),
    paths: [
      {
        type: continuationType,
        label: `Wave ${currentWave} continuation`,
        thesis: `The candidate impulse continues only after price confirms beyond the observed ${up ? "high" : "low"}.`,
        trigger: round(up ? high : low),
        target: round(continuationTarget),
        invalidation: round(correctionTarget),
        sequence: [`Wave ${currentWave === "3" ? "2" : "4"} structure holds`, `Wave ${currentWave} confirms through the prior extreme`, "Reassess the count at the extension target"],
      },
      {
        type: "abc_correction" as const,
        label: "A-B-C correction / alternate count",
        thesis: "Failure of the continuation structure activates a corrective A-B-C hypothesis, not a short recommendation.",
        trigger: round(correctionTarget),
        target: round(up ? high - range * 0.618 : low + range * 0.618),
        invalidation: round(up ? high : low),
        sequence: ["Wave A breaks the continuation structure", "Wave B retraces part of A", "Wave C tests the deeper Fibonacci zone"],
      },
    ],
  };
}

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch (initialError) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        // Report one strict structured-output failure below.
      }
    }
    throw new Error(`Grok structured output is not valid JSON: ${initialError instanceof Error ? initialError.message : "parse failed"}`);
  }
}

export async function runGrokAnalysis(
  cfg: GrokConfig,
  req: AnalysisRequest,
): Promise<AnalysisResult> {
  if (!cfg.apiKey) throw new Error("XAI_API_KEY not configured");

  const lang = req.lang ?? "en";
  const timeframe = req.timeframe ?? "1H";
  const market = await buildMarketContext({
    instId: req.instId,
    timeframe,
    candleLimit: req.candleLimit ?? (req.tier === "premium" ? 120 : 80),
  });

  return runPreparedSpotAnalysis(cfg, req, market);
}

/**
 * Context-first analysis seam. Provider access and validation happen before
 * this function; it performs only prompt construction, model invocation, and
 * legacy-compatible response shaping.
 */
export async function runPreparedSpotAnalysis(
  cfg: GrokConfig,
  req: AnalysisRequest,
  market: SpotMarketContext,
): Promise<AnalysisResult> {
  if (!cfg.apiKey) throw new Error("XAI_API_KEY not configured");

  const lang = req.lang ?? "en";
  const timeframe = req.timeframe ?? "1H";

  // Compact candles for token efficiency: sample last N
  const compactCandles = market.candles.slice(-60).map((c) => [
    c.ts,
    c.open,
    c.high,
    c.low,
    c.close,
    c.volume,
  ]);

  const marketJson = JSON.stringify(
    {
      instId: market.instId,
      bar: market.bar,
      ticker: market.ticker,
      summary: market.summary,
      candles_ohlcv: compactCandles,
      note: "candles are [ts, open, high, low, close, volume] chronological",
    },
    null,
    2,
  );

  // Chart screenshots intentionally disabled — Grok only sees OKX public market series.
  const sys = systemPrompt(req.tier, lang);
  const userText = userPromptPayload({
    tier: req.tier,
    lang,
    instId: req.instId,
    timeframe,
    marketJson,
    hasImage: false,
    userNote: req.userNote,
  });
  const estimatedInputTokens = Math.ceil((sys.length + userText.length) / 3);
  if (req.maxInputTokens && estimatedInputTokens > req.maxInputTokens) {
    throw new Error(`Prepared AI context exceeds input budget (${estimatedInputTokens} > ${req.maxInputTokens} estimated tokens)`);
  }

  const body = {
    model: cfg.model,
    temperature: 0.3,
    reasoning_effort: req.reasoningEffort || (req.tier === "premium" ? "low" : "none"),
    // Version the grammar name as well as its body. Some providers cache the
    // compiled schema by name and otherwise keep returning the pre-Elliott V5
    // object even after the schema body changes.
    response_format: { type: "json_schema", json_schema: { name: `pulse_spot_${req.tier}_v6_elliott`, strict: true, schema: SPOT_ANALYSIS_JSON_SCHEMA } },
    ...(req.maxOutputTokens ? { max_tokens: req.maxOutputTokens } : {}),
    messages: [
      { role: "system", content: sys },
      { role: "user", content: userText },
    ],
  };

  const res = await (cfg.fetchImpl ?? fetch)(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Grok API ${res.status}: ${raw.slice(0, 500)}`);
  }

  let parsed: {
    choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Grok API invalid JSON: ${raw.slice(0, 300)}`);
  }

  const content = parsed.choices?.[0]?.message?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content.map((c) => c.text || "").join("\n");
  }

  const candidate = extractJson(text);
  // `scenarios` was part of the previous grammar. It is intentionally dropped:
  // V6 next moves are Elliott paths, never renamed bull/base/bear branches.
  const normalized = { ...candidate };
  delete normalized.scenarios;
  let validated = SpotGeneratedAnalysisSchema.safeParse(normalized);
  if (!validated.success && validated.error.issues.some((issue) => issue.path[0] === "elliottWave")) {
    validated = SpotGeneratedAnalysisSchema.safeParse({
      ...normalized,
      elliottWave: deterministicElliottFallback(market),
    });
  }
  if (!validated.success) {
    const issue = validated.error.issues[0];
    throw new Error(`Grok structured output failed validation at ${issue?.path.join(".") || "root"}: ${issue?.message || "invalid output"}`);
  }
  const analysis = validated.data;

  const usage = parsed.usage ? Object.freeze({ promptTokens: parsed.usage.prompt_tokens || 0, completionTokens: parsed.usage.completion_tokens || 0, totalTokens: parsed.usage.total_tokens || 0, cachedTokens: parsed.usage.prompt_tokens_details?.cached_tokens || 0, reasoningTokens: parsed.usage.completion_tokens_details?.reasoning_tokens || 0 }) : undefined;
  return {
    service: req.tier === "premium" ? "analysis_premium" : "analysis_base",
    tier: req.tier,
    instId: req.instId,
    timeframe,
    model: cfg.model,
    lang,
    market: {
      ticker: market.ticker,
      summary: market.summary,
      bar: market.bar,
      candleCount: market.candles.length,
      source: market.source,
    },
    analysis,
    rawText: text.slice(0, 4000),
    generatedAt: new Date().toISOString(),
    methodology_version: "pulse-v2.0.0",
    analysisProfile: { mode: "live", model: cfg.model, reasoningEffort: req.reasoningEffort || (req.tier === "premium" ? "low" : "none") },
    ...(usage ? { usage } : {}),
  };
}
