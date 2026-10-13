import test from "node:test";
import assert from "node:assert/strict";
import { GlobalReportSchema } from "@pulse/schemas";
import { globalDesignFixture } from "./globalReport.fixtures.js";
import { globalReportChartSvg, globalChartAnnotations } from "./globalChart.js";
import { presentResearch, researchText } from "./researchPresentation.js";
import { readGlobalReport, globalSetupLines, globalPathLines, globalHumanText, globalTimeframeLabel } from "./globalPresentation.js";

test("timeframe labels distinguish minutes, days, weeks and calendar months",()=>{
  for(const [frame,label] of [["15m","15-minute"],["1D","1-day"],["1W","1-week"],["1Mutc","1-month"]])assert.ok(globalTimeframeLabel(frame,"en").includes(label));
  assert.match(globalTimeframeLabel("1Mutc","zh"),/个月/);assert.match(globalTimeframeLabel("1m","zh"),/分钟/);
});

test("Quick and Pro preserve canonical stage prices, pending protection and actual tier identity",()=>{
  for(const tier of ["quick","pro"] as const){const report=globalDesignFixture(tier), svg=globalReportChartSvg(report)!,p=presentResearch(report),txt=researchText(p);
    assert.equal(p.serviceId,`global-${tier}`);assert.equal(p.subject,"SOL-USDT");
    for(const value of ["117.3","113.12","120.56","124.8"]) {assert.ok(txt.includes(value));assert.ok(svg.includes(value));}
    assert.match(svg,/data-stage="S1"/);assert.match(svg,/data-stage="S2"/);assert.match(svg,/data-stage="S3"/);assert.match(svg,/Pending the observed retest/);assert.doesNotMatch(svg,/undefined|NaN/);
    assert.equal(report.setup.entryZone,null);assert.equal(report.setup.protectiveStop,null);assert.equal(report.setup.netRewardRisk,null);assert.equal(report.view.pathIds.length,tier==="quick"?2:3);
    assert.equal(svg.includes("RSI14"),tier==="pro");assert.equal(svg.includes("SMA144"),tier==="pro");
    assert.ok(svg.includes("1-hour candles"));assert.ok(txt.includes("Primary chart: 1H · 1-hour candles"));
    assert.equal(svg.includes("4-hour candles"),tier==="pro");
  }
});
test("canonical parsing rejects conflicting setup prices and unsupported Ready states",()=>{const report=globalDesignFixture();report.setup.triggerLevelId="floor";assert.equal(readGlobalReport(report),null);assert.equal(GlobalReportSchema.safeParse(report).success,false);const ready=globalDesignFixture();ready.setup.state="ready";assert.equal(readGlobalReport(ready),null);});
test("the retest threshold cannot drift away from the plotted S1 level",()=>{const report=globalDesignFixture();report.setup.retestLevelId="floor";assert.equal(readGlobalReport(report),null);});
test("chart exports retain expiry without dropping the cancellation condition",()=>{const report=globalDesignFixture();report.setup.expiresAt=Date.parse("2026-10-09T00:00:00Z");const svg=globalReportChartSvg(report)!;assert.match(svg,/Expires 2026-10-09T00:00:00.000Z/);assert.match(svg,/Cancel: completed 1H close below 113.12/);});

test("inactive plans use terminal protection labels consistently in image and TXT exports",()=>{
  for(const state of ["cancelled","expired"] as const)for(const lang of ["en","zh"] as const){const report=globalDesignFixture("pro",lang);report.setup.state=state;const expected=lang==="zh"?state==="cancelled"?"计划已取消":"计划已过期":state==="cancelled"?"Plan cancelled":"Plan expired";for(const output of [globalReportChartSvg(report)!,researchText(presentResearch(report))]){assert.ok(output.includes(expected));assert.doesNotMatch(output,/Pending the observed retest|等待实际回测/);}}
});
test("compressed long-term scenarios have separate labels and retain inactive setup status",()=>{
  const report=globalDesignFixture("pro");report.setup.state="cancelled";
  const svg=globalChartAnnotations(report,{left:0,right:1000,top:0,bottom:450,historyEnd:700,x:()=>400,y:price=>200+(price-117)*.1});
  const rows=[...svg.matchAll(/data-scenario-label="\d+"[^]*?<text x="[^"]+" y="([^"]+)"/g)].map(match=>Number(match[1])).sort((a,b)=>a-b);
  assert.ok(rows.length>=4);for(let i=1;i<rows.length;i++)assert.ok(rows[i]-rows[i-1]>=19);
  assert.match(svg,/Spot recovery plan · Cancelled/);
});
test("daily and weekly image axes retain the year of their saved history",()=>{
  for(const timeframe of ["1D","1W"]){const report=globalDesignFixture();report.snapshot.timeframe=timeframe;const svg=globalReportChartSvg(report)!;assert.ok(svg.includes(new Date(report.candles[0].ts).toISOString().slice(0,10)+" UTC"));assert.ok(svg.includes(new Date(report.candles.at(-1)!.ts).toISOString().slice(0,10)+" UTC"));}
});
test("nearby Elliott labels remain separate and connected to their observed anchors",()=>{
  const report=globalDesignFixture("pro"),svg=globalChartAnnotations(report,{left:0,right:1000,top:0,bottom:450,historyEnd:700,x:()=>680,y:()=>220});
  const positions=[...svg.matchAll(/data-wave-label="[^"]+"[^]*?<rect x="([^"]+)" y="([^"]+)"/g)].map(match=>({x:Number(match[1]),y:Number(match[2])}));
  assert.equal(positions.length,report.waveCount.anchors.length);
  positions.forEach((a,i)=>positions.slice(i+1).forEach(b=>assert.ok(Math.abs(a.x-b.x)>=29||Math.abs(a.y-b.y)>=23)));
  assert.equal((svg.match(/<circle cx="680" cy="220" r="3"/g)||[]).length,positions.length);
});
test("exports escape annotations and retain Chinese setup conditions",()=>{const report=globalDesignFixture("pro","zh");report.snapshot.instId='<script>&"';report.paths[0].thesis="<unsafe>&";const svg=globalReportChartSvg(report)!;assert.doesNotMatch(svg,/<script>/);assert.match(svg,/&lt;script&gt;/);const lines=globalSetupLines(report).join("\n");assert.match(lines,/完整收盘/);assert.match(lines,/取消/);assert.match(lines,/113.12/);assert.ok(globalReportChartSvg(report,{layers:{allSmas:true,fibonacci:true,vwap:true,pivots:true}})!.includes("SMA233"));});
test("a Pro stress branch retains its own completed-close condition and never becomes a Spot target",()=>{const pro=globalDesignFixture("pro"),quick=globalDesignFixture("quick"),lines=globalPathLines(pro,pro.paths[0]).join("\n");assert.match(lines,/only after a completed 1H close below 109.93/);assert.match(lines,/95.24/);assert.match(lines,/not a Spot target/);assert.ok(!pro.setup.targetIds.includes("stress"));assert.match(globalReportChartSvg(pro)!,/Only after close below 109.93/);assert.ok(!globalReportChartSvg(quick)!.includes("95.24"));});
test("provider prose references resolve to saved prices across paths and curated exports",()=>{const report=globalDesignFixture("pro");report.levels[0].id="level-pivot-1791478800000-low";report.paths[0].targetIds[0]=report.levels[0].id;report.setup.invalidationLevelId=report.levels[0].id;report.paths[1].invalidationLevelId=report.levels[0].id;report.view.levelIds=report.view.levelIds.map(id=>id==="floor"?report.levels[0].id:id);report.paths[0].thesis=`Watch ${report.levels[0].id}`;report.narrative.headline=report.paths[0].thesis;assert.equal(globalHumanText(report,report.paths[0].thesis),"Watch 113.12 USDT");assert.ok(!researchText(presentResearch(report)).includes(report.levels[0].id));assert.match(globalPathLines(report,report.paths[0]).join("\n"),/113.12 USDT/);});
