import test from "node:test";
import assert from "node:assert/strict";
import {globalDesignFixture} from "./globalReport.fixtures.js";
import {globalRangeSummary} from "./globalRange.js";
import {globalCoverageLine} from "./globalCoverage.js";
import {globalDecision} from "./globalDecision.js";
import {globalFrameReference} from "./globalContext.js";

test("range text separates outer boundaries from its tradable support/resistance zones",()=>{
  const r=globalDesignFixture();r.range={lower:[80,81],upper:[84,85],anchorIds:[],startTs:0,touches:4};r.paths[0].direction="range";
  const summary=globalRangeSummary(r)!;assert.ok(summary.includes("Range 80.00–85.00"));assert.ok(summary.includes("support zone 80.00–81.00"));assert.ok(summary.includes("resistance zone 84.00–85.00"));
  const d=globalDecision(r);assert.ok(d.route.includes(summary));assert.ok(d.changeView.includes("below 80.00 or above 85.00"));
});
test("short source history has a precise coverage explanation without changing the saved data",()=>{
  const r=globalDesignFixture();r.decisionVersion="decision-v2";r.snapshot.timeframe="1Wutc";r.candles=r.candles.slice(-457);const before=structuredClone(r),line=globalCoverageLine(r)!;
  assert.ok(line.includes("457 of 520"));assert.ok(line.includes("1W (UTC)"));assert.deepEqual(r,before);
  r.candles=globalDesignFixture().candles;assert.equal(globalCoverageLine(r),null);assert.equal(globalFrameReference("1Dutc"),"1D (UTC)");assert.equal(globalFrameReference("1D"),"1D (UTC+8)");assert.equal(globalFrameReference("15m"),"15m");
});
