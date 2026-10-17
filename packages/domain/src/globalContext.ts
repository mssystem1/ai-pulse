import {parseCandleTimeframe,candleCloseTime,type GlobalReport,type GlobalFrame} from "@pulse/schemas";

export function globalSession(timeframe:string):string {
  const f=parseCandleTimeframe(timeframe);
  return f&&["day","week","month"].includes(f.unit)&&!f.utc?"UTC+8":"UTC";
}
export function globalFrameName(timeframe:string):string { return timeframe.replace(/utc$/i,""); }
export function globalFrameReference(timeframe:string):string {
  const f=parseCandleTimeframe(timeframe);return globalFrameName(timeframe)+(f&&["day","week","month"].includes(f.unit)?` (${globalSession(timeframe)})`:"");
}
export type GlobalContextRelation="aligned"|"opposing"|"mixed"|"unavailable";
/** Context describes its own observed direction, then its relation to this side. */
export function globalContextRelation(report:GlobalReport,side:"long"|"short"|"none"):GlobalContextRelation {
  if(side==="none")return "mixed";
  if(report.context.status!=="available")return "unavailable";
  const row=report.hierarchy?.find(r=>r.timeframe===report.context.timeframe);
  if(row){if(row.status!=="available")return "unavailable";if(row.bias==="mixed"||row.bias==="range")return "mixed";return (row.bias==="up")===(side==="long")?"aligned":"opposing";}
  // Legacy evidence measures recovery against SMA55; do not relabel it as a
  // complete trend classification. Its direction is still side-dependent.
  const a=report.context.agreement;
  if(a==="unknown")return "unavailable";if(a==="neutral")return "mixed";
  return (a==="supports")===(side==="long")?"aligned":"opposing";
}
export function globalContextRequired(report:GlobalReport):boolean {return Boolean(report.decisionVersion)||report.tier==="pro";}
export function globalContextLine(report:GlobalReport,side:"long"|"short"|"none"):string {
  const zh=report.lang==="zh",frame=report.context.timeframe,relation=globalContextRelation(report,side);
  const name=frame?`${globalFrameName(frame)} (${globalSession(frame)})`:zh?"高周期":"Higher timeframe";
  if(relation==="unavailable")return zh?`${name} 背景暂不可用；需复核后再评估入场。`:`${name} context unavailable; recheck before assessing entry.`;
  const labels=zh?{aligned:"与本次方向一致",opposing:"与本次方向相反",mixed:"方向混合"}:{aligned:"aligned",opposing:"opposing",mixed:"mixed"};
  const row=report.hierarchy?.find(r=>r.timeframe===frame),mean=report.context.sma55.at(-1)?.value,close=report.context.candles.at(-1)?.close;
  const measure=!row&&mean&&close?(zh?` · 收盘位于 SMA55 ${close>mean?"上方":"下方"}`:` · close ${close>mean?"above":"below"} SMA55`):"";
  return `${name} · ${labels[relation]}${measure}`;
}
export function globalPrimaryFrame(report:GlobalReport):GlobalFrame|undefined{return report.hierarchy?.find(r=>r.timeframe===report.snapshot.timeframe);}
export function globalHierarchyLines(report:GlobalReport):string[] {
  const zh=report.lang==="zh",labels=zh?{up:"向上",down:"向下",range:"区间",mixed:"方向混合"}:{up:"Up",down:"Down",range:"Range",mixed:"Mixed"};
  return (report.hierarchy??[]).map(r=>`${globalFrameName(r.timeframe)} (${globalSession(r.timeframe)}) · ${r.status==="available"?labels[r.bias]:zh?"不可用":"Unavailable"}${r.completedAt!==null?` · ${zh?"收盘":"closed"} ${new Date(r.completedAt).toISOString()}`:""}`);
}
export function globalSessionMismatch(report:GlobalReport):boolean {
  return !!report.context.timeframe&&globalSession(report.snapshot.timeframe)!==globalSession(report.context.timeframe);
}
