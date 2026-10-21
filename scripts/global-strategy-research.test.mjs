import test from 'node:test';
import assert from 'node:assert/strict';
import {causalFeatures,completedIndex,updateCandidate,simulateStrategy,acceptanceReasons,selectCandidate,STRATEGIES,RESEARCH_POLICY} from './global-strategy-research.mjs';

const bars=Array.from({length:180},(_,i)=>({ts:i*900000,open:100+i*.1,close:100+i*.1+.2,high:101+i*.1,low:99+i*.1,volume:10+i%5}));
test('future candles cannot revise any already completed feature or reveal an unconfirmed pivot',()=>{
  const prefix=causalFeatures(bars.slice(0,90)),future=bars.map((b,i)=>i<90?b:{...b,high:b.high*20,low:1,close:2});
  assert.deepEqual(causalFeatures(future).slice(0,90),prefix);
  const pivotBars=bars.slice(0,20).map(b=>({...b}));pivotBars[10].high=1000;
  assert.ok(!causalFeatures(pivotBars.slice(0,13)).at(-1).resistance.some(p=>p.index===10));
  assert.ok(causalFeatures(pivotBars.slice(0,14)).at(-1).resistance.some(p=>p.index===10&&p.knownIndex===13));
});
test('higher-timeframe lookup includes a candle only at its close',()=>{
  const higher=[{ts:0},{ts:3600000}];
  assert.equal(completedIndex(higher,'1H',3599999),-1);
  assert.equal(completedIndex(higher,'1H',3600000),0);
  assert.equal(completedIndex(higher,'1H',7199999),0);
});
test('a range reaction is insufficient without a separate later confirming close',()=>{
  const config=STRATEGIES.find(s=>s.family==='range_rejection'&&s.filter==='core');
  const input=bars.slice(0,60).map(b=>({...b}));
  input[58]={ts:58*900000,open:100.5,low:99.9,high:102,close:101.8,volume:20};
  input[59]={ts:59*900000,open:101.8,low:100.5,high:102.7,close:102.4,volume:20};
  const f=input.map(()=>({atr:1,low:100,high:110,ema21:101,rsi:55,volumeRatio:2,resistance:[]}));
  const primary={trend:'mixed',adx:15,resistance:[]},context={trend:'mixed'};
  const reaction=updateCandidate(null,config,input,f,58,primary,context);
  assert.equal(reaction.signal,null);assert.equal(reaction.state.reactionIndex,58);
  const confirmation=updateCandidate(reaction.state,config,input,f,59,primary,context);
  assert.equal(confirmation.signal.reactionAt,input[58].ts);assert.equal(confirmation.signal.confirmationAt,input[59].ts);
  assert.equal(confirmation.signal.stop,99.75);assert.ok(confirmation.signal.target>102.4);
  const blocked=updateCandidate(reaction.state,config,input,f,59,{...primary,resistance:[{price:103}]},context);
  assert.equal(blocked.signal.target,102.95,'A farther R target cannot hide the closer confirmed obstacle');
});
test('too few trades, weak payoff and uncertain 70% results cannot be promoted',()=>{
  const small={resolvedTrades:10,winRatePercent:90,winRate95Percent:[59,99],expectancyR:1,netPnl:100,profitFactor:3,realizedPayoff:2,maxDrawdownPercent:1};
  assert.ok(acceptanceReasons(small).includes('insufficient_final_trades'));
  assert.ok(acceptanceReasons(small).includes('win_rate_uncertainty_too_large'));
  assert.ok(acceptanceReasons({...small,resolvedTrades:500,winRate95Percent:[80,95],realizedPayoff:.2}).includes('realized_reward_risk_failed'));
  assert.deepEqual(acceptanceReasons({...small,resolvedTrades:200,winRate95Percent:[82,95]}),[]);
  assert.ok(acceptanceReasons({...small,resolvedTrades:200,winRatePercent:70,winRate95Percent:[60,80]}).includes('win_rate_target_failed'));
});
test('candidate selection cannot select from final outcomes or fall back to a losing strategy',()=>{
  const bad={resolvedTrades:100,winRatePercent:20,expectancyR:-1,profitFactor:.2,realizedPayoff:2};
  const good={...bad,winRatePercent:80,expectancyR:1,profitFactor:2};
  assert.equal(selectCandidate([{config:{id:'lucky-final'},train:bad,validation:bad,final:good}]),null);
  assert.equal(selectCandidate([{config:{id:'a'},train:good,validation:good,final:bad},{config:{id:'b'},train:bad,validation:bad,final:good}]),'a');
});
test('strategy registry is bounded and each rule preserves the requested reward target',()=>{
  assert.equal(STRATEGIES.length,18);assert.equal(new Set(STRATEGIES.map(s=>s.id)).size,18);
  assert.equal(RESEARCH_POLICY.winRateTargetPercent,70);assert.equal(RESEARCH_POLICY.minimumNetRewardRisk,1.5);
});
test('simulation ignores future data, fills on the next open, and charges costs without crossing split boundaries',()=>{
  const primary=Array.from({length:200},(_,i)=>({ts:i*3600000,open:100,high:110,low:90,close:100,volume:20}));
  const frames={'15m':bars,'1H':primary,'4H':primary.map((b,i)=>({...b,ts:i*14400000}))};
  const blank=arr=>arr.map(()=>({trend:'up',adx:15,atr:1,low:100,high:110,ema21:101,rsi:55,volumeRatio:2,resistance:[]}));
  // Explicit features provide known completed context; the causal feature implementation is checked separately.
  const features=Object.fromEntries(Object.entries(frames).map(([f,b])=>[f,blank(b)]));
  const contextBars=frames['4H'].map(b=>({...b,ts:b.ts-200*14400000}));frames['4H']=contextBars;
  const b=frames['15m'];
  b[100]={ts:100*900000,open:100.5,low:99.9,high:102,close:101.8,volume:20};
  b[101]={ts:101*900000,open:101.8,low:100.5,high:102.7,close:102.4,volume:20};
  b[102]={ts:102*900000,open:102.4,low:102,high:120,close:119,volume:20};
  const config=STRATEGIES.find(s=>s.family==='range_rejection'&&s.filter==='core');
  const input={frames,features,frame:'1H',config,start:100*900000,end:103*900000};
  const run=simulateStrategy(input);assert.equal(run.trades.length,1);
  const t=run.trades[0];assert.equal(t.entryAt,102*900000);assert.equal(t.availableAt,102*900000);
  assert.equal(t.entryPrice,102.4*1.0002);assert.ok(t.fees>0);assert.equal(t.reason,'target');assert.ok(t.netRewardRiskAtEntry>=1.5);
  assert.ok(t.riskBudget<=100.000001);assert.ok(t.entryPrice*t.units+t.entryFee<=10000.000001);
  const changed={...frames,'15m':b.map((v,i)=>i<103?v:{...v,open:1,high:10000,low:1,close:9000})};
  assert.deepEqual(simulateStrategy({...input,frames:changed}),run);
  assert.equal(simulateStrategy({...input,end:102*900000}).trades.length,0);
});

function syntheticLedger(){
  const entry=Array.from({length:180},(_,i)=>({ts:i*900000,open:108,close:108,high:109,low:107,volume:20}));
  const higher=Array.from({length:200},(_,i)=>({ts:i*3600000,open:100,high:110,low:90,close:100,volume:20}));
  const frames={'15m':entry,'1H':higher,'4H':higher.map((b,i)=>({...b,ts:(i-200)*14400000}))};
  const features=Object.fromEntries(Object.entries(frames).map(([key,b])=>[key,b.map(()=>({trend:'up',adx:15,atr:1,low:100,high:110,ema21:101,rsi:55,volumeRatio:2,resistance:[]}))]));
  const config=STRATEGIES.find(s=>s.family==='range_rejection'&&s.filter==='core'&&s.rewardRisk===2.5);
  return {frames,features,frame:'1H',config,start:100*900000,end:150*900000};
}
test('a nominally attractive target is rejected when actual fees consume its net reward',()=>{
  const input=syntheticLedger(),b=input.frames['15m'];
  for(let i=100;i<=102;i++)input.features['15m'][i]={...input.features['15m'][i],atr:.2,low:102};
  b[100]={ts:100*900000,open:102.01,low:101.99,high:102.10,close:102.08,volume:20};
  b[101]={ts:101*900000,open:102.08,low:102.01,high:102.15,close:102.12,volume:20};
  b[102]={ts:102*900000,open:102.12,low:102.1,high:110,close:109,volume:20};
  const run=simulateStrategy({...input,end:103*900000});
  assert.equal(run.signals.length,1);assert.equal(run.trades.length,0);assert.equal(run.summary.skips.insufficient_net_reward,1);
});
test('loss cooldown and the daily equity pause prevent subsequent entries',()=>{
  const input=syntheticLedger(),b=input.frames['15m'];
  for(const i of [100,110,120,130,140]){
    b[i]={ts:i*900000,open:100.5,low:99.9,high:102,close:101.8,volume:20};
    b[i+1]={ts:(i+1)*900000,open:101.8,low:100.5,high:102.7,close:102.4,volume:20};
    b[i+2]={ts:(i+2)*900000,open:102.4,low:99,high:102.5,close:100,volume:20};
  }
  const run=simulateStrategy(input);
  assert.equal(run.trades.length,4,'After the daily pause threshold is crossed, the fifth reaction cannot enter');
  assert.ok(run.trades.every(t=>t.net<0));assert.ok(run.summary.netReturnPercent< -3);
  assert.ok(run.trades.every((t,i)=>!i||t.entryIndex-run.trades[i-1].entryIndex>4));
});
