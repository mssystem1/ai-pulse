import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type express from "express";

type Metric = { count: number; errors: number; totalMs: number; maxMs: number };
const requests = new Map<string, Metric>();
const counters = new Map<string, number>();
let aiPromptTokens = 0;
let aiCompletionTokens = 0;
let aiCachedTokens = 0;
let aiReasoningTokens = 0;
let aiEstimatedCostUsd = 0;
const providerMetrics = new Map<string, Metric & { retries: number; cacheHits: number; cacheAgeMs: number }>();
const paymentMetrics = new Map<string, Metric & { amountAtomic: bigint }>();
const reportMetrics = new Map<string, number>();
let unfinishedJobs = 0;
let queueReady = 0;
let queueLeased = 0;
const correlation = new AsyncLocalStorage<string>();

function eventLog(event: string, fields: Record<string, string | number | boolean>) {
  console.info(JSON.stringify({ level: "info", event, correlationId: correlation.getStore() || "background", at: new Date().toISOString(), ...fields }));
}

export function recordJob(stage: string, network: string) {
  const key = `stage="${label(stage)}",network="${label(network)}"`;
  counters.set(key, (counters.get(key) || 0) + 1);
  if (stage === "payment_settled") unfinishedJobs += 1;
  if (["completed", "completed_partial", "failed_terminal", "manual_reconciliation"].includes(stage)) unfinishedJobs = Math.max(0, unfinishedJobs - 1);
  eventLog("job_stage", { stage, network });
}

export function recordAiUsage(promptTokens: number, completionTokens: number, estimatedCostUsd: number, cachedTokens = 0, reasoningTokens = 0) {
  aiPromptTokens += promptTokens; aiCompletionTokens += completionTokens;
  aiCachedTokens += cachedTokens; aiReasoningTokens += reasoningTokens; aiEstimatedCostUsd += estimatedCostUsd;
}

export function recordProvider(input: { provider: string; operation: string; durationMs: number; success: boolean; retries?: number; cacheHit?: boolean; cacheAgeMs?: number }) {
  const key = `provider="${label(input.provider)}",operation="${label(input.operation)}"`;
  const metric = providerMetrics.get(key) || { count: 0, errors: 0, totalMs: 0, maxMs: 0, retries: 0, cacheHits: 0, cacheAgeMs: 0 };
  metric.count += 1; metric.errors += input.success ? 0 : 1; metric.totalMs += input.durationMs; metric.maxMs = Math.max(metric.maxMs, input.durationMs);
  metric.retries += input.retries || 0; metric.cacheHits += input.cacheHit ? 1 : 0; metric.cacheAgeMs = Math.max(metric.cacheAgeMs, input.cacheAgeMs || 0);
  providerMetrics.set(key, metric);
  eventLog("provider_call", { provider: input.provider, operation: input.operation, durationMs: Number(input.durationMs.toFixed(3)), success: input.success, retries: input.retries || 0, cacheHit: Boolean(input.cacheHit) });
}

export function recordPayment(input: { provider: string; network: string; phase: "verify_settle" | "challenge"; durationMs: number; success: boolean; amountAtomic?: string }) {
  const key = `provider="${label(input.provider)}",network="${label(input.network)}",phase="${input.phase}"`;
  const metric = paymentMetrics.get(key) || { count: 0, errors: 0, totalMs: 0, maxMs: 0, amountAtomic: 0n };
  metric.count += 1; metric.errors += input.success ? 0 : 1; metric.totalMs += input.durationMs; metric.maxMs = Math.max(metric.maxMs, input.durationMs);
  if (input.amountAtomic && /^\d+$/.test(input.amountAtomic)) metric.amountAtomic += BigInt(input.amountAtomic);
  paymentMetrics.set(key, metric);
  eventLog("payment_phase", { provider: input.provider, network: input.network, phase: input.phase, durationMs: Number(input.durationMs.toFixed(3)), success: input.success, amountAtomic: input.amountAtomic || "0" });
}

export function recordReport(outcome: "completed" | "partial" | "failed" | "recovered") {
  reportMetrics.set(outcome, (reportMetrics.get(outcome) || 0) + 1);
  eventLog("report_outcome", { outcome });
}

export function setUnfinishedJobs(value: number) { unfinishedJobs = Math.max(0, Math.floor(value)); }
export function setQueueDepth(ready: number, leased: number) {
  queueReady = Math.max(0, Math.floor(ready));
  queueLeased = Math.max(0, Math.floor(leased));
  setUnfinishedJobs(queueReady + queueLeased);
}

export async function observeProvider<T>(provider: string, operation: string, task: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { const value = await task(); recordProvider({ provider, operation, durationMs: performance.now() - started, success: true }); return value; }
  catch (error) { recordProvider({ provider, operation, durationMs: performance.now() - started, success: false }); throw error; }
}

function routeLabel(req: express.Request): string {
  return `${req.method} ${(req.route?.path as string | undefined) || req.path}`.replace(/[^a-zA-Z0-9_:/.-]/g, "_");
}

export function telemetryMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const correlationId = String(req.header("X-Correlation-ID") || randomUUID());
  Object.assign(req, { pulseCorrelationId: correlationId });
  res.setHeader("X-Correlation-ID", correlationId);
  const started = performance.now();
  res.once("finish", () => {
    const label = routeLabel(req);
    const elapsed = performance.now() - started;
    const current = requests.get(label) || { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
    current.count += 1;
    current.errors += res.statusCode >= 500 ? 1 : 0;
    current.totalMs += elapsed;
    current.maxMs = Math.max(current.maxMs, elapsed);
    requests.set(label, current);
  });
  correlation.run(correlationId, next);
}

function label(value: string): string { return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"'); }

export function prometheusMetrics(): string {
  const lines = [
    "# HELP pulse_http_requests_total HTTP requests observed by route.",
    "# TYPE pulse_http_requests_total counter",
    "# HELP pulse_http_errors_total HTTP 5xx responses observed by route.",
    "# TYPE pulse_http_errors_total counter",
    "# HELP pulse_http_latency_ms_sum Cumulative HTTP latency in milliseconds.",
    "# TYPE pulse_http_latency_ms_sum counter",
    "# HELP pulse_http_latency_ms_max Maximum process-lifetime HTTP latency in milliseconds.",
    "# TYPE pulse_http_latency_ms_max gauge",
  ];
  for (const [route, metric] of [...requests].sort(([a], [b]) => a.localeCompare(b))) {
    const labels = `{route="${label(route)}"}`;
    lines.push(`pulse_http_requests_total${labels} ${metric.count}`);
    lines.push(`pulse_http_errors_total${labels} ${metric.errors}`);
    lines.push(`pulse_http_latency_ms_sum${labels} ${metric.totalMs.toFixed(3)}`);
    lines.push(`pulse_http_latency_ms_max${labels} ${metric.maxMs.toFixed(3)}`);
  }
  lines.push(`pulse_process_uptime_seconds ${process.uptime().toFixed(3)}`);
  for (const [labels, value] of [...counters].sort(([a], [b]) => a.localeCompare(b))) lines.push(`pulse_job_events_total{${labels}} ${value}`);
  lines.push(`pulse_ai_prompt_tokens_total ${aiPromptTokens}`);
  lines.push(`pulse_ai_completion_tokens_total ${aiCompletionTokens}`);
  lines.push(`pulse_ai_cached_tokens_total ${aiCachedTokens}`);
  lines.push(`pulse_ai_reasoning_tokens_total ${aiReasoningTokens}`);
  lines.push(`pulse_ai_estimated_cost_usd_total ${aiEstimatedCostUsd.toFixed(8)}`);
  for (const [labels, metric] of [...providerMetrics].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`pulse_provider_requests_total{${labels}} ${metric.count}`);
    lines.push(`pulse_provider_errors_total{${labels}} ${metric.errors}`);
    lines.push(`pulse_provider_latency_ms_sum{${labels}} ${metric.totalMs.toFixed(3)}`);
    lines.push(`pulse_provider_latency_ms_max{${labels}} ${metric.maxMs.toFixed(3)}`);
    lines.push(`pulse_provider_retries_total{${labels}} ${metric.retries}`);
    lines.push(`pulse_provider_cache_hits_total{${labels}} ${metric.cacheHits}`);
    lines.push(`pulse_provider_cache_age_ms_max{${labels}} ${metric.cacheAgeMs.toFixed(3)}`);
  }
  for (const [labels, metric] of [...paymentMetrics].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`pulse_payment_attempts_total{${labels}} ${metric.count}`);
    lines.push(`pulse_payment_failures_total{${labels}} ${metric.errors}`);
    lines.push(`pulse_payment_latency_ms_sum{${labels}} ${metric.totalMs.toFixed(3)}`);
    lines.push(`pulse_payment_latency_ms_max{${labels}} ${metric.maxMs.toFixed(3)}`);
    lines.push(`pulse_payment_settlement_amount_atomic_total{${labels}} ${metric.amountAtomic}`);
  }
  for (const [outcome, value] of [...reportMetrics].sort(([a], [b]) => a.localeCompare(b))) lines.push(`pulse_reports_total{outcome="${label(outcome)}"} ${value}`);
  lines.push(`pulse_unfinished_jobs ${unfinishedJobs}`);
  lines.push(`pulse_queue_ready_jobs ${queueReady}`);
  lines.push(`pulse_queue_leased_jobs ${queueLeased}`);
  return `${lines.join("\n")}\n`;
}
