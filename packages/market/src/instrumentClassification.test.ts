import assert from "node:assert/strict";
import test from "node:test";
import { classifyGlobalInstrument } from "./index.js";

test("classifies Global Market instruments distinctly", () => {
  assert.equal(classifyGlobalInstrument("BTC"), "crypto");
  assert.equal(classifyGlobalInstrument("XRP"), "crypto");
  assert.equal(classifyGlobalInstrument("XAAPL"), "tokenized_stock");
  assert.equal(classifyGlobalInstrument("XSPY"), "tokenized_etf");
  assert.equal(classifyGlobalInstrument("PAXG"), "rwa");
});
