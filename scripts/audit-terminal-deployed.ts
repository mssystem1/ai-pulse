import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";

/** Bounded deployment check. No app server, Redis connection, payment or worker is started. */
assert(process.argv.includes("--live"), "Use --live to inspect the deployed service with TEST_WALLET_ADDRESS.");
config({ quiet: true });
const origin = "https://pulse-api-production-7aae.up.railway.app";
const webOrigin = "https://app.ai-pulse.tech";
const owner = privateKeyToAccount(process.env.TEST_WALLET_PRIVATE_KEY as `0x${string}`);
assert.equal(owner.address.toLowerCase(), process.env.TEST_WALLET_ADDRESS?.toLowerCase());
const folder = new URL("../.tmp/terminal-deployed-audit/", import.meta.url);
await mkdir(folder, { recursive: true });
let token = "";
const checks: unknown[] = [];
const record = (check: string, detail: Record<string, unknown> = {}) => {
  checks.push({ check, ...detail }); console.log(JSON.stringify({ check, ...detail }));
};
const request = async (path: string, body?: unknown) => {
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST", redirect: "error",
    headers: { "content-type": "application/json", origin: webOrigin, ...(token ? { authorization: "Bearer " + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000),
  });
  const value = await response.json() as any;
  assert(response.ok, `${path}: HTTP ${response.status} ${String(value.code ?? value.error ?? "").slice(0, 150)}`);
  return value;
};
try {
  const catalog = await request("/v1/terminal/catalog");
  assert(catalog.enabled);
  record("deployed_catalog", { available: catalog.available, aiModel: catalog.aiModel, paymentNetworks: catalog.paymentNetworks, monitorIntervalMs: catalog.limits.monitorIntervalMs });
  const health = await request("/healthz");
  const storage = health.dependencies?.kv;
  record("deployed_storage_status", { provider: storage?.provider, state: storage?.state, retryAfterSeconds: storage?.retryAfterSeconds });
  assert(storage?.state !== "degraded" && storage?.state !== "recovering", "Deployed storage is unavailable; stop before wallet authentication or payment. Restore the Redis service, then rerun this bounded check.");
  assert(catalog.available, "Terminal catalog is unavailable; stop before wallet authentication or payment.");
  const challenge = await request("/v1/terminal/auth/challenge", { wallet: owner.address });
  assert(challenge.message.startsWith("PULSE Trading Terminal access\n"));
  assert(challenge.message.includes("\nOrigin: " + origin + "\n"));
  assert(challenge.message.includes("\nWallet: " + owner.address.toLowerCase() + "\n"));
  assert(challenge.message.includes("\nNonce: " + challenge.challengeId + "\n"));
  assert(challenge.message.endsWith("This signature does not authorize a payment, order, transfer or automatic renewal."));
  token = (await request("/v1/terminal/auth/verify", { challengeId: challenge.challengeId, signature: await owner.signMessage({ message: challenge.message }) })).token;
  const workspace = await request("/v1/terminal/workspace");
  record("deployed_test_wallet_workspace", {
    active: workspace.access.active, expiresAt: workspace.access.expiresAt,
    watches: workspace.watches?.map((item: any) => ({ state: item.state, paused: item.paused })),
    radars: workspace.radars?.map((item: any) => ({ state: item.state, paused: item.paused })),
    telegramEnabled: workspace.telegram?.enabled,
  });
  const listings = await request("/v1/terminal/indicators");
  const receipts = await request("/v1/terminal/indicators/purchases");
  record("deployed_indicator_catalog_and_receipts", {
    listings: listings.items?.length, ownListings: listings.items?.filter((item: any) => item.publisher === owner.address.toLowerCase()).length,
    purchases: receipts.purchases?.filter((item: any) => item.state === "granted").length,
    sales: receipts.sales?.length,
  });
  await writeFile(new URL("validation.json", folder), JSON.stringify({ at: new Date().toISOString(), origin, checks, scope: "Deployed catalog and TEST wallet ownership/access/catalog/receipt reads only. No payments, monitoring runs, report generation, Telegram or orders." }, null, 2));
} catch (error) {
  const failure = error instanceof Error ? error.message : "Deployment check failed";
  await writeFile(new URL("validation.json", folder), JSON.stringify({ at: new Date().toISOString(), origin, checks, failure, scope: "Bounded deployed inspection stopped at the first failure. No payments, monitoring runs, report generation, Telegram or orders." }, null, 2));
  console.error(failure); process.exitCode = 1;
}
