import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "./index.js";
import { NETWORK_REGISTRY, getNetworkByCaip2, parseEnabledNetworks } from "./networks.js";

describe("network registry", () => {
  it("contains only the approved networks", () => {
    assert.deepEqual(Object.keys(NETWORK_REGISTRY), ["xlayer", "base", "arbitrum", "arc-testnet"]);
    assert.equal(getNetworkByCaip2("eip155:196")?.key, "xlayer");
    assert.equal(getNetworkByCaip2("eip155:8453")?.key, "base");
    assert.equal(getNetworkByCaip2("eip155:42161")?.key, "arbitrum");
    assert.equal(getNetworkByCaip2("eip155:5042002")?.key, "arc-testnet");
  });

  it("uses native USDC for Base and Arbitrum", () => {
    assert.equal(NETWORK_REGISTRY.base.paymentAsset.address, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    assert.equal(NETWORK_REGISTRY.arbitrum.paymentAsset.address, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
  });

  it("parses a unique ordered allowlist and rejects unsupported networks", () => {
    assert.deepEqual(parseEnabledNetworks("xlayer,base,xlayer"), ["xlayer", "base"]);
    assert.throws(() => parseEnabledNetworks("base-sepolia"), /Unsupported/);
    assert.throws(() => parseEnabledNetworks(""), /at least one/);
  });

  it("is immutable", () => {
    assert.equal(Object.isFrozen(NETWORK_REGISTRY), true);
    assert.equal(Object.isFrozen(NETWORK_REGISTRY.xlayer), true);
    assert.equal(Object.isFrozen(NETWORK_REGISTRY.xlayer.rpcUrls), true);
  });
});

it("fails closed when Arc live AI cost prices are not configured", () => {
  const before = {
    mode: process.env.ARC_AI_MODE,
    input: process.env.XAI_INPUT_COST_PER_MILLION_USD,
    output: process.env.XAI_OUTPUT_COST_PER_MILLION_USD,
  };
  process.env.ARC_AI_MODE = "live";
  process.env.XAI_INPUT_COST_PER_MILLION_USD = "0";
  process.env.XAI_OUTPUT_COST_PER_MILLION_USD = "0";
  try { assert.throws(() => loadConfig(), /requires positive XAI_INPUT_COST/); }
  finally {
    for (const [key, value] of Object.entries({ ARC_AI_MODE: before.mode, XAI_INPUT_COST_PER_MILLION_USD: before.input, XAI_OUTPUT_COST_PER_MILLION_USD: before.output })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

it("defaults PULSE Blob access to public and rejects a private production override", () => {
  const keys = ["STORAGE_PROVIDER", "BLOB_ACCESS", "BLOB_READ_WRITE_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN", "REPORT_ENCRYPTION_KEY"] as const;
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.STORAGE_PROVIDER = "memory";
    delete process.env.BLOB_ACCESS;
    assert.equal(loadConfig().BLOB_ACCESS, "public");

    process.env.STORAGE_PROVIDER = "vercel_blob";
    process.env.BLOB_ACCESS = "private";
    process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    process.env.KV_REST_API_TOKEN = "test-kv-token";
    process.env.REPORT_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    assert.throws(() => loadConfig(), /Invalid literal value/);
  } finally {
    for (const key of keys) {
      const value = before[key];
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
