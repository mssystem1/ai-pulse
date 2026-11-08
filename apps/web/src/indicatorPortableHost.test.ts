import test from "node:test";
import assert from "node:assert/strict";
import {createFormulaIndicatorPackage,createStudyIndicatorPackage,evaluateIndicator,indicatorMarketCatalog,indicatorStudyTemplates,type IndicatorInput,type IndicatorStudyTransform} from "@pulse/domain";
const hostUrl=new URL("../public/indicator-market/tap02-host.js",import.meta.url);
test("independent host imports and evaluates custom formula and both original numerical circuits",async()=>{
  const {evaluatePortableCircuit:run}=await import(hostUrl.href);
  const m=createFormulaIndicatorPackage({id:"creator.portable",title:"Portable formula",description:"Independent custom weighted financial calculation.",author:"Creator",expression:"buy*2-sell",output:{label:"Weighted flow",unit:"volume",accumulation:"bar"}});
  assert.equal(run(m,120,80,20).value,160);
  const [cvd,share]=indicatorMarketCatalog();assert.deepEqual(run(cvd,120,80,20),{delta:40,cvd:60});assert.equal(run(share,120,80).buyerSharePercent,60);
  assert.throws(()=>run({...m,formula:{...m.formula,expression:"fetch(buy)"}},120,80),/Unsupported/);
  assert.throws(()=>run({...m,formula:{...m.formula,expression:"buy-sell"}},120,80),/disagrees/);
});

test("independent portable host reproduces complete professional study pipelines from raw execution bars",async()=>{
  const {evaluatePortableCircuit:run,evaluatePortableStudySeries:series}=await import(hostUrl.href);
  const points=Array.from({length:28},(_,i)=>({ts:(i+1)*60000,end:(i+2)*60000,buy:i<14?3.0001+i/10:1.0001,sell:i<14?1.0001:3.0001+i/10}));
  const source:IndicatorInput={instId:"BTC-USDT",timeframe:"1H",source:"test-source-bars",status:"available",knownAt:29*60000,windowStart:60000,windowEnd:29*60000,now:29*60000,units:"base",intervalMs:60000,points};
  for(const template of indicatorStudyTemplates()){
    const manifest=createStudyIndicatorPackage({...template,id:`portable.${template.id}`,author:"Portable creator"});
    const expected=evaluateIndicator(manifest,source);
    assert.deepEqual(series(manifest,points,{intervalMs:60000}),expected.points,template.id);
    assert.equal(typeof run(manifest,120,80).value,"number","one-bar check is independent of rolling warm-up");
  }
});

test("independent portable host preserves rolling warm-up and resets on source gaps and unknown ratios",async()=>{
  const {evaluatePortableStudySeries:series}=await import(hostUrl.href);
  const template=indicatorStudyTemplates().find(item=>item.id==="delta-ema")!;
  const transforms:IndicatorStudyTransform[]=[{kind:"ema",period:2},{kind:"sum",period:2}];
  const manifest=createStudyIndicatorPackage({...template,id:"portable.gaps",author:"Portable creator",study:{...template.study,transforms}});
  const points=Array.from({length:14},(_,i)=>({ts:(i+1)*60000,end:(i+2)*60000,buy:i===5?0:i<9?3:1,sell:i===5?0:i<9?1:3})).filter((_,i)=>i!==9);
  const options={intervalMs:60000,missingIntervals:[{start:12*60000,end:13*60000}]};
  const expected=evaluateIndicator(manifest,{instId:"BTC-USDT",timeframe:"4H",source:"test-source-bars",status:"partial",knownAt:15*60000,windowStart:60000,windowEnd:15*60000,now:15*60000,units:"base",points,...options});
  const actual=series(manifest,points,options);
  assert.deepEqual(actual,expected.points);
  assert.equal(actual[0].value,undefined);
  assert.equal(actual[1].value,undefined);
  assert.notEqual(actual[2].value,undefined);
  assert.equal(actual.find((point:{ts:number})=>point.ts===6*60000)?.value,undefined);
  assert.equal(actual.find((point:{ts:number})=>point.ts===11*60000)?.reset,true);
});

test("portable studies remain causal when later bars change scale and do not guess a missing cadence",async()=>{
  const {evaluatePortableStudySeries:series}=await import(hostUrl.href);
  const template=indicatorStudyTemplates().find(item=>item.id==="cvd")!;
  const manifest=createStudyIndicatorPackage({...template,id:"portable.causal",author:"Portable creator"});
  const points=[{ts:1,buy:3,sell:1},{ts:2,buy:4,sell:1},{ts:3,buy:2,sell:1}];
  const before=series(manifest,points);
  assert.deepEqual(series(manifest,[...points,{ts:4,buy:100000000,sell:1}]).slice(0,3),before);
  assert.ok(Math.abs(before[2].value-6)<0.001);
});

test("portable study import rejects executable or unbounded state and malformed source observations",async()=>{
  const {evaluatePortableCircuit:run,evaluatePortableStudySeries:series}=await import(hostUrl.href);
  const template=indicatorStudyTemplates().find(item=>item.id==="cvd")!;
  const manifest=createStudyIndicatorPackage({...template,id:"portable.untrusted",author:"Portable creator"});
  assert.throws(()=>run({...manifest,study:{...manifest.study,script:"fetch('https://example.com')"}},120,80),/Unknown or missing/);
  assert.throws(()=>run({...manifest,study:{...manifest.study,transforms:[{kind:"ema",period:201}]}},120,80),/2 to 200/);
  assert.throws(()=>run({...manifest,study:{...manifest.study,gapPolicy:"interpolate"}},120,80),/gap or warm-up/);
  assert.throws(()=>series({...manifest,runtime:{...manifest.runtime,netlist:"0x"}},[]),/malformed/);
  assert.throws(()=>series(manifest,[{ts:2,buy:1,sell:1},{ts:1,buy:1,sell:1}]),/ordered/);
  assert.throws(()=>series(manifest,[{ts:1,buy:Number.NaN,sell:1}]),/finite/);
  assert.throws(()=>series(manifest,[],{missingIntervals:[{start:2,end:1}]}),/missing source/);
  assert.throws(()=>series(manifest,[],{intervalMs:0}),/source-bar/);
});

test("portable rolling studies exclude clipped edges from completed-bar warm-up and preserve partial per-bar readings",async()=>{
  const {evaluatePortableStudySeries:series}=await import(hostUrl.href);
  const points=Array.from({length:22},(_,i)=>({ts:i===0?1500:(i+1)*1000,end:i===21?22500:(i+2)*1000,buy:3,sell:1}));
  for(const id of ["rolling-delta","cvd","participation"]){
    const chosen=indicatorStudyTemplates().find(item=>item.id===id)!;
    const manifest=createStudyIndicatorPackage({...chosen,id:`portable.partial-${id}`,author:"Portable creator"});
    const expected=evaluateIndicator(manifest,{instId:"BTC-USDT",timeframe:"1H",source:"test-source-bars",status:"available",knownAt:22500,windowStart:1500,windowEnd:22500,now:22500,units:"base",intervalMs:1000,points});
    const actual=series(manifest,points,{intervalMs:1000});
    assert.deepEqual(actual,expected.points);
    assert.equal(actual[0].partial,true);
    assert.equal(actual[21].partial,true);
    if(id==="rolling-delta")assert.equal(actual[19].value,undefined);
    if(id==="participation")assert.ok(Math.abs(actual[0].value-7500)<=1);else assert.equal(actual[0].value,undefined);
  }
});
