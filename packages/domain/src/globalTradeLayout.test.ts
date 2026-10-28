import test from "node:test";
import assert from "node:assert/strict";
import {globalDesignFixture} from "./globalReport.fixtures.js";
import {globalTradeAnnotations} from "./globalTradeAnnotations.js";
import {globalReportChartSvg,type GlobalChartCoordinates} from "./globalChart.js";
import {themeGlobalChartSvg} from "./globalChartAppearance.js";

/** Synthetic display geometry only, not historical evidence or a strategy. */
function fixture(){
  const report=globalDesignFixture("pro"),ts=report.candles.at(-1)!.ts;
  report.decisionVersion="decision-v5";
  report.discretionaryPlan={version:"discretionary-plan-v7",side:"long",family:"level_retest",objectiveTimeframe:"1H",requiresNewTestAfter:Date.parse(report.snapshot.observedAt),entry:80,stop:77,
    entryBasis:{kind:"structure_zone",timeframe:"1H",knownAt:ts,price:80},stopBasis:{timeframe:"1H",anchorTs:ts,knownAt:ts,price:78},reference:{timeframe:"15m",candleTs:ts,completedAt:ts+900000,price:81},
    priceZones:{version:"price-zones-v1",entry:{lower:78,upper:80,sourceLower:78,sourceUpper:80,sourcePrice:80},stop:{lower:77,upper:78},targets:[{lower:86,upper:88},{lower:96,upper:98}],payoffFloor:1,payoffLimited:false},
    targets:[88,98].map(price=>({price,timeframe:"1H" as const,anchorTs:ts,knownAt:ts,basis:"observed_extreme" as const})),barriers:[]};
  return report;
}
const attributes=(tag:string)=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
const rects=(svg:string)=>[...svg.matchAll(/<rect\b[^>]*>/g)].map(m=>attributes(m[0]));
const geometry:GlobalChartCoordinates={left:62,right:1110,historyEnd:818,top:132,bottom:548,x:()=>100,y:price=>600-price*3};

test("floating price ledger clears full target bands and role labels in both themes",()=>{
  const report=fixture(),before=JSON.stringify(report);
  for(const appearance of ["dark","light"] as const){
    const svg=themeGlobalChartSvg(globalTradeAnnotations(report,geometry,{}),appearance),ledger=svg.match(/<g\b[^>]*data-trade-price-ledger="[^"]+"[^>]*>(<rect\b[^>]*>)/);
    assert.ok(ledger,"Weekly-style layout must retain its floating price ledger");assert.match(ledger[0],/clear-forecast-gap/);
    const box=attributes(ledger[1]),top=Number(box.y),bottom=top+Number(box.height);
    assert.ok(top>=geometry.top&&bottom<=geometry.bottom);
    for(const zone of rects(svg).filter(r=>r["data-trade-zone"]))assert.ok(bottom<=Number(zone.y)-4||top>=Number(zone.y)+Number(zone.height)+4,"Ledger masks a complete trade zone");
    for(const group of svg.matchAll(/<g\b[^>]*data-trade-role="[^"]+"[^>]*>(.*?)<\/g>/g)){
      const tag=group[1].match(/<text\b[^>]*>/)!,label=attributes(tag[0]),baseline=Number(label.y);
      assert.ok(bottom<=baseline-12||top>=baseline+5,"Ledger masks a role label");
    }
    assert.ok(svg.includes("Hard SL: 77.00"));assert.ok(svg.includes("78.00–80.00"));assert.ok(svg.includes("96.00–98.00"));
  }
  assert.equal(JSON.stringify(report),before,"Layout must not alter setup prices or source data");
});

test("dense forecast bands omit only the optional floating ledger",()=>{
  const report=fixture();report.discretionaryPlan!.priceZones!.targets[1]={lower:20,upper:160};const before=JSON.stringify(report);
  for(const appearance of ["dark","light"] as const){
    const svg=themeGlobalChartSvg(globalTradeAnnotations(report,geometry,{}),appearance);
    assert.match(svg,/<g data-trade-price-ledger="priced-setup" data-layout-status="omitted-no-clear-gap"\/>/);
    assert.equal(rects(svg).filter(r=>r["data-trade-zone"]).length,4);
    assert.ok(rects(svg).some(r=>r["data-trade-price-badge"]==="Entry"));
    assert.equal([...svg.matchAll(/data-trade-role=/g)].length,4,"Trade levels must remain drawn");
  }
  assert.equal(JSON.stringify(report),before);
  const full=globalReportChartSvg(report)!,body=[...full.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map(m=>m[1]).join(" ");
  assert.ok(/Hard SL:? 77.00/.test(body),"Fixed Hard SL remains in the complete setup below the chart");assert.ok(body.includes("TP2 20.00–160.00"),"Full priced setup remains below the chart");
});

test("ordinary export ticks reserve the actual discretionary badge gutter",()=>{
  const report=fixture();report.levels=[];report.view.levelIds=[];report.paths=[];report.view.pathIds=[];
  report.candles=report.candles.map(c=>({...c,open:80,close:80,low:70,high:100}));
  const before=JSON.stringify(report),svg=globalReportChartSvg(report,{layers:{studyScale:"setup",sma:false,ema:false,vwap:false,vwapBands:false,waves:false,range:false,fibonacci:false,regression:false,channel:false,localChannel:false,channelMid:false}})!;
  for(const appearance of ["dark","light"] as const){
    const themed=themeGlobalChartSvg(svg,appearance),badges=rects(themed).filter(r=>r["data-trade-price-badge"]).map(r=>Number(r.y)+10),ticks=[...themed.matchAll(/data-price-axis-tick-y="([^"]+)"/g)].map(m=>Number(m[1]));
    assert.ok(badges.length>=3&&ticks.length>0,"Fixture must retain trade badges and noncolliding ordinary ticks");
    const grid=[132,215.2,298.4,381.6,464.8,548];assert.ok(grid.some(y=>badges.some(b=>Math.abs(b-y)<17)),"Fixture must reproduce a trade badge close to an ordinary tick");
    assert.ok(ticks.every(y=>badges.every(b=>Math.abs(b-y)>22)),"Ordinary tick text overlaps an exact price badge");
  }
  assert.equal(JSON.stringify(report),before);
});
