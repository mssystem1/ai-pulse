import test from "node:test";
import assert from "node:assert/strict";
import {terminalFrameProfile,type TerminalRadarDefinition,type TerminalPriceObservation,type TerminalTapeoutComponent} from "@pulse/domain";
import {advanceTerminalRadar,newTerminalRadar,replayTerminalRadar} from "./terminalRadar.js";
import {terminalToolsFromParticipation,terminalValueWindowStart,createTerminalMarketSnapshot} from "./terminalMarket.js";
import {candleTimeframeMs} from "@pulse/schemas";
import type {buildMarketContext} from "@pulse/market";

const component:TerminalTapeoutComponent={version:"tapeout-xlayer-nand-v1",chainId:196,processor:"0x839bdd6fa7a66416a609a735e11de5411b98574e",circuitId:"2",factory:"0x1f09daefa827f02cbb40967cc91b259763760761",blockNumber:"1",blockHash:`0x${"a".repeat(64)}`,observedAt:0,netlist:"0x000000020000030000000400000400000005000005",codeHash:"sha256:fixture",truthTable:[1,1,1,0],verified:true,endpoints:[]};
const step=300000;
const def=(detector:TerminalRadarDefinition["detector"]="sweep_reclaim"):TerminalRadarDefinition=>({version:"terminal-radar-v1",id:"watch-1",instId:"BTC-USDT",timeframe:"5m",detector,boundary:100,side:"below",tolerance:.1,createdAt:step,expiresAt:step*20});
const obs=(i:number,close:number,low=close,high=close):TerminalPriceObservation=>({id:`bar-${i}`,instId:"BTC-USDT",timeframe:"5m",source:"fixture",start:i*step,at:(i+1)*step,knownAt:(i+1)*step,open:close,high,low,close,complete:true,sequence:i});

test("timeframes preserve distinct execution, context and value horizons",()=>{
  assert.equal(terminalFrameProfile("15m").execution,"5m");assert.equal(terminalFrameProfile("1D").execution,"4H");assert.equal(terminalFrameProfile("1W").context,"1Mutc");
  const at=Date.UTC(2026,10,3,10);assert.equal(terminalValueWindowStart("15m",at),Date.UTC(2026,10,3));assert.equal(terminalValueWindowStart("1H",at),Date.UTC(2026,10,2));assert.equal(terminalValueWindowStart("1Dutc",at),Date.UTC(2026,10,1));assert.throws(()=>terminalFrameProfile("2m"));
});
test("Radar needs real circuit, distinct later observations and never records a fill",()=>{
  const d=def(),rows=[obs(1,99,98,100),obs(2,101,100.5,102),obs(3,102,101,103)];
  const missing=advanceTerminalRadar(d,null,rows,null,4*step);assert.equal(missing.status,"data_needed");assert.equal(missing.stage,0);
  const first=advanceTerminalRadar(d,null,[rows[0]],component,2*step);assert.equal(first.stage,1);
  const repeat=advanceTerminalRadar(d,first,[rows[0],rows[0]],component,2*step+1);assert.equal(repeat.stage,1);assert.equal(repeat.events.length,first.events.length);
  const complete=advanceTerminalRadar(d,repeat,rows,component,4*step);assert.equal(complete.status,"completed");assert.equal(complete.stage,3);assert.equal(complete.events.at(-1)?.kind,"completed");assert.match(complete.events.at(-1)!.reason,/not a trade or fill/);
  const replay=replayTerminalRadar(complete);assert.equal(replay.status,complete.status);assert.deepEqual(replay.events.map(e=>[e.kind,e.at]),complete.events.map(e=>[e.kind,e.at]));assert.throws(()=>replayTerminalRadar({...complete,historyComplete:false}),/Complete retained/);
  const again=advanceTerminalRadar(d,complete,[obs(4,90)],component,5*step);assert.equal(again.status,"completed");assert.equal(again.events.length,complete.events.length);
});
test("Radar rejects old touches, future knownAt, source gaps and changed versions",()=>{
  const d=def(),old=obs(0,98,97,99),future={...obs(2,101),knownAt:step*8};
  assert.equal(advanceTerminalRadar(d,null,[old,future],component,3*step).stage,0);
  const first=advanceTerminalRadar(d,null,[obs(1,99,98,100)],component,2*step);
  const gap=advanceTerminalRadar(d,first,[obs(4,101,100.5,102),obs(5,102,101,103)],component,6*step);assert.notEqual(gap.status,"completed");assert.ok(gap.events.some(e=>e.kind==="data_needed"));
  assert.throws(()=>advanceTerminalRadar({...d,boundary:101},first,[],component,3*step),/rule revisions/);
  const expired=advanceTerminalRadar(d,first,[],component,d.expiresAt);assert.equal(expired.status,"expired");assert.equal(advanceTerminalRadar(d,expired,[obs(3,102)],component,d.expiresAt+step).status,"expired");
});
test("acceptance and failed breakout use different ordered price conditions",()=>{
  const acceptance=def("breakout_acceptance"),rows=[obs(1,98,97,99),obs(2,99,98,100.05),obs(3,98,97,99)];
  assert.equal(advanceTerminalRadar(acceptance,null,rows,component,4*step).status,"completed");
  assert.equal(advanceTerminalRadar(acceptance,null,[rows[0],obs(2,101,100.5,102)],component,3*step).status,"failed");
  assert.equal(advanceTerminalRadar(def("breakout_failure"),null,[rows[0],obs(2,101,100.5,102),obs(3,102,101,103)],component,4*step).status,"completed");
});
test("Radar late polling replays pre-expiry events and repeated source interruption does not spam",()=>{
  const d=def(),rows=[obs(1,99,98,100),obs(2,101,100.5,102),obs(3,102,101,103)];
  assert.equal(advanceTerminalRadar(d,null,rows,component,d.expiresAt+step).status,"completed");
  const gap=advanceTerminalRadar(d,null,[],component,step*5),again=advanceTerminalRadar(d,gap,[],component,step*6);
  assert.equal(gap.status,"data_needed");assert.equal(again.events.filter(e=>e.kind==="data_needed").length,1);
});
test("temporary read outage freezes progress until real contiguous backfill and retains original circuit pin",()=>{
  const d=def(),first=advanceTerminalRadar(d,null,[obs(1,99,98,100)],component,2*step);
  const missing=advanceTerminalRadar(d,first,[],component,5*step);assert.equal(missing.status,"data_needed");assert.equal(missing.stage,1);
  const freshComponent={...component,blockNumber:"2",observedAt:5*step};
  const recovered=advanceTerminalRadar(d,missing,[obs(2,101,100.5,102),obs(3,102,101,103)],freshComponent,6*step);
  assert.equal(recovered.status,"completed");assert.equal(recovered.tapeout?.blockNumber,"1");assert.equal(replayTerminalRadar(recovered).status,recovered.status);
});
test("actual trade sample yields exact value/flow and does not pretend macro coverage",()=>{
  const asOf=Date.UTC(2026,10,3,10),start=asOf-10000;
  const capture={source:"fixture-trades",instId:"BTC-USDT",priceCurrency:"USDT",marketType:"spot" as const,quantityUnit:"base" as const,capturedAt:new Date(asOf).toISOString(),coverage:{start,end:asOf,knownAt:asOf,complete:true,sha256:["a".repeat(64)]},trades:[{id:"1",ts:start,price:100,size:2,side:"buy" as const},{id:"2",ts:start+1,price:110,size:1,side:"sell" as const}]};
  const p={capture,derivatives:{instId:"BTC-USDT-SWAP",knownAt:0},liquidity:{knownAt:0}},tools=terminalToolsFromParticipation(p,{timeframe:"1Dutc",start:Date.UTC(2026,10,1),asOf});
  assert.equal(tools.value.status,"partial");assert.equal(tools.value.tradeVwap,103.333333333);assert.equal(tools.flow.delta,1);assert.equal(tools.flow.points.at(-1)?.cvd,1);assert.equal(tools.value.orderFlow?.profile.start,start);assert.equal(tools.derivatives.status,"unavailable");
  const missing=terminalToolsFromParticipation({...p,capture:null},{timeframe:"1Dutc",start,asOf});assert.equal(missing.value.tradeVwap,undefined);assert.equal(missing.flow.delta,undefined);assert.equal(missing.flow.points.length,0);
  const duplicate=terminalToolsFromParticipation({...p,capture:{...capture,trades:[...capture.trades,capture.trades[0]]}},{timeframe:"1H",start,asOf});assert.equal(duplicate.value.status,"unavailable");assert.match(duplicate.value.reason!,/failed validation/);assert.equal(duplicate.flow.points.length,0);
});

test("recent tape exposes exact coverage and time-aligned price/delta without inventing weekly flow",()=>{
  const asOf=Date.UTC(2026,10,5,10),start=asOf-60000;
  const capture={source:"fixture-trades",instId:"BTC-USDT",priceCurrency:"USDT",marketType:"spot" as const,quantityUnit:"base" as const,capturedAt:new Date(asOf).toISOString(),coverage:{start,end:asOf,knownAt:asOf,complete:true,sha256:["a".repeat(64)]},trades:[
    {id:"1",ts:start+1000,price:100,size:2,side:"buy" as const},
    {id:"2",ts:start+2000,price:102,size:1,side:"sell" as const},
    {id:"3",ts:start+16000,price:99,size:3,side:"sell" as const},
    {id:"4",ts:start+59000,price:101,size:4,side:"buy" as const},
  ]};
  const requestedStart=Date.UTC(2022,0,1),tools=terminalToolsFromParticipation({capture,derivatives:{instId:"BTC-USDT-SWAP",knownAt:0},liquidity:{knownAt:0}},{timeframe:"1Wutc",start:requestedStart,asOf});
  assert.deepEqual(tools.value.coverage,{requestedStart,requestedEnd:asOf,capturedStart:start,capturedEnd:asOf,firstTradeAt:start+1000,lastTradeAt:start+59000,tradeCount:4,completeRequestedWindow:false,completeCapturedInterval:true,horizon:"cycle"});
  assert.deepEqual(tools.flow.coverage,tools.value.coverage);assert.equal(tools.value.status,"partial");
  assert.equal(tools.flow.points.length,1);assert.equal(tools.flow.displayBucketMs,5000);assert.equal(tools.flow.displayPoints?.length,3);
  const [first,second,last]=tools.flow.displayPoints!;
  assert.deepEqual(first,{ts:start,end:start+5000,buy:2,sell:1,delta:1,cvd:1,priceOpen:100,priceHigh:102,priceLow:100,priceClose:102,tradeCount:2});
  assert.equal(second.ts,start+15000);assert.equal(second.priceClose,99);assert.equal(second.delta,-3);assert.equal(second.cvd,-2);
  assert.equal(last.ts,start+55000);assert.equal(last.end,asOf);assert.equal(last.priceClose,101);assert.equal(last.cvd,2);
  assert.equal(tools.flow.displayPoints!.reduce((n,p)=>n+p.tradeCount,0),4);
  assert.equal(tools.flow.displayPoints!.reduce((n,p)=>n+p.buy+p.sell,0),10);
  // The display leaves the missing 5s/10s/etc buckets absent: no made-up
  // zero-volume price candles or repeated prices are inserted across gaps.
  assert.equal(tools.flow.displayPoints!.some(p=>p.ts===start+5000),false);
});

test("sample coverage and price/delta stay isolated for spot and contract streams",()=>{
  const asOf=Date.UTC(2026,10,5,10),start=asOf-10000;
  const capture={source:"fixture-spot",instId:"BTC-USDT",priceCurrency:"USDT",marketType:"spot" as const,quantityUnit:"base" as const,capturedAt:new Date(asOf).toISOString(),coverage:{start,end:asOf-1000,knownAt:asOf,complete:true,sha256:["a".repeat(64)]},trades:[{id:"1",ts:start,price:100,size:2,side:"buy" as const}]};
  const perpetualCapture={...capture,source:"fixture-perp",instId:"BTC-USDT-SWAP",marketType:"perpetual" as const,quantityUnit:"contracts" as const,trades:[{id:"p1",ts:start+3000,price:101,size:20,side:"sell" as const}]};
  const tools=terminalToolsFromParticipation({capture,perpetualCapture,derivatives:{instId:"BTC-USDT-SWAP",knownAt:0},liquidity:{knownAt:0}},{timeframe:"15m",start,asOf});
  assert.equal(tools.flow.units,"base");assert.equal(tools.flow.displayPoints?.[0].priceClose,100);assert.equal(tools.flow.delta,2);
  assert.equal(tools.perpetualFlow?.units,"contracts");assert.equal(tools.perpetualFlow?.displayPoints?.[0].priceClose,101);assert.equal(tools.perpetualFlow?.delta,-20);
  assert.equal(tools.flow.coverage?.completeCapturedInterval,true);assert.equal(tools.flow.coverage?.completeRequestedWindow,false);assert.equal(tools.flow.coverage?.capturedEnd,asOf-1000);
  assert.equal(tools.perpetualFlow?.coverage?.firstTradeAt,start+3000);
  const complete=terminalToolsFromParticipation({capture:{...capture,coverage:{...capture.coverage,end:asOf}},derivatives:{instId:"BTC-USDT-SWAP",knownAt:0},liquidity:{knownAt:0}},{timeframe:"15m",start,asOf});
  assert.equal(complete.flow.coverage?.completeRequestedWindow,true);assert.equal(complete.value.status,"available");
});
test("decimal Terminal display rows reconcile ordinary BTC decimals without inventing macro coverage",()=>{
  const asOf=Date.UTC(2026,10,4,13),start=asOf-10000;
  const capture={source:"fixture-trades",instId:"BTC-USDT",priceCurrency:"USDT",marketType:"spot" as const,quantityUnit:"base" as const,capturedAt:new Date(asOf).toISOString(),coverage:{start,end:asOf,knownAt:asOf,complete:true,sha256:["a".repeat(64)]},trades:[{id:"1",ts:start,price:77700.1,size:2,side:"buy" as const},{id:"2",ts:start+1,price:77711,size:1,side:"sell" as const}]};
  // The old span/80 grid produced rows with width 0.13625000100000761
  // against declared 0.13624999999992723, correctly rejected by the schema.
  const tools=terminalToolsFromParticipation({capture,perpetualCapture:{...capture,marketType:"perpetual",quantityUnit:"contracts"},derivatives:{instId:"BTC-USDT-SWAP",knownAt:0},liquidity:{knownAt:0}},{timeframe:"1Wutc",start:Date.UTC(2022,0,1),asOf});
  assert.equal(tools.value.status,"partial");assert.equal(tools.value.orderFlow?.profile.rowSize,1);
  assert.equal(tools.value.orderFlow?.profile.start,start);assert.equal(tools.value.orderFlow?.coverage.complete,true);
  assert.equal(tools.value.orderFlow?.profile.buy,2);assert.equal(tools.value.orderFlow?.profile.sell,1);assert.equal(tools.value.orderFlow?.profile.volume,3);
  assert.equal(tools.flow.delta,1);assert.equal(tools.perpetualFlow?.delta,1);assert.equal(tools.perpetualFlow?.marketType,"perpetual");
});
test("invalid optional captures and profile provenance cannot erase independent valid sources",()=>{
  const asOf=Date.UTC(2026,10,4,13),start=asOf-10000;
  const capture={source:"fixture-trades",instId:"BTC-USDT",priceCurrency:"USDT",marketType:"spot" as const,quantityUnit:"base" as const,capturedAt:new Date(asOf).toISOString(),coverage:{start,end:asOf,knownAt:asOf,complete:true,sha256:["a".repeat(64)]},trades:[{id:"1",ts:start,price:77700.1,size:2,side:"buy" as const}]};
  const independent={derivatives:{instId:"BTC-USDT-SWAP",knownAt:asOf,markPrice:77700.2,markPriceAt:asOf},liquidity:{knownAt:asOf,bids:[{price:77700,size:1}],asks:[{price:77701,size:1}]}};
  const invalid=terminalToolsFromParticipation({capture:{...capture,trades:[...capture.trades,capture.trades[0]]},perpetualCapture:{...capture,marketType:"perpetual",quantityUnit:"contracts"},...independent},{timeframe:"1H",start,asOf});
  assert.equal(invalid.value.status,"unavailable");assert.equal(invalid.flow.buy,undefined);assert.equal(invalid.perpetualFlow?.buy,2);assert.equal(invalid.derivatives.markPrice,77700.2);assert.equal(invalid.liquidity.bids?.[0].price,77700);
  const badProfile=terminalToolsFromParticipation({capture:{...capture,coverage:{...capture.coverage,sha256:[]}},...independent},{timeframe:"1H",start,asOf});
  assert.equal(badProfile.value.orderFlow,undefined);assert.equal(badProfile.value.status,"partial");assert.match(badProfile.value.reason!,/could not be reconciled/);assert.equal(badProfile.flow.buy,2);assert.equal(badProfile.value.tradeVwap,77700.1);
});
test("exchange-source clocks tolerate bounded skew while preserving each mark timestamp",()=>{
  const asOf=Date.UTC(2026,10,3,10),base={capture:null,derivatives:{instId:"BTC-USDT-SWAP",knownAt:asOf+500,markPrice:100,markPriceAt:asOf+500},liquidity:{knownAt:0}};
  const current=terminalToolsFromParticipation(base,{timeframe:"1H",start:asOf-10000,asOf});assert.equal(current.derivatives.markPriceAt,asOf+500);assert.equal(current.derivatives.status,"available");
  const invalid=terminalToolsFromParticipation({...base,derivatives:{...base.derivatives,knownAt:asOf+6000,markPriceAt:asOf+6000}},{timeframe:"1H",start:asOf-10000,asOf});assert.equal(invalid.derivatives.status,"unavailable");assert.equal(invalid.derivatives.markPrice,undefined);
});
test("snapshot reuses Pro schema with primary profile and execution observations on every supported frame",async()=>{
  const now=Date.UTC(2026,10,3,10),start=now-10000;
  const loadMarket:typeof buildMarketContext=async input=>{const bar=input.timeframe??"1H",ms=candleTimeframeMs(bar)||31*86400000,last=Math.floor(now/ms)*ms-ms;
    const candles=Array.from({length:300},(_,i)=>{const price=100+i*.2+Math.sin(i/5)*2;return {ts:last-(299-i)*ms,open:price,high:price+1,low:price-1,close:price+.2,volume:100,volumeCcy:100,confirmed:true};});
    return {source:"okx-public-spot",instId:input.instId,bar,ticker:{instId:input.instId,last:160,open24h:159,high24h:161,low24h:158,vol24h:100,volCcy24h:100,change24hPct:1,ts:String(now)},candles,summary:null,fetchedAt:new Date(now).toISOString()};};
  const loadParticipation=async()=>({capture:{source:"okx-public-history-trades",instId:"BTC-USDT",priceCurrency:"USDT",marketType:"spot" as const,quantityUnit:"base" as const,capturedAt:new Date(now).toISOString(),coverage:{start,end:now,knownAt:now,complete:true,sha256:["a".repeat(64)]},trades:[{id:"1",ts:start,price:160,size:1,side:"buy" as const}]},derivatives:{instId:"BTC-USDT-SWAP",knownAt:0},liquidity:{knownAt:0}});
  for(const timeframe of ["15m","1H","4H","1Dutc","1Wutc"]){
    const snapshot=await createTerminalMarketSnapshot({instId:"BTC-USDT",timeframe,now,loadMarket,loadParticipation});
    assert.equal(snapshot.report.snapshot.timeframe,timeframe);assert.equal(snapshot.report.orderFlow?.profile.timeframe,timeframe);assert.equal(snapshot.report.orderFlow?.source,snapshot.report.snapshot.source);assert.equal(snapshot.tools.value.orderFlow?.profile.timeframe,terminalFrameProfile(timeframe).execution);assert.equal(snapshot.observations.at(-1)?.timeframe,terminalFrameProfile(timeframe).execution);
    assert.equal(snapshot.tools.perpetualFlow?.status,"unavailable");
    assert.ok(snapshot.observations.every(c=>c.knownAt===now&&c.at<=c.knownAt),"Retrieval time is retained separately from historical candle close time in Radar alerts");
    assert.ok(snapshot.observations.some(c=>c.at<c.knownAt),"A fetched historical candle must not claim it was received at its original close");
  }
  const loadInvalidParticipation=async()=>{const p=await loadParticipation();return {...p,capture:{...p.capture,trades:[...p.capture.trades,p.capture.trades[0]]}};};
  const degraded=await createTerminalMarketSnapshot({instId:"BTC-USDT",timeframe:"1Wutc",now,loadMarket,loadParticipation:loadInvalidParticipation});
  assert.equal(degraded.report.snapshot.timeframe,"1Wutc");assert.ok(degraded.report.candles.length>100);assert.equal(degraded.tools.value.status,"unavailable");assert.equal(degraded.report.orderFlow,undefined);assert.ok(degraded.observations.length>0);
});
