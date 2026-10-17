import type {GlobalReport,GlobalChannel} from "@pulse/schemas";
import {globalFrameReference} from "./globalContext.js";

/** A parallel channel is constructed in candle-index / linear-price space. */
export function globalChannelBounds(report:GlobalReport,channel:GlobalChannel,ts:number){
  const a=report.candles.findIndex(c=>c.ts===channel.base[0].ts),b=report.candles.findIndex(c=>c.ts===channel.base[1].ts),i=report.candles.findIndex(c=>c.ts===ts);
  if(a<0||b<=a||i<0)return null;
  const base=channel.base[0].price+(channel.base[1].price-channel.base[0].price)*(i-a)/(b-a);
  return {lower:base+Math.min(0,channel.offset),upper:base+Math.max(0,channel.offset),mid:base+channel.offset/2};
}
export function globalChannelLines(report:GlobalReport):string[]{
  const last=report.candles.at(-1);if(!last)return [];
  const zh=report.lang==="zh",price=(p:number)=>p.toLocaleString(zh?"zh-CN":"en-US",{maximumFractionDigits:report.snapshot.pricePrecision});
  return (report.indicators.channels??[]).flatMap(channel=>{
    const bounds=globalChannelBounds(report,channel,last.ts);if(!bounds)return [];
    const direction=channel.base[1].price>channel.base[0].price?zh?"上升":"rising":channel.base[1].price<channel.base[0].price?zh?"下降":"falling":zh?"水平":"horizontal";
    const state=channel.priceState??(last.close<bounds.lower?"below":last.close>bounds.upper?"above":"inside");
    return [zh?`${globalFrameReference(channel.timeframe)} ${channel.scope==="broad"?"宽":"局部"}${direction}平行通道：下轨 ${price(bounds.lower)}，上轨 ${price(bounds.upper)}；价格${state==="inside"?"位于通道内":state==="below"?"位于下轨之外":"位于上轨之外"}。`:`${globalFrameReference(channel.timeframe)} ${channel.scope} ${direction} parallel channel: lower ${price(bounds.lower)}, upper ${price(bounds.upper)}; price ${state==="inside"?"inside":`${state} the channel`}.`];
  });
}
