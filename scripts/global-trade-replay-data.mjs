/** Public historical candles. No account, wallet, model or market requests. */
import fs from 'node:fs';
import {candleCloseTime} from '../packages/schemas/dist/index.js';
import {summarizeCandles} from '../packages/market/dist/index.js';
import {prepareGlobalReport,globalContextTimeframe} from '../packages/analysis/dist/index.js';

export const tradeReplaySources=['packages/analysis/src/globalReport.oct17-fixtures.json','packages/analysis/src/globalReport.oct17-2116-fixtures.json'];
export function reviewedTradeReports(lang='en',targetPolicy='legacy-pivots-v1'){
  const base=JSON.parse(fs.readFileSync(tradeReplaySources[0],'utf8')),delta=JSON.parse(fs.readFileSync(tradeReplaySources[1],'utf8'));
  return Object.fromEntries([...delta.requests.map(([frame,at])=>[frame,at]),['15m',delta.requests[0][1]]].map(([frame,at])=>{
    const markets=Object.entries(base.byFrame).map(([bar,rows])=>{
      const candles=[...new Map([...rows,...(delta.additions[bar]??[])].map(row=>[row[0],row])).values()].sort((a,b)=>a[0]-b[0]).map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,volumeCcy:0,confirmed:true})).filter(c=>candleCloseTime(c.ts,bar)<=Date.parse(at)).slice(-520);
      return {source:'okx-public-spot',instId:'BTC-USDT',bar,fetchedAt:at,candles,summary:summarizeCandles(candles),ticker:{instId:'BTC-USDT',priceCurrency:'USDT',last:candles.at(-1).close,open24h:0,high24h:0,low24h:0,vol24h:0,volCcy24h:0,change24hPct:0,ts:'0'}};
    });
    return [frame,prepareGlobalReport({market:markets.find(m=>m.bar===frame),contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier:'premium',lang,targetPolicy})];
  }));
}
