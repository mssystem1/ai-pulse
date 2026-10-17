import fs from "node:fs";
import {summarizeCandles} from "../packages/market/dist/index.js";

export const GLOBAL_REPLAY_SOURCE="packages/analysis/src/globalReport.oct16-fixtures.json";
export const globalReplayRows=JSON.parse(fs.readFileSync(GLOBAL_REPLAY_SOURCE,"utf8"));
export function globalReplayMarket(row,context=false,observedAt=row.observedAt){
  const candles=(context?row.contextCandles:row.candles).map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,volumeCcy:0,confirmed:true}));
  return {source:"okx-public-spot",instId:"BTC-USDT",bar:context?row.contextFrame:row.frame,candles,summary:summarizeCandles(candles),fetchedAt:observedAt,ticker:{instId:"BTC-USDT",priceCurrency:"USDT",last:candles.at(-1).close,open24h:0,high24h:0,low24h:0,vol24h:0,volCcy24h:0,change24hPct:0,ts:String(Date.parse(observedAt))}};
}
/** Reuse only the dataset's actual named bars, including its independent UTC
 * context bars. Never relabel UTC+8 daily bars as UTC daily entry evidence. */
export function globalReplayMarkets(row){
  const candidates=globalReplayRows.filter(r=>r.date===row.date).flatMap(r=>[globalReplayMarket(r,false,row.observedAt),globalReplayMarket(r,true,row.observedAt)]);
  return [...new Map(candidates.map(m=>[m.bar,m])).values()];
}
