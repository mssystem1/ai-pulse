import { useState } from "react";
import type { Lang } from "./i18n";
import { formatMarketPrice } from "./format";
import "./autopilotJournal.css";

export type DecisionEntry = {
  id: string; evaluatedAt: string; action: string; status: string; reason: string;
  bias: string; confidence: number; error?: string; txHash?: string; evidenceHash?: string;
  metrics: Record<string, number | null>;
  rules: { id: string; label: string; passed: boolean; observed: string; required: string }[];
  context?: { pair?: string; signalMarket?: string; strategyType?: string; timeframe: string; candleClosedAt?: string; aiSource?: string; aiStatus?: string; nextAiEligibleAt?: string; minConfidence: number; maxTradePct: number; dailyLossPct: number };
};

const metricLabels: Record<string, string> = { close: "Candle close", sma20: "SMA 20", sma50: "SMA 50", previous20High: "Previous 20-candle high", volumeRatio: "Volume / average", rsi14: "RSI 14", takeProfit: "Take-profit", stopLoss: "Stop-loss", nearestSupport: "Nearest support", cooldownRemainingSeconds: "Cooldown · seconds" };
export function readableRuleValue(value: string) {
  return value.replace(/-?\d+\.\d{7,}/g, number => Math.abs(Number(number)) > 0 && Math.abs(Number(number)) < 0.000001 ? Number(number).toPrecision(6) : Number(number).toLocaleString("en-US", { maximumFractionDigits: 6, useGrouping: false }));
}

export function AutopilotDecisionJournal({ entries, explorer, lang }: { entries: DecisionEntry[]; explorer: string; lang: Lang }) {
  const [filter, setFilter] = useState("all"), [query, setQuery] = useState(""), [page, setPage] = useState(0);
  const zh = lang === "zh";
  const selected = entries.filter(e => (filter === "all" || (filter === "failed" ? e.status === "failed" : e.action === filter && e.status !== "failed")) && `${e.reason} ${e.error || ""} ${e.rules.map(r => r.label).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const sorted = [...selected].sort((a, b) => Date.parse(b.evaluatedAt) - Date.parse(a.evaluatedAt));
  const pages = Math.max(1, Math.ceil(sorted.length / 25)), current = Math.min(page, pages - 1);
  const blockers = new Map<string, number>();
  for (const e of entries) for (const rule of e.rules) {
    const unverifiedLegacyAi = !e.context && e.confidence === 0 && ["bullish_bias", "confidence", "trend_regime", "breakout_regime", "range_regime"].includes(rule.id);
    if (!rule.passed && !unverifiedLegacyAi) blockers.set(rule.label, (blockers.get(rule.label) || 0) + 1);
  }
  const leading = [...blockers].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return <section className="autopilot-evaluation-log decision-journal">
    <header><div><span className="eyebrow">{zh ? "决策历史" : "DECISION HISTORY"}</span><h4>{zh ? "每次等待、买入和卖出的原因" : "Every wait, entry and exit explained"}</h4></div><strong>{entries.length.toLocaleString()} {zh ? "条可用记录" : "available records"}</strong></header>
    <p>{zh ? "历史记录不限于 100 条。分页仅用于浏览；导出包含全部可用记录。等待不等于故障，价格上涨也不代表符合已签署的入场规则。" : "History is not capped at 100. Pages only organise browsing; export includes every available record. A wait is not a failure, and rising prices alone do not satisfy the signed entry rules."}</p>
    {leading.length > 0 && <div className="journal-blockers"><small>{zh ? "最常见的未通过条件 · 可用历史" : "Most frequent unmet conditions · available history"}</small>{leading.map(([label, count]) => <span key={label}>{label}<b>{count}</b></span>)}</div>}
    <div className="journal-filters"><label>{zh ? "结果" : "Outcome"}<select value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}>{[["all", zh ? "全部" : "All decisions"], ["buy", zh ? "买入" : "Buys"], ["sell", zh ? "卖出" : "Sells"], ["hold", zh ? "等待" : "Waits"], ["failed", zh ? "故障" : "Failures"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>{zh ? "搜索原因或条件" : "Search reason or rule"}<input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder={zh ? "例如：SMA20、冷却" : "e.g. SMA20, cooldown"} /></label></div>
    {sorted.slice(current * 25, current * 25 + 25).map(entry => <details className="journal-entry" key={entry.id}>
      <summary><span className={`status-chip ${entry.status}`}>{entry.status === "failed" ? (zh ? "故障" : "Failed") : entry.action === "hold" ? (zh ? "等待" : "Wait") : entry.action.toUpperCase()}</span><time>{new Date(entry.evaluatedAt).toLocaleString(zh ? "zh-CN" : "en-US")}</time><span>{entry.reason}</span><b aria-hidden="true">＋</b></summary>
      <div className="journal-entry-detail"><dl><div><dt>{zh ? "AI 确认" : "AI confirmation"}</dt><dd>{["not_evaluated", "not_required", "unknown"].includes(entry.bias) ? (entry.bias === "not_required" ? (zh ? "确定性保护，无需 AI" : "Not required · deterministic protection") : (zh ? "未提供确认" : "No confirmation available")) : !entry.context && entry.confidence === 0 ? (zh ? "旧记录 · 确认未经验证" : "Legacy · confirmation unverified") : `${entry.bias} · ${entry.confidence}%`}</dd></div>{entry.context && <><div><dt>{zh ? "决策周期" : "Decision timeframe"}</dt><dd>{entry.context.timeframe}</dd></div><div><dt>{zh ? "AI 状态" : "AI eligibility"}</dt><dd>{entry.context.aiStatus?.replaceAll("_", " ") || "—"}</dd></div><div><dt>{zh ? "单次交易上限" : "Per-trade allocation limit"}</dt><dd>{entry.context.maxTradePct}%</dd></div><div><dt>{zh ? "最低置信度" : "Required confidence"}</dt><dd>{entry.context.minConfidence}%</dd></div>{entry.context.candleClosedAt && <div><dt>{zh ? "已收盘 K 线时间" : "Evaluated candle timestamp"}</dt><dd>{new Date(entry.context.candleClosedAt).toLocaleString(zh ? "zh-CN" : "en-US")}</dd></div>}</>}{Object.entries(entry.metrics).filter(([, v]) => v !== null).map(([name, value]) => <div key={name}><dt>{metricLabels[name] || name.replace(/([A-Z])/g, " $1")}</dt><dd>{formatMarketPrice(value, lang)}</dd></div>)}</dl>
      {!entry.context && entry.confidence === 0 && !["not_required", "not_evaluated", "unknown"].includes(entry.bias) && <p>{zh ? "旧记录存储了 0%，但未保存 AI 来源信息。不能将它解读为已验证的 AI 评分。" : "This legacy record stored 0% without AI provenance. It must not be read as a verified AI score."}</p>}
      {entry.context?.signalMarket && <p>{zh ? "信号市场" : "Signal market"}: {entry.context.signalMarket}{entry.context.pair && entry.context.pair !== entry.context.signalMarket ? ` · ${zh ? "执行市场" : "Execution market"}: ${entry.context.pair}` : ""}</p>}
      <div className="rule-results">{entry.rules.map(rule => <div key={rule.id} className={rule.passed ? "pass" : "fail"}><b>{rule.passed ? "PASS" : "WAIT"}</b><span>{rule.label}</span><small>{readableRuleValue(rule.observed)} · {zh ? "需要" : "requires"} {readableRuleValue(rule.required)}</small></div>)}</div>
      {!entry.rules.length && <p>{zh ? "此记录没有保存条件快照，不推测缺失数据。" : "No rule snapshot was retained for this event. Missing details are not reconstructed as facts."}</p>}
      {entry.error && <p className="runtime-error">{entry.error}</p>}{entry.txHash && <a href={`${explorer}/tx/${entry.txHash}`} target="_blank" rel="noreferrer">{zh ? "查看成交交易" : "View execution transaction"} ↗</a>}</div>
    </details>)}
    {!sorted.length && <p>{zh ? "没有匹配的决策记录。" : "No decisions match these filters."}</p>}
    <footer><span>{sorted.length ? current * 25 + 1 : 0}–{Math.min((current + 1) * 25, sorted.length)} / {sorted.length.toLocaleString()}</span><div><button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>{zh ? "上一页" : "Previous"}</button><span>{current + 1} / {pages}</span><button type="button" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>{zh ? "下一页" : "Next"}</button></div></footer>
  </section>;
}
