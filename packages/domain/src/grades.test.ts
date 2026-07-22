import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreToGrade, scoreToVerdict, weightedScore } from "./grades.js";
import { scanToken } from "./tokenScan.js";
import { runPreflight } from "./preflight.js";
import { USDT0 } from "./catalog.js";

describe("grades", () => {
  it("maps scores to grades", () => {
    assert.equal(scoreToGrade(90), "A");
    assert.equal(scoreToGrade(72), "B");
    assert.equal(scoreToGrade(10), "F");
  });

  it("maps scores to verdicts", () => {
    assert.equal(scoreToVerdict(80), "PASS");
    assert.equal(scoreToVerdict(50), "WARN");
    assert.equal(scoreToVerdict(10), "FAIL");
  });

  it("weights components", () => {
    const s = weightedScore([
      { score: 100, weight: 0.5 },
      { score: 0, weight: 0.5 },
    ]);
    assert.equal(s, 50);
  });
});

describe("token scan", () => {
  it("is deterministic", () => {
    const a = scanToken(USDT0.address);
    const b = scanToken(USDT0.address);
    assert.equal(a.riskScore, b.riskScore);
    assert.equal(a.grade, b.grade);
    assert.ok(a.riskScore >= 70);
  });
});

describe("preflight", () => {
  it("composes a swap report", () => {
    const r = runPreflight({
      intent: "swap",
      fromToken: "0x0000000000000000000000000000000000000000",
      toToken: USDT0.address,
      amount: "1.5",
      chainId: "196",
    });
    assert.equal(r.service, "preflight");
    assert.ok(r.shareId.startsWith("pf_"));
    assert.ok(r.checklist.length >= 3);
    assert.ok(r.quote);
  });
});
