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

const RISK_WEIGHTS = { contract: .30, market: .25, holders: .15, project: .15, promotion: .15 } as const;
export function normalizeTokenRiskAnalysis(analysis: z.infer<typeof TokenRiskAiOutputSchema>, evidence: Record<string, unknown>) {
  const sources = Array.isArray(evidence.sources) ? evidence.sources as Array<{source: string; status: string; data?: any}> : [];
  const source = (name: string) => sources.find(item => item.source === name && item.status === "observed")?.data;
  const profile = source("GeckoTerminal profile") || {};
  const market = source("GeckoTerminal token") || source("OKX Onchain OS")?.[0] || {};
  const contract = source("Blockscout verified contract") || {};
  const measured: Record<keyof typeof RISK_WEIGHTS, boolean> = {
    contract: typeof contract.isVerified === "boolean" || source("Sourcify contract verification")?.sourceVerified === true || typeof profile.honeypotObservation === "boolean",
    market: typeof market.liquidityUsd === "number" || (source("GeckoTerminal pools") || []).some((pool: any) => typeof pool.liquidityUsd === "number"),
    holders: (source("Blockscout holders")?.holders || []).length > 0 || profile.holders?.distribution_percentage != null,
    // Metadata verification and a link do not supply project-content evidence.
    // A blocked website must not turn an invented project score into a penalty.
    project: Boolean(source("Project website")) || Boolean(String(profile.description || "").trim()),
    // This evidence collector does not measure social engagement or promotion.
    promotion: false,
  };
  if (new Set(analysis.components.map(item => item.key)).size !== 5) throw new Error("Token Risk must contain each component exactly once");
  const components = analysis.components.map(item => ({ ...item, weight: RISK_WEIGHTS[item.key], score: measured[item.key] ? item.score : null, status: measured[item.key] ? "assessed" : "unknown" }));
  const weight = components.reduce((sum, item) => sum + (item.score === null ? 0 : item.weight), 0);
  const riskScore = weight ? Math.round(components.reduce((sum, item) => sum + (item.score ?? 0) * item.weight, 0) / weight * 10) / 10 : null;
  const evidenceGap = (risk: string) => {
    // Reclassify only a standalone coverage statement. Keep mixed findings in
    // the risk list so an unavailable source cannot hide an observed hazard.
    if (/\b(?:can mint|unlimited|honeypot|cannot sell|blacklist|sell tax|buy tax|drain|rug|exploit)\b|(?:无限增发|无法卖出|黑名单|漏洞)/i.test(risk)) return false;
    return /(?:HTTP|status)\s*(?:403|404|429|5\d\d)|\bno\b.{0,70}\b(?:audit|verification|documentation|data|evidence)\b|\b(?:unavailable|not observed|not supplied|not measured)\b|(?:无法访问|数据缺失|未观察到|未提供|未测量)/i.test(risk);
  };
  const gaps = analysis.criticalRisks.filter(evidenceGap);
  return { ...analysis, components, riskScore, criticalRisks: analysis.criticalRisks.filter(risk => !evidenceGap(risk)), unknowns: [...new Set([...analysis.unknowns, ...gaps])], confidence: Math.min(analysis.confidence, Math.round(weight * 100)), evidenceCoverage: Math.round(weight * 100),
    scoringVersion: "observed-components-v2",
    scoreMethod: "Weighted observed components only; unknown components are excluded, not scored as failures. Higher means lower observed risk. Coverage and confidence are separate; missing evidence does not establish safety.",
  };
}

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
    "An unavailable provider endpoint is an evidence gap, not a confirmed contract vulnerability. Put fetch failures in unknowns, not criticalRisks unless independent observed evidence establishes a risk. Do not claim no promotion or community simply because this source set does not measure engagement.",
    "Present GeckoTerminal gtScore/gtVerified as separate attributed provider metrics, never copy them into PULSE riskScore or treat metadata verification as a contract audit. Credit observed liquidity, verified metadata and holder evidence; explain any material score difference through actual evidence and uncertainty. Holder distribution can include exchanges, pools and treasuries.",
    "riskScore is 0-100 where 100 means lower observed risk and stronger evidence. Score each of exactly five components.",
    "Score only observed facts within each component. Never deduct points because a website blocks automated access (403), holder distribution is missing, or promotion activity is not measured. gtScoreDetails.holders=0 with null holder distribution is missing provider coverage, not proof of zero holders or concentration. The server excludes unmeasured components and computes the weighted aggregate; express uncertainty in confidence and unknowns. A negative honeypot observation is a bounded provider check, not proof of comprehensive contract safety.",
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
  const analysis = normalizeTokenRiskAnalysis(TokenRiskAiOutputSchema.parse(extractJson(content)), input.evidence);
  const usage = body.usage ? {
    promptTokens: Number(body.usage.prompt_tokens || 0),
    completionTokens: Number(body.usage.completion_tokens || 0),
    totalTokens: Number(body.usage.total_tokens || 0),
    cachedTokens: Number(body.usage.prompt_tokens_details?.cached_tokens || 0),
  } : undefined;
  return { analysis, usage, model: cfg.model, lang };
}
