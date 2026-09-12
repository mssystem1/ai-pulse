import type { CandlestickData, SeriesMarkerBar, UTCTimestamp } from "lightweight-charts";
import type { MarketCandle, TradeMarker } from "./marketPreview";

export const CANDLE_UP = "#26a69a";
export const CANDLE_DOWN = "#ef5350";

/** The chart requires unique, ascending UTC seconds. Never synthesize missing bars. */
export function chartCandles(candles: readonly MarketCandle[]): CandlestickData<UTCTimestamp>[] {
  const rows = new Map<number, CandlestickData<UTCTimestamp>>();
  for (const c of candles) {
    if (![c.ts, c.open, c.high, c.low, c.close].every(Number.isFinite) || c.ts <= 0 || c.low <= 0 || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) continue;
    const time = Math.floor(c.ts / 1000) as UTCTimestamp;
    rows.set(time, { time, open: c.open, high: c.high, low: c.low, close: c.close });
  }
  return [...rows.values()].sort((a, b) => a.time - b.time);
}

export function timeframeSeconds(frame: string) {
  const match = /^(\d+)(m|H|D)$/.exec(frame);
  return match ? Number(match[1]) * ({ m: 60, H: 3600, D: 86400 }[match[2]] || 0) : 0;
}

/** Above/below-bar markers cannot distort the market price scale with DEX fill prices. */
export function chartFillMarkers(fills: readonly TradeMarker[], bars: readonly CandlestickData<UTCTimestamp>[], frame: string): SeriesMarkerBar<UTCTimestamp>[] {
  const interval = timeframeSeconds(frame);
  if (!interval || !bars.length) return [];
  const groups = new Map<string, { time: UTCTimestamp; side: "buy" | "sell"; count: number }>();
  const seen = new Set<string>();
  for (const fill of fills) {
    if (!Number.isFinite(fill.ts) || !Number.isFinite(fill.price) || fill.price <= 0 || seen.has(fill.id)) continue;
    seen.add(fill.id);
    const time = fill.ts / 1000;
    let low = 0, high = bars.length - 1, index = -1;
    while (low <= high) { const mid = (low + high) >>> 1; if (bars[mid].time <= time) { index = mid; low = mid + 1; } else high = mid - 1; }
    if (index < 0 || time >= bars[index].time + interval) continue;
    const bar = bars[index], key = `${bar.time}:${fill.side}`, group = groups.get(key);
    if (group) group.count++; else groups.set(key, { time: bar.time, side: fill.side, count: 1 });
  }
  return [...groups.values()].sort((a, b) => a.time - b.time || a.side.localeCompare(b.side)).map(group => ({
    time: group.time, id: `${group.time}:${group.side}`, position: group.side === "buy" ? "belowBar" : "aboveBar",
    shape: group.side === "buy" ? "arrowUp" : "arrowDown", color: group.side === "buy" ? CANDLE_UP : CANDLE_DOWN,
    text: `${group.side === "buy" ? "B" : "S"}${group.count > 1 ? ` ×${group.count}` : ""}`, size: 1,
  }));
}

export function readableCandleCount(width: number) {
  return Math.max(16, Math.min(72, Math.floor((width - 80) / 9)));
}

export function candlePriceStep(bars: readonly CandlestickData<UTCTimestamp>[]) {
  const minimum = Math.min(...bars.map(bar => bar.low));
  return Number.isFinite(minimum) && minimum > 0 ? 10 ** Math.min(-2, Math.floor(Math.log10(minimum)) - 4) : .01;
}
