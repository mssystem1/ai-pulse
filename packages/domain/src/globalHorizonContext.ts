import type {GlobalReport} from "@pulse/schemas";
import type {GlobalChartCoordinates} from "./globalChart.js";
import {globalVwapContextLine} from "./globalSetupStudies.js";

export function globalHorizonContextLines(report:GlobalReport){
  const h=report.horizonContext;if(!h)return [];
  const zh=report.lang==="zh",price=(p:number)=>p.toLocaleString(zh?"zh-CN":"en-US",{maximumFractionDigits:report.snapshot.pricePrecision});
  const names={session:zh?"时段":"Session",intraday:zh?"日内":"Intraday",swing:zh?"波段":"Swing",position:zh?"中期":"Position",macro:zh?"宏观":"Macro"},ranges={session:zh?"时段区间":"Session range",balance:zh?"当前平衡区间":"Current balance",recovery_leg:zh?"结构恢复范围":"Recovery structure",decline_leg:zh?"结构下跌范围":"Decline structure",cycle:zh?"周期范围":"Cycle range"};
  const nearest=(role:"support"|"resistance")=>h.zones.filter(z=>z.role===role).sort((a,b)=>Math.min(Math.abs((report.snapshot.price??0)-a.lower),Math.abs((report.snapshot.price??0)-a.upper))-Math.min(Math.abs((report.snapshot.price??0)-b.lower),Math.abs((report.snapshot.price??0)-b.upper)))[0];
  const zoneLines=(["support","resistance"] as const).flatMap(role=>{
    const z=nearest(role);if(!z)return [];
    const label=zh?(role==="support"?"主周期支撑":"主周期阻力"):(role==="support"?"Primary support":"Primary resistance");
    return [`${label}: ${price(z.lower)}–${price(z.upper)}`];
  });
  const value=report.indicators.vwap?.points.at(-1)?.value,close=report.snapshot.price;
  const valueLine=value!==undefined&&close!==null?(zh?`主周期收盘 ${price(close)} ${close>=value?"高于":"低于"}锚定价值 ${price(value)}。`:`Primary close ${price(close)} is ${close>=value?"above":"below"} anchored value ${price(value)}.`):"";
  return [`${names[h.reading]} · ${h.timeframe.replace(/utc$/," (UTC)")}`,
    ...h.ranges.map(r=>`${r.kind==="session"&&h.reading==="intraday"?(zh?"本周范围":"Week range"):ranges[r.kind]}: ${price(r.lower)}–${price(r.upper)} · ${new Date(r.startTs).toISOString().slice(0,10)}`),
    ...zoneLines,valueLine,globalVwapContextLine(report)].filter(Boolean);
}

/** The same primary-frame context is used by native overlays and PNG exports. */
export function globalHorizonContextAnnotations(report:GlobalReport,g:GlobalChartCoordinates){
  const h=report.horizonContext;if(!h)return "";
  const esc=(v:unknown)=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
  const startX=(ts:number)=>{const c=report.candles.find(c=>c.ts>=ts&&(g.x(c.ts)??-Infinity)>=g.left);return Math.max(g.left,c?g.x(c.ts)??g.left:g.left);};
  const line=(x:number,y:number,color:string,dash:string)=>`<line x1="${x}" x2="${g.historyEnd}" y1="${y}" y2="${y}" stroke="${color}" stroke-width=".9" stroke-dasharray="${dash}"/>`;
  let svg=`<g data-horizon-context="${h.reading}" data-context-timeframe="${esc(h.timeframe)}">`;
  for(const z of h.zones){
    const a=g.y(z.lower),b=g.y(z.upper);if(a===null||b===null)continue;
    const top=Math.max(g.top,Math.min(a,b)),bottom=Math.min(g.bottom,Math.max(a,b)),x=startX(z.startTs),color=z.role==="support"?"#53dabb":"#ed819a";
    if(bottom<top||x>=g.historyEnd)continue;
    svg+=`<g data-context-zone="${z.role}" data-lower="${z.lower}" data-upper="${z.upper}" data-known-at="${z.knownAt}"><rect x="${x}" y="${top}" width="${g.historyEnd-x}" height="${Math.max(1,bottom-top)}" fill="${color}" fill-opacity=".12"/>${[a,b].filter(y=>y>=g.top&&y<=g.bottom).map(y=>line(x,y,color,"6 5")).join("")}</g>`;
  }
  for(const r of h.ranges){
    const x=startX(r.startTs);if(x>=g.historyEnd)continue;
    const levels=[{value:r.lower,color:"#62cfb1",role:"low"},{value:r.upper,color:"#dd8a9c",role:"high"},...([.25,.5,.75] as const).map(f=>({value:r.lower+(r.upper-r.lower)*f,color:"#7e94ac",role:String(f)}))];
    svg+=`<g data-context-range="${r.kind}" data-range-start="${r.startTs}">`;
    for(const l of levels){const y=g.y(l.value);if(y!==null&&y>=g.top&&y<=g.bottom)svg+=`<g data-context-range-level="${l.role}" data-price="${l.value}" opacity="${l.role==="low"||l.role==="high"?.8:.34}">${line(x,y,l.color,l.role==="low"||l.role==="high"?"7 5":"2 6")}</g>`;}
    svg+="</g>";
  }
  return svg+"</g>";
}
