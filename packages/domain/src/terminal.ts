import type {GlobalReport, GlobalOrderFlow} from "@pulse/schemas";

export const TERMINAL_TIMEFRAMES = ["15m", "1H", "4H", "1Dutc", "1Wutc"] as const;
export type TerminalTimeframe = typeof TERMINAL_TIMEFRAMES[number];
export type TerminalDataStatus = "available" | "partial" | "stale" | "unavailable";
/** Distinguishes a validated recent capture from the much broader value horizon
 * requested by the selected chart. Missing history is never candle-derived. */
export type TerminalExecutedCoverage = {
  requestedStart:number;requestedEnd:number;capturedStart:number;capturedEnd:number;
  firstTradeAt:number;lastTradeAt:number;tradeCount:number;
  completeRequestedWindow:boolean;completeCapturedInterval:boolean;horizon:string;
};
export type TerminalSourceStatus = {
  id:string; source:string; status:TerminalDataStatus; reason?:string;
  windowStart?:number; windowEnd?:number; knownAt:number; units?:string;
  coverage?:TerminalExecutedCoverage;
};
export type TerminalToolBase = TerminalSourceStatus & {label:string};
export type TerminalFlowDisplayPoint = {
  ts:number;end:number;buy:number;sell:number;delta:number;cvd:number;
  priceOpen:number;priceHigh:number;priceLow:number;priceClose:number;tradeCount:number;
};
export type TerminalFlowTool = TerminalToolBase & {
  points:{ts:number;buy:number;sell:number;delta:number;cvd:number}[];
  /** Authoritative source gaps can occur inside an aggregated display bucket. */
  missingIntervals?:{start:number;end:number}[];
  /** Adaptive sample-only display; execution-frame observations stay in points. */
  displayPoints?:TerminalFlowDisplayPoint[];displayBucketMs?:number;
  buy?:number;sell?:number;delta?:number;marketType:"spot"|"perpetual";
};
export type TerminalMarketTools = {
  value:TerminalToolBase & {tradeVwap?:number;sigma?:number;bands?:{lower:number;upper:number;deviations:number}[];orderFlow?:GlobalOrderFlow;sessionProfile?:GlobalOrderFlow["profile"];sessionFootprints?:GlobalOrderFlow["footprints"]};
  flow:TerminalFlowTool;
  perpetualFlow?:TerminalFlowTool;
  derivatives:TerminalToolBase & {instrumentId?:string;openInterest?:number;openInterestUsd?:number;openInterestAt?:number;fundingRate?:number;fundingTime?:number;fundingObservedAt?:number;markPrice?:number;markPriceAt?:number;fundingKind?:"current-estimate"};
  liquidity:TerminalToolBase & {bids?:{price:number;size:number}[];asks?:{price:number;size:number}[];sequence?:number;note?:string};
};
export type TerminalPriceObservation = {
  id:string;instId:string;timeframe:string;source:string;start:number;at:number;knownAt:number;
  open:number;high:number;low:number;close:number;complete:boolean;sequence:number;
};
export type TerminalMarketSnapshot = {
  version:"terminal-market-v1";instId:string;timeframe:TerminalTimeframe;observedAt:number;
  report:GlobalReport;tools:TerminalMarketTools;observations:TerminalPriceObservation[];sources:TerminalSourceStatus[];
};
export type TerminalFrameProfile = {timeframe:TerminalTimeframe;execution:string;context:string;valueWindow:"utc-day"|"utc-week"|"utc-month"|"utc-quarter"|"cycle";watchBars:number};
export function terminalFrameProfile(frame:string):TerminalFrameProfile {
  const profiles:Record<TerminalTimeframe,Omit<TerminalFrameProfile,"timeframe">> = {
    "15m":{execution:"5m",context:"1H",valueWindow:"utc-day",watchBars:12},
    "1H":{execution:"15m",context:"4H",valueWindow:"utc-week",watchBars:24},
    "4H":{execution:"1H",context:"1Dutc",valueWindow:"utc-week",watchBars:30},
    "1Dutc":{execution:"4H",context:"1Wutc",valueWindow:"utc-month",watchBars:30},
    "1Wutc":{execution:"1Dutc",context:"1Mutc",valueWindow:"cycle",watchBars:26},
  };
  const canonical=frame==="1D"?"1Dutc":frame==="1W"?"1Wutc":frame;
  if(!Object.hasOwn(profiles,canonical))throw Error("Unsupported Terminal timeframe");
  return {timeframe:canonical as TerminalTimeframe,...profiles[canonical as TerminalTimeframe]};
}

export type TerminalTapeoutComponent = {
  version:"tapeout-xlayer-nand-v1";chainId:196;processor:string;circuitId:"2";factory:string;
  blockNumber:string;blockHash:string;observedAt:number;netlist:string;codeHash:string;
  truthTable:readonly number[];verified:true;endpoints:string[];
};
export type TerminalRadarDetector = "sweep_reclaim"|"breakout_acceptance"|"breakout_failure";
export type TerminalRadarDefinition = {
  version:"terminal-radar-v1";id:string;instId:string;timeframe:string;detector:TerminalRadarDetector;
  boundary:number;side:"above"|"below";tolerance:number;createdAt:number;expiresAt:number;
};
export type TerminalRadarEvent = {id:string;observationId?:string;at:number;kind:"started"|"first_stage"|"second_stage"|"completed"|"failed"|"expired"|"data_needed";reason:string;price?:number;source?:string};
export type TerminalRadarState = {
  version:"terminal-radar-state-v1";definition:TerminalRadarDefinition;
  status:"developing"|"completed"|"failed"|"expired"|"data_needed";stage:0|1|2|3;
  updatedAt:number;lastObservationAt?:number;lastObservationId?:string;events:TerminalRadarEvent[];
  tapeout?:TerminalTapeoutComponent;next:string;
  /** Retained real inputs support rule replay, never a performance backtest. */
  observations?:TerminalPriceObservation[];historyComplete?:boolean;
};
