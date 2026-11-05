export type TerminalLiveQuote = { instId: string; price: number; ts: number; source: string; observedAt: number };
/** A frame change cannot rewind the asset ticker to a completed candle or an
 * older HTTP response. The server clock, not the browser wall clock, dates it. */
export function terminalAcceptLiveQuote(previous: TerminalLiveQuote | null, incoming: TerminalLiveQuote, instId: string, now: number): TerminalLiveQuote | null {
  if (incoming.instId !== instId || incoming.source !== "okx-public-spot" || !Number.isFinite(incoming.price) || incoming.price <= 0 || !Number.isSafeInteger(incoming.ts) || !Number.isSafeInteger(incoming.observedAt) || !Number.isFinite(now) || incoming.ts > now + 5000 || now - incoming.ts > 30000) return previous?.instId === instId ? previous : null;
  if (previous?.instId === instId && previous.ts >= incoming.ts) return previous;
  return incoming;
}
