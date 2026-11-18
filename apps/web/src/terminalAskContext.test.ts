import assert from "node:assert/strict";
import { test } from "node:test";
import { terminalAskSection, terminalSections } from "./terminalAskContext";

test("Ask PULSE supplies focused prompts for every terminal section", () => {
  assert.deepEqual(terminalSections, ["terminal", "market-tools", "radar", "create-indicator", "market", "my-indicators", "positions", "alerts"]);
  for (const section of terminalSections) {
    const guidance = terminalAskSection(section);
    assert.ok(guidance.label.length > 0);
    assert.ok(guidance.focus.length > 20);
    assert.ok(guidance.prompts.length >= 2);
  }
  assert.match(terminalAskSection("market-tools").focus, /plain language/);
  assert.match(terminalAskSection("radar").focus, /move it forward or end it/);
  assert.match(terminalAskSection("create-indicator").focus, /Studio copilot/);
  assert.match(terminalAskSection("market").focus, /free and paid access/);
  assert.match(terminalAskSection("market").focus, /purchase receipts/);
  assert.match(terminalAskSection("positions").focus, /does not confirm an exchange fill or order/);
});
