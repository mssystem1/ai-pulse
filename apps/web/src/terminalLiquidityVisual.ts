import type { TerminalBookHistoryFrame, TerminalHistoryGap, TerminalLiquidityHistory } from "@pulse/domain";

export type TerminalLiquidityColumn = {
  start: number; end: number; observations: number;
  frame: TerminalBookHistoryFrame | null;
  bids: number[]; asks: number[]; mid: number | null;
};
export type TerminalLiquiditySample = {
  start: number; end: number; frame: TerminalBookHistoryFrame;
  bids: number[]; asks: number[]; mid: number;
  lowestBid: number; highestAsk: number;
};
export type TerminalLiquidityModel = {
  start: number; end: number; low: number; high: number; priceStep: number;
  rowCount: number; columns: TerminalLiquidityColumn[]; frameCount: number;
  representedFrames: number; maxSize: number; gaps: TerminalHistoryGap[];
  samples: TerminalLiquiditySample[];
  midSegments: Array<Array<{ column: number; price: number; at: number }>>;
};
export type TerminalLiquidityCell = {
  column: number; row: number; start: number; end: number; low: number; high: number;
  sourceAt: number | null; knownAt: number | null; bid: number | null; ask: number | null;
  observations: number; gaps: TerminalHistoryGap[];
};

const finitePositive = (value: number) => Number.isFinite(value) && value > 0;
const validLevel = (level: { price: number; size: number }) => finitePositive(level.price) && Number.isFinite(level.size) && level.size >= 0;
function latestSample(samples: TerminalLiquiditySample[], start: number, end: number): TerminalLiquiditySample | undefined {
  for (let index = samples.length - 1; index >= 0; index--) if (samples[index].start >= start && samples[index].start < end) return samples[index];
}

/** Price bins sum levels inside one real order-book snapshot. Time columns
 * select their latest observation; repeated snapshots never become volume. */
export function terminalLiquidityModel(history: TerminalLiquidityHistory, maximumColumns = 320, maximumRows = 80): TerminalLiquidityModel | null {
  const start = history.requestedStart, end = history.requestedEnd;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(history.observedAt) || !finitePositive(history.priceStep) || !finitePositive(history.sampleIntervalMs)) return null;
  const unique = new Map<number, TerminalBookHistoryFrame>();
  for (const raw of history.frames) {
    if (!Number.isFinite(raw.ts) || raw.ts < start || raw.ts >= end || !Number.isFinite(raw.knownAt) || raw.knownAt < raw.ts || raw.knownAt > history.observedAt + 5_000) continue;
    const bids = raw.bids.filter(validLevel).sort((a, b) => b.price - a.price), asks = raw.asks.filter(validLevel).sort((a, b) => a.price - b.price);
    if (!bids.length || !asks.length || bids[0].price >= asks[0].price || unique.has(raw.ts)) continue;
    unique.set(raw.ts, { ...raw, bids, asks });
  }
  const frames = [...unique.values()].sort((a, b) => a.ts - b.ts);
  if (!frames.length) return null;
  const allPrices = frames.flatMap(frame => [...frame.bids, ...frame.asks].map(level => level.price));
  const min = allPrices.reduce((v,p)=>Math.min(v,p),Infinity), max = allPrices.reduce((v,p)=>Math.max(v,p),-Infinity), rowLimit = Number.isFinite(maximumRows) ? Math.min(800, Math.max(2, Math.floor(maximumRows))) : 80;
  const priceStep = history.priceStep * Math.max(1, Math.ceil((max - min) / history.priceStep / rowLimit));
  const low = Math.floor(min / priceStep) * priceStep, high = Math.max(low + priceStep, Math.ceil(max / priceStep) * priceStep + priceStep);
  const rowCount = Math.max(1, Math.round((high - low) / priceStep));
  const count = Math.max(1, Math.min(Number.isFinite(maximumColumns) ? Math.max(1, Math.floor(maximumColumns)) : 320, Math.ceil((end - start) / history.sampleIntervalMs)));
  const width = (end - start) / count;
  const columns: TerminalLiquidityColumn[] = Array.from({ length: count }, (_, i) => ({ start: start + i * width, end: start + (i + 1) * width, observations: 0, frame: null, bids: Array(rowCount).fill(0), asks: Array(rowCount).fill(0), mid: null }));
  for (const frame of frames) {
    const column = columns[Math.min(count - 1, Math.floor((frame.ts - start) / width))];
    column.observations++; column.frame = frame;
  }
  const gaps = history.gaps.filter(gap => Number.isFinite(gap.start) && Number.isFinite(gap.end) && gap.end > start && gap.start < end && gap.end > gap.start).map(gap => ({ ...gap, start: Math.max(start, gap.start), end: Math.min(end, gap.end) }));
  let maxSize = 0;
  const samples: TerminalLiquiditySample[] = [];
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    // A known missing interval overrides a broad sampling bucket. Never paint
    // across it or resume an old snapshot on the far side of the interruption.
    if (gaps.some(gap => gap.start <= frame.ts && gap.end > frame.ts)) continue;
    const interruption = gaps.filter(gap => gap.start > frame.ts).reduce((first, gap) => Math.min(first, gap.start), Infinity);
    const sampleEnd = Math.min(end, frame.ts + history.sampleIntervalMs, frames[index + 1]?.ts ?? end, interruption);
    if (sampleEnd <= frame.ts) continue;
    const sample: TerminalLiquiditySample = { start: frame.ts, end: sampleEnd, frame, bids: Array(rowCount).fill(0), asks: Array(rowCount).fill(0), mid: (frame.bids[0].price + frame.asks[0].price) / 2, lowestBid: frame.bids.at(-1)!.price, highestAsk: frame.asks.at(-1)!.price };
    for (const side of ["bids", "asks"] as const) for (const level of frame[side]) {
      const row = Math.min(rowCount - 1, Math.max(0, Math.floor((level.price - low) / priceStep)));
      sample[side][row] += level.size; maxSize = Math.max(maxSize, sample[side][row]);
    }
    samples.push(sample);
  }
  for (const column of columns) {
    const sample = latestSample(samples, column.start, column.end);
    column.frame = sample?.frame ?? null;
    column.bids = sample?.bids ?? column.bids; column.asks = sample?.asks ?? column.asks; column.mid = sample?.mid ?? null;
  }
  const midSegments: TerminalLiquidityModel["midSegments"] = [];
  let segment: TerminalLiquidityModel["midSegments"][number] = [];
  samples.forEach((sample, index) => {
    const previous = samples[index - 1];
    if (previous && previous.end < sample.start) { if (segment.length) midSegments.push(segment); segment = []; }
    segment.push({ column: Math.min(count - 1, Math.floor((sample.start - start) / width)), at: sample.start, price: sample.mid });
  });
  if (segment.length) midSegments.push(segment);
  return { start, end, low, high, priceStep, rowCount, columns, frameCount: frames.length, representedFrames: samples.length, maxSize, gaps, samples, midSegments };
}

/** Unknown time columns stay null, rather than implying an empty order book. */
export function terminalLiquidityCell(model: TerminalLiquidityModel, columnIndex: number, rowIndex: number, at?: number): TerminalLiquidityCell | null {
  if (!Number.isInteger(columnIndex) || !Number.isInteger(rowIndex) || columnIndex < 0 || columnIndex >= model.columns.length || rowIndex < 0 || rowIndex >= model.rowCount) return null;
  const column = model.columns[columnIndex], low = model.low + rowIndex * model.priceStep;
  const sample = at === undefined ? latestSample(model.samples, column.start, column.end) : Number.isFinite(at) && at >= column.start && at < column.end ? model.samples.find(item => item.start <= at && item.end > at) : undefined;
  return { column: columnIndex, row: rowIndex, start: column.start, end: column.end, low, high: low + model.priceStep, sourceAt: sample?.frame.ts ?? null, knownAt: sample?.frame.knownAt ?? null, bid: sample && low + model.priceStep > sample.lowestBid ? sample.bids[rowIndex] : null, ask: sample && low <= sample.highestAsk ? sample.asks[rowIndex] : null, observations: column.observations, gaps: model.gaps.filter(gap => gap.start < column.end && gap.end > column.start) };
}

export function terminalLiquidityIntensity(size: number, maximum: number, logarithmic = true): number {
  if (!finitePositive(size) || !finitePositive(maximum)) return 0;
  return Math.max(0, Math.min(1, logarithmic ? Math.log1p(size) / Math.log1p(maximum) : size / maximum));
}
