import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {GlobalReportSchema} from "@pulse/schemas";
import {globalDecision,globalSetupAdmission} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe} from "./globalReport.js";

const fixture=JSON.parse(readFileSync(new URL("./globalReport.oct20-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:"BTC-USDT",source:"okx-public-spot",fetchedAt:fixture.observedAt,ticker:{priceCurrency:"USDT"},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true}))}));
const make=(frame="1Wutc")=>prepareGlobalReport({market:markets.find(m=>m.bar===frame)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier:"premium"});

test("alternate source-edge plans retain the first primary obstacle even when it was touched historically",()=>{
  const report=make(),alternate=report.alternatePlan!;
  assert.ok(alternate);assert.equal(alternate.targets.length,1);
  assert.equal(GlobalReportSchema.safeParse(report).success,true);
  const forged=structuredClone(report),plan=forged.alternatePlan!;
  plan.targets[0].price+=100;plan.priceZones!.targets[0]={lower:plan.targets[0].price,upper:plan.targets[0].price};
  assert.equal(GlobalReportSchema.safeParse(forged).success,false,"an alternate cannot skip its first canonical primary obstacle");
});

test("structural-edge passive-v2 admission ignores a crossed objective but still blocks a breached hard stop",()=>{
  const report=make(),plan=report.discretionaryPlan!;
  assert.equal(plan.executionPolicy?.id,"structural-edge-passive-v2");
  const cutoff=Date.parse(report.snapshot.observedAt),sign=plan.side==="long"?1:-1;
  report.currentMarket={...(report.currentMarket??{source:report.snapshot.source,frames:[]}),quote:{price:plan.targets[0].price+sign,ts:cutoff}};
  assert.equal(globalSetupAdmission(report).allowed,true);
  assert.equal(globalDecision(report).limitPlanReady,true);
  report.currentMarket.quote={price:plan.stop-sign,ts:cutoff};
  assert.equal(globalSetupAdmission(report).allowed,false);
  assert.equal(globalDecision(report).limitPlanReady,false);
});
