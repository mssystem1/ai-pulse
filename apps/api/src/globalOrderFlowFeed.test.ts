import test from "node:test";
import assert from "node:assert/strict";
import type {MarketTradeCapture} from "@pulse/market";
import {createGlobalOrderFlowFeed} from "./globalOrderFlowFeed.js";

const DAY=86_400_000,start=Date.UTC(2026,6,5),end=start+DAY,now=end+DAY;
const capture:MarketTradeCapture={source:"okx-public-spot",instId:"HYPE-USDT",priceCurrency:"USDT",marketType:"spot",quantityUnit:"base",capturedAt:new Date(now-1000).toISOString(),coverage:{start,end,knownAt:now-1000,complete:true,sha256:["a".repeat(64)]},trades:[{id:"1",ts:start+1,price:69,size:1,side:"buy"},{id:"2",ts:end-1,price:70,size:2,side:"sell"}]};
const candle={ts:start,open:69,high:70,low:69,close:70,volume:3,confirmed:true};
const reference={source:"okx-public-spot",instId:"HYPE-USDT",bar:"1Dutc",fetchedAt:new Date(now-500).toISOString(),candle};
const market=(at=now)=>({source:"okx-public-spot",instId:"HYPE-USDT",bar:"1Dutc",fetchedAt:new Date(at).toISOString(),ticker:{priceCurrency:"USDT"},candles:[candle]});
function setup(extra:Partial<Parameters<typeof createGlobalOrderFlowFeed>[0]>={}){const state={captures:0,references:0,checks:0};const feed=createGlobalOrderFlowFeed({now:()=>now,capture:async()=>{state.captures++;return {capture:structuredClone(capture)};},dailyReference:async(instId,from,to)=>{state.references++;assert.equal(instId,capture.instId);assert.equal(from,start);assert.equal(to,end);return structuredClone(reference);},reconcile:()=>{state.checks++;},...extra});return {feed,state};}
test("verified flow is cached once and attaches without modifying market prices, clocks or source objects",async()=>{
  const {feed,state}=setup();await Promise.all([feed.warm('HYPE-USDT'),feed.warm('HYPE-USDT')]);const original=market(),before=structuredClone(original),result=feed.attach(original);assert.deepEqual(original,before);assert.ok(result.orderFlow);assert.equal(result.fetchedAt,original.fetchedAt);assert.deepEqual(result.candles,original.candles);assert.equal(result.orderFlow.profile.volume,3);assert.equal(result.orderFlow.coverage.knownAt,now-1000);await feed.warm('HYPE-USDT');assert.deepEqual(state,{captures:1,references:1,checks:1});
  result.orderFlow.profile.rows[0].buy=999;assert.equal(feed.attach(original).orderFlow!.profile.volume,3);assert.notEqual(feed.attach(original).orderFlow!.profile.rows[0].buy,999);
});
test("an earlier market observation cannot borrow later capture or reconciliation evidence",async()=>{
  const {feed}=setup();await feed.warm('HYPE-USDT');const old=market(now-1);assert.equal(feed.attach(old),old);assert.equal(old.fetchedAt,new Date(now-1).toISOString());
});
test("each selected timeframe receives its own footprint buckets without inventing weekly candles",async()=>{
  const {feed}=setup();await feed.warm('HYPE-USDT');for(const bar of ['15m','1H','4H','1Dutc','1Wutc']){const result=feed.attach({...market(),bar,candles:[]});assert.equal(result.orderFlow!.profile.timeframe,bar);assert.equal(result.orderFlow!.profile.volume,3);assert.deepEqual(result.orderFlow!.footprints,[]);}assert.equal(feed.attach(market()).orderFlow!.footprints.length,1);
});
test("different venues, currencies and revised candle volumes cannot inherit cached flow",async()=>{
  const {feed}=setup();await feed.warm('HYPE-USDT');for(const changed of [{...market(),source:'binance-usdm-research'},{...market(),instId:'BTC-USDT'},{...market(),ticker:{priceCurrency:'USD'}},{...market(),candles:[{...candle,volume:4}]}])assert.equal(feed.attach(changed),changed);
});
test("bad captures and failed source reconciliation are not cached",async()=>{
  const bad=structuredClone(capture);bad.quantityUnit='contracts';const one=setup({capture:async()=>({capture:bad})});await assert.rejects(one.feed.warm('HYPE-USDT'),/mismatched/);assert.equal(one.state.references,0);assert.equal(one.feed.attach(market()).orderFlow,undefined);
  const two=setup({reconcile:()=>{throw Error('source volume mismatch')}});await assert.rejects(two.feed.warm('HYPE-USDT'),/source volume/);assert.equal(two.feed.attach(market()).orderFlow,undefined);
});
test("a failed refresh retains the last independently available window and stale windows expire",async()=>{
  let clock=now,fail=false;const {feed}=setup({now:()=>clock,cacheMs:10,capture:async()=>{if(fail)throw Error('provider temporarily unavailable');return {capture:structuredClone(capture)}}});await feed.warm('HYPE-USDT');clock+=10;fail=true;await assert.rejects(feed.warm('HYPE-USDT'));assert.ok(feed.attach(market(clock)).orderFlow);const old=market(clock+5*DAY);assert.equal(feed.attach(old),old);
});
test("unsupported identities do not start downloads and pending work is bounded",async()=>{
  let release!:()=>void;const {feed,state}=setup({maxPending:1,capture:async()=>{await new Promise<void>(resolve=>release=resolve);return {capture:structuredClone(capture)}}});await feed.warm('HYPE-USDT-SWAP');assert.equal(state.captures,0);const pending=feed.warm('HYPE-USDT');await assert.rejects(feed.warm('BTC-USDT'),/queue is full/);await new Promise(resolve=>setImmediate(resolve));release();await pending;
});
test("asynchronous source verification must finish successfully before the cache is usable",async()=>{
  let release!:()=>void;const {feed}=setup({reconcile:()=>new Promise<void>((_,reject)=>{release=()=>reject(Error('asynchronous source mismatch'));})}),pending=feed.warm('HYPE-USDT');await new Promise(resolve=>setImmediate(resolve));assert.equal(feed.attach(market()).orderFlow,undefined);release();await assert.rejects(pending,/asynchronous source mismatch/);assert.equal(feed.attach(market()).orderFlow,undefined);
});
