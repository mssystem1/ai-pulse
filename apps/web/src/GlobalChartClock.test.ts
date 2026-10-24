import test from "node:test";
import assert from "node:assert/strict";
import {formatChartClock} from "./GlobalChartClock.js";
test("chart clock includes seconds and local timezone across the UTC date boundary",()=>{
  const time=Date.parse("2026-10-24T20:01:02Z"),local=formatChartClock(time,"en","Europe/Samara");
  assert.match(local,/25 Oct 2026/);assert.match(local,/00:01:02/);assert.match(local,/UTC\+04:00/);
  const utc=formatChartClock(time,"en","UTC");assert.match(utc,/24 Oct 2026/);assert.match(utc,/20:01:02/);
});
