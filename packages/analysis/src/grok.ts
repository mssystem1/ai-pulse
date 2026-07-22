import { buildMarketContext } from "@pulse/market";
import { systemPrompt, userPromptPayload, type AnalysisLang, type AnalysisTier } from "./prompts.js";

export type GrokConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
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
};

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    }
    return {
      headline: "Analysis returned unstructured text",
      summary: cleaned.slice(0, 2000),
      bias: "neutral",
      confidence: 40,
      disclaimer: "NFA / DYOR — not financial advice",
      limitations: ["Model output was not valid JSON; raw text embedded in summary."],
    };
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

  const body = {
    model: cfg.model,
    temperature: 0.3,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: userText },
    ],
  };

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Grok API ${res.status}: ${raw.slice(0, 500)}`);
  }

  let parsed: {
    choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> } }>;
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

  const analysis = extractJson(text);

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
  };
}
