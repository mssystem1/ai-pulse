import type {GlobalReport} from "@pulse/schemas";
import {globalFrameReference} from "./globalContext.js";

/** Requested history depth is different from minimum usable study history. */
export function globalCoverageLine(report:GlobalReport):string|null{
  if(!report.decisionVersion||report.candles.length>=520)return null;
  return report.lang==="zh"?`历史覆盖：请求 520 根，来源返回 ${report.candles.length} 根完整 ${globalFrameReference(report.snapshot.timeframe)} K 线。更早历史不可用；本报告保留此覆盖限制。`:`History coverage: ${report.candles.length} of 520 requested completed ${globalFrameReference(report.snapshot.timeframe)} candles returned by the source. Earlier history is unavailable in this response; this coverage limit is retained.`;
}
