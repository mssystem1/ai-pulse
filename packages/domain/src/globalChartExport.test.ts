import test from "node:test";
import assert from "node:assert/strict";
import {globalChartRasterSize} from "./globalChartAppearance.js";
import {globalDesignFixture} from "./globalReport.fixtures.js";
import {globalReportChartSvg} from "./globalChart.js";

test("PNG resolution improves on the old 2x export while bounding long mobile canvases",()=>{
  const standard=globalChartRasterSize(1300,1800);assert.ok(standard.width>2600);assert.ok(standard.width<=3900);
  for(const [w,h]of [[1300,1800],[1300,3500],[1300,10000],[1300,100000],[1300,600]]){
    const size=globalChartRasterSize(w,h);assert.ok(size.width*size.height<=16_000_000);assert.ok(size.width<=8192&&size.height<=8192);assert.ok(size.width+size.height<=10001);assert.ok(Math.abs(size.height-size.width*h/w)<1.01);
  }
  assert.throws(()=>globalChartRasterSize(0,100));assert.throws(()=>globalChartRasterSize(100,NaN));
});
test("image title leads straight to the timeframe and retains source time in evidence",()=>{
  const report=globalDesignFixture(),before=JSON.stringify(report),svg=globalReportChartSvg(report)!;
  assert.ok(svg.includes("Snapshot "+report.snapshot.observedAt.slice(0,19).replace("T"," ")+" UTC"));
  const rows=[...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map(match=>match[1]);
  assert.match(rows[0],/PULSE/);assert.match(rows[1],/COMPLETED CANDLES/);assert.doesNotMatch(rows.slice(0,3).join(" "),/Snapshot|Quote|Fetched|OKX|Reference/);
  assert.doesNotMatch(svg,/Fetched|Reference: last completed/);assert.equal(JSON.stringify(report),before);
});
