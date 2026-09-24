import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTokenRiskAnalysis } from "./tokenRisk.js";

const analysis = {
  headline: "Example", summary: "Example", riskScore: 43, confidence: 95,
  components: (["contract", "market", "holders", "project", "promotion"] as const).map(key => ({ key, label: key, score: key === "holders" || key === "promotion" ? 0 : 80, weight: .2, reason: "Evidence", evidence: ["Provider"] })),
  criticalRisks: [], positiveSignals: [], unknowns: [], mostLikelyLossScenario: "Liquidity loss", recommendedAction: "Review", maxExposurePct: 0, projectAssessment: "Linked", promotionAssessment: "Unmeasured", disclaimer: "NFA",
};
test("missing holder distribution, promotion and blocked website cannot become zero-score penalties", () => {
  const result = normalizeTokenRiskAnalysis(analysis, { sources: [
    { source: "GeckoTerminal profile", status: "observed", data: { gtVerified: true, honeypotObservation: false, holders: { count: null, distribution_percentage: null }, gtScoreDetails: { holders: 0 }, websites: ["https://xdog.meme"] } },
    { source: "GeckoTerminal token", status: "observed", data: { liquidityUsd: 684000 } },
    { source: "Project website", status: "unavailable", error: "HTTP 403" },
  ] });
  assert.equal(result.riskScore, 80);
  assert.equal(result.evidenceCoverage, 55);
  assert.equal(result.confidence, 55);
  assert.equal(result.components.find(item => item.key === "project")?.score, null);
  assert.equal(result.components.find(item => item.key === "holders")?.score, null);
  assert.equal(result.components.find(item => item.key === "promotion")?.score, null);
  assert.equal(result.components.find(item => item.key === "contract")?.weight, .3);
});
test("no evidence is unknown, not a fabricated failure or safety score", () => {
  const result = normalizeTokenRiskAnalysis(analysis, { sources: [] });
  assert.equal(result.riskScore, null);
  assert.equal(result.confidence, 0);
});

test("verified Sourcify runtime is contract evidence when the explorer is unavailable", () => {
  const result = normalizeTokenRiskAnalysis(analysis, { sources: [
    { source: "Sourcify contract verification", status: "observed", data: { sourceVerified: true } },
    { source: "Blockscout verified contract", status: "unavailable" },
  ] });
  assert.equal(result.components.find(item => item.key === "contract")?.score, 80);
  assert.equal(result.evidenceCoverage, 30);
  assert.equal(result.confidence, 30);
});
test("model-generated provider failures and missing audit claims remain unknowns, not critical defects", () => {
  const result = normalizeTokenRiskAnalysis({ ...analysis, criticalRisks: ["No contract audit or ownership verification observed", "Project website returns HTTP 403", "Owner can mint unlimited tokens", "No audit supplied; owner can mint unlimited tokens"] }, {});
  assert.deepEqual(result.criticalRisks,["Owner can mint unlimited tokens", "No audit supplied; owner can mint unlimited tokens"]);
  assert.ok(result.unknowns.includes("Project website returns HTTP 403"));
});
test("observed hazards retain their penalty and duplicate components are rejected", () => {
  const result = normalizeTokenRiskAnalysis({ ...analysis, components: analysis.components.map(item => ({ ...item, score: 5 })) }, { sources: [{ source: "GeckoTerminal profile", status: "observed", data: { honeypotObservation: true } }] });
  assert.equal(result.riskScore, 5);
  assert.throws(() => normalizeTokenRiskAnalysis({ ...analysis, components: Array(5).fill(analysis.components[0]) }, {}), /exactly once/);
});
