import type { GlobalReport } from "@pulse/schemas";
import { globalFrameReference } from "./globalContext.js";
import { globalPriceBandText, globalOpposingEntryZones } from "./globalPriceZones.js";

const executionTime = (at: number) => new Date(at).toISOString().slice(0, 19).replace("T", " ") + " UTC";

/** A confirmed return cannot outlive its saved fill window, even when the
 * broader setup remains valid. Reading a snapshot never restarts either clock. */
export function globalScenarioEntryDeadline(report: GlobalReport): number | null {
  const s = report.scenario;
  if (!s) return report.discretionaryPlan?.executionPolicy?.expiresAt ?? null;
  return s.definition.mode === "confirmed_retest" && s.confirmationAt !== undefined
    ? Math.min(s.expiresAt, s.confirmationAt + s.definition.fillWindowMs)
    : s.expiresAt;
}

/** Human wording comes from the saved order policy, never a generic template. */
export function globalExecutionInstructions(report: GlobalReport): string | null {
  const p = report.discretionaryPlan, policy = p?.executionPolicy;
  if (!p || !policy || !p.priceZones) return null;
  const zh = report.lang === "zh", zone = globalPriceBandText(report, p.priceZones.entry);
  const frame = globalFrameReference(policy.eventTimeframe);
  const price = (value: number) => value.toLocaleString(zh ? "zh-CN" : "en-US", { maximumFractionDigits: report.snapshot.pricePrecision });
  const deadline = globalScenarioEntryDeadline(report) ?? policy.expiresAt;
  const setupExpiry = report.scenario?.expiresAt ?? policy.expiresAt;
  if (report.scenario?.state === "entry_observed") {
    return zh
      ? "已观察到价格进入本计划的入场区域，但这不代表实际成交或持仓。本次已观察机会不能再次作为新入场使用；保留所示价格用于复核。若确有成交，请单独记录实际价格、数量和保护措施；没有成交时，应等待有独立依据的新机会。"
      : "Price reached this setup's entry area; that observation does not establish an actual fill or position. This already-observed opportunity cannot be reused as a new entry. Its displayed prices remain for review. If you actually traded, record the fill price, quantity and protection separately; otherwise wait for a separate opportunity with its own evidence.";
  }
  if (report.scenario && ["invalidated", "expired", "completed"].includes(report.scenario.state)) {
    return zh
      ? `本次已定价机会已${report.scenario.state === "expired" ? "到期" : report.scenario.state === "invalidated" ? "失效" : "结束"}，不能作为新入场。保留所示价格用于复核；新机会必须有独立依据。价格路径观察不代表实际成交或盈亏。`
      : `This priced opportunity has ${report.scenario.state === "expired" ? "expired" : report.scenario.state === "invalidated" ? "been invalidated" : "ended"}; it supplies no new entry. Its prices remain for review. A new opportunity needs its own evidence. Price-path observations do not establish fills or PnL.`;
  }
  const family = {
    range_rotation: zh ? "区间边缘" : "range edge",
    ema_pullback: zh ? "趋势回调区域" : "trend pullback region",
    vwap_reversion: zh ? "VWAP 偏离区域" : "VWAP deviation region",
    breakout_retest: zh ? "突破边界" : "breakout boundary",
    level_retest: zh ? "结构区域" : "structural zone",
  }[p.family];
  const confirmationObserved = report.scenario?.confirmationAt !== undefined;
  const instruction = policy.mode === "passive_limit"
    ? zh
      ? `被动限价计划：仅在 ${zone} 的${family}考虑${p.side === "long" ? "买入" : "卖出"}。该计划不以随后出现的确认作为当前入场证据。`
      : `Passive limit plan: ${p.side === "long" ? "buy" : "sell"} only within ${zone} at the ${family}. This policy does not require a later confirmation to justify the limit entry.`
    : confirmationObserved
      ? zh
        ? `${frame} 的价格回测事件已经观察到。仅在所示 ${zone} 的回测区域复核入场；该事件不代表完整入场资格或实际成交。`
        : `The ${frame} price-retest event has been observed. Entry review remains limited to its ${zone} retest region; that observation alone establishes neither full entry eligibility nor a fill.`
      : zh
      ? `${frame} 必须先在 ${price(policy.sourceBoundary)} 的${family}完成${p.side === "long" ? "收复和守住回测" : "跌破和受阻回测"}，再仅在所示 ${zone} 回测区域考虑入场。确认收盘价不视为成交。`
      : `${frame} must establish ${p.side === "long" ? "acceptance above and a defended retest of" : "acceptance below and a rejected retest of"} the ${family} at ${price(policy.sourceBoundary)}. Entry is limited to its ${zone} retest region; a confirmation close is not an assumed fill.`;
  return [instruction,
    ...(globalOpposingEntryZones(report).length ? [zh ? "入场区域与反向结构区域重叠；已观察到的回测不能单独解决该障碍，入场前须重新评估。" : "Entry overlaps opposing structure. The observed retest does not resolve that obstacle; reassess before entry."] : []),
    zh ? `固定硬止损 ${price(p.stop)}；入场截止 ${executionTime(deadline)}。` : `Fixed hard SL ${price(p.stop)}; Entry deadline ${executionTime(deadline)}.`,
    ...(deadline < setupExpiry ? [zh ? `整体计划到期 ${executionTime(setupExpiry)}，不能延长本次已确认入场窗口。` : `Overall setup expiry ${executionTime(setupExpiry)} does not extend this confirmed entry window.`] : []),
    policy.mode === "passive_limit"
      ? zh ? "目标在入场前被触及或结构失效时取消本次机会。" : "Cancel this opportunity if its first objective is reached before entry or its structure fails."
      : zh ? "目标先被触及、结构失效或确认失败时取消本次机会。" : "Cancel this opportunity if its first objective is reached before entry, its structure fails or its confirmation fails.",
    zh ? "以上是已保存快照条件，执行前须重新检查当前入场资格。" : "These are saved snapshot conditions; recheck current entry eligibility before execution.",
  ].join(" ");
}

export function globalScenarioStateName(report: GlobalReport): string | null {
  const state = report.scenario?.state;
  if (!state) return null;
  const names = {
    awaiting_location: ["Awaiting entry area", "等待入场区域"],
    awaiting_event: ["Awaiting retest event", "等待回测事件"],
    confirmed_awaiting_fill: ["Price retest observed; entry pending", "已观察到价格回测，等待入场"],
    entry_observed: ["Entry price observed", "已观察到入场价"],
    invalidated: ["Opportunity invalidated", "机会已失效"],
    expired: ["Entry window expired", "入场窗口已到期"],
    completed: ["Price path ended", "价格路径已结束"],
  };
  return names[state][report.lang === "zh" ? 1 : 0];
}

export function globalScenarioLines(report: GlobalReport): string[] {
  const s = report.scenario;
  if (!s) return [];
  const zh = report.lang === "zh", date = executionTime, deadline = globalScenarioEntryDeadline(report) ?? s.expiresAt;
  return [
    `${zh ? "快照记录状态" : "Recorded snapshot state"}: ${globalScenarioStateName(report)} · ${zh ? "开始" : "Started"} ${date(s.startedAt)} · ${zh ? "入场截止" : "Entry deadline"} ${date(deadline)}`,
    ...(deadline < s.expiresAt ? [zh ? `整体计划到期 ${date(s.expiresAt)}；已确认入场窗口不会随之延长。` : `Overall setup expiry ${date(s.expiresAt)}; the confirmed entry window is not extended.`] : []),
    ...(s.confirmationAt !== undefined ? [`${zh ? "回测确认" : "Retest confirmation"}: ${date(s.confirmationAt)}`] : []),
    ...(s.entryObservedAt !== undefined ? [`${zh ? "入场价格触及" : "Entry price touch"}: ${date(s.entryObservedAt)}. ${zh ? "未断言实际成交。" : "No actual fill is asserted."}`] : []),
    ...(s.outcome?.kind === "ambiguous_bar" ? [zh ? "同一根 K 线触及多个价位，无法判断盘内顺序。" : "One candle crossed multiple order levels; its intrabar sequence is unresolved."] : []),
    zh ? "重复报告沿用同一机会的时钟和风险价格。K 线触价不代表订单成交、持仓或已实现盈亏。" : "Repeated reports retain this opportunity's clock and risk prices. Candle touches do not establish order fills, holdings or realized PnL.",
  ];
}
