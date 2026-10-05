import assert from "node:assert/strict";
import test from "node:test";
import { createPaidFetch, type BuyerPaymentRecoveryStore, type BuyerPendingPayment } from "./index.js";

const privateKey = `0x${"1".repeat(64)}`;
const recipient = `0x${"2".repeat(40)}`;
const origin = "https://pulse.example";
function store(): BuyerPaymentRecoveryStore {
  const values = new Map<string, BuyerPendingPayment>();
  let queue: Promise<unknown> = Promise.resolve();
  return { async get(key) { return values.get(key) || null; }, async set(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); },
    async exclusive(_key, run) { const next = queue.catch(() => undefined).then(run); queue = next; return next; } };
}
function challenge(resource = `${origin}/arc/v1/preflight`, payTo = recipient) {
  const required = { x402Version: 2, resource: { url: resource, description: "Risk Guard", mimeType: "application/json" }, accepts: [{ scheme: "exact", network: "eip155:5042",
    asset: "0x3600000000000000000000000000000000000000", amount: "200000", payTo, maxTimeoutSeconds: 300,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE" } }] };
  return Response.json(required, { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(required)).toString("base64") } });
}
const success = (mcp = false) => Response.json(mcp ? { jsonrpc: "2.0", id: 1, result: { structuredContent: { history: { jobId: "paid-job", recoveryToken: "private-recovery" } } } }
  : { history: { jobId: "paid-job", recoveryToken: "private-recovery" } }, { headers: { "PAYMENT-RESPONSE": "settled" } });
const request = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokenAddress: "0x3600000000000000000000000000000000000000", lang: "en" }) };

test("Arc agent restart reuses the exact saved authorization after a lost paid response", async () => {
  const recovery = store(); const signed: string[] = []; let probes = 0;
  const fetchImpl = (async (input: Request) => { const header = input.headers.get("PAYMENT-SIGNATURE"); if (!header) { probes++; return challenge(); }
    signed.push(header); if (signed.length === 1) throw new Error("response lost after settlement"); return success(); }) as typeof fetch;
  const cfg = { privateKey, network: "eip155:5042", maxPaymentUsd: .20, expectedPayTo: recipient, paymentRecoveryStore: recovery, fetchImpl };
  await assert.rejects(createPaidFetch(cfg)(`${origin}/arc/v1/preflight`, request), /response lost/);
  assert.equal((await createPaidFetch(cfg)(`${origin}/arc/v1/preflight`, request)).status, 200);
  assert.equal(probes, 1); assert.equal(signed.length, 2); assert.equal(signed[0], signed[1]);
});

test("Arc agent keeps uncertain authorization fenced when request selection changes", async () => {
  let paidCalls = 0;
  const paid = createPaidFetch({ privateKey, network: "eip155:5042", paymentRecoveryStore: store(), fetchImpl: (async (input: Request) => {
    if (!input.headers.has("PAYMENT-SIGNATURE")) return challenge(); paidCalls++; return Response.json({ retrySamePayment: true }, { status: 503 });
  }) as typeof fetch });
  assert.equal((await paid(`${origin}/arc/v1/preflight`, request)).status, 503);
  await assert.rejects(paid(`${origin}/arc/v1/preflight`, { ...request, body: JSON.stringify({ tokenAddress: recipient, lang: "en" }) }), /original request/);
  assert.equal(paidCalls, 1);
});

test("Arc agent storage failure prevents paid submission", async () => {
  let paidCalls = 0; const recovery = store(); recovery.set = async () => { throw new Error("store offline"); };
  const paid = createPaidFetch({ privateKey, network: "eip155:5042", paymentRecoveryStore: recovery, fetchImpl: (async (input: Request) => {
    if (!input.headers.has("PAYMENT-SIGNATURE")) return challenge(); paidCalls++; return success();
  }) as typeof fetch });
  await assert.rejects(paid(`${origin}/arc/v1/preflight`, request), /store offline/); assert.equal(paidCalls, 0);
});

test("Arc agent serializes concurrent purchases and replays one signed authorization", async () => {
  const signed: string[] = []; let probes = 0;
  const paid = createPaidFetch({ privateKey, network: "eip155:5042", paymentRecoveryStore: store(), fetchImpl: (async (input: Request) => {
    const header = input.headers.get("PAYMENT-SIGNATURE"); if (!header) { probes++; return challenge(); } signed.push(header); return success();
  }) as typeof fetch });
  await Promise.all([paid(`${origin}/arc/v1/preflight`, request), paid(`${origin}/arc/v1/preflight`, request)]);
  assert.equal(probes, 1); assert.equal(new Set(signed).size, 1);
});

test("Arc agent accepts only the published MCP tool's exact REST payment resource", async () => {
  let paidCalls = 0;
  const paid = createPaidFetch({ privateKey, network: "eip155:5042", paymentRecoveryStore: store(), fetchImpl: (async (input: Request) => {
    assert.equal(input.url, `${origin}/arc/mcp`); if (!input.headers.has("PAYMENT-SIGNATURE")) return challenge(); paidCalls++; return success(true);
  }) as typeof fetch });
  const result = await paid(`${origin}/arc/mcp`, { ...request, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "preflight", arguments: JSON.parse(request.body) } }) });
  assert.equal(result.status, 200); assert.equal(paidCalls, 1);
  const wrong = createPaidFetch({ privateKey, network: "eip155:5042", paymentRecoveryStore: store(), fetchImpl: (async () => challenge(`${origin}/arc/v1/analysis/spot/premium`)) as typeof fetch });
  await assert.rejects(wrong(`${origin}/arc/mcp`, { ...request, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "preflight", arguments: JSON.parse(request.body) } }) }), /resource does not match/);
});

test("Arc agent pins its merchant and budget before signing", async () => {
  const cfg = { privateKey, network: "eip155:5042", paymentRecoveryStore: store(), fetchImpl: (async () => challenge()) as typeof fetch };
  await assert.rejects(createPaidFetch({ ...cfg, expectedPayTo: `0x${"3".repeat(40)}` })(`${origin}/arc/v1/preflight`, request), /configured merchant/);
  await assert.rejects(createPaidFetch({ ...cfg, maxPaymentUsd: .19 })(`${origin}/arc/v1/preflight`, request), /budget/);
});
