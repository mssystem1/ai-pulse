import {candleCloseTime,type GlobalReport} from "@pulse/schemas";
import {globalFrameReference} from "./globalContext.js";

const at=(ts:number)=>new Date(ts).toISOString().slice(0,19).replace("T"," ")+" UTC";
export function globalCurrentMarketPrice(report:GlobalReport):number|null{
  if(report.currentMarket?.quote)return report.currentMarket.quote.price;
  const sources=[{timeframe:report.snapshot.timeframe,candles:report.candles},...(report.entryStudy?[report.entryStudy]:[]),...(report.currentMarket?.frames??[])];
  return sources.flatMap(f=>{const c=f.candles.at(-1);return c?[{price:c.close,end:candleCloseTime(c.ts,f.timeframe)??0}]:[];}).sort((a,b)=>b.end-a.end)[0]?.price??null;
}
export function globalCurrentMarketLines(report:GlobalReport):string[]{
  const current=report.currentMarket;if(!current)return [];
  const zh=report.lang==="zh",price=(v:number)=>v.toLocaleString(zh?"zh-CN":"en-US",{maximumFractionDigits:report.snapshot.pricePrecision});
  const latest=current.frames.flatMap(f=>{const c=f.candles.at(-1),end=c?candleCloseTime(c.ts,f.timeframe):null;return c&&end!==null?[{price:c.close,end,timeframe:f.timeframe}]:[];}).sort((a,b)=>b.end-a.end)[0];
  return [...(current.quote?[`${zh?"快照时最新报价":"Latest quote at snapshot"}: ${price(current.quote.price)} ${report.snapshot.priceCurrency} · ${at(current.quote.ts)}`]:[]),...(latest?[`${zh?"最新完整市场K线":"Latest completed market candle"}: ${globalFrameReference(latest.timeframe)} · ${price(latest.price)} · ${at(latest.end)}`]:[])];
}
export function globalSetupEvidenceLines(report:GlobalReport):string[]{
  const d=report.discretionaryPlan,e=d?.evidence;if(!d||!e)return [];
  const zh=report.lang==="zh",level=e.level.toLocaleString(zh?"zh-CN":"en-US",{maximumFractionDigits:report.snapshot.pricePrecision});
  return [zh?`${globalFrameReference(e.timeframe)} 已完整收盘${d.side==="long"?"收复并守住":"跌破并受阻于"} ${level}（${at(e.completedAt)}）；主周期趋势与此入场机会分别评估。`:`${globalFrameReference(e.timeframe)} completed ${d.side==="long"?"reclaim and hold above":"break and hold below"} ${level} at ${at(e.completedAt)}. The primary trend and this entry opportunity are assessed separately.`];
}
