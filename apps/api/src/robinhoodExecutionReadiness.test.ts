import test from "node:test";
import assert from "node:assert/strict";
import type { AppConfig } from "@pulse/config";
import { robinhoodAutomationReadiness } from "./robinhoodExecutionReadiness.js";

test("automation readiness rejects paused, wrong-chain and unavailable RPC without disabling wallet swaps", async () => {
  const original = globalThis.fetch;
  const cfg = { ROBINHOOD_RPC_URL: "https://rpc.fixture.invalid" } as AppConfig;
  let paused = true, chain = 4663, fail = false;
  globalThis.fetch = async (_input, init) => {
    if (fail) return new Response("unavailable", { status: 503 });
    const request = JSON.parse(String(init?.body));
    return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "eth_chainId" ? `0x${chain.toString(16)}` : `0x${Number(paused).toString(16).padStart(64, "0")}` });
  };
  try {
    assert.match((await robinhoodAutomationReadiness(cfg)).reason!, /paused on-chain/);
    paused = false;
    assert.deepEqual(await robinhoodAutomationReadiness(cfg), { ready: true });
    chain = 1;
    assert.match((await robinhoodAutomationReadiness(cfg)).reason!, /wrong network/);
    fail = true;
    assert.match((await robinhoodAutomationReadiness(cfg)).reason!, /temporarily unavailable/);
  } finally { globalThis.fetch = original; }
});
