import test from "node:test";
import assert from "node:assert/strict";
import {createIndicatorPackage,evaluateIndicator,evaluateIndicatorCircuit,exportIndicatorPackage,indicatorMarketCatalog,parseIndicatorPackage,type IndicatorInput,type IndicatorManifest} from "./indicatorMarket.js";

const [cvd, participation] = indicatorMarketCatalog();
const source = (overrides: Partial<IndicatorInput> = {}): IndicatorInput => ({
  instId: "BTC-USDT", timeframe: "4H", source: "retained-exact-executions", status: "available", knownAt: 4000,
  windowStart: 1000, windowEnd: 4000, units: "base", now: 4000,
  points: [{ts: 1000,end: 2000,buy: 3,sell: 1},{ts: 2000,end: 3000,buy: 2,sell: 5},{ts: 3000,end: 4000,buy: 4,sell: 2}], ...overrides,
});

/** Independent TAP-02 NAND byte walk: constants first, then input bits, then
 * seven-byte opcode/uint24/uint24 records. Output is the final signal suffix. */
function reference(manifest: IndicatorManifest, buy: number, sell: number, previous: number) {
  const bits = [false, true];
  for (const [word, length] of [[buy,16],[sell,16],...(manifest.runtime.inputBits === 64 ? [[previous >>> 0,32]] : [])]) for (let i = 0; i < length; i++) bits.push(Boolean((word >>> i) & 1));
  const raw = manifest.runtime.netlist.slice(2);
  for (let at = 0; at < raw.length; at += 14) {
    assert.equal(raw.slice(at,at+2), "00");
    const a = parseInt(raw.slice(at+2,at+8),16), b = parseInt(raw.slice(at+8,at+14),16);
    assert.ok(a < bits.length && b < bits.length); bits.push(!(bits[a] && bits[b]));
  }
  return bits.slice(-manifest.runtime.outputBits);
}

test("portable numeric kernels match arithmetic across boundaries and deterministic random inputs", () => {
  const cases = [[0,0,0],[0,65535,0],[65535,0,0],[65535,65535,1],[1,2,-22],[32768,32767,2147400000],[12,34,-2147400000]];
  let seed = 107;
  for (let i = 0; i < 250; i++) { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; const buy = seed & 65535; seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; cases.push([buy,seed & 65535,(seed >>> 16)-32768]); }
  for (const [buy,sell,previousCvd] of cases) {
    assert.deepEqual(evaluateIndicatorCircuit(cvd,{buy,sell,previousCvd}),{deltaQ:buy-sell,cvdQ:previousCvd+buy-sell});
    if (buy+sell) assert.deepEqual(evaluateIndicatorCircuit(participation,{buy,sell}),{participationBps:Math.floor(buy*10000/(buy+sell))});
  }
});

test("exported gates independently produce the numeric result, with TAP-02 final-output order", () => {
  const bits = reference(cvd,2,9,-17);
  const word = (offset: number) => { let n = 0; for (let i = 0; i < 32; i++) n += Number(bits[offset+i])*2**i; return bits[offset+31] ? n-2**32 : n; };
  assert.equal(word(0),-7); assert.equal(word(32),-24);
  const percent = reference(participation,314,927,0).reduce((n,bit,i) => n+Number(bit)*2**i,0);
  assert.equal(percent,Math.floor(314*10000/1241));
  assert.ok((cvd.runtime.netlist.length-2)/14 > 1000);
  assert.ok((participation.runtime.netlist.length-2)/14 > 10000);
});

test("creator metadata survives portable round trips, while formula and deployment claims cannot be altered", () => {
  const custom = createIndicatorPackage({id:"alice.btc-spot-delta",title:"Alice spot delta",description:"Cumulative aggressor flow for the selected spot session.",author:"Alice",kernel:"executed-cvd-v1",version:"2.4.1"});
  assert.deepEqual(parseIndicatorPackage(exportIndicatorPackage(custom)),custom);
  assert.equal(custom.runtime.netlist,cvd.runtime.netlist);
  assert.deepEqual(custom.publication,{chainId:196,registered:false});
  assert.equal(evaluateIndicatorCircuit(custom,{buy:10,sell:3,previousCvd:-5}).cvdQ,2);
  const mutable = () => JSON.parse(exportIndicatorPackage(custom));
  const netlist = mutable(); netlist.runtime.netlist = netlist.runtime.netlist.slice(0,-1)+(netlist.runtime.netlist.endsWith("0")?"1":"0");
  assert.throws(()=>parseIndicatorPackage(netlist),/unreviewed circuit netlist/);
  const registered = mutable(); registered.publication.registered = true; assert.throws(()=>parseIndicatorPackage(registered),/publication claim/);
  const extra = mutable(); extra.script = "fetch('https://example.com')"; assert.throws(()=>parseIndicatorPackage(extra),/unknown or missing fields/);
  const prereq = mutable(); prereq.prerequisites.source="candle-estimated-volume"; assert.throws(()=>parseIndicatorPackage(prereq),/prerequisites/);
  assert.throws(()=>createIndicatorPackage({id:"<script>",title:"Bad",description:"Bad package metadata.",author:"A",kernel:"executed-cvd-v1"}),/identity/);
  assert.throws(()=>parseIndicatorPackage("x".repeat(600001)),/size limit/);
  assert.throws(()=>parseIndicatorPackage("not json"),/invalid JSON/);
});

test("observed-source calculations retain units, window, finite precision and circuit provenance", () => {
  const result = evaluateIndicator(cvd,source());
  assert.equal(result.status,"available"); assert.equal(result.points.length,3);
  assert.ok(Math.abs(result.summary.cvd!-1) <= result.precision.maxCvdError);
  assert.equal(result.provenance.execution,"local-tap02"); assert.equal(result.provenance.registered,false);
  assert.equal(result.provenance.windowStart,1000); assert.equal(result.provenance.windowEnd,4000); assert.equal(result.provenance.units,"base");
  const buyer = evaluateIndicator(participation,source());
  assert.ok(Math.abs(buyer.points[0].participationBps!-7500) <= 1);
  assert.ok(Math.abs(buyer.points[1].participationBps!-2857) <= 1);
  assert.ok(Math.abs(buyer.summary.netParticipationBps!-3332) <= 2);
  assert.equal(evaluateIndicator(cvd,source({units:"contracts"})).provenance.units,"contracts");
});

test("unavailable, partial and stale coverage stay explicit and never imply a complete session", () => {
  const partial = evaluateIndicator(cvd,source({status:"partial"}));
  assert.equal(partial.status,"partial"); assert.match(partial.reason!,/excludes missing/); assert.equal(partial.points.length,3);
  const missing = evaluateIndicator(cvd,source({status:"unavailable"}));
  assert.equal(missing.status,"unavailable"); assert.equal(missing.points.length,0); assert.equal(missing.summary.cvd,undefined);
  assert.equal(evaluateIndicator(cvd,source({points:[]})).status,"unavailable");
  const stale = evaluateIndicator(cvd,source({now:400000}));
  assert.equal(stale.status,"stale"); assert.match(stale.reason!,/historical measurements/);
});

test("quantization error is bounded and no-volume participation is unknown", () => {
  const input = source({points:[{ts:1000,buy:123.45678,sell:0.00001},{ts:2000,buy:0.00001,sell:321.12345},{ts:3000,buy:0,sell:0}]});
  const output = evaluateIndicator(cvd,input), exact = input.points.reduce((n,p)=>n+p.buy-p.sell,0);
  assert.ok(Math.abs(output.summary.cvd!-exact) <= output.precision.maxCvdError);
  const unresolved = evaluateIndicator(participation,input);
  assert.equal(unresolved.points[2].participationBps,undefined);
  assert.throws(()=>evaluateIndicatorCircuit(participation,{buy:0,sell:0}),/nonzero/);
  assert.throws(()=>evaluateIndicatorCircuit(cvd,{buy:65535,sell:0,previousCvd:2147483647}),/overflow/);
  assert.throws(()=>evaluateIndicatorCircuit(cvd,{buy:-1,sell:0}),/outside circuit ABI/);
});

test("invalid clocks, nonfinite quantities, mixed points and resource excess are rejected", () => {
  assert.throws(()=>evaluateIndicator(cvd,source({points:[{ts:1000,buy:Number.NaN,sell:1}]})),/execution point/);
  assert.throws(()=>evaluateIndicator(cvd,source({points:[{ts:1000,buy:-1,sell:1}]})),/execution point/);
  assert.throws(()=>evaluateIndicator(cvd,source({points:[{ts:2000,buy:1,sell:1},{ts:1000,buy:1,sell:1}]})),/execution point/);
  assert.throws(()=>evaluateIndicator(cvd,source({points:[{ts:1000,end:5000,buy:1,sell:1}]})),/execution point/);
  assert.throws(()=>evaluateIndicator(cvd,source({knownAt:999})),/execution point/);
  assert.throws(()=>evaluateIndicator(cvd,source({knownAt:100000})),/source clock/);
  assert.throws(()=>evaluateIndicator(cvd,source({points:Array(1025).fill({ts:1000,buy:1,sell:1})})),/point limit/);
  assert.throws(()=>evaluateIndicator(cvd,source({maxAgeMs:0})),/freshness limit/);
});
