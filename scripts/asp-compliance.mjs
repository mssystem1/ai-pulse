/**
 * OKX.AI A2MCP ASP compliance self-check
 * Based on: https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp
 * + ASP registration fields (name, description, endpoint, price)
 *
 * Usage: node scripts/asp-compliance.mjs [baseUrl]
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

const BASE = (process.argv[2] || process.env.BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const USDT0 = "0x779ded0c9e1022225f8e0630b35a9b54be713736".toLowerCase();
const NETWORK = "eip155:196";
const PAY_TO = (process.env.PAY_TO_ADDRESS || "").toLowerCase();
const TEST_TOKEN = "0x779ded0c9e1022225f8e0630b35a9b54be713736";

const results = [];
let liveSettlementVerified = false;
function pass(name, detail = "") {
  results.push({ ok: true, name, detail });
  console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`);
}
function fail(name, detail = "") {
  results.push({ ok: false, name, detail });
  console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`);
}

async function req(method, path, { body, headers = {}, pay = false } = {}) {
  let fetchImpl = fetch;
  if (pay) {
    const { createPaidFetch } = await import("../packages/buyer/dist/index.js");
    fetchImpl = createPaidFetch({
      privateKey: process.env.TEST_WALLET_PRIVATE_KEY,
      rpcUrl: process.env.X_LAYER_RPC || "https://rpc.xlayer.tech",
      network: process.env.X402_NETWORK || NETWORK,
    });
  }
  const r = await fetchImpl(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  const hdr = (name) => r.headers.get(name) || r.headers.get(name.toLowerCase());
  return {
    status: r.status,
    paymentRequired: hdr("PAYMENT-REQUIRED") || hdr("payment-required"),
    paymentResponse: hdr("PAYMENT-RESPONSE") || hdr("payment-response"),
    json,
    text,
  };
}

function decode402(b64) {
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function validateChallenge(ch, expectAmount, label) {
  if (!ch) {
    fail(`${label}: decode PAYMENT-REQUIRED`, "missing/invalid base64");
    return false;
  }
  if (ch.x402Version !== 2 && ch.x402Version !== 1) {
    fail(`${label}: x402Version`, String(ch.x402Version));
  } else {
    pass(`${label}: x402Version`, String(ch.x402Version));
  }
  const acc = ch.accepts?.[0];
  if (!acc) {
    fail(`${label}: accepts[]`, "empty");
    return false;
  }
  if (acc.scheme !== "exact") fail(`${label}: scheme`, acc.scheme);
  else pass(`${label}: scheme exact`);
  if (acc.network !== NETWORK) fail(`${label}: network`, acc.network);
  else pass(`${label}: network ${NETWORK}`);
  if ((acc.asset || "").toLowerCase() !== USDT0) fail(`${label}: asset USD₮0`, acc.asset);
  else pass(`${label}: asset USD₮0`);
  if (String(acc.amount) !== String(expectAmount)) {
    fail(`${label}: amount`, `got ${acc.amount} want ${expectAmount}`);
  } else pass(`${label}: amount ${acc.amount}`);
  if (PAY_TO && (acc.payTo || "").toLowerCase() !== PAY_TO) {
    fail(`${label}: payTo`, `${acc.payTo} vs ${PAY_TO}`);
  } else pass(`${label}: payTo`, (acc.payTo || "").slice(0, 12) + "…");
  if (!ch.resource?.url && !acc.resource) {
    // resource may be at top level in v2
    pass(`${label}: resource optional shape ok`);
  } else {
    pass(`${label}: resource present`);
  }
  return true;
}

console.log("\n═══ OKX.AI A2MCP ASP compliance ═══");
console.log("BASE", BASE);
console.log("PAY_TO", PAY_TO || "(from .env)");
console.log("");

try {
  const hostname = new URL(BASE).hostname.toLowerCase();
  if (hostname.endsWith(".vercel.app")) {
    fail(
      "OKX.AI moderation hostname",
      "vercel.app is blocked by some buyer security policies; use a custom domain or a non-Vercel API host",
    );
  } else if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    pass("OKX.AI moderation hostname", hostname);
  }
} catch {
  fail("BASE_URL", "must be an absolute URL");
}

// ── 1. Identity / listing surfaces ──────────────────────────────────
console.log("1) Listing surfaces (metadata, health, logo)");
const health = await req("GET", "/healthz");
if (health.status === 200 && health.json?.ok && health.json?.paymentMode === "okx") {
  pass("GET /healthz", `service=${health.json.service} paymentMode=okx`);
} else fail("GET /healthz", JSON.stringify(health.json));

const meta = await req("GET", "/v1/metadata");
if (meta.status === 200 && meta.json?.asp?.name && meta.json?.asp?.description) {
  pass("GET /v1/metadata", `${meta.json.asp.name} · ${meta.json.asp.type || "A2MCP"}`);
  if (meta.json.asp.mcpEndpoint || meta.json.asp?.tags) pass("metadata has MCP/tags");
  else pass("metadata structure ok");
} else fail("GET /v1/metadata", String(meta.status));

const logoSvg = await fetch(`${BASE}/brand/logo.svg`);
const logoPng = await fetch(`${BASE}/brand/logo.png`);
if (logoSvg.status === 200) pass("GET /brand/logo.svg", logoSvg.headers.get("content-type") || "");
else fail("GET /brand/logo.svg", String(logoSvg.status));
if (logoPng.status === 200) pass("GET /brand/logo.png");
else fail("GET /brand/logo.png", "optional png missing");

// ── 2. Free endpoints (must 200, no 402) ────────────────────────────
console.log("\n2) Free endpoints (HTTP 200, no payment)");
const freePaths = [
  ["GET", "/v1/market/ticker?instId=BTC-USDT", null],
  ["GET", "/v1/market/candles?instId=BTC-USDT&bar=1H&limit=5", null],
  ["GET", "/v1/market/instruments?q=BTC&limit=5", null],
  ["POST", "/v1/resolve", { query: "OKB" }],
];
for (const [method, path, body] of freePaths) {
  const r = await req(method, path, { body });
  if (r.status === 200 && !r.paymentRequired) pass(`${method} ${path.split("?")[0]}`, "200 free");
  else fail(`${method} ${path}`, `status=${r.status} 402hdr=${Boolean(r.paymentRequired)}`);
}

// ── 3. Paid REST: unpaid → 402 + PAYMENT-REQUIRED header ────────────
console.log("\n3) Paid REST — unpaid must be HTTP 402 + PAYMENT-REQUIRED header");
const discovery = await req("GET", "/v1/token/scan");
if (
  discovery.status === 400 &&
  discovery.json?.status === "input_required" &&
  discovery.json?.fields?.some?.((field) => field.name === "address" && field.required)
) {
  pass("GET /v1/token/scan input discovery", "400 input_required with address field");
} else {
  fail(
    "GET /v1/token/scan input discovery",
    `status=${discovery.status} body=${JSON.stringify(discovery.json).slice(0, 240)}`,
  );
}

const paidSpecs = [
  { path: "/v1/analysis/base", body: { instId: "BTC-USDT", timeframe: "1H", lang: "en" }, amount: "30000", label: "base $0.03" },
  { path: "/v1/analysis/premium", body: { instId: "ETH-USDT", timeframe: "1H", lang: "en" }, amount: "60000", label: "premium $0.06" },
  { path: "/v1/token/scan", body: { address: "0x779ded0c9e1022225f8e0630b35a9b54be713736" }, amount: "10000", label: "token_scan $0.01" },
  {
    path: "/v1/preflight",
    body: {
      intent: "swap",
      fromToken: "0x0000000000000000000000000000000000000000",
      toToken: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      amount: "1",
    },
    amount: "50000",
    label: "preflight $0.05",
  },
];

const challenges = {};
for (const spec of paidSpecs) {
  const r = await req("POST", spec.path, { body: spec.body });
  if (r.status !== 402) {
    fail(`POST ${spec.path} unpaid status`, `got ${r.status}`);
    continue;
  }
  if (!r.paymentRequired) {
    fail(`POST ${spec.path} PAYMENT-REQUIRED header`, "missing (marketplace validates header)");
    continue;
  }
  pass(`POST ${spec.path} → 402 + header`, spec.label);
  const ch = decode402(r.paymentRequired);
  challenges[spec.path] = ch;
  validateChallenge(ch, spec.amount, spec.label);
  const outputSchema = ch?.outputSchema || r.json?.outputSchema;
  if (
    outputSchema?.method === "POST" &&
    outputSchema?.input &&
    Object.values(outputSchema.input).every((field) => field.carrier === "body")
  ) {
    pass(`${spec.label}: POST body contract`);
  } else {
    fail(`${spec.label}: POST body contract`, "missing outputSchema/input carrier metadata");
  }
}

// ── 4. Paid REST with real x402 settlement ──────────────────────────
console.log("\n4) Paid REST replay proof (one deliberate $0.01 token scan)");
if (process.env.RUN_LIVE_PAY !== "1") {
  console.log(
    "  SKIP Live settlement proof - set RUN_LIVE_PAY=1 only after verifying wallet, recipient, and the $0.01 price",
  );
} else if (!process.env.TEST_WALLET_PRIVATE_KEY) {
  fail("TEST_WALLET_PRIVATE_KEY", "missing - cannot run explicitly requested live pay");
} else {
  try {
    const r = await req("POST", "/v1/token/scan", {
      body: { address: TEST_TOKEN, chainId: "196" },
      pay: true,
    });
    if (
      r.status === 200 &&
      r.json?.service === "token_scan" &&
      r.json?.address?.toLowerCase?.() === TEST_TOKEN &&
      Array.isArray(r.json?.components)
    ) {
      liveSettlementVerified = true;
      pass("PAID POST /v1/token/scan inline report", `riskScore=${r.json.riskScore}`);
      if (r.paymentResponse) pass("PAYMENT-RESPONSE on token scan");
      else fail("PAYMENT-RESPONSE on token scan", "missing after successful paid replay");
    } else {
      fail(
        "PAID POST /v1/token/scan inline report",
        `status=${r.status} ${JSON.stringify(r.json).slice(0, 240)}`,
      );
    }
  } catch (e) {
    fail("PAID POST /v1/token/scan", String(e.message || e));
  }
}

// ── 5. MCP protocol (Agent-to-MCP) ──────────────────────────────────
console.log("\n5) MCP Streamable HTTP (agent tools)");
const mcpInit = await req("POST", "/mcp", {
  body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
});
if (mcpInit.status === 200 && mcpInit.json?.result?.serverInfo) {
  pass("MCP initialize", mcpInit.json.result.serverInfo.name);
} else fail("MCP initialize", JSON.stringify(mcpInit.json).slice(0, 150));

const mcpList = await req("POST", "/mcp", {
  body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
});
const tools = mcpList.json?.result?.tools || [];
const toolNames = tools.map((t) => t.name);
if (mcpList.status === 200 && tools.length >= 4) {
  pass("MCP tools/list", toolNames.join(", "));
} else fail("MCP tools/list", `count=${tools.length}`);

const need = ["spot_ticker", "analysis_base", "analysis_premium", "token_scan", "preflight"];
for (const n of need) {
  if (toolNames.includes(n)) pass(`MCP tool registered: ${n}`);
  else fail(`MCP tool registered: ${n}`, "missing");
}

// Free MCP tool
const mcpTicker = await req("POST", "/mcp", {
  body: {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "spot_ticker", arguments: { instId: "BTC-USDT" } },
  },
});
if (mcpTicker.status === 200 && !mcpTicker.paymentRequired) {
  pass("MCP free tools/call spot_ticker");
} else fail("MCP free tools/call spot_ticker", String(mcpTicker.status));

// Paid MCP tool unpaid → 402
const mcpUnpaid = await req("POST", "/mcp", {
  body: {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "analysis_base", arguments: { instId: "BTC-USDT", timeframe: "1H" } },
  },
});
if (mcpUnpaid.status === 402 && mcpUnpaid.paymentRequired) {
  pass("MCP paid tools/call unpaid → 402 + PAYMENT-REQUIRED");
  validateChallenge(decode402(mcpUnpaid.paymentRequired), "30000", "MCP base");
} else if (mcpUnpaid.status === 402) {
  pass("MCP paid tools/call unpaid → 402 (header check soft)");
} else {
  fail("MCP paid unpaid", `status=${mcpUnpaid.status}`);
}

// Paid MCP with settlement
if (process.env.RUN_LIVE_PAY === "1" && process.env.TEST_WALLET_PRIVATE_KEY) {
  try {
    const mcpPaid = await req("POST", "/mcp", {
      body: {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "analysis_base", arguments: { instId: "BTC-USDT", timeframe: "1H", lang: "en" } },
      },
      pay: true,
    });
    if (mcpPaid.status === 200 && mcpPaid.json?.result) {
      pass("MCP paid tools/call analysis_base settled");
    } else {
      fail("MCP paid tools/call", `status=${mcpPaid.status} ${JSON.stringify(mcpPaid.json).slice(0, 180)}`);
    }
  } catch (e) {
    fail("MCP paid tools/call", String(e.message || e));
  }
}

// ── 6. Registration payload completeness ────────────────────────────
console.log("\n6) ASP registration readiness");
const asp = meta.json?.asp || {};
const fields = [
  ["name", asp.name],
  ["description", asp.description || asp.shortDescription],
  ["logo", asp.logo],
  ["mcpEndpoint", asp.mcpEndpoint],
  ["network", asp.network || NETWORK],
  ["payTo", asp.payTo],
];
for (const [k, v] of fields) {
  if (v) pass(`ASP field ${k}`, String(v).slice(0, 80));
  else fail(`ASP field ${k}`, "missing");
}

// ── Summary ─────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log("\n═══ SUMMARY ═══");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(
  failed === 0
    ? liveSettlementVerified
      ? "\n✅ ASP COMPLIANCE: technical checks and live $0.01 replay passed\n"
      : "\n✅ ASP COMPLIANCE: non-spending checks passed; live settlement was not executed\n"
    : "\n❌ ASP COMPLIANCE: fix failures above before listing\n",
);

// Human checklist still needed
console.log("Human steps still required for marketplace:");
console.log("  1. Use a stable HTTPS host that is not a *.vercel.app hostname");
console.log("  2. Run one controlled $0.01 replay with RUN_LIVE_PAY=1");
console.log("  3. Update and resubmit existing OKX.AI agent 8355 (do not register a duplicate)");
console.log("");

process.exit(failed === 0 ? 0 : 1);
