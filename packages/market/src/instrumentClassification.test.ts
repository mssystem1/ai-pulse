import assert from "node:assert/strict";
import test from "node:test";
import { classifyGlobalInstrument } from "./index.js";

test("classifies Global Market instruments distinctly", () => {
  assert.equal(classifyGlobalInstrument("BTC"), "crypto");
  assert.equal(classifyGlobalInstrument("XRP"), "crypto");
  assert.equal(classifyGlobalInstrument("XAAPL"), "crypto");
  assert.equal(classifyGlobalInstrument("XSPY"), "crypto");
  assert.equal(classifyGlobalInstrument("PAXG"), "rwa");
  assert.equal(classifyGlobalInstrument("XAAPL", "3"), "tokenized_stock");
  assert.equal(classifyGlobalInstrument("XSPY", "3"), "tokenized_etf");
  assert.equal(classifyGlobalInstrument("XLM", "1"), "crypto");
  assert.equal(classifyGlobalInstrument("XSN", "1"), "crypto");
});
