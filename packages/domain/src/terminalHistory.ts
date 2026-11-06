/** Public exchange measurements. Every interval is [start,end), in UTC ms. */
export type TerminalHistoryGap = { start: number; end: number; reason: string };
export type TerminalHistoryInterval = { start: number; end: number };
export type TerminalSessionPreset = "day" | "previous-day" | "week" | "month" | "custom";
export type TerminalSessionWindow = { preset: TerminalSessionPreset; start: number; end: number };
export type TerminalHistoryProgress = {
  state: "queued" | "backfilling" | "collecting" | "complete" | "failed";
  pages: number; message?: string;
};
export type TerminalHistoryRow = { low: number; high: number; buy: number; sell: number; trades: number };
export type TerminalHistoryTotals = {
  buy: number; sell: number; trades: number;
  /** Sum(price*size) and sum(price*price*size), before price-row rounding. */
  notional: number; squaredNotional: number;
  open: number; high: number; low: number; close: number;
  firstTradeAt: number; lastTradeAt: number;
  firstTradeId?: string; lastTradeId?: string;
};
export type TerminalHistoryBar = TerminalHistoryTotals & {
  start: number; end: number; rows: TerminalHistoryRow[];
};
export type TerminalSessionHistory = {
  version: "terminal-session-history-v1";
  instId: string; marketType: "spot" | "perpetual"; quantityUnit: "base" | "contracts";
  source: string; requestedStart: number; requestedEnd: number; knownAt: number;
  status: "available" | "partial" | "collecting" | "unavailable" | "stale";
  priceStep: number; complete: boolean;
  intervals: TerminalHistoryInterval[]; gaps: TerminalHistoryGap[];
  totals: TerminalHistoryTotals | null; rows: TerminalHistoryRow[];
  /** Bounded server-selected bars; their intervals/rows retain real executions. */
  bars: TerminalHistoryBar[]; barMs: number; proofHashes?: string[];
  backfill: TerminalHistoryProgress;
};
export type TerminalBookHistoryFrame = {
  ts: number; knownAt: number; bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
  sequence?: number; sequenceVerified?: boolean;
};
export type TerminalLiquidityHistory = {
  version: "terminal-liquidity-history-v1";
  source: string; instrumentId: string; marketType: "spot" | "perpetual";
  quantityUnit: "base" | "contracts";
  requestedStart: number; requestedEnd: number; observedAt: number;
  status: "available" | "partial" | "collecting" | "unavailable" | "stale";
  sampleIntervalMs: number; priceStep: number; depthLevels: number;
  frames: TerminalBookHistoryFrame[]; gaps: TerminalHistoryGap[];
  retainedFrom?: number; retainedTo?: number;
  backfill: TerminalHistoryProgress;
};
