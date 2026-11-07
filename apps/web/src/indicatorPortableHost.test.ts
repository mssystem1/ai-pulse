import test from "node:test";
import assert from "node:assert/strict";
import {createFormulaIndicatorPackage,indicatorMarketCatalog} from "@pulse/domain";
const hostUrl=new URL("../public/indicator-market/tap02-host.js",import.meta.url);
test("independent host imports and evaluates custom formula and both original numerical circuits",async()=>{
  const {evaluatePortableCircuit:run}=await import(hostUrl.href);
  const m=createFormulaIndicatorPackage({id:"creator.portable",title:"Portable formula",description:"Independent custom weighted financial calculation.",author:"Creator",expression:"buy*2-sell",output:{label:"Weighted flow",unit:"volume",accumulation:"bar"}});
  assert.equal(run(m,120,80,20).value,160);
  const [cvd,share]=indicatorMarketCatalog();assert.deepEqual(run(cvd,120,80,20),{delta:40,cvd:60});assert.equal(run(share,120,80).buyerSharePercent,60);
  assert.throws(()=>run({...m,formula:{...m.formula,expression:"fetch(buy)"}},120,80),/Unsupported/);
  assert.throws(()=>run({...m,formula:{...m.formula,expression:"buy-sell"}},120,80),/disagrees/);
});
