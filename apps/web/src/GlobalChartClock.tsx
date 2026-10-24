import {useEffect,useState} from "react";
import {globalCurrentMarketLines,type GlobalReport} from "@pulse/domain";

export function formatChartClock(time:number,lang:"en"|"zh",timeZone?:string){
  return new Intl.DateTimeFormat(lang==="zh"?"zh-CN":"en-GB",{year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23",timeZoneName:"longOffset",...(timeZone?{timeZone}:{})}).format(time).replace("GMT","UTC");
}
export function GlobalChartClock({report}:{report:GlobalReport}){
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[]);
  return <div className="global-chart-clock" style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",fontSize:12,padding:"8px 0"}}>
    <div><span>{report.lang==="zh"?"快照":"Snapshot"}: {report.snapshot.observedAt.replace("T"," ").replace(/\.\d+Z$/," UTC")}</span>{globalCurrentMarketLines(report).map(line=><div key={line}>{line}</div>)}</div>
    <div style={{textAlign:"right",fontVariantNumeric:"tabular-nums"}}><time data-chart-clock dateTime={new Date(now).toISOString()}>{formatChartClock(now,report.lang)}</time><div>{report.lang==="zh"?"当前本地时间 · 图表K线：UTC":"Current local time · Chart candles: UTC"}</div></div>
  </div>;
}
