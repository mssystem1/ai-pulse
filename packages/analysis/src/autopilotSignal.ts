import type { SpotMarketContext } from "@pulse/market";
import type { GrokConfig } from "./grok.js";

export type AutopilotSignal = Readonly<{
  bias: "bullish" | "bearish" | "neutral";
  regime: "trend_up" | "trend_down" | "range" | "transition";
  confidence: number;
  support: readonly number[];
  resistance: readonly number[];
  rationale: string;
}>;

export type AutopilotSignalResult = Readonly<{
  signal: AutopilotSignal;
  generatedAt: string;
  model: string;
  candleTs: number;
  usage?: Readonly<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
    /** Exact provider-billed cost when xAI returns cost_in_usd_ticks. */
    costUsd?: number;
  }>;
}>;

const SIGNAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bias: { type: "string", enum: ["bullish", "bearish", "neutral"] },
    regime: { type: "string", enum: ["trend_up", "trend_down", "range", "transition"] },
    confidence: { type: "number", minimum: 0, maximum: 100 },
    support: { type: "array", maxItems: 3, items: { type: "number" } },
    resistance: { type: "array", maxItems: 3, items: { type: "number" } },
    rationale: { type: "string", maxLength: 240 },
  },
  required: ["bias", "regime", "confidence", "support", "resistance", "rationale"],
} as const;

function finiteLevels(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const levels = value.map(Number);
  return levels.every((level) => Number.isFinite(level) && level > 0) ? levels : null;
}

function validateSignal(value: unknown): AutopilotSignal {
  if (!value || typeof value !== "object") throw new Error("Autopilot signal is not an object");
  const item = value as Record<string, unknown>;
  const bias = String(item.bias);
  const regime = String(item.regime);
  const confidence = Number(item.confidence);
  const support = finiteLevels(item.support);
  const resistance = finiteLevels(item.resistance);
  const rationale = String(item.rationale || "").trim();
  if (!["bullish", "bearish", "neutral"].includes(bias)) throw new Error("Autopilot signal bias is invalid");
  if (!["trend_up", "trend_down", "range", "transition"].includes(regime)) throw new Error("Autopilot signal regime is invalid");
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) throw new Error("Autopilot signal confidence is invalid");
  if (!support || !resistance || !rationale || rationale.length > 240) throw new Error("Autopilot signal levels or rationale are invalid");
  return Object.freeze({ bias: bias as AutopilotSignal["bias"], regime: regime as AutopilotSignal["regime"], confidence, support: Object.freeze(support), resistance: Object.freeze(resistance), rationale });
}

/**
 * Produces only the compact market-state fields required by deterministic
 * Autopilot rules. It intentionally cannot generate a chart, report narrative,
 * DeFi section, execution ticket or wallet action.
 */
export async function runPreparedAutopilotSignal(
  cfg: GrokConfig,
  input: {
    instId: string;
    timeframe: string;
    strategyType: string;
    market: SpotMarketContext;
    maxInputTokens?: number;
    maxOutputTokens?: number;
  },
): Promise<AutopilotSignalResult> {
  if (!cfg.apiKey) throw new Error("XAI_API_KEY not configured");
  const candles = input.market.candles.slice(-36).map((candle) => [candle.ts, candle.open, candle.high, candle.low, candle.close, candle.volume]);
  const system = "You are PULSE Autopilot's compact market-state classifier. Return only the strict JSON fields requested. Do not write a report, chart, scenarios, DeFi advice, trade ticket, disclaimer or wallet action. Confidence measures only classification quality, not expected profit.";
  const user = JSON.stringify({ instId: input.instId, timeframe: input.timeframe, strategyType: input.strategyType, ticker: input.market.ticker, summary: input.market.summary, candles, candleFormat: ["ts", "open", "high", "low", "close", "volume"] });
  const estimatedInputTokens = Math.ceil((system.length + user.length) / 3);
  const maxInputTokens = Math.max(1_000, input.maxInputTokens || 4_000);
  if (estimatedInputTokens > maxInputTokens) throw new Error(`Prepared Autopilot signal exceeds input budget (${estimatedInputTokens} > ${maxInputTokens} estimated tokens)`);
  const maxOutputTokens = Math.max(256, Math.min(512, input.maxOutputTokens || 320));
  const response = await (cfg.fetchImpl || fetch)(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      reasoning_effort: "none",
      max_tokens: maxOutputTokens,
      response_format: { type: "json_schema", json_schema: { name: "pulse_autopilot_signal_v1", strict: true, schema: SIGNAL_SCHEMA } },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`xAI Autopilot signal HTTP ${response.status}: ${raw.slice(0, 400)}`);
  const parsed = JSON.parse(raw) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost_in_usd_ticks?: number | string; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };
  };
  if (parsed.choices?.[0]?.finish_reason === "length") throw new Error(`Autopilot signal reached its ${maxOutputTokens}-token output limit`);
  const content = parsed.choices?.[0]?.message?.content;
  if (!content) throw new Error("xAI returned no Autopilot signal");
  const signal = validateSignal(JSON.parse(content));
  const billedCostTicks = parsed.usage?.cost_in_usd_ticks === undefined ? Number.NaN : Number(parsed.usage.cost_in_usd_ticks);
  const usage = parsed.usage ? Object.freeze({
    promptTokens: parsed.usage.prompt_tokens || 0,
    completionTokens: parsed.usage.completion_tokens || 0,
    totalTokens: parsed.usage.total_tokens || 0,
    cachedTokens: parsed.usage.prompt_tokens_details?.cached_tokens || 0,
    reasoningTokens: parsed.usage.completion_tokens_details?.reasoning_tokens || 0,
    ...(Number.isFinite(billedCostTicks) && billedCostTicks >= 0 ? { costUsd: billedCostTicks / 10_000_000_000 } : {}),
  }) : undefined;
  return Object.freeze({ signal, generatedAt: new Date().toISOString(), model: cfg.model, candleTs: input.market.candles.at(-1)?.ts || 0, ...(usage ? { usage } : {}) });
}
