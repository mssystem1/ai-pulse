import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { collectLiveContractEvidence, simulateEvmTransaction } from "./contractInspect.js";

const originalFetch = globalThis.fetch;

function rpcResponse(result?: unknown, error?: { code: number; message: string }) {
  return Promise.resolve(new Response(JSON.stringify(error ? { jsonrpc: "2.0", id: 1, error } : { jsonrpc: "2.0", id: 1, result }), {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
}

describe("live safety evidence", () => {
  before(() => {
    globalThis.fetch = (async (input, init) => {
      if (String(input) === "https://primary.invalid") return new Response("unavailable", { status: 503 });
      const request = JSON.parse(String(init?.body)) as { method: string };
      if (request.method === "eth_chainId") return rpcResponse("0x2105");
      if (request.method === "eth_blockNumber") return rpcResponse("0x100");
      if (request.method === "eth_getCode") return rpcResponse("0x6001600055");
      if (request.method === "eth_getBalance") return rpcResponse("0x0");
      if (request.method === "eth_getTransactionCount") return rpcResponse("0x1");
      if (request.method === "eth_getStorageAt") return rpcResponse(`0x${"0".repeat(64)}`);
      if (request.method === "eth_estimateGas") return rpcResponse("0x5208");
      if (request.method === "eth_call") return rpcResponse(undefined, { code: 3, message: "execution reverted" });
      return rpcResponse(undefined, { code: -32601, message: "unsupported" });
    }) as typeof fetch;
  });

  after(() => { globalThis.fetch = originalFetch; });

  it("keeps missing token evidence unknown instead of inventing a score", async () => {
    const result = await collectLiveContractEvidence({ rpcUrl: "https://rpc.invalid", address: "0x1111111111111111111111111111111111111111", expectedChainHex: "0x2105", chainId: "8453", network: "Base mainnet" });
    assert.equal(result.evidenceStatus, "partial");
    assert.equal(result.safetyVerdict, "unknown");
    assert.equal(result.tokenInterface.symbol.status, "unknown");
    assert.equal("riskScore" in result, false);
  });

  it("reports partial transaction simulation as unknown and never broadcasts", async () => {
    const result = await simulateEvmTransaction({ rpcUrl: "https://rpc.invalid", expectedChainHex: "0x2105", chainId: "8453", network: "Base mainnet", transaction: { from: "0x1111111111111111111111111111111111111111", to: "0x2222222222222222222222222222222222222222" } });
    assert.equal(result.status, "unknown");
    assert.equal(result.safetyVerdict, "unknown");
    assert.equal(result.evidence.estimateGas.status, "observed");
    assert.equal(result.evidence.ethCall.status, "unknown");
  });

  it("fails over from the configured primary RPC to its fallback", async () => {
    const result = await collectLiveContractEvidence({
      rpcUrl: ["https://primary.invalid", "https://fallback.invalid"],
      address: "0x1111111111111111111111111111111111111111",
      expectedChainHex: "0x2105", chainId: "8453", network: "Base mainnet",
    });
    assert.equal(result.inspection.observedAtBlock, "256");
  });
});
