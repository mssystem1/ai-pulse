import { buildMarketContext, type SpotMarketContext } from "@pulse/market";
import { GlobalNarrativeSchema, SpotGeneratedAnalysisSchema, type GlobalNarrative, type GlobalReport } from "@pulse/schemas";
import { systemPrompt, userPromptPayload } from "./prompts.js";
import { spotOutputTokenLimit, type GrokConfig, type AnalysisRequest, type AnalysisResult } from "./grok.js";
import { GLOBAL_HISTORY_LIMIT, globalContextTimeframe, prepareGlobalReport, globalPromptEvidence, finishGlobalReport, globalCompatibility } from "./globalReport.js";
import {loadGlobalMarketSet} from "./globalMarketSet.js";

function narrativeJsonSchema(report: GlobalReport) {
  const ids = report.view.pathIds;
  const nullableId = (values: string[]) => ({ type: ["string", "null"], enum: [...values, null] });
  return { type: "object", additionalProperties: false, properties: {
    headline: { type: "string" }, summary: { type: "string" }, regime: { type: "string", enum: ["trend_up", "trend_down", "range", "transition"] }, bias: { type: "string", enum: ["bullish", "bearish", "neutral"] }, confidence: { type: "number", minimum: 0, maximum: 100 },
    waveCandidateId: nullableId([report.waveCount.id]), mainPathId: nullableId(report.paths.filter(p=>p.role==="main").map(p=>p.id)), setupPathId: report.setup.pathId ? {type:"string",enum:[report.setup.pathId]} : {type:"null"},
    reasons: { type: "array", items: { type: "string" } },
    pathNotes: { type: "array", maxItems: ids.length, items: { type: "object", additionalProperties: false, properties: { pathId: { type: "string", enum: ids.length ? ids : ["unavailable"] }, thesis: { type: "string" } }, required: ["pathId", "thesis"] } },
    riskNotes: { type: "array", items: { type: "string" } }, limitations: { type: "array", items: { type: "string" } }, disclaimer: { type: "string" },
  }, required: ["headline", "summary", "regime", "bias", "confidence", "waveCandidateId", "mainPathId", "setupPathId", "reasons", "pathNotes", "riskNotes", "limitations", "disclaimer"] };
}
function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); }
  catch { const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) { try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* strict failure below */ } }
    throw new Error("Grok structured output is not valid JSON");
  }
}
/** A cached older grammar may retain prose, but cannot invent wave evidence. */
function legacyNarrative(candidate: Record<string, unknown>, prepared: GlobalReport): GlobalNarrative | null {
  const normalized = { ...candidate }; delete normalized.scenarios;
  let parsed = SpotGeneratedAnalysisSchema.safeParse(normalized);
  if (!parsed.success && parsed.error.issues.some(issue => issue.path[0] === "elliottWave")) {
    parsed = SpotGeneratedAnalysisSchema.safeParse({ ...normalized, elliottWave: { degree: "unclear", structure: "unclear", direction: "unclear", currentWave: "unclear", confidence: 0, rationale: "No validated anchor count was returned.", invalidation: null, paths: [] } });
  }
  if (!parsed.success) return null;
  const a = parsed.data;
  return { headline: a.headline, summary: a.summary, regime: a.regime, bias: a.bias, confidence: a.confidence, waveCandidateId: null,
    mainPathId: prepared.paths.find(p => p.direction === (a.bias === "bullish" ? "up" : a.bias === "bearish" ? "down" : "range") && prepared.view.pathIds.includes(p.id))?.id ?? null,
    setupPathId: prepared.setup.pathId, reasons: [], pathNotes: [], riskNotes: a.riskNotes,
    limitations: [...a.limitations, prepared.lang === "zh" ? "模型返回旧版格式；价位和交易条件仅采用已保存的市场图。" : "The provider returned an older format; levels and setup conditions use the saved market map only."], disclaimer: a.disclaimer };
}
export async function runGrokAnalysis(cfg: GrokConfig, req: AnalysisRequest): Promise<AnalysisResult> {
  if (!cfg.apiKey) throw new Error("XAI_API_KEY not configured");
  const set=await loadGlobalMarketSet({instId:req.instId,timeframe:req.timeframe??"1H"},buildMarketContext);
  return runPreparedSpotAnalysis(cfg, { ...req,contextMarket:set.contextMarket,hierarchyMarkets:set.hierarchyMarkets },set.market);
}
/** Every presentation consumes this saved result; reopening never calls xAI. */
export async function runPreparedSpotAnalysis(cfg: GrokConfig, req: AnalysisRequest, market: SpotMarketContext, onPrepared?:()=>Promise<void>): Promise<AnalysisResult> {
  if (!cfg.apiKey) throw new Error("XAI_API_KEY not configured");
  const lang = req.lang ?? "en", timeframe = market.bar;
  const prepared = prepareGlobalReport({ market, tier: req.tier, lang, contextMarket: req.contextMarket,hierarchyMarkets:req.hierarchyMarkets });
  const sys = systemPrompt(req.tier, lang), marketJson = JSON.stringify(globalPromptEvidence(prepared));
  const user = userPromptPayload({ tier: req.tier, lang, instId: market.instId, timeframe, marketJson, hasImage: false, userNote: req.userNote });
  const estimated = Math.ceil((sys.length + user.length) / 3);
  if (req.maxInputTokens && estimated > req.maxInputTokens) throw new Error(`Prepared AI context exceeds input budget (${estimated} > ${req.maxInputTokens} estimated tokens)`);
  const maxOutputTokens = spotOutputTokenLimit(req.tier, req.maxOutputTokens), reasoningEffort = req.reasoningEffort ?? (req.tier === "premium" ? "medium" : "low");
  await onPrepared?.();
  const res = await (cfg.fetchImpl ?? fetch)(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ model: cfg.model, temperature: .2, reasoning_effort: reasoningEffort, max_tokens: maxOutputTokens,
      response_format: { type: "json_schema", json_schema: { name: `pulse_global_${req.tier}_v3_map`, strict: true, schema: narrativeJsonSchema(prepared) } },
      messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Grok API ${res.status}: ${raw.slice(0, 500)}`);
  let parsed: { choices?: Array<{ finish_reason?: string; message?: { content?: string | Array<{ text?: string }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } } };
  try { parsed = JSON.parse(raw); } catch { throw new Error("Grok API invalid JSON"); }
  if (parsed.choices?.[0]?.finish_reason === "length") throw new Error(`Grok structured output reached its ${maxOutputTokens}-token limit before completing JSON`);
  const content = parsed.choices?.[0]?.message?.content, text = typeof content === "string" ? content : Array.isArray(content) ? content.map(c => c.text ?? "").join("\n") : "";
  const candidate = extractJson(text), validated = GlobalNarrativeSchema.safeParse(candidate);
  const narrative = validated.success ? validated.data : legacyNarrative(candidate, prepared);
  if (!narrative) { const issue = validated.success ? undefined : validated.error.issues[0]; throw new Error(`Grok structured output failed validation at ${issue?.path.join(".") || "root"}: ${issue?.message || "invalid output"}`); }
  const global = finishGlobalReport(prepared, narrative), compatibility = globalCompatibility(global, narrative);
  const u = parsed.usage, usage = u ? Object.freeze({ promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0, totalTokens: u.total_tokens ?? 0, cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0, reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0 }) : undefined;
  return { service: req.tier === "premium" ? "analysis_premium" : "analysis_base", tier: req.tier, instId: market.instId, timeframe, model: cfg.model, lang,
    market: { ticker: market.ticker, summary: market.summary, bar: market.bar, candleCount: global.candles.length, source: market.source },
    global, ...compatibility, chart: { source: market.source, timeframe, candles: global.candles }, generatedAt: new Date().toISOString(), methodology_version: global.version,
    analysisProfile: { mode: "live", model: cfg.model, reasoningEffort }, ...(usage ? { usage } : {}) };
}
