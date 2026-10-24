import test from "node:test";
import assert from "node:assert/strict";
import {summarizeCandles,type SpotMarketContext,type MarketTradeCapture,type Candle} from "@pulse/market";
import {createGlobalOrderFlowSource,loadGlobalReportMarketSet} from "./globalOrderFlowSource.js";

const DAY=86_400_000,start=Math.floor(Date.now()/DAY)*DAY-DAY,end=start+DAY;
function fixture(){
  const now=Date.now(),events:string[]=[],candle:Candle={ts:start,open:69,high:70,low:69,close:70,volume:3,volumeCcy:209,confirmed:true},capture:MarketTradeCapture={source:'okx-public-spot',instId:'HYPE-USDT',priceCurrency:'USDT',marketType:'spot',quantityUnit:'base',capturedAt:new Date(now-2000).toISOString(),coverage:{start,end,knownAt:now-2000,complete:true,sha256:['a'.repeat(64)]},trades:[{id:'1',ts:start+1,price:69,size:1,side:'buy'},{id:'2',ts:end-1,price:70,size:2,side:'sell'}]};
  const feed=createGlobalOrderFlowSource({client:{captureRecentUtcDay:async instId=>{events.push('capture');assert.equal(instId,'HYPE-USDT');return {capture,archives:[]}}},history:async(instId,frame,limit,after)=>{events.push('daily-reference');assert.equal(instId,'HYPE-USDT');assert.equal(frame,'1Dutc');assert.equal(limit,1);assert.equal(after,end);return [candle]}});
  const load=async(input:{instId:string;timeframe:string}):Promise<SpotMarketContext>=>{events.push('market:'+input.timeframe);const candles=input.timeframe==='1Dutc'?[candle]:[];return {source:'okx-public-spot',instId:input.instId,bar:input.timeframe,fetchedAt:new Date().toISOString(),candles,summary:summarizeCandles(candles),ticker:{instId:input.instId,priceCurrency:'USDT',last:70,open24h:69,high24h:70,low24h:69,vol24h:3,volCcy24h:209,change24hPct:1,ts:String(now)}};};
  return {feed,load,events,candle};
}
test('fresh report preparation obtains and verifies real source context before selecting its observation time',async()=>{
  const {feed,load,events,candle}=fixture(),result=await loadGlobalReportMarketSet({instId:'HYPE-USDT',timeframe:'1Dutc'},load,feed);assert.deepEqual(events.slice(0,2),['capture','daily-reference']);assert.ok(events.slice(2).every(s=>s.startsWith('market:')));assert.ok(result.market.orderFlow);assert.equal(result.market.orderFlow.profile.volume,candle.volume);assert.equal(result.market.orderFlow.footprints[0].open,candle.open);assert.equal(result.market.orderFlow.instId,result.market.instId);assert.ok(Date.parse(result.market.fetchedAt)>=result.market.orderFlow.coverage.knownAt);
});
test('an optional archive outage preserves primary context and its quoted prices',async()=>{
  const {load}=fixture(),feed={warm:async()=>{throw Error('archive temporarily unavailable')},attach:<T>(m:T)=>m},result=await loadGlobalReportMarketSet({instId:'HYPE-USDT',timeframe:'1Dutc'},load,feed);assert.equal(result.market.ticker.last,70);assert.equal(result.market.candles[0].close,70);assert.equal(result.market.orderFlow,undefined);
});
test('the explicit fixture adapter performs no source warmup or attachment',async()=>{
  const {load,events}=fixture(),result=await loadGlobalReportMarketSet({instId:'HYPE-USDT',timeframe:'1Dutc'},load,null);assert.ok(events.every(s=>s.startsWith('market:')));assert.equal(result.market.orderFlow,undefined);
});
test('a source candle mismatch cannot become report evidence',async()=>{
  const {load,candle}=fixture(),now=Date.now(),feed=createGlobalOrderFlowSource({client:{captureRecentUtcDay:async()=>({capture:{source:'okx-public-spot',instId:'HYPE-USDT',priceCurrency:'USDT',marketType:'spot',quantityUnit:'base',capturedAt:new Date(now).toISOString(),coverage:{start,end,knownAt:now,complete:true,sha256:['a'.repeat(64)]},trades:[{id:'1',ts:start,price:69,size:1,side:'buy'}]},archives:[]})},history:async()=>[candle]});
  const result=await loadGlobalReportMarketSet({instId:'HYPE-USDT',timeframe:'1Dutc'},load,feed);assert.equal(result.market.orderFlow,undefined);assert.equal(result.market.candles[0].volume,3);
});
