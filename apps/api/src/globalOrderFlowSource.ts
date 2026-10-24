import {loadGlobalMarketSet} from "@pulse/analysis";
import {getHistoricalCandles,OkxTradeArchiveClient,reconcileOkxDailyTradeCapture} from "@pulse/market";
import {createGlobalOrderFlowFeed} from "./globalOrderFlowFeed.js";

export type GlobalOrderFlowFeed=ReturnType<typeof createGlobalOrderFlowFeed>;
export function createGlobalOrderFlowSource(options:{client?:Pick<OkxTradeArchiveClient,"captureRecentUtcDay">;history?:typeof getHistoricalCandles;now?:()=>number}={}):GlobalOrderFlowFeed{
  const now=options.now??Date.now,client=options.client??new OkxTradeArchiveClient({now}),history=options.history??getHistoricalCandles;
  return createGlobalOrderFlowFeed({now,capture:instId=>client.captureRecentUtcDay(instId,1),dailyReference:async(instId,start,end)=>{
    const candles=await history(instId,"1Dutc",1,end),candle=candles.find(c=>c.ts===start);if(!candle)throw Error("Source daily candle unavailable for trade reconciliation");
    return {source:"okx-public-spot",instId,bar:"1Dutc",fetchedAt:new Date(now()).toISOString(),candle};
  },reconcile:reconcileOkxDailyTradeCapture});
}
let shared:GlobalOrderFlowFeed|undefined;
export function defaultGlobalOrderFlowSource(){return shared??=createGlobalOrderFlowSource();}

/** Warm before the common market observation is chosen. Optional source
 * outages preserve the existing priced report and any still-valid cache. */
export async function loadGlobalReportMarketSet(input:Parameters<typeof loadGlobalMarketSet>[0],load:Parameters<typeof loadGlobalMarketSet>[1],feed:GlobalOrderFlowFeed|null=defaultGlobalOrderFlowSource()){
  if(feed)await feed.warm(input.instId).catch(()=>undefined);
  const markets=await loadGlobalMarketSet(input,load);
  return {...markets,market:feed?feed.attach(markets.market):markets.market};
}
