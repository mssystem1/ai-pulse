/**
 * Full E2E: free teaser + paid base/premium with real x402 from TEST_WALLET_PRIVATE_KEY.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}
loadEnv();

const BASE = process.env.BASE_URL || "http://127.0.0.1:4000";
const PK = process.env.TEST_WALLET_PRIVATE_KEY;
if (!PK) {
  console.error("TEST_WALLET_PRIVATE_KEY missing");
  process.exit(1);
}

const { createPaidFetch, buyerAddress } = await import("../packages/buyer/dist/index.js");
const paidFetch = createPaidFetch({
  privateKey: PK,
  rpcUrl: process.env.X_LAYER_RPC || "https://rpc.xlayer.tech",
  network: process.env.X402_NETWORK || "eip155:196",
});

const addr = buyerAddress(PK);
console.log("Buyer", addr);
console.log("API", BASE);

async function jget(path) {
  const r = await fetch(`${BASE}${path}`);
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

async function jpost(path, body, usePay = false) {
  const f = usePay ? paidFetch : fetch;
  const r = await f(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return {
    status: r.status,
    paymentResponse: r.headers.get("payment-response") || r.headers.get("PAYMENT-RESPONSE"),
    data,
  };
}

const health = await jget("/healthz");
console.log("\n[health]", health.status, health.data?.service, health.data?.paymentMode, health.data?.hasXaiKey);

const ticker = await jget("/v1/market/ticker?instId=BTC-USDT");
console.log("[free ticker]", ticker.status, ticker.data?.ticker?.last);

const candles = await jget("/v1/market/candles?instId=BTC-USDT&bar=1H&limit=10");
console.log("[free candles]", candles.status, candles.data?.candles?.length);

const unpaid = await jpost("/v1/analysis/base", { instId: "BTC-USDT", timeframe: "1H", lang: "en" }, false);
console.log("[unpaid base]", unpaid.status);

console.log("\n[paying base $0.03 …]");
const base = await jpost("/v1/analysis/base", { instId: "BTC-USDT", timeframe: "1H", lang: "en" }, true);
console.log("[paid base]", base.status, {
  service: base.data?.service,
  headline: base.data?.analysis?.headline,
  bias: base.data?.analysis?.bias,
  hasPaymentResponse: Boolean(base.paymentResponse),
  err: base.data?.error,
});

console.log("\n[paying premium $0.06 …]");
const prem = await jpost(
  "/v1/analysis/premium",
  { instId: "ETH-USDT", timeframe: "1H", lang: "en" },
  true,
);
console.log("[paid premium]", prem.status, {
  service: prem.data?.service,
  headline: prem.data?.analysis?.headline,
  bias: prem.data?.analysis?.bias,
  scenarios: prem.data?.analysis?.scenarios?.length,
  err: prem.data?.error,
});

const meta = await jget("/v1/metadata");
console.log("\n[metadata]", meta.status, meta.data?.asp?.name, meta.data?.asp?.logo);

const logo = await fetch(`${BASE}/brand/logo.png`);
console.log("[logo.png]", logo.status, logo.headers.get("content-type"));

const ok =
  health.status === 200 &&
  ticker.status === 200 &&
  candles.status === 200 &&
  unpaid.status === 402 &&
  base.status === 200 &&
  prem.status === 200 &&
  logo.status === 200;

console.log(ok ? "\n✅ E2E PAID PASSED" : "\n❌ E2E FAILED");
if (!ok) process.exit(1);
