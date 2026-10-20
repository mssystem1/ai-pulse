/** Candle execution model, deliberately independent of setup detection. */
export const DEFAULT_COSTS={feeBps:10,slippageBps:2};
export function executionPrice(price,side,action,slippageBps){return price*(1+(side==='long'?1:-1)*(action==='entry'?1:-1)*slippageBps/10000);}
export function positionExit(position,bar){
  const {side,stop,target}=position,long=side==='long';
  if(long?bar.open<=stop:bar.open>=stop)return {price:bar.open,reason:'stop_gap'};
  // Stop first if OHLC cannot establish the order of intrabar touches.
  if(long?bar.low<=stop:bar.high>=stop)return {price:stop,reason:'stop'};
  if(long?bar.high>=target:bar.low<=target)return {price:target,reason:'target'};
  return null;
}
export function makePosition(signal,bar,equity,costs=DEFAULT_COSTS){
  if(bar.ts<signal.availableAt)throw Error('Entry before signal availability');
  const price=executionPrice(bar.open,signal.side,'entry',costs.slippageBps),[low,high]=signal.entry;
  if(price<low||price>high)return null;
  const sign=signal.side==='long'?1:-1,risk=sign*(price-signal.stop),reward=sign*(signal.target-price);
  if(risk<=0||reward<=0)return null;
  const riskBudget=equity*.01,fee=costs.feeBps/10000;
  const lossPerUnit=risk+price*fee+signal.stop*(fee+costs.slippageBps/10000);
  const units=Math.min(riskBudget/lossPerUnit,equity/(price*(1+fee)));
  return {...signal,price,units,entryAt:bar.ts,entryFee:price*units*fee,riskBudget:units*lossPerUnit};
}
export function closePosition(position,rawPrice,costs=DEFAULT_COSTS){
  const price=executionPrice(rawPrice,position.side,'exit',costs.slippageBps),exitFee=price*position.units*costs.feeBps/10000;
  const gross=(position.side==='long'?1:-1)*(price-position.price)*position.units;
  return {exitPrice:price,gross,fees:position.entryFee+exitFee,net:gross-position.entryFee-exitFee};
}
export function winInterval(wins,total){
  if(!total)return null;const z=1.96,p=wins/total,d=1+z*z/total,c=(p+z*z/(2*total))/d,h=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d;
  return [Math.max(0,100*(c-h)),Math.min(100,100*(c+h))];
}
export function summarizeTrades(trades,initialEquity,finalEquity,maxDrawdownPercent){
  const resolved=trades.filter(t=>t.reason!=='sample_end'),wins=resolved.filter(t=>t.net>0),losses=resolved.filter(t=>t.net<0);
  const positive=resolved.reduce((s,t)=>s+Math.max(0,t.net),0),negative=-resolved.reduce((s,t)=>s+Math.min(0,t.net),0);
  return {resolvedTrades:resolved.length,sampleEndExits:trades.length-resolved.length,wins:wins.length,losses:losses.length,winRatePercent:resolved.length?100*wins.length/resolved.length:null,winRate95Percent:winInterval(wins.length,resolved.length),profitFactor:negative?positive/negative:null,profitFactorUndefinedReason:negative?null:resolved.length?'No losing trades':'No resolved trades',expectancyR:resolved.length?resolved.reduce((s,t)=>s+t.net/t.riskBudget,0)/resolved.length:null,netPnl:finalEquity-initialEquity,netReturnPercent:100*(finalEquity/initialEquity-1),maxDrawdownPercent,fees:trades.reduce((s,t)=>s+t.fees,0)};
}
