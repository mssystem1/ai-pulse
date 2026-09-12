export type PerformanceFill = {
  id: string; source: string; kind: string; status: string; pair?: string; txHash?: string;
  fillSide?: "buy" | "sell"; fillQuantity?: number; fillQuoteValue?: number;
  fillBaseAsset?: string; fillQuoteAsset?: string; fillObservedAt?: string; createdAt: string;
};

/** Average-cost realized return from confirmed executions, never an average of percentages. */
export function spotTradePerformance(activity: readonly PerformanceFill[], marks: Readonly<Record<string, number>> = {}) {
  const lots = new Map<string, { quantity: number; cost: number; unknown: boolean; pair?: string }>();
  const quoteAssets = new Set<string>();
  const seen = new Set<string>();
  let realized = 0, matchedCost = 0, verifiedFills = 0, unpricedFills = 0, unmatchedSells = 0;
  const items = activity.filter(item => item.status === "confirmed" && item.source !== "autopilot"
    && /^(market_(buy|sell)|automatic_(fill|entry_protected|take_profit|stop_loss))$/.test(item.kind))
    .slice().sort((a, b) => Date.parse(a.fillObservedAt || a.createdAt) - Date.parse(b.fillObservedAt || b.createdAt));
  for (const item of items) {
    const side = item.fillSide, quantity = item.fillQuantity, value = item.fillQuoteValue;
    const key = item.fillBaseAsset && item.fillQuoteAsset ? `${item.fillBaseAsset.toLowerCase()}:${item.fillQuoteAsset.toLowerCase()}` : item.pair || "unknown";
    const identity = item.txHash ? `${item.txHash.toLowerCase()}:${side || item.kind}` : item.id;
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (!item.txHash || !side || !Number.isFinite(quantity) || quantity! <= 0 || !Number.isFinite(value) || value! <= 0 || !item.fillBaseAsset || !item.fillQuoteAsset) {
      unpricedFills++;
      continue;
    }
    verifiedFills++;
    quoteAssets.add(item.fillQuoteAsset.toLowerCase());
    const lot = lots.get(key) || { quantity: 0, cost: 0, unknown: false, pair: item.pair };
    if (side === "buy") { lot.quantity += quantity!; lot.cost += value!; }
    else if (quantity! > lot.quantity + Math.max(1e-12, lot.quantity * 1e-9) || lot.unknown) {
      // Inventory from outside this history has no known cost basis.
      unmatchedSells++; lot.unknown = true;
    } else {
      const cost = lot.quantity > 0 ? lot.cost * Math.min(1, quantity! / lot.quantity) : 0;
      realized += value! - cost; matchedCost += cost;
      lot.quantity = Math.max(0, lot.quantity - quantity!); lot.cost = Math.max(0, lot.cost - cost);
    }
    lots.set(key, lot);
  }
  const complete = unpricedFills === 0 && unmatchedSells === 0 && quoteAssets.size <= 1;
  const open = [...lots.values()].filter(lot => lot.quantity > 0);
  const openCost = open.reduce((sum, lot) => sum + lot.cost, 0);
  const marked = complete && open.length > 0 && open.every(lot => !lot.unknown && lot.pair && Number.isFinite(marks[lot.pair]) && marks[lot.pair] > 0);
  const openPnl = marked ? open.reduce((sum, lot) => sum + lot.quantity * marks[lot.pair!] - lot.cost, 0) : null;
  return { realized: complete && matchedCost > 0 ? realized : null,
    realizedPct: complete && matchedCost > 0 ? realized / matchedCost * 100 : null,
    matchedCost, verifiedFills, unpricedFills, unmatchedSells, complete,
    openCost, openPnl, openPnlPct: openPnl !== null && openCost > 0 ? openPnl / openCost * 100 : null };
}
