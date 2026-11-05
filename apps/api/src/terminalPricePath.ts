import { createHash } from "node:crypto";
import { candleCloseTime, candleTimeframeMs, type GlobalReport, type GlobalScenarioDefinition, type GlobalScenarioEvent } from "@pulse/schemas";

/** Finer bars observe prices, never the strategy's confirmation rules. In
 * particular a daily/4H confirmation policy must not wait four hours to learn
 * that its original TP was already crossed before a future entry. */
export function terminalPricePathEvents(source: GlobalReport, definition: GlobalScenarioDefinition, asOf: number, quoteCurrency: string): GlobalScenarioEvent[] {
  if (`${source.snapshot.source}:${source.snapshot.instId}` !== definition.market || source.snapshot.priceCurrency !== quoteCurrency || source.currentMarket?.source !== source.snapshot.source || !Number.isFinite(asOf)) return [];
  const policyMs = candleTimeframeMs(definition.eventTimeframe);
  const frame = source.currentMarket.frames.filter(f => candleTimeframeMs(f.timeframe) > 0 && candleTimeframeMs(f.timeframe) < policyMs).sort((a, b) => candleTimeframeMs(a.timeframe) - candleTimeframeMs(b.timeframe))[0];
  if (!frame) return [];
  const result: GlobalScenarioEvent[] = [];
  for (const candle of frame.candles) {
    const at = candleCloseTime(candle.ts, frame.timeframe);
    if (!candle.confirmed || at === null || at > asOf || candle.ts < definition.createdAt || candle.ts < definition.sourceKnownAt || ![candle.open, candle.high, candle.low, candle.close].every(price => Number.isFinite(price) && price > 0) || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.high < candle.low) continue;
    const event = (kind: GlobalScenarioEvent["kind"], price: number, targetId?: string) => {
      const digest = createHash("sha256").update(JSON.stringify([definition.market, frame.timeframe, kind, at, candle.ts, price, targetId])).digest("hex").slice(0, 32);
      result.push({ id: `tgpe_${frame.timeframe}_${digest}`, kind, at, candleTs: candle.ts, price, basis: "completed_candle", ...(targetId ? { targetId } : {}) });
    };
    if (candle.low <= definition.entryZone[1] && candle.high >= definition.entryZone[0]) {
      // The zone can be wider than this entire finer bar. Its outer boundary
      // is not necessarily a traded price; retain a price inside the actual
      // observed overlap without changing the bound entry/risk contract.
      const edge = definition.side === "long" ? definition.entryZone[1] : definition.entryZone[0];
      event("entry_touch", Math.max(candle.low, Math.min(candle.high, edge)));
    }
    if (definition.side === "long" ? candle.low <= definition.hardStop : candle.high >= definition.hardStop) event("stop_touch", definition.hardStop);
    for (const target of definition.targets) if (definition.side === "long" ? candle.high >= target.lower : candle.low <= target.upper) event("target_touch", definition.side === "long" ? target.lower : target.upper, target.id);
  }
  return result;
}
