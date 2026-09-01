import { z } from "zod";

export type TokenRiskLanguage = "en" | "zh";

export type TokenRiskAiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
};

const ComponentSchema = z.object({
  key: z.enum(["contract", "market", "holders", "project", "promotion"]),
  label: z.string(),
  score: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
  reason: z.string(),
  evidence: z.array(z.string()),
}).strict();

const TokenRiskAiOutputSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  riskScore: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  components: z.array(ComponentSchema).length(5),
  criticalRisks: z.array(z.string()),
  positiveSignals: z.array(z.string()),
  unknowns: z.array(z.string()),
  mostLikelyLossScenario: z.string(),
  recommendedAction: z.string(),
  maxExposurePct: z.number().min(0).max(100),
  projectAssessment: z.string(),
  promotionAssessment: z.string(),
  disclaimer: z.string(),
}).strict();

const TOKEN_RISK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    riskScore: { type: "number", minimum: 0, maximum: 100 },
    confidence: { type: "number", minimum: 0, maximum: 100 },
    components: {
      type: "array", minItems: 5, maxItems: 5,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          key: { type: "string", enum: ["contract", "market", "holders", "project", "promotion"] },
          label: { type: "string" }, score: { type: "number", minimum: 0, maximum: 100 },
          weight: { type: "number", minimum: 0, maximum: 1 }, reason: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
        },
        required: ["key", "label", "score", "weight", "reason", "evidence"],
      },
    },
    criticalRisks: { type: "array", items: { type: "string" } },
    positiveSignals: { type: "array", items: { type: "string" } },
    unknowns: { type: "array", items: { type: "string" } },
    mostLikelyLossScenario: { type: "string" }, recommendedAction: { type: "string" },
    maxExposurePct: { type: "number", minimum: 0, maximum: 100 },
    projectAssessment: { type: "string" }, promotionAssessment: { type: "string" }, disclaimer: { type: "string" },
  },
  required: ["headline", "summary", "riskScore", "confidence", "components", "criticalRisks", "positiveSignals", "unknowns", "mostLikelyLossScenario", "recommendedAction", "maxExposurePct", "projectAssessment", "promotionAssessment", "disclaimer"],
} as const;

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Grok Token Risk output is not valid JSON");
  }
}

export async function runGrokTokenRiskAnalysis(
  cfg: TokenRiskAiConfig,
  input: { evidence: Record<string, unknown>; lang?: TokenRiskLanguage; maxOutputTokens?: number },
) {
  if (!cfg.apiKey) throw new Error("XAI_API_KEY not configured");
  const lang = input.lang ?? "en";
  const system = [
    "You are PULSE Token Risk Guard. Produce a due-diligence report from the supplied evidence only.",
    "Never invent audits, ownership state, liquidity, holder counts, social activity, partnerships, verification, or safety.",
    "Treat missing, failed, stale, or contradictory data as unknown and lower confidence. A verified source contract is not proof that a token is safe.",
    "riskScore is 0-100 where 100 means lower observed risk and stronger evidence. Score each of exactly five components.",
    "Weights must be contract .30, market .25, holders .15, project .15, promotion .15. Promotion spending is not a positive safety signal by itself.",
    "Separate facts from inference. Cite source names inside evidence strings. Keep recommendations non-custodial and non-financial-advice.",
    lang === "zh" ? "Write every user-facing field in Simplified Chinese." : "Write every user-facing field in English.",
  ].join("\n");
  const response = await (cfg.fetchImpl ?? fetch)(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      reasoning_effort: "low",
      max_tokens: Math.max(900, input.maxOutputTokens ?? 1800),
      response_format: { type: "json_schema", json_schema: { name: "pulse_token_risk", strict: true, schema: TOKEN_RISK_JSON_SCHEMA } },
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Analyze this bounded source packet:\n${JSON.stringify(input.evidence)}` },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json().catch(() => ({})) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  };
  if (!response.ok) throw new Error(`Grok Token Risk HTTP ${response.status}: ${body.error?.message || "request failed"}`);
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Grok Token Risk returned no report");
  const analysis = TokenRiskAiOutputSchema.parse(extractJson(content));
  const usage = body.usage ? {
    promptTokens: Number(body.usage.prompt_tokens || 0),
    completionTokens: Number(body.usage.completion_tokens || 0),
    totalTokens: Number(body.usage.total_tokens || 0),
    cachedTokens: Number(body.usage.prompt_tokens_details?.cached_tokens || 0),
  } : undefined;
  return { analysis, usage, model: cfg.model, lang };
}

