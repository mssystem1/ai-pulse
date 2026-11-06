import type { TerminalMarket, TerminalToolStatus } from "./terminalClient";

export function terminalPricePrecision(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value >= 100) return 2;
  return value >= 1 ? 4 : value >= .01 ? 6 : 8;
}

export function terminalPositionQuantity(size: number, unit: "quote" | "base" | "margin", price: number, leverage = 1): number | null {
  if (![size, price, leverage].every(Number.isFinite) || size <= 0 || price <= 0 || leverage < 1 || leverage > 200) return null;
  const quantity = unit === "base" ? size : size * (unit === "margin" ? leverage : 1) / price;
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

export function terminalDurationLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "Unknown window";
  if (ms < 1000) return "Less than a second";
  const seconds = Math.floor(ms / 1000), days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function terminalCoverageLabel(source: TerminalToolStatus): string {
  if (source.status === "unavailable") return "Source unavailable";
  if (source.status === "stale") return "Update needed";
  if (source.id === "liquidity") return "Order book now";
  if (source.source === "okx-retained-executions") return source.status === "available" ? "Complete session" : "Developing session";
  if (source.status === "partial") return "Recent executions";
  return "Source ready";
}

export function terminalValueReading(market: TerminalMarket): { title: string; observation: string; next: string } {
  const value = market.tools.value, price = market.report.currentMarket?.quote?.price, profile = value.sessionProfile ?? value.orderFlow?.profile;
  if (["stale", "unavailable"].includes(value.status) || !(typeof price === "number" && Number.isFinite(price)) || !profile) return { title: "Check the source first", observation: "This view needs a fresh quote and an executed-volume profile from the stated window.", next: "Refresh evidence before using this measurement to judge an entry." };
  if (price > profile.vah) return { title: "Price is above recent traded value", observation: "The quote at this evidence capture is above the execution window's value-area high. That locates price; it does not establish a breakout.", next: "Watch the value-area high: a later hold above supports acceptance; a return inside calls that move into question. Use Radar to monitor that sequence." };
  if (price < profile.val) return { title: "Price is below recent traded value", observation: "The quote at this evidence capture is below the execution window's value-area low. Sellers moved price below the sampled value area.", next: "Watch the value-area low: a reclaim and later hold can support a recovery review; continued acceptance below keeps that recovery unproven." };
  return { title: "Price is inside recent traded value", observation: "The quote at this evidence capture is between the window's value-area low and high. Neither side established a break from that area.", next: "Use the edges for a rejection or acceptance watch. The point of control marks concentrated execution, not a reason to trade the middle." };
}

export const TERMINAL_RADAR_STEPS: Record<string, string[]> = {
  sweep_reclaim: ["A new candle trades beyond the level", "A later candle closes back inside", "Another candle holds inside"],
  breakout_acceptance: ["A candle closes beyond the level", "A later retest closes outside", "Another candle holds outside"],
  breakout_failure: ["A candle closes beyond the level", "A later candle returns inside", "Another candle holds inside"],
};
export function terminalNextRadarClose(frame: string, now: number): number | null {
  const step = ({ "5m": 300000, "15m": 900000, "1H": 3600000, "4H": 14400000, "1Dutc": 86400000, "1D": 86400000 } as Record<string, number>)[frame];
  // An in-progress candle began before the detector and is historical for it.
  return step && Number.isFinite(now) ? (Math.ceil(now / step) + 1) * step : null;
}
