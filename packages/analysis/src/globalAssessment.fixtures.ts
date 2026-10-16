import { candleTimeframeMs, type GlobalReport } from "@pulse/schemas";
import { deriveGlobalTradePlan } from "@pulse/domain";
import { summarizeCandles, type SpotMarketContext } from "@pulse/market";
import { prepareGlobalReport } from "./globalReport.js";

/** Synthetic public-data-shaped fixtures only; never a market fallback. */
export function qualifiedGlobalFixture(frame="1H",now=Date.now()) {
  const interval=candleTimeframeMs(frame),end=Math.floor(now/interval)*interval;
  const candles=Array.from({length:180},(_,i)=>({ts:end-(180-i)*interval,open:99,high:99.5,low:98.5,close:99,volume:100,volumeCcy:9900,confirmed:true}));
  for(const [offset,open,high,low,close] of [[3,99,100.6,98.9,100.4],[2,100.4,100.6,99.95,100.3],[1,100.3,100.7,100.2,100.4]])Object.assign(candles[candles.length-offset],{open,high,low,close});
  const market:SpotMarketContext={source:"okx-public-spot",instId:"BTC-USDT",bar:frame,candles,summary:summarizeCandles(candles),fetchedAt:new Date(now).toISOString(),ticker:{instId:"BTC-USDT",last:100.4,open24h:99,high24h:101,low24h:98,vol24h:100,volCcy24h:10000,change24hPct:0,ts:String(now),priceCurrency:"USDT"}};
  const report=prepareGlobalReport({market,tier:"base"});
  report.levels=[{id:"trigger",price:100,role:"resistance",basis:"swing",anchorIds:["trigger-anchor"]},{id:"floor",price:98,role:"support",basis:"swing",anchorIds:["floor-anchor"]},{id:"target",price:110,role:"resistance",basis:"swing",anchorIds:["target-anchor"]}];
  report.indicators.pivots=[{id:"trigger-anchor",price:100,kind:"high",ts:candles[168].ts,confirmedAt:candles[171].ts},{id:"floor-anchor",price:98,kind:"low",ts:candles[160].ts,confirmedAt:candles[163].ts},{id:"target-anchor",price:110,kind:"high",ts:candles[150].ts,confirmedAt:candles[153].ts}];
  report.waveCount={id:"unclear",status:"unclear",structure:"unclear",direction:"unclear",degree:"local",activeWave:"unclear",anchors:[],invalidationLevelId:null,validation:[]};
  report.paths=[{id:"recovery",role:"main",direction:"up",kind:"recovery",state:"conditional",triggerLevelId:"trigger",invalidationLevelId:"floor",targetIds:["target"],confirmation:"close_retest",thesis:"Synthetic reclaim and retest."}];
  report.setup={state:"watching",pathId:"recovery",triggerLevelId:"trigger",retestLevelId:"trigger",invalidationLevelId:"floor",targetIds:["target"],entryZone:null,protectiveStop:null,grossRewardRisk:null,netRewardRisk:null,costsBps:null,confirmationTs:null,retestTs:null,expiresAt:null,missing:["execution_costs"]};
  report.view={levelIds:["trigger","floor","target"],pathIds:["recovery"],smaPeriods:[55],defaultLayers:["sma"]};
  report.tradePlan=deriveGlobalTradePlan(report);
  return {report,market};
}
