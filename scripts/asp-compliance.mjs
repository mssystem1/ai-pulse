/**
 * Non-spending REST/MCP acceptance check for PULSE's eight public services.
 * Never loads .env, keys, payment headers or a paid-fetch client.
 * Usage: node scripts/asp-compliance.mjs http://127.0.0.1:4000
 * Optional: --market-id=pm:... --owner=0x... --vault-xlayer=0x...
 * --vault-base=0x... --vault-arbitrum=0x... enable valid-input challenges.
 * --check-local-binding also validates returned terms against the built local
 * settlement validator. This is not signature verification or settlement.
 */
const BASE = (process.argv[2]?.startsWith("http") ? process.argv[2] : "http://127.0.0.1:4000").replace(/\/$/, "");
const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const localBinding = process.argv.includes("--check-local-binding")
  ? (await import("../packages/payments/dist/inlineSettlement.js")).validateSignedPayment : undefined;
if (process.env.RUN_LIVE_PAY === "1" || process.env.RUN_LIVE_MCP_PAY === "1") {
  throw new Error("This check never spends. Unset legacy RUN_LIVE_PAY/RUN_LIVE_MCP_PAY; paid acceptance is a separately authorized workflow.");
}
const routes = [
  ["/v1/analysis/spot/standard", "spot_analysis_standard"],
  ["/v1/analysis/spot/premium", "spot_analysis_premium"],
  ["/v1/analysis/prediction/standard", "prediction_analysis_standard"],
  ["/v1/analysis/prediction/premium", "prediction_analysis_premium"],
  ["/v1/preflight", "preflight"],
  ["/v1/autopilot/pass/24h", "start_autopilot_24h"],
  ["/v1/autopilot/pass/7d", "start_autopilot_7d"],
  ["/v1/autopilot/pass/30d", "start_autopilot_30d"],
];
const networks = [
  { key: "xlayer", chain: "196", asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736" },
  { key: "base", chain: "8453", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  { key: "arbitrum", chain: "42161", asset: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
];
let passed = 0, failed = 0, skipped = 0;
function check(ok, name, detail = "") {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ": " + detail : ""}`);
}
async function request(path, body) {
  const response = await fetch(BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25_000),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json, required: response.headers.get("PAYMENT-REQUIRED"), receipt: response.headers.get("PAYMENT-RESPONSE") };
}
const envelope = (tool, args) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } });
console.log(`PULSE non-spending acceptance: ${BASE}`);
const health = await request("/healthz");
check(health.status === 200 && health.json?.ok, "API health");
const metadata = await request("/v1/metadata");
const asp = metadata.json?.asp;
if (!asp) throw new Error("Metadata unavailable; no further probes performed.");
const advertisedOrigin = new URL(asp.metadataEndpoint).origin;
const bindingConfig = {
  BASE_URL: advertisedOrigin, PAY_TO_ADDRESS: asp.payTo,
  X402_ASSET: networks[0].asset,
  routes: Object.fromEntries(asp.services.map(service => ["POST " + service.path, { priceUsd: service.priceUsd }])),
};
check(asp.product === "PULSE", "Product identity");
check(asp.repository === "https://github.com/mssystem1/ai-pulse", "Repository identity");
check(asp.services?.length === 8, "Eight public mainnet services", String(asp.services?.length));
for (const [path] of routes) check(asp.services?.some((service) => service.path === path), "Catalog " + path);
const expectedPrices = { "/v1/preflight": .20, "/v1/autopilot/pass/24h": 1.50, "/v1/autopilot/pass/7d": 10.50, "/v1/autopilot/pass/30d": 45 };
for (const [path, expected] of Object.entries(expectedPrices)) {
  const actual = asp.services?.find((service) => service.path === path)?.priceUsd;
  check(actual === expected, "Agreed price " + path, `advertised ${actual}; expected ${expected}`);
}
for (const network of networks) {
  const prefix = "/" + network.key;
  const listing = await request(prefix + "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
  const tools = listing.json?.result?.tools || [];
  for (const [path, tool] of routes) {
    check(tools.some((entry) => entry.name === tool), `${network.key} MCP lists ${tool}`);
    for (const mcp of [false, true]) {
      const label = `${network.key} ${mcp ? "MCP" : "REST"} ${tool}`;
      try {
        const invalid = await request(prefix + (mcp ? "/mcp" : path), mcp ? envelope(tool, {}) : {});
        check(invalid.status === 400 && !invalid.required && !invalid.receipt, label + " rejects missing input before payment", String(invalid.status));
        let args;
        if (tool.startsWith("spot_")) args = { instId: "BTC-USDT", timeframe: "1H", lang: "en" };
        else if (tool === "preflight") args = { tokenAddress: network.asset, chainId: network.chain, lang: "en" };
        else if (tool.startsWith("prediction_") && option("market-id")) args = { primaryMarketId: option("market-id"), lang: "en" };
        else if (tool.startsWith("start_") && option("owner") && option("vault-" + network.key)) args = { owner: option("owner"), vault: option("vault-" + network.key) };
        if (!args) { skipped++; console.log("SKIP " + label + " valid challenge: provide an active market ID or registered owner/vault"); continue; }
        const unpaid = await request(prefix + (mcp ? "/mcp" : path), mcp ? envelope(tool, args) : args);
        let challenge;
        try { challenge = JSON.parse(Buffer.from(unpaid.required || "", "base64").toString("utf8")); } catch {}
        const accept = challenge?.accepts?.[0];
        const price = asp.services.find((service) => service.path === path)?.priceUsd;
        check(unpaid.status === 402 && !!accept && !unpaid.receipt, label + " unpaid challenge", String(unpaid.status));
        if (accept) {
          const expectedResource = new URL(prefix + path, advertisedOrigin).href;
          check(challenge.resource?.url === expectedResource, label + " canonical resource", challenge.resource?.url);
          if (localBinding) {
            localBinding(bindingConfig, { method: "POST", path, originalUrl: prefix + path, pulseNetworkKey: network.key }, { ...challenge, accepted: accept });
            check(true, label + " local settlement terms accepted (unsigned)");
          }
          check(accept.network === "eip155:" + network.chain && accept.asset?.toLowerCase() === network.asset, label + " chain/asset");
          check(String(accept.amount ?? accept.maxAmountRequired) === String(Math.round(price * 1e6)), label + " catalog price");
          check(/^0x[a-fA-F0-9]{40}$/.test(accept.payTo || ""), label + " recipient");
        }
      } catch (error) { check(false, label, error.message); }
    }
  }
}
console.log(`Summary: ${passed} passed; ${failed} failed; ${skipped} valid-input probes skipped. No payments, AI generation or transactions were performed.`);
console.log("Live paid delivery and marketplace resubmission are not established by this check.");
process.exitCode = failed ? 1 : 0;
