/** Isolated strategy research. Nothing here authorizes orders or changes report selection. */
import {makePosition,positionExit,closePosition,summarizeTrades,winInterval} from './global-backtest-engine.mjs';

export const RESEARCH_POLICY=Object.freeze({
  version:'global-strategy-research-v1',
  minimumNetRewardRisk:1.5,winRateTargetPercent:70,minimumFinalTrades:100,
  minimumRealizedPayoff:1.5,maximumDrawdownPercent:10,riskPercent:1,
  dailyLossLimitPercent:3,cooldownBarsAfterLoss:4,maxHoldingBars:48,
  feeBps:10,slippageBps:2,
});
export const STRATEGIES=Object.freeze(['trend_pullback','breakout_retest','range_rejection'].flatMap(family=>
  ['core','aligned','strict'].flatMap(filter=>[1.75,2.5].map(rewardRisk=>Object.freeze({
    id:`${family}-${filter}-${rewardRisk}R`,family,filter,rewardRisk,
  })))));
export const FRAME_RULES=Object.freeze({
  '1H':{entry:'15m',context:'4H'},'4H':{entry:'1H',context:'1Dutc'},
  '1Dutc':{entry:'4H',context:'1Wutc'},'1Wutc':{entry:'1Dutc',context:'1Mutc'},
});

export function frameDuration(frame){return {'15m':900000,'1H':3600000,'4H':14400000,'1Dutc':86400000,'1Wutc':604800000}[frame];}
export function barClose(bar,frame){
  if(frame==='1Mutc'){const d=new Date(bar.ts);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);}
  return bar.ts+frameDuration(frame);
}

/** All fields at index i depend only on bars 0..i; pivots need three right closes. */
export function causalFeatures(bars){
  const out=[];let ema21,ema55,atr=0,gain=0,loss=0,plus=0,minus=0,adx=0;
  let resistance=[];
  for(let i=0;i<bars.length;i++){
    const c=bars[i],prev=bars[i-1],change=prev?c.close-prev.close:0;
    ema21=ema21===undefined?c.close:ema21+(c.close-ema21)*2/22;
    ema55=ema55===undefined?c.close:ema55+(c.close-ema55)*2/56;
    const tr=prev?Math.max(c.high-c.low,Math.abs(c.high-prev.close),Math.abs(c.low-prev.close)):c.high-c.low;
    const up=prev?c.high-prev.high:0,down=prev?prev.low-c.low:0;
    if(i===0){atr=tr;gain=loss=plus=minus=0;}
    else {atr+=(tr-atr)/14;gain+=(Math.max(0,change)-gain)/14;loss+=(Math.max(0,-change)-loss)/14;plus+=((up>down&&up>0?up:0)-plus)/14;minus+=((down>up&&down>0?down:0)-minus)/14;}
    const dx=plus+minus?100*Math.abs(plus-minus)/(plus+minus):0;adx+=(dx-adx)/14;
    const rsi=gain+loss?100*gain/(gain+loss):50;
    const prior=bars.slice(Math.max(0,i-20),i),volume=prior.length?prior.reduce((s,b)=>s+b.volume,0)/prior.length:0;
    const high=prior.length?Math.max(...prior.map(b=>b.high)):null,low=prior.length?Math.min(...prior.map(b=>b.low)):null;
    const p=i-3;
    if(p>=3&&bars.slice(p-3,p).every(b=>b.high<bars[p].high)&&bars.slice(p+1,i+1).every(b=>b.high<bars[p].high))resistance.push({price:bars[p].high,index:p,knownIndex:i});
    resistance=resistance.filter(r=>r.index>=i-520&&c.close<r.price);
    const slope=i>=10?ema55-out[i-10].ema55:0;
    const trend=i<55?'unknown':c.close>ema55&&ema21>ema55&&slope>0?'up':c.close<ema55&&ema21<ema55&&slope<0?'down':'mixed';
    out.push({ema21,ema55,atr,rsi,adx,volumeRatio:volume?c.volume/volume:0,high,low,trend,resistance:resistance.slice()});
  }
  return out;
}

export function completedIndex(bars,frame,at){
  let low=0,high=bars.length;
  while(low<high){const m=(low+high)>>>1;if(barClose(bars[m],frame)<=at)low=m+1;else high=m;}
  return low-1;
}

function allowed(config,primary,context,entry,candle){
  if(!primary||!context||primary.trend==='unknown'||context.trend==='unknown')return false;
  if(config.family==='trend_pullback'&&primary.trend!=='up')return false;
  if(config.family==='breakout_retest'&&primary.trend==='down')return false;
  if(config.family==='range_rejection'&&(primary.adx>=22||primary.trend==='down'))return false;
  if(config.filter!=='core'&&(config.family==='range_rejection'?context.trend==='down':context.trend!=='up'))return false;
  if(config.filter==='strict'){
    if(entry.volumeRatio<1.2||entry.rsi<45||entry.rsi>68)return false;
    if(candle.high<=candle.low||(candle.close-candle.low)/(candle.high-candle.low)<.65)return false;
  }
  return true;
}

/** Returns only a candidate observed after a reaction AND a later confirming close. */
export function updateCandidate(state,config,bars,features,i,primary,context){
  const bar=bars[i],f=features[i],at=bar.ts;
  if(i<55||!allowed(config,primary,context,f,bar))return {state:null,signal:null};
  if(state){
    if(i-state.started>12||bar.close<state.invalidation)return {state:null,signal:null};
    if(state.stage==='break'){
      if(i>state.started&&bar.low<=state.level+.15*f.atr&&bar.close>state.level&&bar.close>bar.open){
        return {state:{...state,stage:'reaction',reactionIndex:i,reactionHigh:bar.high,reactionLow:bar.low,invalidation:Math.min(state.level,bar.low)-.15*f.atr},signal:null};
      }
      return {state,signal:null};
    }
    if(i-state.reactionIndex>3||bar.low<state.reactionLow)return {state:null,signal:null};
    if(i>state.reactionIndex&&bar.close>state.reactionHigh){
      if(bar.close-state.reactionHigh>.75*f.atr)return {state:null,signal:null};
      const stop=state.invalidation,risk=bar.close-stop;
      if(risk<=0)return {state:null,signal:null};
      let target=bar.close+config.rewardRisk*risk;
      if(state.upper!==undefined)target=Math.min(target,state.upper);
      // A nearer known obstacle caps the objective; it may invalidate the trade's net R.
      const obstacles=[...f.resistance,...primary.resistance].filter(p=>p.price>bar.close);
      if(obstacles.length)target=Math.min(target,Math.min(...obstacles.map(p=>p.price))-.05*f.atr);
      return {state:null,signal:{side:'long',entry:[state.reactionHigh,bar.close+.15*f.atr],stop,target,
        signalAt:at,reactionAt:bars[state.reactionIndex].ts,confirmationAt:at,
        family:config.family,key:`${config.id}:${state.reactionIndex}:${i}`}};
    }
    return {state,signal:null};
  }
  if(config.family==='breakout_retest'){
    if(f.high!==null&&bar.close>f.high+.1*f.atr)return {state:{stage:'break',started:i,level:f.high,invalidation:f.high-.5*f.atr},signal:null};
    return {state:null,signal:null};
  }
  const bullish=bar.close>bar.open&&bar.high>bar.low&&(bar.close-bar.low)/(bar.high-bar.low)>=.6;
  const touch=config.family==='trend_pullback'?bar.low<=f.ema21&&bar.close>f.ema21:
    f.low!==null&&bar.low<=f.low+.1*f.atr&&bar.close>=f.low+.25*f.atr&&f.high-f.low>=3*f.atr;
  if(bullish&&touch)return {state:{stage:'reaction',started:i,reactionIndex:i,reactionHigh:bar.high,reactionLow:bar.low,
    invalidation:bar.low-.15*f.atr,...(config.family==='range_rejection'?{upper:f.high-.1*f.atr}:{})},signal:null};
  return {state:null,signal:null};
}

export function netRewardRisk(position,costs){
  const reward=closePosition(position,position.target,costs).net,loss=-closePosition(position,position.stop,costs).net;
  return loss>0?reward/loss:null;
}

/** Separate cash ledgers; no outcome can cross a split boundary. */
export function simulateStrategy({frames,features,frame,config,start,end,policy=RESEARCH_POLICY}){
  if(policy.riskPercent!==1)throw Error('This execution engine supports the declared 1% risk cap only');
  const rules=FRAME_RULES[frame],bars=frames[rules.entry],f=features[rules.entry],costs={feeBps:policy.feeBps,slippageBps:policy.slippageBps};
  const initialEquity=10000;let equity=initialEquity,peak=equity,maxDrawdown=0,position=null,pending=null,state=null;
  let cooldownUntil=-1,day=null,dayStart=equity,lastIndex=-1,exposure=0,decisions=0;const trades=[],signals=[],skips={};
  const skip=key=>{skips[key]=(skips[key]??0)+1;};
  function finish(rawPrice,reason,i){
    const result=closePosition(position,rawPrice,costs),{price:entryPrice,...rest}=position;
    trades.push({...rest,entryPrice,...result,reason,exitAt:barClose(bars[i],rules.entry)});equity+=result.net;
    if(result.net<0)cooldownUntil=i+policy.cooldownBarsAfterLoss;
    position=null;
  }
  for(let i=0;i<bars.length;i++){
    const bar=bars[i],at=barClose(bar,rules.entry);
    if(bar.ts<start||at>end)continue;
    decisions++;lastIndex=i;
    const currentDay=Math.floor(bar.ts/86400000);
    if(currentDay!==day){day=currentDay;dayStart=equity+(position?closePosition(position,bar.open,costs).net:0);}
    const currentEquity=equity+(position?closePosition(position,bar.open,costs).net:0);
    const dailyBlocked=currentEquity<=dayStart*(1-policy.dailyLossLimitPercent/100);
    if(pending){
      if(!dailyBlocked&&i>cooldownUntil){
        const p=makePosition(pending,bar,equity,costs);
        if(!p)skip('next_open_outside_band');
        else if(netRewardRisk(p,costs)<policy.minimumNetRewardRisk)skip('insufficient_net_reward');
        else{position={...p,entryIndex:i,netRewardRiskAtEntry:netRewardRisk(p,costs)};}
      }else skip('risk_pause');
      pending=null;
    }
    if(position){
      exposure++;
      const exit=positionExit(position,bar);
      if(exit)finish(exit.price,exit.reason,i);
      else if(i-position.entryIndex+1>=policy.maxHoldingBars)finish(bar.close,'time_exit',i);
    }
    const marked=equity+(position?closePosition(position,bar.close,costs).net:0);
    peak=Math.max(peak,marked);maxDrawdown=Math.max(maxDrawdown,100*(peak-marked)/peak);
    if(position||dailyBlocked||i<=cooldownUntil){state=null;continue;}
    const p=completedIndex(frames[frame],frame,at),h=completedIndex(frames[rules.context],rules.context,at);
    const decision=updateCandidate(state,config,bars,f,i,features[frame][p],features[rules.context][h]);state=decision.state;
    if(decision.signal&&at<end){pending={...decision.signal,availableAt:at,signalAt:at};signals.push(pending);}
  }
  if(position&&lastIndex>=0)finish(bars[lastIndex].close,'sample_end',lastIndex);
  const summary=summarizeTrades(trades,initialEquity,equity,maxDrawdown),resolved=trades.filter(t=>t.reason!=='sample_end');
  const wins=resolved.filter(t=>t.net>0),losses=resolved.filter(t=>t.net<0);
  const meanWin=wins.length?wins.reduce((s,t)=>s+t.net/t.riskBudget,0)/wins.length:null;
  const meanLoss=losses.length?-losses.reduce((s,t)=>s+t.net/t.riskBudget,0)/losses.length:null;
  const targetHits=resolved.filter(t=>t.reason==='target').length;
  return {summary:{...summary,frame,strategyId:config.id,requestedStart:new Date(start).toISOString(),lastCompletedClose:lastIndex>=0?new Date(barClose(bars[lastIndex],rules.entry)).toISOString():null,decisions,signals:signals.length,exposurePercent:decisions?100*exposure/decisions:0,
    meanWinR:meanWin,meanLossR:meanLoss,realizedPayoff:meanWin!==null&&meanLoss?meanWin/meanLoss:null,
    targetHits,targetHitRatePercent:resolved.length?100*targetHits/resolved.length:null,skips},trades,signals};
}

export function acceptanceReasons(summary,policy=RESEARCH_POLICY){
  const reasons=[];
  if(summary.resolvedTrades<policy.minimumFinalTrades)reasons.push('insufficient_final_trades');
  if(!(summary.winRatePercent>policy.winRateTargetPercent))reasons.push('win_rate_target_failed');
  if(!(summary.winRate95Percent?.[0]>policy.winRateTargetPercent))reasons.push('win_rate_uncertainty_too_large');
  if(!(summary.expectancyR>0&&summary.netPnl>0&&summary.profitFactor>1))reasons.push('positive_net_edge_not_established');
  if(!(summary.realizedPayoff>=policy.minimumRealizedPayoff))reasons.push('realized_reward_risk_failed');
  if(summary.maxDrawdownPercent>policy.maximumDrawdownPercent)reasons.push('drawdown_limit_failed');
  return reasons;
}

/** Selection cannot inspect final-period results. No fallback to a losing winner. */
export function selectCandidate(rows,policy=RESEARCH_POLICY){
  const eligible=rows.filter(r=>[r.train,r.validation].every(s=>s.resolvedTrades>=20&&s.winRatePercent>policy.winRateTargetPercent&&s.expectancyR>0&&s.profitFactor>1&&s.realizedPayoff>=policy.minimumRealizedPayoff));
  return eligible.sort((a,b)=>b.validation.expectancyR-a.validation.expectancyR||a.config.id.localeCompare(b.config.id))[0]?.config.id??null;
}
