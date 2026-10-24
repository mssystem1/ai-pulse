/** Public descriptions only; execution recipes and tuning stay on the server. */
export function globalSetupStrategyProfile(timeframe:string){
  const frame=timeframe.replace(/utc$/i,"");
  const profiles={
    "15m":{entry:"5m",objectives:"15m",context:"1H",families:["breakout_retest","range_rotation","ema_pullback","vwap_reversion"],description:"Session value, fast breakouts, range rotation and VWAP reactions",window:120},
    "1H":{entry:"15m",objectives:"1H",context:"4H",families:["breakout_retest","ema_pullback","range_rotation","vwap_reversion"],description:"Weekly value, intraday trend, range rotation and VWAP reactions",window:120},
    "4H":{entry:"1H",objectives:"4H",context:"1D",families:["range_rotation","ema_pullback","vwap_reversion","breakout_retest"],description:"Swing structure, anchored value and range rotation",window:180},
    "1D":{entry:"4H",objectives:"1D",context:"1W",families:["ema_pullback","breakout_retest","range_rotation","vwap_reversion"],description:"Multi-month recovery, daily balance and position setups",window:260},
    "1W":{entry:"1D",objectives:"1W",context:"1M",families:["ema_pullback","range_rotation","vwap_reversion","breakout_retest"],description:"Cycle value, weekly support/resistance and macro setups",window:260},
  } as const;
  return profiles[frame as keyof typeof profiles]??null;
}
export function globalSetupFamilyName(family:string,lang:"en"|"zh"="en"){
  const names:Record<string,[string,string]>={range_rotation:["Range rotation","区间轮动"],ema_pullback:["Trend pullback","趋势回调"],vwap_reversion:["VWAP value reversion","VWAP价值回归"],breakout_retest:["Breakout retest","突破回测"]};
  return names[family]?.[lang==="zh"?1:0]??family;
}
