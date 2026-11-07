import type { IndicatorManifest, IndicatorResult } from "@pulse/domain";

/** Executed-volume indicators use their own pane and units, never the asset-price scale. */
export type TerminalChartIndicator = {
  id: string; title: string; units: string; status: string; source: string; instId?:string;
  windowStart: number; windowEnd: number; bucketMs?: number;
  points: Array<{ ts: number; value?: number }>;
};
export function terminalChartIndicator(manifest: IndicatorManifest, result: IndicatorResult, instId: string, stream: "spot" | "perpetual", bucketMs?: number): TerminalChartIndicator {
  const baseAsset=instId.split("-")[0];
  const output = manifest.kernel === "formula-v1" ? manifest.formula.output : undefined;
  const units = manifest.kernel === "executed-cvd-v1" ? stream === "spot" ? baseAsset : "contracts" : manifest.kernel === "buy-participation-v1" ? "%" : output?.unit === "volume" ? stream === "spot" ? baseAsset : "contracts" : output?.unit ?? "scalar";
  return { id: `${manifest.id}@${manifest.version}`, title: manifest.title, instId, units, status: result.status, source: result.provenance.source,
    windowStart: result.provenance.windowStart, windowEnd: result.provenance.windowEnd, bucketMs,
    points: result.points.map(point => ({ ts: point.ts, value: manifest.kernel === "executed-cvd-v1" ? point.cvd : manifest.kernel === "buy-participation-v1" ? point.participationBps === undefined ? undefined : point.participationBps / 100 : (point as typeof point & { value?: number }).value })) };
}
/** Preserve source time; insert whitespace at gaps rather than connecting unknown intervals. */
export function terminalIndicatorSeries(study: TerminalChartIndicator): Array<{ time: number; value?: number }> {
  const points = new Map<number, { time: number; value?: number }>();
  study.points.forEach((point, index) => {
    const previous = study.points[index - 1];
    if (previous && study.bucketMs && point.ts - previous.ts > study.bucketMs) {
      const time = Math.floor((previous.ts + study.bucketMs) / 1000);
      if (time < Math.floor(point.ts / 1000)) points.set(time, { time });
    }
    const time = Math.floor(point.ts / 1000);
    points.set(time, { time, ...(Number.isFinite(point.value) ? { value: point.value } : {}) });
  });
  return [...points.values()].sort((a, b) => a.time - b.time);
}
