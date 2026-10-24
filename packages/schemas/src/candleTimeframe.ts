export type CandleTimeframeUnit = "minute" | "hour" | "day" | "week" | "month";

export function parseCandleTimeframe(value: string): { count: number; unit: CandleTimeframeUnit; utc: boolean } | null {
  const match = /^(\d+)(m|H|D|W|M)(utc)?$/i.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 1) return null;
  // Case matters: m is a minute and M is a calendar month.
  const unit = match[2] === "M" ? "month" : match[2].toLowerCase() === "m" ? "minute"
    : ({ h: "hour", d: "day", w: "week" } as const)[match[2].toLowerCase() as "h" | "d" | "w"];
  return { count: Number(match[1]), unit, utc: Boolean(match[3]) };
}

// Close-time checks are hot in causal entry validation. Cache only immutable
// timeframe metadata, never market observations or public parser return values.
const fixedUnitMs={minute:60_000,hour:3_600_000,day:86_400_000,week:604_800_000} as const;
const clockMetadata=new Map<string,{frame:NonNullable<ReturnType<typeof parseCandleTimeframe>>;duration:number}|null>();
function timeframeClock(value:string){
  const cached=clockMetadata.get(value);if(cached!==undefined)return cached;
  const frame=parseCandleTimeframe(value),result=frame?{frame,duration:frame.unit==="month"?0:frame.count*fixedUnitMs[frame.unit]}:null;
  if(clockMetadata.size>=128){const first=clockMetadata.keys().next().value;if(first!==undefined)clockMetadata.delete(first);}
  clockMetadata.set(value,result);return result;
}

/** Calendar months deliberately have no fixed millisecond duration. */
export function candleTimeframeMs(value: string): number {
  return timeframeClock(value)?.duration??0;
}

/** OKX unsuffixed calendar bars open in UTC+8; utc bars open in UTC. */
export function candleCloseTime(ts: number, value: string): number | null {
  const clock=timeframeClock(value),frame=clock?.frame;
  if (!clock||!frame || !Number.isFinite(ts)) return null;
  if (frame.unit !== "month") return ts + clock.duration;
  const offset = frame.utc ? 0 : 8 * 3_600_000;
  const date = new Date(ts + offset);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + frame.count,
    date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()) - offset;
}
