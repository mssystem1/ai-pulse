import test from "node:test";
import assert from "node:assert/strict";
import { globalSetupWindow, globalSetupMap } from "./globalPolicy.js";
import {globalDecision,globalDecisionTitle} from "./globalDecision.js";
import { GlobalReportSchema } from "@pulse/schemas";
import { globalDesignFixture } from "./globalReport.fixtures.js";
import { globalReportChartSvg, globalChartAnnotations } from "./globalChart.js";
import { presentResearch, researchText } from "./researchPresentation.js";
import { readGlobalReport, globalSetupLines, globalPathLines, globalHumanText, globalTimeframeLabel } from "./globalPresentation.js";

test("timeframe labels distinguish minutes, days, weeks and calendar months",()=>{
  for(const [frame,label] of [["15m","15-minute"],["1D","1-day"],["1W","1-week"],["1Mutc","1-month"]])assert.ok(globalTimeframeLabel(frame,"en").includes(label));
  assert.match(globalTimeframeLabel("1Mutc","zh"),/个月/);assert.match(globalTimeframeLabel("1m","zh"),/分钟/);
});

test("projected swing channels stay inside the price pane on steep rising and falling swings",()=>{
  for(const delta of [-10,10]){
    const report=globalDesignFixture("pro"),anchor=report.indicators.pivots[0];
    report.indicators.channel={lower:[{...anchor,ts:10,price:100},{...anchor,ts:20,price:100+delta}],upper:[{...anchor,ts:10,price:105},{...anchor,ts:20,price:105+delta}]};
    const svg=globalChartAnnotations(report,{left:62,right:1110,top:100,bottom:450,historyEnd:700,x:ts=>ts*10,y:price=>1000-price*8});
    const segments=[...svg.matchAll(/data-channel="swing"><line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/g)];
    assert.equal(segments.length,2);
    for(const match of segments){const [,x1,y1,x2,y2]=match.map(Number);assert.ok(x1>=62&&x2<=700);assert.ok(y1>=100&&y1<=450&&y2>=100&&y2<=450);assert.ok(x2<700,"Projection should end at the viewport boundary before the time axis");}
    assert.doesNotMatch(svg,/NaN|Infinity/);
  }
});

test("Fibonacci is drawn from the same confirmed endpoints for rising and falling swings",()=>{
  for(const down of [false,true]){
    const report=globalDesignFixture("pro"),a=report.indicators.pivots.find(p=>p.id==="anchor-0")!,b=report.indicators.pivots.find(p=>p.id==="anchor-5")!;
    if(down){a.price=125.2;b.price=101;a.kind="high";b.kind="low";report.indicators.fibonacci=report.indicators.fibonacci.map(f=>({...f,price:b.price-(b.price-a.price)*f.ratio}));}
    const g={left:20,right:900,top:20,bottom:600,historyEnd:700,x:(ts:number)=>40+(ts-report.candles[0].ts)/3600000,y:(price:number)=>600-(price-95)*15};
    const svg=globalChartAnnotations(report,g,{layers:{fibonacci:true}});
    for(const ratio of[0,.236,.382,.5,.618,.786,1]){const match=svg.match(new RegExp(`data-fib-ratio="${ratio}"[^]*?<line x1="[^"]+" y1="([^"]+)"`));assert.ok(match);assert.ok(Math.abs(Number(match[1])-g.y(b.price-(b.price-a.price)*ratio))<1e-8);}
    assert.match(svg,/data-fibonacci="confirmed-swing"/);assert.match(svg,/data-anchor-a="anchor-0" data-anchor-b="anchor-5"/);
    const history=globalChartAnnotations(report,g,{layers:{fibonacci:true},showScenarios:false});
    assert.match(history,/data-fib-ratio/);assert.doesNotMatch(history,/data-path-id|data-stage|CONDITIONAL MOVES/);
    report.indicators.fibonacci[0].price+=1;
    assert.doesNotMatch(globalChartAnnotations(report,g,{layers:{fibonacci:true}}),/data-fib-ratio/);
    report.indicators.fibonacci[0].price-=1;
    b.confirmedAt=null;assert.doesNotMatch(globalChartAnnotations(report,g,{layers:{fibonacci:true}}),/data-fib-ratio/);
  }
});

test("Quick and Pro preserve watch prices and tier identity without promoting an unconfirmed entry",()=>{
  for(const tier of ["quick","pro"] as const){const report=globalDesignFixture(tier), svg=globalReportChartSvg(report)!,p=presentResearch(report),txt=researchText(p);
    assert.equal(p.serviceId,`global-${tier}`);assert.equal(p.subject,"SOL-USDT");
    for(const id of globalSetupMap(report).view.levelIds)assert.ok(txt.includes(report.levels.find(l=>l.id===id)!.price.toFixed(2)),id);
    for(const id of globalSetupMap(report).view.levelIds)assert.ok(svg.includes(report.levels.find(l=>l.id===id)!.price.toFixed(2)),id);
    assert.ok(!/data-stage=/.test(svg));assert.ok(svg.includes("ENTRY PLAN"));assert.ok(!/undefined|NaN/.test(svg));
    assert.equal(report.setup.entryZone,null);assert.equal(report.setup.protectiveStop,null);assert.equal(report.setup.netRewardRisk,null);assert.equal(report.view.pathIds.length,tier==="quick"?2:3);
    assert.equal(svg.includes("RSI14"),tier==="pro");assert.equal(svg.includes("SMA144"),false);
    assert.equal(globalReportChartSvg(report,{layers:{allSmas:true}})!.includes("SMA144"),tier==="pro");
    assert.ok(svg.includes("1-hour candles"));assert.ok(txt.includes("Primary chart: 1H · 1-hour candles"));
    assert.equal(svg.includes("4-hour candles"),tier==="pro");
  }
});
test("canonical parsing rejects conflicting setup prices and unsupported Ready states",()=>{const report=globalDesignFixture();report.setup.triggerLevelId="floor";assert.equal(readGlobalReport(report),null);assert.equal(GlobalReportSchema.safeParse(report).success,false);const ready=globalDesignFixture();ready.setup.state="ready";assert.equal(readGlobalReport(ready),null);});
test("the retest threshold cannot drift away from the plotted S1 level",()=>{const report=globalDesignFixture();report.setup.retestLevelId="floor";assert.equal(readGlobalReport(report),null);});
test("an unrelated Spot expiry cannot become the current route's entry deadline",()=>{const report=globalDesignFixture();report.setup.expiresAt=Date.parse("2026-10-09T00:00:00Z");const svg=globalReportChartSvg(report)!;assert.ok(!svg.includes("Expires 2026-10-09"));assert.ok(svg.includes(globalDecisionTitle(report)));assert.ok(svg.includes("Reassess after a completed 1H close"));});

test("inactive Spot attempts remain in saved evidence rather than becoming the image headline",()=>{
  for(const state of ["cancelled","expired"])for(const lang of ["en","zh"]){const report=globalDesignFixture("pro",lang);report.setup.state=state;
    const svg=globalReportChartSvg(report),txt=researchText(presentResearch(report));
    assert.ok(!/WAIT|INVALIDATED|EXPIRED|NO TRADE/.test(svg));assert.ok(!/data-stage=|Previous Spot attempt/.test(svg));
    assert.ok(txt.includes(lang==="zh"?"先前尝试":"PREVIOUS ATTEMPTS"));assert.equal(report.setup.state,state);
  }
});
test("compressed scenarios separate primary labels from the previous inactive attempt",()=>{
  const report=globalDesignFixture("pro");report.setup.state="cancelled";
  const svg=globalChartAnnotations(report,{left:0,right:1000,top:0,bottom:450,historyEnd:700,x:()=>400,y:price=>200+(price-117)*.1});
  const rows=[...svg.matchAll(/data-scenario-label="\d+"[^]*?<text x="[^"]+" y="([^"]+)"/g)].map(match=>Number(match[1])).sort((a,b)=>a-b);
  assert.ok(rows.length>=1);for(let i=1;i<rows.length;i++)assert.ok(rows[i]-rows[i-1]>=19);
  assert.equal(/data-path-id="recovery"/.test(svg),globalSetupMap(report).view.pathIds.includes("recovery"));assert.doesNotMatch(svg,/Spot recovery plan · Cancelled/);
  assert.ok(!globalReportChartSvg(report)!.includes("Previous Spot attempt · Cancelled"));
});
test("daily and weekly image axes retain the year of their saved history",()=>{
  for(const timeframe of ["1D","1W"]){const report=globalDesignFixture();report.snapshot.timeframe=timeframe;const svg=globalReportChartSvg(report)!;assert.ok(svg.includes(new Date(report.candles.slice(-globalSetupWindow(report))[0].ts).toISOString().slice(0,10)+" UTC"));assert.ok(svg.includes(new Date(report.candles.at(-1)!.ts).toISOString().slice(0,10)+" UTC"));}
});
test("nearby Elliott labels remain separate and connected to their observed anchors",()=>{
  const report=globalDesignFixture("pro"),svg=globalChartAnnotations(report,{left:0,right:1000,top:0,bottom:450,historyEnd:700,x:()=>680,y:()=>220});
  const positions=[...svg.matchAll(/data-wave-label="[^"]+"[^]*?<rect x="([^"]+)" y="([^"]+)"/g)].map(match=>({x:Number(match[1]),y:Number(match[2])}));
  assert.equal(positions.length,report.waveCount.anchors.length);
  positions.forEach((a,i)=>positions.slice(i+1).forEach(b=>assert.ok(Math.abs(a.x-b.x)>=29||Math.abs(a.y-b.y)>=23)));
  assert.equal((svg.match(/<circle cx="680" cy="220" r="3"/g)||[]).length,positions.length);
});
test("exports escape annotations and retain Chinese setup conditions",()=>{const report=globalDesignFixture("pro","zh");report.snapshot.instId='<script>&"';report.paths[0].thesis="<unsafe>&";const svg=globalReportChartSvg(report)!;assert.doesNotMatch(svg,/<script>/);assert.match(svg,/&lt;script&gt;/);const lines=globalSetupLines(report).join("\n");assert.match(lines,/完整收盘/);assert.match(lines,/取消/);assert.match(lines,/113.12/);assert.ok(globalReportChartSvg(report,{layers:{allSmas:true,fibonacci:true,vwap:true,pivots:true}})!.includes("SMA233"));});
test("a Pro stress branch retains its own completed-close condition and never becomes a Spot target",()=>{const pro=globalDesignFixture("pro"),quick=globalDesignFixture("quick"),lines=globalPathLines(pro,pro.paths[0]).join("\n");assert.match(lines,/only after a completed 1H close below 109.93/);assert.match(lines,/95.24/);assert.match(lines,/not a Spot target/);assert.ok(!pro.setup.targetIds.includes("stress"));assert.ok(!globalSetupMap(pro).paths[0].stress,"Remote stress remains outside the local setup map");assert.ok(!/Only after close below 109.93/.test(globalReportChartSvg(pro)!));assert.ok(!globalReportChartSvg(quick)!.includes("95.24"));});
test("provider prose references resolve to saved prices across paths and curated exports",()=>{const report=globalDesignFixture("pro");report.levels[0].id="level-pivot-1791478800000-low";report.paths[0].targetIds[0]=report.levels[0].id;report.setup.invalidationLevelId=report.levels[0].id;report.paths[1].invalidationLevelId=report.levels[0].id;report.view.levelIds=report.view.levelIds.map(id=>id==="floor"?report.levels[0].id:id);report.paths[0].thesis=`Watch ${report.levels[0].id}`;report.narrative.headline=report.paths[0].thesis;assert.equal(globalHumanText(report,report.paths[0].thesis),"Watch 113.12 USDT");assert.ok(!researchText(presentResearch(report)).includes(report.levels[0].id));assert.match(globalPathLines(report,report.paths[0]).join("\n"),/113.12 USDT/);});
