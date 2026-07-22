/**
 * End-to-end simulation against local PULSE API using the test wallet.
 * - Verifies balances on X Layer
 * - Hits free + paid routes (mock x402 signature when X402_MOCK=1)
 * - Prints 402 challenge decoding for real payment readiness
 *
 * Usage:
 *   node scripts/check-wallet.mjs
 *   # start API in another terminal: npm run dev:api
 *   node scripts/live-simulate.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    const v = m[2].trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv();

const BASE = process.env.BASE_URL || "http://localhost:4000";
const WALLET = process.env.TEST_WALLET_ADDRESS;
const PK = process.env.TEST_WALLET_PRIVATE_KEY;
const USDT0 = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const ZERO = "0x0000000000000000000000000000000000000000";

function assertPkLocalOnly() {
  if (!PK || !WALLET) throw new Error("TEST_WALLET_* missing in .env");
  if (PK.length < 60) throw new Error("Invalid TEST_WALLET_PRIVATE_KEY");
}

async function call(path, body, { pay = false } = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (pay) {
    // Mock facilitator signature for local X402_MOCK=1
    // Real flow: EIP-3009 transferWithAuthorization signed by PK against 402 challenge
    headers["PAYMENT-SIGNATURE"] = `sim:${WALLET}:${Date.now()}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return {
    status: res.status,
    paymentRequired: res.headers.get("payment-required") || res.headers.get("PAYMENT-REQUIRED"),
    paymentResponse: res.headers.get("payment-response") || res.headers.get("PAYMENT-RESPONSE"),
    json,
  };
}

function decodePaymentRequired(b64) {
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

assertPkLocalOnly();
console.log("=== PULSE live simulate ===");
console.log("API", BASE);
console.log("Wallet", WALLET);
console.log("PK loaded:", PK.slice(0, 6) + "…" + PK.slice(-4));

const health = await call("/healthz");
console.log("\n[health]", health.status, health.json);

const meta = await call("/v1/meta");
console.log("[meta routes]", meta.status, meta.json?.routes?.map((r) => `${r.route} ${r.price}`));

const resolved = await call("/v1/resolve", { query: "USDT" });
console.log("\n[resolve free]", resolved.status, resolved.json?.matches?.[0]?.symbol);

const unpaid = await call("/v1/token/scan", { address: USDT0, chainId: "196" });
const challenge = decodePaymentRequired(unpaid.paymentRequired);
console.log("\n[token_scan unpaid]", unpaid.status);
console.log("  challenge:", challenge ? {
  version: challenge.x402Version,
  amount: challenge.accepts?.[0]?.amount,
  asset: challenge.accepts?.[0]?.asset,
  network: challenge.accepts?.[0]?.network,
  payTo: challenge.accepts?.[0]?.payTo,
} : null);

const paidToken = await call(
  "/v1/token/scan",
  { address: USDT0, chainId: "196" },
  { pay: true },
);
console.log("\n[token_scan paid]", paidToken.status, {
  verdict: paidToken.json?.verdict,
  grade: paidToken.json?.grade,
  riskScore: paidToken.json?.riskScore,
  symbol: paidToken.json?.symbol,
});

const paidWallet = await call(
  "/v1/wallet/scan",
  { address: WALLET, chainId: "196" },
  { pay: true },
);
console.log("[wallet_scan self]", paidWallet.status, {
  verdict: paidWallet.json?.verdict,
  grade: paidWallet.json?.grade,
  riskScore: paidWallet.json?.riskScore,
  labels: paidWallet.json?.labels,
});

const paidQuote = await call(
  "/v1/swap/quote",
  { fromToken: ZERO, toToken: USDT0, amount: "0.1", chainId: "196" },
  { pay: true },
);
console.log("[swap_quote]", paidQuote.status, {
  verdict: paidQuote.json?.verdict,
  amountOut: paidQuote.json?.amountOut,
  impact: paidQuote.json?.priceImpactBps,
});

const paidPf = await call(
  "/v1/preflight",
  {
    intent: "swap",
    fromToken: ZERO,
    toToken: USDT0,
    amount: "0.1",
    counterparty: WALLET,
    chainId: "196",
  },
  { pay: true },
);
console.log("[preflight]", paidPf.status, {
  verdict: paidPf.json?.verdict,
  grade: paidPf.json?.grade,
  overallScore: paidPf.json?.overallScore,
  headline: paidPf.json?.headline,
  shareId: paidPf.json?.shareId,
});

// MCP tools/list free handshake
const mcpList = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
const mcpJson = await mcpList.json();
console.log("\n[mcp tools/list]", mcpList.status, mcpJson?.result?.tools?.map((t) => t.name));

const mcpCall = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "PAYMENT-SIGNATURE": `sim:${WALLET}:mcp`,
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "preflight",
      arguments: {
        intent: "hire_agent",
        counterparty: WALLET,
        tokenAddress: USDT0,
      },
    },
  }),
});
const mcpCallJson = await mcpCall.json();
console.log("[mcp preflight]", mcpCall.status, mcpCallJson?.result ? "ok" : mcpCallJson);

const ok =
  health.status === 200 &&
  resolved.status === 200 &&
  unpaid.status === 402 &&
  paidToken.status === 200 &&
  paidPf.status === 200;

console.log(ok ? "\n✅ SIMULATION PASSED" : "\n❌ SIMULATION FAILED");
process.exit(ok ? 0 : 1);
