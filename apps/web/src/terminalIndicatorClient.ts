import { parseIndicatorPackage, type IndicatorInput, type IndicatorKernel, type IndicatorManifest } from "@pulse/domain";
import type { TerminalMarket } from "./terminalClient";

export type IndicatorListing = { id: string; manifestId: string; version: string; title: string; description: string; author: string; kernel: IndicatorKernel; publisher: string | null; createdAt: string | null; canDelete: boolean; hosted: boolean };
export const indicatorIdentity = (manifest: IndicatorManifest) => `${manifest.id}@${manifest.version}`;
export function indicatorInputFromMarket(market: TerminalMarket, stream: "spot" | "perpetual", now = Date.now()): IndicatorInput {
  const flow = stream === "spot" ? market.tools.flow : market.tools.perpetualFlow;
  const points = flow?.displayPoints ?? flow?.points ?? [];
  const start = flow?.windowStart ?? points[0]?.ts ?? now - 60000, end = flow?.windowEnd ?? points.at(-1)?.ts! + 1;
  return { instId: market.instId, timeframe: market.timeframe, source: flow?.source ?? "unavailable-perpetual-executions", status: flow?.status ?? "unavailable", knownAt: flow?.knownAt ?? 0,
    windowStart: start, windowEnd: Number.isSafeInteger(end) && end > start ? end : start + 1, units: stream === "spot" ? "base" : "contracts", now,
    // Assessment samples start inside a UTC display bucket. Its quantities
    // already contain only captured executions; clip the label's boundaries
    // rather than pretending earlier trades were observed or dropping volume.
    points: points.map(point => ({ ts: Math.max(start, point.ts), ...("end" in point && typeof point.end === "number" ? { end: Math.min(end, point.end) } : {}), buy: point.buy, sell: point.sell })) };
}
/** Store calculation packages only, never market data or wallet credentials. */
export function loadInstalledIndicators(storage: Pick<Storage, "getItem">, defaults: IndicatorManifest[]): IndicatorManifest[] {
  const raw = storage.getItem("pulse-indicators-v1");
  if (raw === null) return defaults.slice(0, 1);
  if (raw.length > 4_800_000) throw Error("Saved indicator library is too large; remove its browser storage to reset it");
  const items: unknown = JSON.parse(raw);
  if (!Array.isArray(items) || items.length > 8) throw Error("Saved indicator library is invalid");
  const valid = items.map(parseIndicatorPackage);
  if (new Set(valid.map(indicatorIdentity)).size !== valid.length) throw Error("Duplicate installed indicator version");
  return valid;
}
export function installIndicator(current: IndicatorManifest[], candidate: unknown): IndicatorManifest[] {
  const valid = parseIndicatorPackage(candidate), identity = indicatorIdentity(valid);
  const same = current.find(item => indicatorIdentity(item) === identity);
  if (same) { if (JSON.stringify(same) !== JSON.stringify(valid)) throw Error("This indicator version is already installed with different content"); return current; }
  if (current.length >= 8) throw Error("Keep up to eight installed indicators; remove one before adding another");
  return [...current, valid];
}
