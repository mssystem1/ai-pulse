import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {candleCloseTime,GlobalReportSchema,type GlobalCandle} from "@pulse/schemas";
import {globalDefaultChartLayers,globalStructureChartLayers,globalReportChartSvg,globalSetupStudySeries,globalSetupWindow} from "@pulse/domain";
import {globalSetupEmas,globalSetupVwap} from "./globalSetupStudies.js";
import {prepareGlobalReport,globalContextTimeframe} from "./globalReport.js";

const hour=3_600_000;
const candle=(i:number,price:number,volume=1):GlobalCandle=>({ts:i*hour,open:price,high:price,low:price,close:price,volume,confirmed:true});
const anchor={id:"observed-low",ts:0,price:10,kind:"low" as const,confirmedAt:hour};

test("anchored bands match an independently calculated weighted source-price variance",()=>{
  const bars=[candle(0,10,1),candle(1,20,3),candle(2,100,0)],vwap=globalSetupVwap(bars,anchor,"1H")!;
  assert.equal(vwap.knownAt,2*hour);assert.equal(vwap.anchorTs,0);
  const mean=(10+20*3)/4,sd=Math.sqrt(((10-mean)**2+3*(20-mean)**2)/4);
  assert.equal(vwap.points.at(-1)!.value,mean);
  assert.equal(vwap.points[0].value,10);
  for(const band of vwap.bands!){
    assert.ok(Math.abs(band.upper.at(-1)!.value-(mean+band.multiple*sd))<1e-9);
    assert.ok(Math.abs(band.lower.at(-1)!.value-(mean-band.multiple*sd))<1e-9);
    assert.equal(band.upper[0].value,10);assert.equal(band.lower[0].value,10);
  }
  assert.equal(vwap.points.at(-2)!.value,vwap.points.at(-1)!.value,"Zero volume leaves cumulative observations unchanged");
});

test("a future anchor, omitted anchor candle or incomplete anchor interval cannot supply AVWAP",()=>{
  const bars=[candle(0,10),candle(1,12)];
  assert.equal(globalSetupVwap(bars,{...anchor,confirmedAt:3*hour},"1H"),null);
  assert.equal(globalSetupVwap(bars,{...anchor,confirmedAt:null},"1H"),null);
  assert.equal(globalSetupVwap(bars.slice(1),anchor,"1H"),null);
  assert.equal(globalSetupVwap([...bars,candle(3,15)],anchor,"1H"),null);
  assert.equal(globalSetupVwap(bars.map(b=>({...b,volume:0})),anchor,"1H"),null);
});

test("completed EMA and AVWAP points are prefix-stable and EMA warms up again after a gap",()=>{
  const bars=Array.from({length:90},(_,i)=>candle(i,100+i%7,i%4));
  const short=bars.slice(0,55),through=short.at(-1)!.ts;
  assert.deepEqual(globalSetupEmas(short,"1H"),globalSetupEmas(bars,"1H").map(s=>({...s,points:s.points.filter(p=>p.ts<=through)})));
  const left=globalSetupVwap(short,anchor,"1H")!,right=globalSetupVwap(bars,anchor,"1H")!;
  assert.deepEqual(left.points,right.points.filter(p=>p.ts<=through));
  for(let i=0;i<3;i++)for(const edge of ["upper","lower"] as const)assert.deepEqual(left.bands![i][edge],right.bands![i][edge].filter(p=>p.ts<=through));
  const gap=globalSetupEmas([...bars.slice(0,30),...bars.slice(31)],"1H");
  assert.equal(gap[0].points.find(p=>p.ts>30*hour)!.ts,42*hour);
  assert.equal(gap[1].points.find(p=>p.ts>30*hour)!.ts,55*hour);
});

const fixture=JSON.parse(readFileSync(new URL("./globalReport.oct20-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:"BTC-USDT",source:"okx-public-spot",fetchedAt:fixture.observedAt,ticker:{priceCurrency:"USDT"},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true}))}));

test("all five report frames retain broad history and share saved studies in setup/export views",()=>{
  for(const [frame,window] of [["15m",120],["1H",120],["4H",180],["1Dutc",260],["1Wutc",260]] as const){
    const r=prepareGlobalReport({market:markets.find(m=>m.bar===frame)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier:"premium"});
    assert.deepEqual(GlobalReportSchema.parse(r),r);
    const before=structuredClone(r.tradePlan),layers=globalDefaultChartLayers(r),svg=globalReportChartSvg(r)!;
    assert.equal(layers.ema,true);assert.equal(layers.sma,false);assert.equal(layers.waves,false);
    assert.equal(layers.studyScale,"context");assert.equal(globalSetupWindow(r),Math.min(window,r.candles.length));
    for(const name of ["EMA12","EMA25"])assert.ok(svg.includes(`data-setup-study="${name}"`));
    assert.ok(globalSetupStudySeries(r,layers).every(s=>s.points.every(p=>p.ts<=r.snapshot.lastCandleTs!)));
    assert.doesNotMatch(svg,/data-wave-label=|data-wave-swings=|NaN|Infinity/);
    if(r.indicators.vwap){assert.ok(r.indicators.vwap.knownAt!<=candleCloseTime(r.snapshot.lastCandleTs!,frame)!);assert.ok(svg.includes('data-setup-study="AVWAP"'));}
    if(r.range){assert.match(svg,/data-context-zone="support"/);assert.match(svg,/data-context-range="balance"/);assert.doesNotMatch(svg,/\bPOC\b/);}
    const structure=globalReportChartSvg(r,{layers:globalStructureChartLayers(r)})!;
    assert.doesNotMatch(structure,/data-setup-study=/);assert.deepEqual(r.tradePlan,before);
    if(frame==="1Dutc"){assert.equal(r.tradePlan!.referenceEntry,null);assert.doesNotMatch(svg,/data-scenario-projection=/);}
    const legacy=structuredClone(r);delete legacy.indicators.ema;
    if(legacy.indicators.vwap){delete legacy.indicators.vwap.bands;delete legacy.indicators.vwap.anchorTs;delete legacy.indicators.vwap.knownAt;delete legacy.indicators.vwap.basis;}
    assert.equal(GlobalReportSchema.safeParse(legacy).success,true);assert.equal(globalDefaultChartLayers(legacy).sma,true);
  }
});
