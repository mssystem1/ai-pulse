import type {GlobalReport} from "@pulse/schemas";
import type {GlobalChartLayers} from "./globalChart.js";

/** Saved server-calculated series shared by the interactive and export views. */
export function globalSetupStudySeries(report:GlobalReport,layers:GlobalChartLayers){
  if(report.tier!=="pro")return [];
  const series:Array<{name:string;color:string;dash:boolean;points:Array<{ts:number;value:number}>}>=[];
  if(layers.ema)for(const e of report.indicators.ema??[])series.push({name:`EMA${e.period}`,color:e.period===12?"#f5b75b":"#8bafff",dash:false,points:e.points});
  const vwap=report.indicators.vwap;
  if(layers.vwap&&vwap){
    series.push({name:"AVWAP",color:"#f1dfae",dash:false,points:vwap.points});
    if(layers.vwapBands)for(const b of vwap.bands??[])for(const edge of ["upper","lower"] as const)series.push({name:`AVWAP ${edge==="upper"?"+":"−"}${b.multiple}σ`,color:b.multiple===1?"#8bc8df":b.multiple===2?"#6aa9df":"#8194cf",dash:true,points:b[edge]});
  }
  return series;
}

export function globalVwapContextLine(report:GlobalReport){
  const v=report.indicators.vwap;if(!v?.anchorTs||!v.anchorReason)return "";
  const names=report.lang==="zh"?{session_open:"时段开盘",week_open:"周开盘",swing_low:"主周期波段低点",swing_high:"主周期波段高点",cycle_low:"周期低点",cycle_high:"周期高点"}:{session_open:"Session open",week_open:"Week open",swing_low:"Primary swing low",swing_high:"Primary swing high",cycle_low:"Cycle low",cycle_high:"Cycle high"};
  return `${report.snapshot.timeframe.replace(/utc$/," (UTC)")} · AVWAP ±1/2/3σ · ${names[v.anchorReason]} ${new Date(v.anchorTs).toISOString().slice(0,16).replace("T"," ")} UTC`;
}

export function globalSetupStudyReadings(report:GlobalReport,layers:GlobalChartLayers){
  return globalSetupStudySeries(report,layers).filter(s=>!s.dash).map(s=>({name:s.name,value:s.points.at(-1)?.value}));
}
