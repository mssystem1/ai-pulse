import test from "node:test";
import assert from "node:assert/strict";
import { splitCloudEnv, serializeCloudEnv, parseCloudEnv, prepareCloudRelease } from "./cloud-env.mjs";

test("cloud exports isolate Circle/worker secrets and carry existing Arc changes", () => {
  const values = new Map(Object.entries({ CIRCLE_API_KEY_MAINNET: "server-only", AUTOMATION_EXECUTOR_PRIVATE_KEY: "server-signer",
    VITE_CIRCLE_APP_ID: "public-app-id", VITE_ENABLED_NETWORKS: "arc", ENABLED_NETWORKS: "arc", ARC_PULSE_REGISTRY_ADDRESS: "public-contract",
    TEST_WALLET_PRIVATE_KEY: "qualification-only", TEST_WALLET_ADDRESS: "qualification-owner", ENABLE_SERVER_PAY: "1", RUN_LIVE_PAY: "1", EMPTY: "" }));
  const { railway, vercel } = splitCloudEnv(values, values);
  assert.deepEqual([...vercel.keys()], ["VITE_CIRCLE_APP_ID", "VITE_ENABLED_NETWORKS"]);
  assert.equal(railway.get("CIRCLE_API_KEY_MAINNET"), "server-only");
  assert.equal(railway.get("AUTOMATION_EXECUTOR_PRIVATE_KEY"), "server-signer");
  assert.equal(railway.get("ENABLED_NETWORKS"), "arc");
  assert.equal(railway.get("ARC_PULSE_REGISTRY_ADDRESS"), "public-contract");
  assert.ok(!serializeCloudEnv(vercel, "Vercel").includes("server-only"));
  for (const key of ["TEST_WALLET_PRIVATE_KEY", "TEST_WALLET_ADDRESS", "ENABLE_SERVER_PAY", "RUN_LIVE_PAY", "EMPTY"]) assert.ok(!railway.has(key));
});

test("a mistakenly prefixed browser secret stops exports before files are written", () => {
  const values = new Map([["VITE_CIRCLE_API_KEY", "private"]]);
  assert.throws(() => splitCloudEnv(values, values), /Refusing browser credential variable/);
});

test("qualification signer cannot be exported as the production executor", () => {
  const values = new Map([["AUTOMATION_EXECUTOR_PRIVATE_KEY", "0xABCD"], ["TEST_WALLET_PRIVATE_KEY", "0xabcd"]]);
  assert.equal(splitCloudEnv(values, values).railway.size, 0);
});

test("public report encryption fixtures are omitted without changing existing production keys", () => {
  const fixture = new Map([["REPORT_ENCRYPTION_KEY", "A".repeat(43)]]);
  assert.ok(!splitCloudEnv(fixture, fixture).railway.has("REPORT_ENCRYPTION_KEY"));
  const production = new Map([["REPORT_ENCRYPTION_KEY", "cryptographically-generated-server-key"]]);
  assert.equal(splitCloudEnv(production, production).railway.get("REPORT_ENCRYPTION_KEY"), production.get("REPORT_ENCRYPTION_KEY"));
  assert.equal(fixture.get("REPORT_ENCRYPTION_KEY"), "A".repeat(43));
});

test("cloud export preserves credentials containing quoted hashes and newlines", () => {
  const values = parseCloudEnv('CIRCLE_API_KEY_MAINNET="key#quoted" # operator comment\nREPORT_ENCRYPTION_KEY="line1\\nline2"\n');
  assert.equal(values.get("CIRCLE_API_KEY_MAINNET"), "key#quoted");
  assert.equal(values.get("REPORT_ENCRYPTION_KEY"), "line1\nline2");
  assert.deepEqual(parseCloudEnv(serializeCloudEnv(values, "Railway")), values);
});

test("manual release export aligns API and webhook origins while preserving local settings", () => {
  const local = new Map([["BASE_URL", "http://localhost:4000"], ["VITE_API_URL", "http://localhost:4000"], ["NODE_ENV", "development"]]);
  const { railway, vercel } = prepareCloudRelease(splitCloudEnv(local, local), { production: true, apiOrigin: "https://pulse-api-production-7aae.up.railway.app/" });
  assert.equal(railway.get("NODE_ENV"), "production");
  assert.equal(railway.get("BASE_URL"), "https://pulse-api-production-7aae.up.railway.app");
  assert.equal(railway.get("TELEGRAM_WEBHOOK_BASE_URL"), railway.get("BASE_URL"));
  assert.equal(vercel.get("VITE_API_URL"), railway.get("BASE_URL"));
  assert.equal(local.get("BASE_URL"), "http://localhost:4000");
  assert.equal(local.get("NODE_ENV"), "development");
  assert.ok(!vercel.has("NODE_ENV"));
});

test("manual release export rejects ambiguous or credential-bearing API URLs", () => {
  for (const apiOrigin of ["http://localhost:4000", "https://user:password@example.com", "https://example.com/api", "https://example.com?key=secret", "https://example.com#api"]) {
    assert.throws(() => prepareCloudRelease({ railway: new Map(), vercel: new Map() }, { apiOrigin }), /HTTPS origin/);
  }
});
