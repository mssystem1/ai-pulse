import { getCandles } from "@pulse/market";
import { candleCloseTime, terminalFrameProfile } from "@pulse/domain";
export type TerminalLiveCandle = { instId:string;timeframe:string;observedAt:number;candle:{ts:number;open:number;high:number;low:number;close:number;volume:number;confirmed:false} };
export function createTerminalLiveCandles(options:{load?:typeof getCandles;now?:()=>number}={}){
 const load=options.load??getCandles,now=options.now??Date.now,cache=new Map<string,{at:number;value:Promise<TerminalLiveCandle>}>();
 return async(instId:string,timeframe:string)=>{
  if(!/^[A-Z0-9]{2,20}-(USDT|USDC|USD)$/.test(instId))throw Error("Exact Spot instrument required");
  const frame=terminalFrameProfile(timeframe).timeframe,key=instId+":"+frame,clock=now(),prior=cache.get(key);
  if(prior&&clock-prior.at<2000)return prior.value;
  const value=load(instId,frame,2).then(rows=>{
   const observedAt=now(),c=rows.find(c=>c.confirmed===false&&c.ts<=observedAt&&(candleCloseTime(c.ts,frame)??0)>observedAt);
   if(!c||![c.open,c.high,c.low,c.close].every(n=>Number.isFinite(n)&&n>0)||!Number.isSafeInteger(c.ts)||!Number.isFinite(c.volume)||c.volume<0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close))throw Error("A valid current forming candle is unavailable");
   return{instId,timeframe:frame,observedAt,candle:{ts:c.ts,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume,confirmed:false as const}};
  });
  if(cache.size>=80)cache.delete(cache.keys().next().value!);cache.set(key,{at:clock,value});
  value.catch(()=>{if(cache.get(key)?.value===value)cache.delete(key);});return value;
 };
}
