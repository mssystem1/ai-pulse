import { test } from "node:test";
import assert from "node:assert/strict";
import { collectTokenRiskEvidence } from "./tokenRiskEvidence.js";
import { getNetwork, type AppConfig } from "@pulse/config";

test("GeckoTerminal is always the primary source; Blockscout failure cannot erase provider evidence", async () => {
  const original = globalThis.fetch;
  const address = "0x0000000000000000000000000000000000000321";
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input); requests.push(url);
    assert.ok(!url.includes("dexscreener"));
    if (url.includes("smart-contracts")) return new Response("{}", { status: 500 });
    const attributes = { address, symbol: "AERO", websites: [], gt_score: 91, gt_verified: true, holders: { count: 100 }, market_cap_usd: "600000000" };
    return Response.json({ data: url.endsWith("/pools") ? [] : { attributes } });
  };
  try {
    const evidence = await collectTokenRiskEvidence({ cfg: { BLOCKSCOUT_API_KEY: "" } as AppConfig, networkKey: "base", network: getNetwork("base"), address });
    assert.equal(requests.filter(url => url.includes("geckoterminal")).length, 3);
    const profile = evidence.sources.find(source => source.source === "GeckoTerminal profile");
    assert.equal(profile?.status, "observed");
    assert.equal((profile?.data as any).gtScore, 91);
    assert.equal(evidence.sources.find(source => source.source === "Blockscout verified contract")?.status, "unavailable");
    assert.match(evidence.sourcePolicy, /not observed contract vulnerabilities/);
  } finally { globalThis.fetch = original; }
});

test("Blockscout v2 failure uses one verified-source fallback and shares cached evidence", async () => {
  const original = globalThis.fetch;
  const address = "0x0000000000000000000000000000000000000322";
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input); requests.push(url);
    if (url.includes("smart-contracts")) return new Response("{}", { status: 500 });
    if (url.includes("action=getsourcecode")) return Response.json({ status: "1", result: [{ SourceCode: "contract Aero {}", ContractName: "Aero", Proxy: "0" }] });
    return Response.json({ data: url.endsWith("/pools") ? [] : { attributes: { address } } });
  };
  try {
    const input = { cfg: { BLOCKSCOUT_API_KEY: "" } as AppConfig, networkKey: "base" as const, network: getNetwork("base"), address };
    const evidence = await collectTokenRiskEvidence(input);
    await collectTokenRiskEvidence(input);
    const contract = evidence.sources.find(source => source.source === "Blockscout verified contract");
    assert.equal(contract?.status, "observed");
    assert.equal((contract?.data as any).isVerified, true);
    assert.match((contract?.data as any).evidenceApi, /legacy/);
    assert.equal(requests.filter(url => url.includes("action=getsourcecode")).length, 1);
    assert.equal(requests.filter(url => url.includes("smart-contracts")).length, 1);
  } finally { globalThis.fetch = original; }
});
