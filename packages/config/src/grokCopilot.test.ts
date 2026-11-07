import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./index.js";

test("Ask PULSE inherits GROK_MODEL unless its own model override is explicit", () => {
  const saved = { model: process.env.GROK_MODEL, copilot: process.env.GROK_COPILOT_MODEL };
  try {
    process.env.GROK_MODEL = "grok-4.7";
    delete process.env.GROK_COPILOT_MODEL;
    assert.equal(loadConfig().GROK_COPILOT_MODEL, "grok-4.7");
    process.env.GROK_COPILOT_MODEL = "  ";
    assert.equal(loadConfig().GROK_COPILOT_MODEL, "grok-4.7");
    process.env.GROK_COPILOT_MODEL = "grok-explicit";
    assert.equal(loadConfig().GROK_COPILOT_MODEL, "grok-explicit");
    process.env.GROK_MODEL = "next-report-model";
    assert.equal(loadConfig().GROK_COPILOT_MODEL, "grok-explicit");
    delete process.env.GROK_COPILOT_MODEL;
    assert.equal(loadConfig().GROK_COPILOT_MODEL, "next-report-model");
  } finally {
    if (saved.model === undefined) delete process.env.GROK_MODEL; else process.env.GROK_MODEL = saved.model;
    if (saved.copilot === undefined) delete process.env.GROK_COPILOT_MODEL; else process.env.GROK_COPILOT_MODEL = saved.copilot;
  }
});
