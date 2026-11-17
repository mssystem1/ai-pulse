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
  assert.match(terminalAskSection("create-indicator").focus, /preview/);
  assert.match(terminalAskSection("create-indicator").focus, /dedicated Studio copilot/);
  assert.match(terminalAskSection("market").focus, /free versus paid/);
  assert.match(terminalAskSection("market").focus, /version identity/);
  assert.match(terminalAskSection("market").focus, /payment networks and purchase receipts/);
  assert.match(terminalAskSection("positions").focus, /venue fills/);
});
