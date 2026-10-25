import {globalTradeAnnotations} from "./globalTradeAnnotations.js";
import { parseCandleTimeframe, type GlobalReport } from "@pulse/schemas";
import { GLOBAL_PATH_COLORS, globalLabel, globalPrice, globalSetupLines, globalTimeframeLabel, globalTradePlanLines, globalCompletedPriceLine, globalRiskLines, globalNextSetupLines, globalPathTitle } from "./globalPresentation.js";
import { globalTradePlan } from "./globalTradePlan.js";
import { globalSetupMap, globalSetupWindow, globalRiskMeasurement, globalEligibility } from "./globalPolicy.js";
import {globalDecision,globalDecisionTitle} from "./globalDecision.js";
import {globalContextLine} from "./globalContext.js";
import {globalChannelBounds,globalChannelLines} from "./globalChannels.js";
import {globalEntryStudySvg} from "./globalEntryChart.js";
import {globalOrderFlowAnnotations,globalOrderFlowLines,globalOrderFlowStudy} from "./globalOrderFlow.js";
import {globalFrameReference} from "./globalContext.js";
import {globalCoverageLine} from "./globalCoverage.js";
import {globalWavePhase} from "./globalSetupSelection.js";
import {globalSetupStudySeries,globalSetupStudyReadings} from "./globalSetupStudies.js";
import {globalTradeCards} from "./globalTradeDisplay.js";
import {globalCurrentMarketLines,globalSetupEvidenceLines} from "./globalMarketNow.js";
import {globalHorizonContextAnnotations,globalHorizonContextLines} from "./globalHorizonContext.js";
import {globalDefaultChartLayers,globalStructuralScaleValues,globalStructuralWindow,globalMeasuredFib,globalChannelAvailability} from "./globalViewport.js";

export type GlobalChartLayers = { studyScale?:"setup"|"context";allSmas?: boolean; sma?:boolean; ema?:boolean; vwapBands?:boolean; range?:boolean; volumeProfile?:boolean;footprint?:boolean; waves?:boolean; regression?: boolean; fibonacci?: boolean; vwap?: boolean; pivots?: boolean; atr?: boolean; channel?: boolean; localChannel?:boolean; channelMid?:boolean };
export type GlobalChartOptions = { layers?: GlobalChartLayers; selectedPathId?: string | null; showScenarios?: boolean; fullHistory?: boolean; structure?: boolean; fitFibonacci?:boolean };
export type GlobalChartCoordinates = { x: (ts: number) => number | null; y: (price: number) => number | null; left: number; right: number; top: number; bottom: number; historyEnd: number };
export const escapeGlobalSvg = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
const line = (x1: number, y1: number, x2: number, y2: number, color: string, width = 1, dash = "") => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
const text = (x: number, y: number, value: unknown, color = "#b9c6d8", size = 12, anchor = "start") => `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" text-anchor="${anchor}">${escapeGlobalSvg(value)}</text>`;
const point = (g: GlobalChartCoordinates, ts: number, price: number) => { const x = g.x(ts), y = g.y(price); return x === null || y === null ? null : { x, y }; };

export function globalFibonacciAnchors(report: GlobalReport) {
  const saved = report.indicators.fibonacci;
  if (!saved.length) return null;
  const ids = saved[0].anchorIds, anchors = [...report.indicators.pivots, ...report.waveCount.anchors];
  const a = anchors.find(anchor => anchor.id === ids[0]), b = anchors.find(anchor => anchor.id === ids[1]);
  if (!a || !b || a.confirmedAt === null || b.confirmedAt === null || a.ts >= b.ts || a.price === b.price) return null;
  // Preserve the exact measured swing in older saved retracements, too.
  const tolerance = Math.max(10 ** -report.snapshot.pricePrecision, Math.abs(b.price) * 1e-8);
  if (saved.some(level => level.anchorIds[0] !== a.id || level.anchorIds[1] !== b.id || Math.abs(level.price - (b.price - (b.price - a.price) * level.ratio)) > tolerance)) return null;
  return { a, b };
}
// A steep projected swing channel can leave the price viewport. Clip its
// segment geometrically so it cannot cross the time axis, RSI or setup panel.
function channelSegment(g: GlobalChartCoordinates, a: { x: number; y: number }, b: { x: number; y: number }) {
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
  const dx = b.x - a.x, dy = b.y - a.y; let start = 0, end = 1;
  for (const [p, q] of [[-dx, a.x - g.left], [dx, g.historyEnd - a.x], [-dy, a.y - g.top], [dy, g.bottom - a.y]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const ratio = q / p;
    if (p < 0) start = Math.max(start, ratio); else end = Math.min(end, ratio);
    if (start > end) return null;
  }
  return { x1: a.x + start * dx, y1: a.y + start * dy, x2: a.x + end * dx, y2: a.y + end * dy };
}

/** One annotation renderer for TradingView's coordinate API and server SVG.
 * The renderer resolves IDs; it never calculates a second wave or trade plan. */
export function globalChartAnnotations(report: GlobalReport, g: GlobalChartCoordinates, options: GlobalChartOptions = {}): string {
  report = globalSetupMap(report);
  const { left, right, top, bottom, historyEnd } = g, future = Math.max(80, right - historyEnd), pro = report.tier === "pro", levels = report.levels;
  options={...options,layers:{...globalDefaultChartLayers(report),...options.layers}};
  const plan=globalTradePlan(report),decision=globalDecision(report),eligibility=globalEligibility(report);
  const allPaths=report.paths.filter(p=>report.view.pathIds.includes(p.id)),main=allPaths.find(p=>p.role==="main")??allPaths[0];
  const alternative=allPaths.find(p=>p.id===options.selectedPathId&&p.id!==main?.id)??allPaths.find(p=>p.id===plan.pathId&&p.id!==main?.id)??allPaths.find(p=>p.id!==main?.id&&(main?.direction!=="range"||p.direction==="down"))??allPaths.find(p=>p.id!==main?.id);
  const visiblePaths=(report.decisionVersion==="decision-v5"?[allPaths.find(p=>p.id===(report.setupSelection?.pathId??plan.pathId))]:[main,alternative]).filter((p):p is NonNullable<typeof p>=>!!p),strategyRoutes=report.strategy?.routes.filter(r=>visiblePaths.some(p=>p.id===r.pathId))??[],visibleIds=new Set([...visiblePaths.flatMap(p=>[p.triggerLevelId,p.invalidationLevelId,...p.targetIds,...(p.stress?[p.stress.triggerLevelId,...p.stress.targetIds]:[])]),...strategyRoutes.flatMap(r=>[...r.objectiveIds,...r.checkpointIds]),...(visiblePaths.some(p=>p.id===plan.pathId)?[plan.triggerLevelId,plan.invalidationLevelId,...plan.targetIds,...(plan.checkpointIds??[])]:[])]);
  const find = (id: string | null) => levels.find(l => l.id === id), xFuture = (fraction: number) => historyEnd + future * fraction;
  const visible = (y: number | null): y is number => y !== null && y >= top && y <= bottom;
  let svg = text(left+8,top-9,report.lang==="zh"?"已完成价格历史":"COMPLETED PRICE HISTORY","#8d9cb3",9);
  const parallels=(report.indicators.channels??[]).filter(c=>c.scope==="broad"?options.layers?.channel!==false:pro&&options.layers?.localChannel!==false);
  const legend=parallels.length?`${report.lang==="zh"?"平行通道":"Parallel channel"}: ${parallels.map(c=>`${c.scope}${c.priceState&&c.priceState!=="inside"?` (price ${c.priceState})`:""}`).join(" / ")}${options.layers?.regression?" · cyan: regression 120 ±2σ":""}`:options.layers?.regression?"Regression channel · 120 bars · ±2σ; no qualifying parallel channel":"";
  if(legend)svg+=text(left+8,top+15,legend,"#a8b4c6",10);
  if (options.showScenarios !== false) svg += `<rect x="${historyEnd+1}" y="${top}" width="${Math.max(0,right-historyEnd)}" height="${bottom-top}" fill="#142034" fill-opacity=".36"/>`+line(historyEnd, top, historyEnd, bottom, "#536175", 1, "4 5")+text(historyEnd+15,top-9,report.decisionVersion==="decision-v5"?report.lang==="zh"?"交易计划 · Entry / SL / TP":"TRADE PLAN · ENTRY / SL / TP":report.lang==="zh"?"有条件走势 · 时间仅为示意":"CONDITIONAL MOVES · TIMING SCHEMATIC","#99abc4",9);
  if (options.layers?.waves!==false&&report.waveCount.status === "unclear") svg += text(left + 8, top + (legend?36:19), globalLabel("unclear", report.lang), "#acb8cb", 12);
  if(pro&&options.layers?.range&&report.horizonContext)svg+=globalHorizonContextAnnotations(report,g);
  if(pro&&options.layers?.volumeProfile)svg+=globalOrderFlowAnnotations(report,g);
  if(pro&&options.layers?.range&&report.range&&!report.horizonContext){
    const range=report.range,mid=(range.lower[1]+range.upper[0])/2,start=report.candles.find(c=>c.ts>=range.startTs&&g.x(c.ts)!==null&&g.x(c.ts)!>=left),rx=Math.max(left,start?g.x(start.ts)??left:left);
    for(const [kind,zone,color] of [["support",range.lower,"#53dabb"],["resistance",range.upper,"#ef6b85"]] as const){
      const a=g.y(zone[0]),b=g.y(zone[1]);if(a===null||b===null)continue;
      const zoneTop=Math.max(top,Math.min(a,b)),zoneBottom=Math.min(bottom,Math.max(a,b));
      if(zoneBottom>=zoneTop)svg+=`<g data-range-zone="${kind}"><rect x="${rx}" y="${zoneTop}" width="${Math.max(0,historyEnd-rx)}" height="${Math.max(1,zoneBottom-zoneTop)}" fill="${color}" fill-opacity=".09"/>${[a,b].filter(visible).map(y=>line(rx,y,historyEnd,y,color,.8,"5 4")).join("")}</g>`;
    }
    const my=g.y(mid);if(visible(my))svg+=`<g data-range-midpoint="${mid}">${line(rx,my,historyEnd,my,"#91a1b8",.8,"2 5")}</g>`;
  }
  const origin = report.waveCount.anchors[0];
  for(const channel of report.indicators.channels??[]){
    if(channel.scope==="broad"?options.layers?.channel===false:!pro||options.layers?.localChannel===false)continue;
    const first=report.candles.find(c=>c.ts>=channel.startTs&&g.x(c.ts)!==null&&g.x(c.ts)!>=left),last=report.candles.at(-1);
    if(!first||!last)continue;
    const a=globalChannelBounds(report,channel,first.ts),b=globalChannelBounds(report,channel,last.ts);if(!a||!b)continue;
    const color=channel.scope==="broad"?"#bd945b":"#a8b4c6";
    for(const edge of ["lower","upper",...(options.layers?.channelMid?["mid"]:[])] as const){
      const pa=point(g,first.ts,a[edge as keyof typeof a]),pb=point(g,last.ts,b[edge as keyof typeof b]);if(!pa||!pb||pa.x===pb.x)continue;
      const segment=channelSegment(g,pa,pb);
      if(segment)svg+=`<g data-channel="${channel.scope}" data-edge="${edge}" data-known-at="${channel.knownAt}">${line(segment.x1,segment.y1,segment.x2,segment.y2,color,edge==="mid"?.7:1.2,edge==="mid"?"3 5":"")}</g>`;
      if(options.showScenarios!==false){
        const x=historyEnd+future*.4,y=pb.y+(pb.y-pa.y)/(pb.x-pa.x)*(x-pb.x),futureSegment=channelSegment({...g,left:historyEnd,historyEnd:right},pb,{x,y});
        if(futureSegment)svg+=`<g data-channel-projection="${channel.scope}" opacity=".35">${line(futureSegment.x1,futureSegment.y1,futureSegment.x2,futureSegment.y2,color,.8,"3 5")}</g>`;
      }
    }
  }
  if (report.indicators.channel && options.layers?.channel !== false) for (const anchors of [report.indicators.channel.lower, report.indicators.channel.upper]) {
    const a = point(g, anchors[0].ts, anchors[0].price), b = point(g, anchors[1].ts, anchors[1].price);
    if (!a || !b || a.x === b.x) continue;
    const endY = a.y + (b.y - a.y) / (b.x - a.x) * (historyEnd - a.x);
    const segment = channelSegment(g, a, { x: historyEnd, y: endY });
    if (segment) svg += `<g data-channel="swing">${line(segment.x1, segment.y1, segment.x2, segment.y2, "#d89b57", 1.4)}</g>`;
  }
  if (pro && options.layers?.fibonacci && report.indicators.fibonacci.length) {
    const measured = globalFibonacciAnchors(report);
    if (measured) {
      const { a, b } = measured;
      svg+=text(left+8,bottom-27,`Fib A ${new Date(a.ts).toISOString().slice(0,10)} → Fib B ${new Date(b.ts).toISOString().slice(0,10)} · ${a.ts<(report.candles.at(-globalSetupWindow(report))?.ts??0)?"macro swing; fit anchors":"measured swing"}`,"#a7bed9",10);
      const pa = point(g,a.ts,a.price), pb = point(g,b.ts,b.price), start = left;
      const zero = g.y(b.price), one = g.y(a.price);
      if (zero !== null && one !== null) svg += `<g data-fibonacci="confirmed-swing"><rect x="${start}" y="${Math.max(top,Math.min(zero,one))}" width="${Math.max(0,historyEnd-start)}" height="${Math.max(0,Math.min(bottom,Math.max(zero,one))-Math.max(top,Math.min(zero,one)))}" fill="#718fc0" fill-opacity=".035"/>`;
      if (pa && pb) { const segment = channelSegment(g,pa,pb); if(segment) svg += line(segment.x1,segment.y1,segment.x2,segment.y2,"#a7bed9",1,"5 4"); }
      const rows: number[] = [];
      for(const ratio of [0,.236,.382,.5,.618,.786,1]) {
        // Input high/low endpoints are measuring data, not projected exits.
        // If an endpoint is independently selected as a TP, the trade drawing
        // labels it as TP. Do not add a competing historical price marker.
        if(report.decisionVersion==="decision-v5"&&(ratio===0||ratio===1))continue;
        const price = b.price-(b.price-a.price)*ratio, y=g.y(price); if(!visible(y)||start>=historyEnd)continue;
        const color = ratio === .618 ? "#91cbae" : ratio === .5 ? "#b6a0dc" : "#86a7c5";
        svg += `<g data-fib-ratio="${ratio}" data-anchor-a="${escapeGlobalSvg(a.id)}" data-anchor-b="${escapeGlobalSvg(b.id)}">`+line(start,y,historyEnd,y,color,ratio===0||ratio===1?1.2:.8);
        // Keep the real horizontal line at its price. Omit only crowded labels.
        if(rows.every(row=>Math.abs(row-y)>=17)){rows.push(y);const label=`Fib ${ratio} (${Number((ratio*100).toFixed(1))}%${ratio===0?", B":ratio===1?", A":""}) · ${globalPrice(report,price)}`;svg += `<rect x="${start+3}" y="${y-16}" width="${Math.min(historyEnd-start-3,label.length*5.8+6)}" height="15" rx="2" fill="#0f1826" fill-opacity=".88"/>`+text(start+6,y-4,label,color,10);}
        svg += "</g>";
      }
      if(zero !== null && one !== null)svg += "</g>";
    }
  }
  if (pro && options.layers?.pivots) for (const a of report.indicators.pivots) { const p = point(g, a.ts, a.price); if (a.confirmedAt !== null && p && p.x >= left && p.x <= historyEnd && visible(p.y)) svg += `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="#83a9bc"/>`; }
  const waveLabels: Array<{ x: number; y: number }> = [];
  const waveAnchors=options.layers?.waves===false?[]:report.waveCount.anchors;
  const wavePoints=waveAnchors.flatMap(a=>{const p=point(g,a.ts,a.price);return p&&p.x>=left&&p.x<=historyEnd&&visible(p.y)?[p]:[];});
  if(wavePoints.length>1)svg+=`<polyline data-wave-swings="candidate" points="${wavePoints.map(p=>`${p.x},${p.y}`).join(" ")}" fill="none" stroke="#a38ebd" stroke-width="1.2" stroke-dasharray="4 3"/>`;
  const latest = report.candles.at(-1), closeY = latest ? g.y(latest.close) : null, atr = pro && options.layers?.atr ? report.indicators.atr.points.at(-1)?.value : undefined;
  const atrY = latest && atr !== undefined ? g.y(latest.close - atr) : null;
  const readingRows = [closeY === null ? null : closeY - 7, atrY === null ? null : atrY + 13].filter((row): row is number => row !== null);
  for (const a of waveAnchors) { const p = point(g, a.ts, a.price); if (!p || !visible(p.y) || p.x < left || p.x > historyEnd) continue;
    const desiredY = p.y + (a.kind === "high" ? -14 : 20);
    const candidates = [0, -24, 24, -48, 48, -72, 72].flatMap(dy => [0, -30, 30, -60, 60].map(dx => ({ x: Math.max(left + 14, Math.min(historyEnd - 14, p.x + dx)), y: Math.max(top + 15, Math.min(bottom - 8, desiredY + dy)), distance: dx * dx + dy * dy }))).sort((a, b) => a.distance - b.distance);
    const label = candidates.find(candidate => waveLabels.every(placed => Math.abs(candidate.x - placed.x) >= 29 || Math.abs(candidate.y - placed.y) >= 23) && readingRows.every(row => candidate.x < historyEnd - 145 || Math.abs(candidate.y - row) >= 22)) ?? candidates[0];
    waveLabels.push(label);
    svg += `<g data-wave-label="${escapeGlobalSvg(a.id)}">` + (Math.abs(label.x-p.x)>2 || Math.abs(label.y-desiredY)>2 ? line(p.x, p.y, label.x, label.y - 5, "#a38ebd", .7) : "") + `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#d0b7f7"/><rect x="${label.x-13}" y="${label.y-14}" width="26" height="20" rx="5" fill="#202036"/>` + text(label.x, label.y, a.label, "#e6d5ff", 13, "middle") + "</g>";
  }
  if (origin&&options.layers?.waves!==false) svg += text(left + 8, bottom - 8, globalWavePhase(report).recovered?(report.lang==="zh"?"C 后恢复 · 历史 ABC 候选":"POST-C RECOVERY · HISTORICAL ABC CANDIDATE"):`${report.lang === "zh" ? "候选" : "CANDIDATE"} · ${report.waveCount.activeWave}`, "#bba8d8", 10);
  if (options.showScenarios === false) return svg;
  if(report.decisionVersion==="decision-v5")return svg+globalTradeAnnotations(report,g,options);
  const labels = report.view.levelIds.filter(id=>visibleIds.has(id)).flatMap(id => { const l = find(id), y = l ? g.y(l.price) : null; return l && visible(y) ? [{ level: l, y }] : []; }).sort((a,b)=>Number(b.level.id===plan.triggerLevelId||plan.targetIds.includes(b.level.id))-Number(a.level.id===plan.triggerLevelId||plan.targetIds.includes(a.level.id))).filter((item,i,all)=>!all.slice(0,i).some(prior=>Math.abs(prior.level.price-item.level.price)<10**-report.snapshot.pricePrecision)).sort((a, b) => a.y - b.y);
  const labelPositions=labels.map((l,i)=>Math.max(l.y,top+12+i*20));
  for(let i=1;i<labelPositions.length;i++)labelPositions[i]=Math.max(labelPositions[i],labelPositions[i-1]+20);
  for(let i=labelPositions.length-1;i>=0;i--)labelPositions[i]=Math.min(labelPositions[i],i===labelPositions.length-1?bottom-3:labelPositions[i+1]-20);
  for (const { level: l, y } of labels) {
    const trigger = l.id === plan.triggerLevelId, targetIndex = plan.targetIds.indexOf(l.id), floor = l.id === plan.invalidationLevelId,strategyObjective=strategyRoutes.some(r=>r.objectiveIds.includes(l.id)),checkpoint=!strategyObjective&&strategyRoutes.some(r=>r.checkpointIds.includes(l.id))||!strategyRoutes.length&&plan.checkpointIds?.includes(l.id);
    const stress=report.paths.some(p=>p.stress?.targetIds.includes(l.id)),upside=report.paths.some(p=>p.kind==="recount"&&p.targetIds.includes(l.id));
    const label = checkpoint?report.lang==="zh"?"沿途关口":"CHECKPOINT":targetIndex>=0&&plan.strategyId?`${report.strategy?.name.toUpperCase()} OBJ ${targetIndex+1}`:trigger ? decision.planningValid?"ENTRY PLAN":report.lang==="zh"?"支撑 / 阻力":"SUPPORT / RESISTANCE" : targetIndex >= 0 ? decision.planningValid?`TP${targetIndex+1}`:report.lang==="zh"?`目标 ${targetIndex+1}`:`OBJECTIVE ${targetIndex+1}` : floor ? report.lang === "zh" ? "观点变化位" : "VIEW CHANGE" : stress?report.lang==="zh"?"有条件压力":"CONDITIONAL STRESS":upside?report.lang==="zh"?"上行":"UPSIDE":l.basis === "extension" ? report.lang === "zh" ? "投射" : "PROJECTION" : l.role === "support" ? report.lang === "zh" ? "支撑" : "SUPPORT" : report.lang === "zh" ? "阻力" : "RESISTANCE";
    const axisLabel=strategyObjective&&targetIndex<0?`${report.strategy!.name.toUpperCase()} OBJECTIVE`:label;
    const color = trigger || targetIndex >= 0 || strategyObjective ? "#ffcb76" : floor ? "#ff8194" : stress?"#b790ff":upside?"#48e3ad":"#97a8c1", labelY = labelPositions[labels.findIndex(item=>item.level.id===l.id)];
    svg += line(Math.max(left,historyEnd-(historyEnd-left)*.25), y, right+7, y, color, .8).replace("/>",' stroke-opacity=".35"/>');
    if (labelY <= bottom - 3) svg += `<g data-level-id="${escapeGlobalSvg(l.id)}">${Math.abs(labelY-y)>2?line(right-10,y,right+8,labelY-2,color,.7):""}<rect x="${right + 8}" y="${labelY - 12}" width="132" height="20" rx="3" fill="${color}" fill-opacity=".12"/>` + text(right + 132, labelY + 2, globalPrice(report,l.price), color, 11,"end")+text(right+4,labelY+2,axisLabel,color,8,"end")+ "</g>";
  }
  const last = report.candles.at(-1), lastY = last ? g.y(last.close) : null;
  if (visible(lastY)) svg += text(historyEnd - 8, lastY - 7, `${report.lang === "zh" ? "最后收盘" : "LAST CLOSE"} ${globalPrice(report, last!.close)}`, "#d1dae8", 10, "end");
  const scenarioLabels: Array<{ y: number; value: string; color: string; size: number; dim: boolean }> = [];
  const stageRows: number[] = [];
  for (const path of visiblePaths) {
    const primary=path.id===plan.pathId&&plan.side!=="none";
    const color=path.direction==="down"?"#f0738c":path.direction==="up"?"#53dabb":"#9dabcf", dim = options.selectedPathId && options.selectedPathId !== path.id, targets = (primary?plan.targetIds:path.targetIds).filter(id=>report.view.levelIds.includes(id)).map(id => find(id)).filter((l): l is NonNullable<typeof l> => Boolean(l));
    const trigger = find(primary?plan.triggerLevelId:path.triggerLevelId), triggerY = trigger ? g.y(trigger.price) : lastY;
    if (!visible(triggerY) || !targets.length) continue;
    const targetPoints = targets.map((l, i) => ({ x: xFuture(path.kind === "recount" ? .72 + i * .16 : .47 + i * .25), y: g.y(l.price) })).filter((p): p is {x:number;y:number} => visible(p.y));
    if (!targetPoints.length) continue;
    const startX = path.confirmation === "hold" ? historyEnd + 7 : xFuture(path.kind === "recount" ? .6 : .18), startY = path.confirmation === "hold" && visible(lastY) ? lastY : triggerY;
    const planned=primary&&decision.planningValid&&plan.referenceEntry!==null;
    if(path.direction==="range"&&report.range){
      const low=g.y(report.range.lower[1]),high=g.y(report.range.upper[0]);
      if(visible(low)&&visible(high))svg+=`<g data-range-bounds="observed"><rect x="${historyEnd+2}" y="${high}" width="${future*.7}" height="${Math.max(1,low-high)}" fill="#9dabcf" fill-opacity=".035"/>${line(historyEnd,low,xFuture(.7),low,"#9dabcf",1,"4 5")}${line(historyEnd,high,xFuture(.7),high,"#9dabcf",1,"4 5")}</g>`;
      if(!planned){scenarioLabels.push({y:triggerY+30,value:report.lang==="zh"?"区间边缘：买卖测试分别确认":"RANGE EDGES · separate BUY / SELL tests",color,size:11,dim:false});continue;}
    }
    // Conditional level gates are not forecasts of future oscillation turns.
    const points = [{x:planned?xFuture(.28):startX,y:triggerY},...targetPoints];
    const d = points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" "), end = points.at(-1)!, prev = points.at(-2)!, angle = Math.atan2(end.y - prev.y, end.x - prev.x);
    const arrow = [end, { x: end.x - 11 * Math.cos(angle) + 5 * Math.sin(angle), y: end.y - 11 * Math.sin(angle) - 5 * Math.cos(angle) }, { x: end.x - 11 * Math.cos(angle) - 5 * Math.sin(angle), y: end.y - 11 * Math.sin(angle) + 5 * Math.cos(angle) }];
    svg += `<g data-path-id="${escapeGlobalSvg(path.id)}"${planned?' data-planned-entry-route="true"':""} opacity="${dim ? .2 : 1}"><path d="${d}" fill="none" stroke="${color}" stroke-width="${path.role === "main" ? 2.5 : 2}"${!decision.qualified || path.state === "conditional" || planned&&plan.state!=="confirmed" ? ' stroke-dasharray="6 5"' : ""}/><polygon points="${arrow.map(p => `${p.x},${p.y}`).join(" ")}" fill="${color}"/>`;
    const pathIndex=report.view.pathIds.indexOf(path.id),compactTitle=globalPathTitle(report,path);
    svg+=text(end.x+10,end.y+4,["①","②","③"][pathIndex],color,12);
    const titleY=path.kind==="recount"?Math.min(...targetPoints.map(p=>p.y))-28:primary?targetPoints[0].y-18:startY+38;
    scenarioLabels.push({ y: titleY, value: compactTitle, color, size: 11, dim: Boolean(dim) });
    if (primary&&decision.planningValid) {
      const stages = [{ x: xFuture(.28), y: triggerY, id: plan.triggerLevelId }, ...targetPoints.map((p, i) => ({ ...p, id: plan.targetIds[i] }))];
      stageRows.push(...stages.map(stage => stage.y));
      stages.forEach((p, i) => svg += `<g ${decision.qualified?"data-stage":"data-plan-stage"}="${i?`TP${i}`:"ENTRY"}" data-level-id="${escapeGlobalSvg(p.id)}"><circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${color}"/>` + text(p.x, p.y + (i===1?-10:16), i?`TP${i}`:`${plan.side==="short"?"SELL":"BUY"}${decision.qualified?"":" PLAN"} (${globalFrameReference(plan.entryTimeframe??report.snapshot.timeframe)})`, color, 10, "middle") + "</g>");
      const tested=plan.confirmationTs&&plan.retestTs&&!plan.blockers.includes("cancelled")&&!plan.blockers.includes("expired");
      const actionHint=decision.qualified?(report.lang==="zh"?"入场信号已确认 · 复核报价":"ENTRY SIGNAL CONFIRMED · CHECK QUOTE"):report.lang==="zh"?"条件入场计划":"CONDITIONAL ENTRY PLAN";
      scenarioLabels.push({ y: triggerY + 35, value: actionHint??(tested?(report.lang==="zh"?"测试已观察 · 复核入场与费用":"TEST OBSERVED · RECHECK ENTRY / QUOTE"):(report.lang === "zh" ? "需新的确认和后续测试" : "FRESH CONFIRMATION + SUBSEQUENT TEST")), color, size: 8, dim: Boolean(dim) });
    }
    svg += "</g>";
    if(pro&&path.stress){const trigger=find(path.stress.triggerLevelId),target=find(path.stress.targetIds[0]),a=trigger?g.y(trigger.price):null,b=target?g.y(target.price):null;
      if(visible(a)&&visible(b)){
        svg+=`<g data-stress-id="${escapeGlobalSvg(path.id)}" opacity="${dim ? .3 : .75}"><path d="M ${xFuture(.72)} ${a} L ${xFuture(.95)} ${b}" fill="none" stroke="#ba81ae" stroke-width="1.2" stroke-dasharray="3 6"/></g>`;
        scenarioLabels.push({ y: b - 9, value: `${report.lang === "zh" ? "完整收盘跌破后" : "Only after close below"} ${globalPrice(report, trigger!.price)}`, color: "#ba81ae", size: 9, dim: Boolean(dim) });
      }
    }
  }
  if (decision.qualified&&report.setup.pathId===plan.pathId&&report.setup.entryZone && report.setup.protectiveStop !== null) {
    const a = g.y(report.setup.entryZone[0]), b = g.y(report.setup.entryZone[1]), stop = g.y(report.setup.protectiveStop);
    if (visible(a) && visible(b)) svg += `<rect x="${historyEnd}" y="${Math.min(a, b)}" width="${future * .3}" height="${Math.max(2, Math.abs(a - b))}" fill="#f6c368" fill-opacity=".15"/>`;
    if (visible(stop)) {
      svg += line(historyEnd, stop, xFuture(.42), stop, "#f0738c", 1.3, "5 3");
      scenarioLabels.push({y:stop-6,value:`${report.setup.pathId!==plan.pathId?(report.lang==="zh"?"备选买入止损（已观察）":"ALT BUY SL (observed)"):globalLabel("stop", report.lang)} ${globalPrice(report, report.setup.protectiveStop)}`,color:"#f0738c",size:9,dim:Boolean(options.selectedPathId&&options.selectedPathId!==report.setup.pathId)});
    }
  }
  if(decision.planningValid&&plan.referenceEntry&&plan.referenceStop){
    const entry=g.y(plan.referenceEntry[0]),stop=g.y(plan.referenceStop),color=plan.side==="short"?"#f0738c":"#53dabb";
    const dim=options.selectedPathId&&options.selectedPathId!==plan.pathId;
    for(const [value,label,price] of [[entry,decision.signalObserved?report.lang==="zh"?"已观察入场":"OBSERVED ENTRY":report.lang==="zh"?"观察区域":"WATCH AREA",plan.referenceEntry[0]],[stop,decision.signalObserved?report.lang==="zh"?"已观察止损":"OBSERVED SL":report.lang==="zh"?"暂定止损示例":"PROVISIONAL SL",plan.referenceStop]] as const)if(visible(value)){
      svg+=`<g data-plan-reference="${escapeGlobalSvg(label)}" opacity="${dim?.2:.8}">`+line(historyEnd+2,value,xFuture(.32),value,color,1,"2 4")+"</g>";
      scenarioLabels.push({y:value-9,value:`${label} ${globalPrice(report,price)}`,color,size:9,dim:Boolean(dim)});
    }
  }
  if(decision.planningValid&&plan.referenceEntry&&plan.referenceStop!==null){
    const risk=globalRiskMeasurement(report),entry=g.y(plan.side==="long"?plan.referenceEntry[1]:plan.referenceEntry[0]),stop=g.y(plan.referenceStop);
    if(risk&&visible(entry)&&visible(stop))svg+=`<g data-risk-band="planned"><rect x="${historyEnd+2}" y="${Math.min(entry,stop)}" width="${Math.max(24,future*.12)}" height="${Math.max(1,Math.abs(stop-entry))}" fill="#ef6b85" fill-opacity=".12"/>`+line(historyEnd+5,entry,historyEnd+5,stop,"#ef6b85",2)+"</g>";
  }
  if (pro && options.layers?.atr && last && visible(lastY)) { const atr = report.indicators.atr.points.at(-1)?.value, upper = atr === undefined ? null : g.y(last.close + atr), lower = atr === undefined ? null : g.y(last.close - atr);
    if (visible(upper) && visible(lower)) svg += line(historyEnd - 7, upper, historyEnd - 7, lower, "#c8abea", 2) + text(historyEnd - 12, lower + 13, `ATR14 ${globalPrice(report, atr)}`, "#c8abea", 10, "end"); }
  // Nearby weekly levels can place several routes at the same pixel. Keep
  // their numbered labels separate without changing any path coordinates.
  scenarioLabels.sort((a, b) => a.y - b.y);
  const availableRows = Array.from({ length: Math.max(1, Math.floor((bottom - top - 23) / 19) + 1) }, (_, i) => top + 15 + i * 19);
  const rows: number[] = [];
  for (const label of scenarioLabels) {
    const candidates = availableRows.filter(row => !rows.includes(row) && stageRows.every(stage => row < stage - 22 || row > stage + 30));
    const remaining = candidates.length ? candidates : availableRows.filter(row => !rows.includes(row));
    rows.push(remaining.sort((a, b) => Math.abs(a - label.y) - Math.abs(b - label.y))[0] ?? bottom - 8);
  }
  scenarioLabels.forEach((label, i) => {
    const labelWidth = Array.from(label.value).reduce((width, character) => width + (character.charCodeAt(0) > 255 ? 1 : .56) * label.size, 0);
    const size=Math.max(9,label.size),available=Math.max(60,future-27);
    let shown="",used=0;
    for(const char of label.value){const advance=(char.charCodeAt(0)>255?1:.56)*size;if(used+advance>available-8){shown+="…";break;}shown+=char;used+=advance;}
    svg += `<g data-scenario-label="${i}" data-full-label="${escapeGlobalSvg(label.value)}" opacity="${label.dim ? .2 : 1}"><rect x="${historyEnd + 12}" y="${rows[i] - 13}" width="${Math.min(labelWidth + 7, Math.max(80, future - 20))}" height="17" rx="3" fill="#142034" fill-opacity=".9"/>` + text(historyEnd + 15, rows[i], shown, label.color, size) + "</g>";
  });
  return svg;
}

/** Self-contained image of a saved report. No URLs, model calls or live prices. */
export function globalReportChartSvg(report: GlobalReport, options: GlobalChartOptions = {}): string | null {
  if (report.candles.length < 2) return null;
  const pro = report.tier === "pro", width = 1300, priceBottom = 548, top = 132, left = 62, historyEnd = 818, right = 1110,layers={...globalDefaultChartLayers(report),...options.layers},entryTop=pro?774:595,entryImage=globalEntryStudySvg(report,1250,options.selectedPathId),flow=pro&&layers.footprint?globalOrderFlowStudy(report,1250):null,flowTop=entryTop+(entryImage?240:0),footerTop=flowTop+(flow?flow.height+15:0);
  const decision=globalDecision(report),primary=globalTradePlan(report);
  const footerLines=[...new Set([globalDecisionTitle(report),decision.route,...globalSetupEvidenceLines(report),...globalCurrentMarketLines(report),...(decision.direction==="BUY / SELL"?decision.scenarios.map(s=>s.line):[decision.nextCondition]),...globalNextSetupLines(report).slice(report.decisionVersion==="decision-v5"?0:1).filter(line=>!line.startsWith("First-objective")&&!line.startsWith("Reassess")),decision.changeView,
    ...(decision.rewardLine&&decision.direction!=="BUY / SELL"?[decision.rewardLine]:[]),...(decision.qualified&&decision.risk?[`${report.lang==="zh"?"风险参考":"Risk reference"}: ${decision.risk.percent.toFixed(2)}% · ${decision.risk.atr?.toFixed(2)} ATR14`]:[]),
    ...(globalCoverageLine(report)?[globalCoverageLine(report)!]:[]),...(pro?[...globalHorizonContextLines(report),...globalOrderFlowLines(report),...globalChannelLines(report)]:[])].filter(Boolean))];
  const wrapped=footerLines.flatMap((value,index)=>{const max=report.lang==="zh"?(index?100:70):(index?185:140),rows:string[]=[];let rest=value;while(rest.length>max){const space=report.lang==="en"?rest.lastIndexOf(" ",max):-1,at=space>max/2?space:max;rows.push(rest.slice(0,at));rest=rest.slice(at).trimStart();}if(rest)rows.push(rest);return rows;});
  const footerHeight=wrapped.length*19+32,height=footerTop+footerHeight+35;
  const periods = layers.sma===false?[]:pro && layers.allSmas ? [21, 55, 89, 144, 233] : [55];
  const candles = options.fullHistory?report.candles:report.candles.slice(options.fitFibonacci?-globalStructuralWindow(report,true):options.structure?-Math.max(180,globalSetupWindow(report)):-globalSetupWindow(report)), start = candles[0].ts, end = candles.at(-1)!.ts;
  const refs = globalSetupMap(report).view.levelIds.flatMap(id => { const p = report.levels.find(l => l.id === id)?.price; return p === undefined ? [] : [p]; });
  const plan=globalTradePlan(report),visiblePoints=(points:Array<{ts:number;value:number}>)=>points.filter(p=>p.ts>=start&&p.ts<=end);
  const values = [...candles.flatMap(c => [c.low, c.high]), ...refs,...globalStructuralScaleValues(report,start,layers),...globalTradeCards(report).flatMap(c=>[...(c.plan.referenceEntry??[]),...(c.plan.referenceStop===null?[]:[c.plan.referenceStop]),...c.targets.map(t=>t.price),...(report.discretionaryPlan?.priceZones?.targets.flatMap(z=>[z.lower,z.upper])??[])]), ...((decision.planningValid||report.decisionVersion==="decision-v5")?plan.referenceEntry??[]:[]),...((decision.planningValid||report.decisionVersion==="decision-v5")&&plan.referenceStop!==null?[plan.referenceStop]:[])];
  const low = Math.min(...values), high = Math.max(...values), margin = Math.max(high - low, high * .01) * .1, min = Math.max(0, low - margin), max = high + margin;
  const y = (p: number) => top + (max - p) / (max - min) * (priceBottom - top), x = (ts: number) => left + (ts - start) / Math.max(1, end - start) * (historyEnd - left);
  const g = { x, y, left, right, top, bottom: priceBottom, historyEnd };
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" rx="16" fill="#0f1826"/><g font-family="Inter, Noto Sans SC, Arial, sans-serif">`;
  svg += text(25, 31, `PULSE · GLOBAL ${report.tier.toUpperCase()} · ${report.snapshot.instId} · ${globalFrameReference(report.snapshot.timeframe)}`, "#55dfb5", 20);
  svg += text(25, 54, `${report.snapshot.venue} · ${report.snapshot.priceCurrency} · ${report.lang==="zh"?"获取":"Fetched"} ${report.snapshot.observedAt} · ${globalCompletedPriceLine(report)}`, "#a5b7cd", 10);
  const quoteLine=globalCurrentMarketLines(report)[0];if(quoteLine)svg+=text(25,66,quoteLine,"#b9c6d8",9);
  svg += text(left, 77, `${globalTimeframeLabel(report.snapshot.timeframe, report.lang)} · ${candles.length} / ${report.candles.length} ${report.lang === "zh" ? "根完整 K 线（显示 / 保存）" : "COMPLETED CANDLES (shown / saved)"}${report.strategy?` · ${report.strategy.holding}`:""}`, "#b9c6d8", 12);
  svg += text(left,101,`${decision.marketView} · ${globalDecisionTitle(report)}`,"#cce8f2",14);
  for (let i = 0; i < 6; i += 1) { const value = min + (max - min) * i / 5, py = y(value);
    svg += line(left, py, right, py, "#28374a", .8, "2 5");
    if(refs.every(price=>Math.abs(y(price)-py)>22))svg+=text(width-18,py+4,globalPrice(report,value),"#8398b3",10,"end");
  }
  const maxVolume = Math.max(1, ...candles.map(c => c.volume)), candleWidth = Math.max(.8, Math.min(6, (historyEnd - left) / candles.length * .75));
  for (const c of candles) { const cx = x(c.ts), color = c.close >= c.open ? "#35d0aa" : "#ef6b85", vh = c.volume / maxVolume * 55;
    svg += `<rect x="${cx - candleWidth / 2}" y="${priceBottom - vh}" width="${candleWidth}" height="${vh}" fill="${color}" opacity=".2"/>` + line(cx, y(c.high), cx, y(c.low), color, .8) + `<rect x="${cx - candleWidth / 2}" y="${Math.min(y(c.open), y(c.close))}" width="${candleWidth}" height="${Math.max(.8, Math.abs(y(c.close) - y(c.open)))}" fill="${color}"/>`;
  }
  svg += `<defs><clipPath id="global-series-clip"><rect x="${left}" y="${top}" width="${historyEnd-left}" height="${priceBottom-top}"/></clipPath></defs>`;
  const drawSeries = (points: Array<{ts:number;value:number}>, color: string, dash = "") => {const visible=visiblePoints(points);if (visible.length) svg += `<polyline clip-path="url(#global-series-clip)" points="${visible.map(p => `${x(p.ts)},${y(p.value)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="1.4"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`; };
  const smaColors = ["#ffcb76", "#b790ff", "#59c2ee", "#e593c2", "#71969b"];
  report.indicators.sma.forEach((s, i) => { if (periods.includes(s.period)) drawSeries(s.points, smaColors[i]); });
  if (pro && layers.regression && report.indicators.regression) for (const series of [report.indicators.regression.upper, report.indicators.regression.mid, report.indicators.regression.lower]) drawSeries(series, "#31b8da", "4 3");
  for(const study of globalSetupStudySeries(report,layers)){svg+=`<g data-setup-study="${escapeGlobalSvg(study.name)}">`;drawSeries(study.points,study.color,study.dash?"4 4":"");svg+="</g>";}
  svg += globalChartAnnotations(report, g, { ...options, layers });
  const unit = parseCandleTimeframe(report.snapshot.timeframe)?.unit;
  const axisDate = (ts: number) => ["day", "week", "month"].includes(unit ?? "") ? new Date(ts).toISOString().slice(0, 10) + " UTC" : new Date(ts).toISOString().slice(5, 16).replace("T", " ") + " UTC";
  svg += text(right, priceBottom + 25, new Date(report.snapshot.observedAt).toISOString().slice(11,19)+" (UTC)", "#a5b7cd", 10, "end");
  svg += text(left, priceBottom + 25, axisDate(start), "#8298b5", 10) + text(historyEnd, priceBottom + 25, axisDate(end), "#8298b5", 10, "end");
  svg += text(left, priceBottom + 44, [...report.indicators.sma.filter(s => periods.includes(s.period)).map(s => `SMA${s.period} ${globalPrice(report, s.points.at(-1)?.value)}`),...globalSetupStudyReadings(report,layers).map(s=>`${s.name} ${globalPrice(report,s.value)}`)].join(" · "), "#bda8df", 10);
  if (pro) {
    const panelTop = 618, panelBottom = 728, ry = (value: number) => panelTop + (100 - value) / 100 * (panelBottom - panelTop);
    svg += text(left, panelTop - 12, `RSI14 · ${report.indicators.rsi.points.at(-1)?.value.toFixed(2) ?? "—"}`, "#a0b4ce", 11);
    for (const v of [30, 50, 70]) svg += line(left, ry(v), historyEnd, ry(v), "#48556a", .8, "3 4") + text(historyEnd + 4, ry(v) + 4, v, "#8197b4", 9);
    svg += `<polyline points="${visiblePoints(report.indicators.rsi.points).map(p => `${x(p.ts)},${ry(p.value)}`).join(" ")}" fill="none" stroke="#d4b479" stroke-width="1.3"/>`;
    const c = report.context, cx = 916, cw = 340;
    svg += `<rect x="${cx}" y="${panelTop - 14}" width="${cw}" height="147" rx="8" fill="#152033" stroke="#334258"/>` + text(cx + 13, panelTop + 5, `${globalLabel("context", report.lang)} · ${globalTimeframeLabel(c.timeframe ?? "—", report.lang)}`, "#a0b4ce", 11);
    if (c.candles.length>=2) { const data = c.candles.slice(-36), csma = c.sma55.filter(p => p.ts >= data[0].ts), clow = Math.min(...data.map(c => c.low), ...csma.map(p => p.value)), chigh = Math.max(...data.map(c => c.high), ...csma.map(p => p.value)), cy = (price:number) => panelTop + 17 + (chigh - price) / Math.max(1e-10, chigh - clow) * 77, cxx = (ts:number) => cx + 18 + (ts - data[0].ts) / Math.max(1, data.at(-1)!.ts - data[0].ts) * 303;
      for (const bar of data) {const color=bar.close>=bar.open?"#35d0aa":"#ef6b85";svg += line(cxx(bar.ts), cy(bar.low), cxx(bar.ts), cy(bar.high), color, 1)+`<rect x="${cxx(bar.ts)-2.5}" y="${Math.min(cy(bar.open),cy(bar.close))}" width="5" height="${Math.max(1,Math.abs(cy(bar.open)-cy(bar.close)))}" fill="${color}"/>`;}
      const agreement = decision.contextRelation;
      if(csma.length)svg+=`<polyline points="${csma.map(p => `${cxx(p.ts)},${cy(p.value)}`).join(" ")}" fill="none" stroke="#b58aff" stroke-width="1.2"/>`;
      svg+=text(cx+12,panelBottom+9,csma.length?`${agreement} · SMA55 ${globalPrice(report,csma.at(-1)?.value)}`:`${c.candles.length} ${report.lang==="zh"?"根完整 K 线":"completed candles"}`,"#bda8df",10);
    } else svg += text(cx + 16, panelTop + 67, globalLabel("unavailable", report.lang), "#a0b4ce", 13);
    svg += text(left, panelBottom + 23, `${report.lang === "zh" ? "成交量/前20根" : "Volume / prior 20 bars"}: ${report.indicators.volumeRatio?.toFixed(2) ?? "—"}× · ATR14 ${globalPrice(report, report.indicators.atr.points.at(-1)?.value)}`, "#91a7c3", 10);
  }
  if(entryImage)svg+=`<g transform="translate(25 ${entryTop})">${entryImage}</g>`;
  if(flow)svg+=`<g transform="translate(25 ${flowTop})">${flow.svg}</g>`;
  svg += `<rect x="25" y="${footerTop}" width="1250" height="${footerHeight}" rx="10" fill="#181c24" stroke="#695335"/>`;
  wrapped.forEach((value,i)=>svg+=text(43,footerTop+24+i*19,value,i?"#c8d3e1":"#f6c368",i?12:16));
  svg += text(26, height - 14, report.targetReviewOf ? report.lang === "zh" ? "原快照技术复核 · 相同 K 线 · 未调用新 AI · 研究用途" : "Technical review of saved snapshot · same saved candles · no new AI · research only" : report.lang === "zh" ? "原始快照 · 条件路径非保证预测 · 研究用途，非财务建议" : "Original snapshot · conditional routes, not guaranteed forecasts · research only / not financial advice", "#8196b2", 10);
  return svg + "</g></svg>";
}
