import test from "node:test";
import assert from "node:assert/strict";
import { robinhoodFundingFailureCode } from "./robinhoodFunding.js";

test("funding diagnostics identify provider and validation failures without leaking upstream details", () => {
  assert.equal(robinhoodFundingFailureCode(new Error("OKX DEX credentials are not configured")), "funding_provider_not_configured");
  assert.equal(robinhoodFundingFailureCode(new Error("OKX DEX upstream HTTP 401 code=50111: secret provider response")), "funding_provider_http_401_code_50111");
  assert.equal(robinhoodFundingFailureCode(new Error("Funding RPC network mismatch")), "funding_rpc_wrong_chain");
  assert.equal(robinhoodFundingFailureCode(new Error("Funding transaction mismatch")), "funding_route_validation_failed");
  assert.equal(robinhoodFundingFailureCode(new Error("https://private-rpc.invalid/secret")), "funding_provider_or_rpc_unavailable");
});
