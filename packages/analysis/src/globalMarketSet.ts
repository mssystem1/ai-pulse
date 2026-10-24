import {parseCandleTimeframe} from "@pulse/schemas";
import type {SpotMarketContext} from "@pulse/market";
import {globalContextTimeframe,GLOBAL_HISTORY_LIMIT} from "./globalReport.js";
import {globalEntryTimeframe,globalStrategyProfile} from "@pulse/domain";

/** New reports use one calendar convention; old saved reports keep theirs. */
export function globalCanonicalTimeframe(timeframe:string):string {
  const f=parseCandleTimeframe(timeframe);
  return f&&["day","week","month"].includes(f.unit)?`${f.count}${{day:"D",week:"W",month:"M"}[f.unit as "day"|"week"|"month"]}utc`:timeframe;
}
export async function loadGlobalMarketSet(input:{instId:string;timeframe:string},load:(input:{instId:string;timeframe:string;candleLimit:number;completedOnly:boolean})=>Promise<SpotMarketContext>,requestedObservation?:string) {
  const timeframe=globalCanonicalTimeframe(input.timeframe),contextFrame=globalContextTimeframe(timeframe);
  const frames=[...new Set([timeframe,"1Wutc","1Dutc","4H","1H","15m","5m",globalStrategyProfile(timeframe)?.entryTimeframe??globalEntryTimeframe(timeframe),...(contextFrame?[contextFrame]:[])])];
  const fetched=await Promise.allSettled(frames.map(async frame=>{
    const market=await load({instId:input.instId,timeframe:frame,candleLimit:GLOBAL_HISTORY_LIMIT,completedOnly:true});
    if(market.instId!==input.instId||market.bar!==frame)throw new Error("Global market timeframe or instrument mismatch");
    return market;
  }));
  if(fetched[0].status==="rejected")throw fetched[0].reason;
  const observedAt=requestedObservation??new Date().toISOString();
  const primarySource=fetched[0].value.source;
  const markets=fetched.flatMap(result=>result.status==="fulfilled"&&result.value.source===primarySource?[{...result.value,fetchedAt:observedAt}]:[]);
  const primary=markets[0];
  return {market:primary,contextMarket:markets.find(m=>m.bar===contextFrame)??null,hierarchyMarkets:markets,observedAt};
}
