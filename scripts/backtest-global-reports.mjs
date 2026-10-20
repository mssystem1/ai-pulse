/** No fitting, no model/account calls. Recompute production reports at each entry close. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {candleCloseTime} from '../packages/schemas/dist/index.js';
import {prepareGlobalReport,globalContextTimeframe} from '../packages/analysis/dist/globalReport.js';
import {globalEligibility,globalTradePlan} from '../packages/domain/dist/index.js';
import {makePosition,positionExit,closePosition,summarizeTrades,DEFAULT_COSTS} from './global-backtest-engine.mjs';
import {loadBacktestData} from './global-backtest-data.mjs';

const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const frame=args.frame??'1H',entryFrame={'1H':'15m','4H':'1H','1Dutc':'4H','1Wutc':'1Dutc'}[frame];
if(!entryFrame)throw Error('Unsupported primary frame');
const label=args.label??'baseline',root='.tmp/global-backtest',out=`docs/backtests/global-${label}`;fs.mkdirSync(out,{recursive:true});
const costs={feeBps:Number(args.feeBps??DEFAULT_COSTS.feeBps),slippageBps:Number(args.slippageBps??DEFAULT_COSTS.slippageBps)};
const start=Date.parse(args.start??'2025-10-20T00:00:00Z'),requestedEnd=Date.parse(args.end??'2026-10-21T00:00:00Z');
const {frames,manifest}=loadBacktestData(args.data);
const closes=Object.fromEntries(Object.entries(frames).map(([bar,bars])=>[bar,bars.map(c=>candleCloseTime(c.ts,bar))]));
function completedAt(bar,at){const times=closes[bar];let lo=0,hi=times.length;while(lo<hi){const m=(lo+hi)>>>1;if(times[m]<=at)lo=m+1;else hi=m;}return frames[bar].slice(Math.max(0,lo-520),lo);}
const allBars=frames[entryFrame],end=Math.min(requestedEnd,candleCloseTime(allBars.at(-1).ts,entryFrame));
const bars=allBars.filter(c=>c.ts>=start&&candleCloseTime(c.ts,entryFrame)<=end);
if(!bars.length)throw Error('No evaluation candles');
const gaps=bars.slice(1).filter((c,i)=>c.ts!==candleCloseTime(bars[i].ts,entryFrame));if(gaps.length)throw Error(`Evaluation data has ${gaps.length} gaps`);
const initialEquity=10000,ledgers=Object.fromEntries(['long','short'].map(side=>[side,{equity:initialEquity,peak:initialEquity,drawdown:0,position:null,trades:[],used:new Set(),pending:null,blockedFills:0,exposureBars:0}]));
const counts={},errors=[],signals=[],warmup={};let decisions=0;
const hashes=Object.fromEntries(['packages/domain/dist/globalEntryPlan.js','packages/domain/dist/globalSetupSelection.js','packages/analysis/dist/globalTradeMap.js'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
for(let i=0;i<bars.length;i++){
  const bar=bars[i],at=candleCloseTime(bar.ts,entryFrame);
  for(const [side,l]of Object.entries(ledgers)){
    if(l.pending){const p=makePosition(l.pending,bar,l.equity,costs);if(p){l.position=p;l.used.add(l.pending.key);}else l.blockedFills++;l.pending=null;}
    if(l.position){l.exposureBars++;const exit=positionExit(l.position,bar);if(exit){const result=closePosition(l.position,exit.price,costs),{price:entryPrice,...position}=l.position;l.trades.push({...position,entryPrice,...result,exitAt:at,reason:exit.reason});l.equity+=result.net;l.position=null;}}
    const marked=l.equity+(l.position?closePosition(l.position,bar.close,costs).net:0);l.peak=Math.max(l.peak,marked);l.drawdown=Math.max(l.drawdown,100*(l.peak-marked)/l.peak);
  }
  // No trade can fill on the decision candle; next bar open is the earliest.
  const markets=Object.keys(frames).map(bar=>({bar,instId:'BTC-USDT',source:'okx-public-spot',fetchedAt:new Date(at).toISOString(),ticker:{priceCurrency:'USDT'},candles:completedAt(bar,at)}));
  if(i===0)for(const m of markets)warmup[m.bar]=m.candles.length;
  if(markets.find(m=>m.bar===frame).candles.length<233||markets.find(m=>m.bar===entryFrame).candles.length<55){counts.warmup=(counts.warmup??0)+1;continue;}
  let report;
  try{report=prepareGlobalReport({market:markets.find(m=>m.bar===frame),contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier:'base',lang:'en'});}
  catch(e){errors.push({at,message:e.message});if(errors.length>10)throw e;continue;}
  decisions++;const eligibility=globalEligibility(report),p=globalTradePlan(report);counts[eligibility]=(counts[eligibility]??0)+1;
  for(const b of p.blockers)counts[`blocker:${b}`]=(counts[`blocker:${b}`]??0)+1;
  if(eligibility==='technical_valid'&&p.side!=='none'&&p.referenceEntry&&p.referenceStop!==null){
    const target=report.levels.find(l=>l.id===p.targetIds[0])?.price,l=ledgers[p.side];
    const key=JSON.stringify([p.side,p.family,p.confirmationTs,p.retestTs,report.levels.find(v=>v.id===p.triggerLevelId)?.price]);
    if(target&&!l.position&&!l.used.has(key)&&i<bars.length-1){
      const availableAt=candleCloseTime(p.retestTs,entryFrame);if(availableAt>at)throw Error('Lookahead signal');
      l.pending={side:p.side,entry:p.referenceEntry,stop:p.referenceStop,target,key,signalAt:at,availableAt,confirmationTs:p.confirmationTs,retestTs:p.retestTs,primaryClose:report.snapshot.price};signals.push(l.pending);
    }
  }
  if(i%1000===0)console.log(JSON.stringify({label,frame,progress:i,total:bars.length,at:new Date(at).toISOString(),trades:Object.fromEntries(Object.entries(ledgers).map(([s,l])=>[s,l.trades.length])),counts}));
}
const summaries={};
for(const [side,l]of Object.entries(ledgers)){
  if(l.position){const result=closePosition(l.position,bars.at(-1).close,costs),{price:entryPrice,...position}=l.position;l.trades.push({...position,entryPrice,...result,exitAt:end,reason:'sample_end'});l.equity+=result.net;}
  summaries[side]={...summarizeTrades(l.trades,initialEquity,l.equity,l.drawdown),exposurePercent:100*l.exposureBars/bars.length,blockedNextOpenFills:l.blockedFills,execution:side==='long'?'Unlevered spot; 1% risk cap, 100% cash cap':'Hypothetical unlevered short; borrow/funding unavailable, NOT executable OKX spot'};
  fs.writeFileSync(`${out}/${frame}-${side}-trades.json`,JSON.stringify(l.trades,null,2));
}
const first=bars[0].open,last=bars.at(-1).close,fee=costs.feeBps/10000,slip=costs.slippageBps/10000;
const benchmarkNetReturnPercent=100*((last*(1-slip)*(1-fee))/(first*(1+slip)*(1+fee))-1);
const result={label,frame,entryFrame,sourceManifest:manifest,productionModuleHashes:hashes,start:new Date(bars[0].ts).toISOString(),end:new Date(end).toISOString(),warmup,decisionBars:decisions,errors,counts,costs,initialEquity,benchmarkNetReturnPercent,summaries,method:{sampling:'Every completed entry-frame candle, recompute the entire production setup using <=520 completed candles per frame',fills:'Next candle open only, adverse slippage, fill must stay in saved entry band; no retrospective intrabar entry',exit:'Frozen SL and first target, all units exit; ambiguous candle stop first; stop gaps at open; no trailing or optimization',positions:'One position per timeframe and direction; separate ledgers, never pool overlapping timeframes',end:'Remaining position liquidated at final close and excluded from resolved win rate',validation:'Rules already inspected historical BTC examples. Retrospective diagnostic, not untouched out-of-sample proof. No parameter fitting.'}};
fs.writeFileSync(`${out}/${frame}-summary.json`,JSON.stringify(result,null,2));fs.writeFileSync(`${out}/${frame}-signals.json`,JSON.stringify(signals,null,2));console.log(JSON.stringify(result));
