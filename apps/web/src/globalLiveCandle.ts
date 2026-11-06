import { candleCloseTime, type GlobalReport } from "@pulse/domain";
import type { GlobalChartCurrentQuote } from "./globalChartQuote";

export type GlobalLiveCandle = {
  instId: string; timeframe: string; observedAt: number;
  candle: { ts: number; open: number; high: number; low: number; close: number; volume: number; confirmed: false };
};
/** Only the exchange-supplied developing candle may receive ticker updates.
 * Completed candles and the saved analysis remain immutable. */
export function globalLiveCandle(report: GlobalReport, live: GlobalLiveCandle | undefined, quote: GlobalChartCurrentQuote | undefined, now: number): GlobalLiveCandle["candle"] | null {
  if (!live || live.instId !== report.snapshot.instId || live.timeframe !== report.snapshot.timeframe || !Number.isFinite(live.observedAt) || live.observedAt > now + 5000 || now - live.observedAt > 90000) return null;
  const c = live.candle, end = candleCloseTime(c.ts, live.timeframe);
  if (c.confirmed !== false || !Number.isSafeInteger(c.ts) || c.ts <= (report.candles.at(-1)?.ts ?? 0) || !end || c.ts > now || end <= now || ![c.open,c.high,c.low,c.close].every(n=>Number.isFinite(n)&&n>0) || !Number.isFinite(c.volume) || c.volume < 0 || c.high < Math.max(c.open,c.close) || c.low > Math.min(c.open,c.close)) return null;
  const price = quote && Number.isFinite(quote.price) && quote.price>0 && quote.ts>=c.ts && quote.ts<end && quote.ts<=now+5000 && now-quote.ts<=30000 ? quote.price : c.close;
  return {...c,close:price,high:Math.max(c.high,price),low:Math.min(c.low,price)};
}
