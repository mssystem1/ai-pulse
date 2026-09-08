import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, decisionAuditColumns, serializeAuditCsv } from "./autopilotExport";

test("CSV includes rule evidence and readable policy context, not just activity labels", () => {
  const columns = decisionAuditColumns({ id: "1", evaluatedAt: "2026-09-08T00:00:00Z", action: "hold", status: "held", reason: "Waiting for trend", bias: "not_evaluated", confidence: 0,
    metrics: { close: 2500, sma20: 2510 }, rules: [{ id: "trend", label: "Close above SMA20", passed: false, observed: "2500", required: ">2510" }],
    context: { timeframe: "4H", minConfidence: 60, maxTradePct: 100, dailyLossPct: 3, aiStatus: "candidate_not_ready" } });
  assert.match(columns[1], /2500/);
  assert.match(columns[2], /Close above SMA20/);
  assert.match(columns[3], /candidate_not_ready/);
});
test("CSV never truncates 321 history rows and escapes spreadsheet formulas", () => {
  assert.equal(serializeAuditCsv(Array.from({ length: 321 }, (_, i) => [i, "wait"])).split("\r\n").length, 321);
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  assert.equal(csvCell("  +cmd"), '"\'  +cmd"');
});
