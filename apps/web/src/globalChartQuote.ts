import type { GlobalReport } from "@pulse/domain";

export type GlobalChartCurrentQuote = { price: number; ts: number; source?: string; observedAt?: number };
export type GlobalChartQuote = GlobalChartCurrentQuote & { kind: "current" | "snapshot" };
export const GLOBAL_CHART_QUOTE_MAX_AGE_MS = 90_000;

/** A completed candle is never a fallback for a missing current quote. */
export function resolveGlobalChartQuote(report: GlobalReport, current: GlobalChartCurrentQuote | undefined, now: number): GlobalChartQuote | null {
  const valid = (quote: GlobalChartCurrentQuote | undefined) => Boolean(quote && Number.isFinite(quote.price) && quote.price > 0 && Number.isFinite(quote.ts) && quote.ts > 0 && quote.ts <= now + 5_000);
  if (valid(current) && now - current!.ts <= GLOBAL_CHART_QUOTE_MAX_AGE_MS) return { ...current!, kind: "current" };
  const saved = report.currentMarket?.quote;
  return valid(saved) ? { ...saved!, source: report.currentMarket?.source, kind: "snapshot" } : null;
}

/** Include every candle intersecting the visible logical window, including
 * wicks. Whitespace used for the plan does not become an artificial candle. */
export function globalVisibleCandleExtrema(candles: ReadonlyArray<{ low: number; high: number }>, range: { from: number; to: number } | null): { minValue: number; maxValue: number } | null {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to < 0 || range.from >= candles.length) return null;
  const first = Math.max(0, Math.floor(range.from)), last = Math.min(candles.length - 1, Math.ceil(range.to));
  const visible = candles.slice(first, last + 1);
  if (!visible.length) return null;
  return { minValue: Math.min(...visible.map(c => c.low)), maxValue: Math.max(...visible.map(c => c.high)) };
}

/** LWC logical indices belong to the union of all plotted timestamps. A minute
 * indicator can insert thousands of points between daily/weekly candles, so
 * candle selection must use the actual visible time range. Values are seconds. */
export function globalVisibleTimeCandleExtrema(candles: ReadonlyArray<{ ts: number; low: number; high: number }>, range: { from: unknown; to: unknown } | null): { minValue: number; maxValue: number } | null {
  if (!range || typeof range.from !== "number" || typeof range.to !== "number") return null;
  const visible = candles.filter(c => c.ts >= (range.from as number) * 1000 && c.ts <= (range.to as number) * 1000);
  return visible.length ? { minValue: Math.min(...visible.map(c => c.low)), maxValue: Math.max(...visible.map(c => c.high)) } : null;
}
/** Reserve plan space using actual union-axis indices, never candle counts. */
export function globalLogicalSetupWindow(first: number, last: number, width: number, full = false): { from: number; to: number } {
  const count = Math.max(1, last - first + 1), reserved = Math.min(width * .55, Math.max(300, width * .28));
  return { from: full ? first - 5 : first, to: last + Math.ceil(count * reserved / Math.max(1, width - reserved)) };
}
