import test from "node:test";
import assert from "node:assert/strict";
import { createFormulaIndicatorPackage, evaluateIndicatorCircuit, evaluateIndicator, exportIndicatorPackage, parseIndicatorPackage, interpretIndicatorFormula, type IndicatorInput } from "./indicatorMarket.js";

const create = (expression: string, accumulation: "bar" | "cumulative" = "bar", unit: "volume" | "bps" = "volume") => createFormulaIndicatorPackage({ id: "creator.actual-formula", title: "Creator calculation", description: "A creator-defined bounded executed-volume calculation.", author: "Creator", expression, output: { label: "Custom flow", unit, accumulation } });
const source: IndicatorInput = { instId: "BTC-USDT", timeframe: "1H", source: "actual-test-trades", status: "partial", units: "base", knownAt: 4000, windowStart: 1000, windowEnd: 4000, now: 4000, points: [{ ts: 1000, buy: 2, sell: 1 }, { ts: 2000, buy: 1, sell: 3 }, { ts: 3000, buy: 4, sell: 2 }] };

test("creator expressions genuinely change exported NAND and independently match integer arithmetic", () => {
  const expressions = ["buy-sell", "buy*2-sell", "abs(buy-sell)", "min(buy,sell)", "max(buy,sell)", "clamp(buy-sell,-sell,buy)", "(buy-sell)/3", "10000*buy/(buy+sell)", "10000*(buy-sell)/(buy+sell)"];
  const netlists = new Set<string>();
  for (const expression of expressions) {
    const m = create(expression,"bar",expression.startsWith("10000")?"bps":"volume"); netlists.add(m.runtime.netlist);
    assert.equal(m.runtime.inputBits,64); assert.equal(m.runtime.outputBits,32);
    assert.deepEqual(parseIndicatorPackage(exportIndicatorPackage(m)),m);
    const cases = [[0,0],[0,65535],[65535,0],[65535,65535],[32,17],[12,65],[32768,32767]];
    let seed = 331;
    for (let i = 0; i < 40; i++) { seed = (Math.imul(seed,1664525)+1013904223)>>>0; const buy = seed&65535; seed = (Math.imul(seed,1664525)+1013904223)>>>0; cases.push([buy,seed&65535]); }
    for (const [buy,sell] of cases) { const expected=interpretIndicatorFormula(expression,buy,sell); if(expected===undefined)assert.throws(()=>evaluateIndicatorCircuit(m,{buy,sell}),/unknown/); else assert.equal(evaluateIndicatorCircuit(m,{buy,sell}).valueQ,expected,`${expression} (${buy}, ${sell})`); }
  }
  assert.equal(netlists.size,expressions.length);
});
test("formula units survive changing the execution volume quantum",()=>{
  for(const expression of ["min(buy,100)","clamp(buy,0,100)","buy+1","(buy-sell)*min(buy,100)"]) assert.throws(()=>create(expression),/dimension|mix native/);
  assert.throws(()=>create("buy-sell","bar","bps"),/dimension/);
  assert.throws(()=>create("10000*buy/(buy+sell)"),/dimension/);
  const m=create("buy*2-sell"), result=evaluateIndicator(m,source); assert.ok(Math.abs(result.summary.value!-6)<0.001);
});

test("custom cumulative output uses explicit prior int32 and source-window quantities", () => {
  const m = create("buy*2-sell","cumulative");
  assert.equal(evaluateIndicatorCircuit(m,{buy:120,sell:80,previousCvd:-50}).valueQ,110);
  const result = evaluateIndicator(m,source);
  assert.equal(result.status,"partial"); assert.equal(result.summary.label,"Custom flow");
  assert.ok(Math.abs(result.summary.value!-8) < 0.001);
  assert.equal(result.provenance.source,source.source);
  assert.throws(()=>evaluateIndicatorCircuit(m,{buy:65535,sell:0,previousCvd:2147483647}),/overflow/);
});

test("zero divisors stay unknown instead of fabricating a signal", () => {
  const m = create("10000*buy/(buy+sell)","bar","bps");
  assert.throws(()=>evaluateIndicatorCircuit(m,{buy:0,sell:0}),/zero is unknown/);
  const result = evaluateIndicator(m,{...source,points:[{ts:1000,buy:0,sell:0},{ts:2000,buy:3,sell:1}]});
  assert.equal(result.points[0].value,undefined); assert.ok(Math.abs(result.points[1].value!-7500)<=1);
});

test("untrusted formulas cannot execute scripts, overflow, bypass compiler identity or exhaust resources", () => {
  for (const expression of ["fetch(buy)","buy;alert(1)","buy**2","constructor(buy)","buy.sell","buy/0","buy*sell","buy*1000000","(".repeat(100)+"buy"+")".repeat(100)]) assert.throws(()=>create(expression),/Indicator formula/);
  const m = create("buy-sell"), tampered = JSON.parse(exportIndicatorPackage(m));
  tampered.formula.expression="(sell-buy)"; assert.throws(()=>parseIndicatorPackage(tampered),/compiled circuit/);
  const claim = JSON.parse(exportIndicatorPackage(m)); claim.publication.registered=true; assert.throws(()=>parseIndicatorPackage(claim),/independently verified/);
  assert.throws(()=>create("buy+".repeat(100)+"sell"),/limit/);
});
