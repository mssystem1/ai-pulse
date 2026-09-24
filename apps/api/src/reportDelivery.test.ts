import { test } from "node:test";
import assert from "node:assert/strict";
import { fullReportDelivery, reportDelivery } from "./reportDelivery.js";
test("agent delivery includes every material Pro section and excludes transport secrets and candles", () => {
  const result = fullReportDelivery({ instId: "BTC-USDT", timeframe: "4H", lang: "en", analysis: { summary: "Wait", confidence: 40 }, market: { ticker: { last: 100 }, candles: [{ secretFixture: "raw-array" }] }, technical: { pivots: { pivot: 99 } }, executionPlan: { recommendation: { action: "wait" } }, defi: { opportunities: [{ name: "Yield context" }] }, limitations: ["Partial data"], recoveryToken: "private" });
  for (const text of ["Wait", "40", "100", "99", "Yield context", "Partial data"]) assert.ok(result.reportMarkdown.includes(text));
  assert.ok(!result.reportMarkdown.includes("raw-array"));
  assert.ok(!result.reportMarkdown.includes("private"));
  assert.equal(reportDelivery("job").delivery.paymentRequired, false);
  assert.equal(reportDelivery("job").reportUrl, "/v1/jobs/job/report");
});
test("delivery preserves new material sections and uses the requested Chinese headings", () => {
  const result = fullReportDelivery({ lang: "zh", analysis: { summary: "等待确认", confidence: 40 }, futureEvidence: { observation: "New material evidence" } });
  assert.ok(result.reportMarkdown.includes("## 市场分析"));
  assert.ok(result.reportMarkdown.includes("置信度"));
  assert.ok(result.reportMarkdown.includes("New material evidence"));
  assert.ok(result.delivery.sections.includes("futureEvidence"));
});
