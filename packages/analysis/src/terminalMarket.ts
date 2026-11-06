import {candleCloseTime,candleTimeframeMs} from "@pulse/schemas";
import {terminalFrameProfile,type TerminalMarketSnapshot,type TerminalMarketTools,type TerminalSourceStatus,type TerminalFlowDisplayPoint} from "@pulse/domain";
import {buildMarketContext,loadTerminalParticipation,type TerminalParticipation} from "@pulse/market";
import {loadGlobalMarketSet} from "./globalMarketSet.js";
import {prepareGlobalReport,completedGlobalCandles} from "./globalReport.js";
import {buildGlobalOrderFlow} from "./globalOrderFlow.js";

const round=(n:number)=>Number(n.toPrecision(12));
// A display grid, not an exchange tick-size claim. Arbitrary span/80 fractions
// accumulate boundary rounding at BTC-sized prices and can fail the strict
// shared profile reconciliation. Decimal bins retain the captured quantities.
const profileRowSize=(low:number,high:number,vwap:number)=>10**Math.ceil(Math.log10(Math.max(vwap*1e-6,(high-low)/80)));
const profileUnavailable=(value:TerminalMarketTools["value"],reason:string)=>({...value,status:value.status==="stale"?"stale" as const:"partial" as const,reason:[value.reason,reason].filter(Boolean).join(" ")});
export function terminalValueWindowStart(timeframe:string,asOf:number,cycleStart?:number):number{
  const {valueWindow}=terminalFrameProfile(timeframe),d=new Date(asOf),day=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
  return valueWindow==="utc-day"?day:valueWindow==="utc-week"?day-(d.getUTCDay()+6)%7*86400000:valueWindow==="cycle"?cycleStart??Date.UTC(d.getUTCFullYear()-4,0,1):Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);
}
export function terminalToolsFromParticipation(p:TerminalParticipation,input:{timeframe:string;start:number;asOf:number}):TerminalMarketTools{
  const {asOf,start,timeframe}=input,frame=terminalFrameProfile(timeframe),capture=p.capture;
  const unavailable=(id:string,label:string,reason:string):TerminalSourceStatus&{label:string}=>({id,label,source:"okx-public",knownAt:asOf,status:"unavailable",reason});
  const tools:TerminalMarketTools={value:unavailable("value","VWAP & value",p.reason??"Executed trade coverage is not available for this value window."),flow:{...unavailable("flow","Buy/sell flow",p.reason??"Executed trade source unavailable."),points:[],marketType:"spot"},derivatives:unavailable("derivatives","Open interest & funding",p.derivatives.reason??"Current derivative data unavailable."),liquidity:unavailable("liquidity","Liquidity",p.liquidity.reason??"Current depth unavailable.")};
  try{if(capture&&capture.coverage.knownAt<=asOf){
    const coverage=capture.coverage;
    if(![coverage.start,coverage.end,coverage.knownAt].every(Number.isSafeInteger)||coverage.start<0||coverage.start>=coverage.end||coverage.knownAt<coverage.end||coverage.knownAt>Date.parse(capture.capturedAt)||!Number.isFinite(Date.parse(capture.capturedAt)))throw Error("Invalid Terminal executed trade coverage");
    const ids=new Set<string>();let last=-1;
    for(const t of capture.trades){if(!t.id||ids.has(t.id)||!Number.isSafeInteger(t.ts)||t.ts<last||t.ts<capture.coverage.start||t.ts>=capture.coverage.end||!Number.isFinite(t.price)||t.price<=0||!Number.isFinite(t.size)||t.size<=0||!["buy","sell"].includes(t.side))throw Error("Invalid Terminal executed trade capture");ids.add(t.id);last=t.ts;}
    const trades=capture.trades.filter(t=>t.ts>=start&&t.ts<asOf);
    if(trades.length){
      const buy=trades.reduce((n,t)=>n+(t.side==="buy"?t.size:0),0),sell=trades.reduce((n,t)=>n+(t.side==="sell"?t.size:0),0),volume=buy+sell,tradeVwap=trades.reduce((n,t)=>n+t.price*t.size,0)/volume,sigma=Math.sqrt(trades.reduce((n,t)=>n+(t.price-tradeVwap)**2*t.size,0)/volume);
      if(![buy,sell,volume,tradeVwap,sigma].every(Number.isFinite)||volume<=0||tradeVwap<=0)throw Error("Invalid Terminal executed trade totals");
      const complete=capture.coverage.complete&&capture.coverage.start<=start&&capture.coverage.end>=asOf;
      const capturedStart=Math.max(start,capture.coverage.start),capturedEnd=Math.min(capture.coverage.end,asOf);
      const meta:TerminalSourceStatus={id:"value",source:capture.source,knownAt:capture.coverage.knownAt,windowStart:capturedStart,windowEnd:capturedEnd,status:asOf-trades.at(-1)!.ts>120000?"stale":complete?"available":"partial",units:capture.quantityUnit,
        coverage:{requestedStart:start,requestedEnd:asOf,capturedStart,capturedEnd,firstTradeAt:trades[0].ts,lastTradeAt:trades.at(-1)!.ts,tradeCount:trades.length,completeRequestedWindow:complete,completeCapturedInterval:capture.coverage.complete,horizon:frame.valueWindow},
        ...(!complete?{reason:`Recent executed sample only; the ${frame.valueWindow} value window is not fully retained.`}:{})};
      tools.value={...meta,label:"VWAP & value",tradeVwap:round(tradeVwap),sigma:round(sigma),bands:[1,2,3].map(deviations=>({deviations,lower:round(Math.max(0,tradeVwap-deviations*sigma)),upper:round(tradeVwap+deviations*sigma)}))};
      // Profile/footprint use the exact captured interval, never the requested
      // macro window. Value status still states missing broad-window coverage.
      if(capture.coverage.complete){
        const rowSize=profileRowSize(Math.min(...trades.map(t=>t.price)),Math.max(...trades.map(t=>t.price)),tradeVwap);
        try{const orderFlow=buildGlobalOrderFlow(capture,{timeframe:frame.execution,start:Math.max(start,capture.coverage.start),end:Math.min(asOf,capture.coverage.end),asOf,rowSize});if(orderFlow)tools.value.orderFlow=orderFlow;}
        catch{tools.value=profileUnavailable(tools.value,"Volume profile and footprint are unavailable because their captured price rows could not be reconciled. Validated executed flow and trade-based VWAP remain separate measurements.");}
      }
      const grouped=new Map<number,{ts:number;buy:number;sell:number;delta:number;cvd:number}>(),size=candleTimeframeMs(frame.execution);
      for(const t of trades){const ts=Math.floor(t.ts/size)*size,row=grouped.get(ts)??{ts,buy:0,sell:0,delta:0,cvd:0};row[t.side]+=t.size;grouped.set(ts,row);}
      let cvd=0;const points=[...grouped.values()].map(row=>{row.delta=round(row.buy-row.sell);row.cvd=round(cvd+=row.delta);return row;});
      // A minute-long weekly sample cannot be read as a one-point daily CVD.
      // Show its exact tape in smaller UTC buckets while keeping the actual
      // execution-frame points separate. Price and flow share the same prints;
      // no OHLC candle is substituted for missing executed history.
      const displayBucketMs=[1000,5000,15000,30000,60000,300000,900000,3600000,14400000,86400000].find(ms=>ms>=Math.max(1000,(capturedEnd-capturedStart)/24))??86400000;
      const display=new Map<number,TerminalFlowDisplayPoint>();
      for(const t of trades){const ts=Math.floor(t.ts/displayBucketMs)*displayBucketMs,row=display.get(ts)??{ts,end:Math.min(ts+displayBucketMs,capturedEnd),buy:0,sell:0,delta:0,cvd:0,priceOpen:t.price,priceHigh:t.price,priceLow:t.price,priceClose:t.price,tradeCount:0};row[t.side]+=t.size;row.priceHigh=Math.max(row.priceHigh,t.price);row.priceLow=Math.min(row.priceLow,t.price);row.priceClose=t.price;row.tradeCount++;display.set(ts,row);}
      let displayCvd=0;const displayPoints=[...display.values()].map(row=>({...row,buy:round(row.buy),sell:round(row.sell),delta:round(row.buy-row.sell),cvd:round(displayCvd+=row.buy-row.sell)}));
      tools.flow={...meta,id:"flow",label:"Buy/sell flow",marketType:capture.marketType,buy:round(buy),sell:round(sell),delta:round(buy-sell),points,displayPoints,displayBucketMs};
    }
  }}catch{
    const reason="Executed-trade capture failed validation; its quantities and price profile are unavailable. Independent price, derivative and depth sources are retained.";
    tools.value=unavailable("value","VWAP & value",reason);tools.flow={...unavailable("flow","Buy/sell flow",reason),points:[],marketType:capture?.marketType??"spot"};
  }
  if(p.perpetualCapture){
    const isolated=terminalToolsFromParticipation({capture:p.perpetualCapture,derivatives:{instId:p.derivatives.instId,knownAt:0},liquidity:{knownAt:0}},input).flow;
    tools.perpetualFlow={...isolated,id:"perpetual-flow",label:"Perpetual buy/sell flow",marketType:"perpetual"};
  }else tools.perpetualFlow={...unavailable("perpetual-flow","Perpetual buy/sell flow","Perpetual executed-trade source unavailable; spot volume is not substituted."),points:[],marketType:"perpetual"};
  // Public exchange clocks can lead retrieval slightly. Match the shared quote
  // policy's five-second skew allowance; preserve the actual source clocks.
  const d=p.derivatives;if(d.knownAt>0&&d.knownAt<=asOf+5000&&(d.openInterest!==undefined||d.fundingRate!==undefined||d.markPrice!==undefined))tools.derivatives={id:"derivatives",label:"Open interest & funding",source:"okx-public-perpetual",instrumentId:d.instId,status:asOf-d.knownAt>120000?"stale":"available",units:"OI contracts / OI USD / funding rate",...d,fundingKind:"current-estimate"};
  const b=p.liquidity;if(b.knownAt>0&&b.knownAt<=asOf+5000&&b.bids&&b.asks)tools.liquidity={id:"liquidity",label:"Liquidity",source:"okx-public-spot-books",status:asOf-b.knownAt>15000?"stale":"partial",units:"base",...b,note:"Current resting-depth snapshot. Persistence, consumed liquidity and a historical heatmap require retained sequenced updates."};
  return tools;
}

export async function createTerminalMarketSnapshot(input:{instId:string;timeframe:string;now?:number;loadMarket?:typeof buildMarketContext;loadParticipation?:(input:{instId:string;start:number;end:number})=>Promise<TerminalParticipation>}):Promise<TerminalMarketSnapshot>{
  if(!/^[A-Z0-9]{2,20}-(USDT|USDC|USD)$/.test(input.instId))throw Error("Unsupported Terminal instrument");
  const profile=terminalFrameProfile(input.timeframe),started=input.now??Date.now(),start=terminalValueWindowStart(profile.timeframe,started);
  const [set,participation]=await Promise.all([loadGlobalMarketSet({instId:input.instId,timeframe:profile.timeframe},input.loadMarket??buildMarketContext),
    (input.loadParticipation??loadTerminalParticipation)({instId:input.instId,start,end:started}).catch(()=>({capture:null,reason:"Executed-trade feed unavailable.",derivatives:{instId:`${input.instId}-SWAP`,knownAt:0},liquidity:{knownAt:0}} satisfies TerminalParticipation))]);
  const observedAt=input.now??Date.now(),stamp=new Date(observedAt).toISOString();
  const market={...set.market,fetchedAt:stamp},hierarchyMarkets=set.hierarchyMarkets.map(m=>({...m,fetchedAt:stamp})),contextMarket=set.contextMarket?{...set.contextMarket,fetchedAt:stamp}:null;
  const tools=terminalToolsFromParticipation(participation,{timeframe:profile.timeframe,start,asOf:observedAt});
  const sampled=tools.value.orderFlow,capture=participation.capture;
  // The shared Pro contract uses the primary frame and canonical venue ID.
  // Tool footprint remains in the execution frame; never relabel its bars.
  let reportFlow:ReturnType<typeof buildGlobalOrderFlow>=null;
  if(sampled&&capture&&market.source==="okx-public-spot")try{reportFlow=buildGlobalOrderFlow({...capture,source:market.source},{timeframe:profile.timeframe,start:sampled.profile.start,end:sampled.profile.end,asOf:observedAt,rowSize:sampled.profile.rowSize});}catch{tools.value=profileUnavailable(tools.value,"The primary-frame report profile could not be reconciled and is omitted; the execution-window tool profile remains separately sourced.");}
  const report=prepareGlobalReport({market:{...market,...(reportFlow?{orderFlow:reportFlow}:{})},hierarchyMarkets,contextMarket,tier:"premium",decisionVersion:"decision-v5",targetPolicy:"active-zones-v1"});
  const entry=hierarchyMarkets.find(m=>m.bar===profile.execution),observations=entry?completedGlobalCandles(entry).slice(-128).map(c=>({id:`${entry.source}:${input.instId}:${entry.bar}:${c.ts}`,instId:input.instId,timeframe:entry.bar,source:entry.source,start:c.ts,at:candleCloseTime(c.ts,entry.bar)!,knownAt:observedAt,open:c.open,high:c.high,low:c.low,close:c.close,complete:true,sequence:c.ts})):[];
  const latest=observations.at(-1),sources:TerminalSourceStatus[]=[{id:"price",source:market.source,knownAt:latest?.at??0,status:latest&&observedAt-latest.at<=candleTimeframeMs(profile.execution)+60000?"available":"stale",windowStart:observations[0]?.start,windowEnd:latest?.at},tools.value,tools.flow,...(tools.perpetualFlow?[tools.perpetualFlow]:[]),tools.derivatives,tools.liquidity];
  return {version:"terminal-market-v1",instId:input.instId,timeframe:profile.timeframe,observedAt,report,tools,observations,sources};
}
