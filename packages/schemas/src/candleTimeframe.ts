export type CandleTimeframeUnit = "minute" | "hour" | "day" | "week" | "month";

export function parseCandleTimeframe(value: string): { count: number; unit: CandleTimeframeUnit; utc: boolean } | null {
  const match = /^(\d+)(m|H|D|W|M)(utc)?$/i.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 1) return null;
  // Case matters: m is a minute and M is a calendar month.
  const unit = match[2] === "M" ? "month" : match[2].toLowerCase() === "m" ? "minute"
    : ({ h: "hour", d: "day", w: "week" } as const)[match[2].toLowerCase() as "h" | "d" | "w"];
  return { count: Number(match[1]), unit, utc: Boolean(match[3]) };
}

/** Calendar months deliberately have no fixed millisecond duration. */
export function candleTimeframeMs(value: string): number {
  const frame = parseCandleTimeframe(value);
  if (!frame || frame.unit === "month") return 0;
  return frame.count * { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }[frame.unit];
}

/** OKX unsuffixed calendar bars open in UTC+8; utc bars open in UTC. */
export function candleCloseTime(ts: number, value: string): number | null {
  const frame = parseCandleTimeframe(value);
  if (!frame || !Number.isFinite(ts)) return null;
  if (frame.unit !== "month") return ts + candleTimeframeMs(value);
  const offset = frame.utc ? 0 : 8 * 3_600_000;
  const date = new Date(ts + offset);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + frame.count,
    date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()) - offset;
}
