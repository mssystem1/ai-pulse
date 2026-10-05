import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "./index.js";
import { NETWORK_REGISTRY, getNetworkByCaip2, parseEnabledNetworks } from "./networks.js";

describe("network registry", () => {
  it("contains only the approved networks", () => {
    assert.deepEqual(Object.keys(NETWORK_REGISTRY).sort(), ["arbitrum", "arc", "base", "robinhood", "xlayer"]);
    assert.equal(getNetworkByCaip2("eip155:196")?.key, "xlayer");
    assert.equal(getNetworkByCaip2("eip155:8453")?.key, "base");
    assert.equal(getNetworkByCaip2("eip155:42161")?.key, "arbitrum");
    assert.equal(getNetworkByCaip2("eip155:5042")?.key, "arc");
    assert.equal(getNetworkByCaip2("eip155:5042002"), undefined);
    assert.equal(getNetworkByCaip2("eip155:4663")?.key, "robinhood");
    assert.equal(getNetworkByCaip2("eip155:46630"), undefined);
  });

  it("uses native USDC for Base and Arbitrum", () => {
    assert.equal(NETWORK_REGISTRY.base.paymentAsset.address, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    assert.equal(NETWORK_REGISTRY.arbitrum.paymentAsset.address, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
  });

  it("separates Arc native USDC gas units from its ERC-20 payment units", () => {
    assert.equal(NETWORK_REGISTRY.arc.chainId, 5042);
    assert.equal(NETWORK_REGISTRY.arc.environment, "mainnet");
    assert.equal(NETWORK_REGISTRY.arc.nativeAsset.decimals, 18);
    assert.equal(NETWORK_REGISTRY.arc.paymentAsset.decimals, 6);
    assert.equal(NETWORK_REGISTRY.arc.rpcUrls[0], "https://rpc.mainnet.arc.io");
    assert.throws(() => parseEnabledNetworks("arc-testnet"), /Unsupported/);
  });

  it("uses USDG with ETH gas for Robinhood, without enabling it by default", () => {
    const chain = NETWORK_REGISTRY.robinhood;
    assert.equal(chain.paymentAsset.symbol, "USDG");
    assert.equal(chain.paymentAsset.decimals, 6);
    assert.equal(chain.nativeAsset.symbol, "ETH");
    assert.equal(chain.paymentProvider, "robinhood-x402");
    assert.equal(chain.environment, "mainnet");
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

it("rejects testnet endpoints, old signing networks and fixture AI in Arc mainnet configuration", () => {
  const settings = { ENABLED_NETWORKS: "arc", FEATURE_ARC_MAINNET: "1", X402_MOCK: "0", ARC_AI_MODE: "live", ARC_MAINNET_CHAIN_ID: "5042", ARC_RPC_URL: "https://rpc.mainnet.arc.io", ARC_RPC_FALLBACK_URL: "", CIRCLE_GATEWAY_MAINNET_URL: "https://gateway-api.circle.com", CIRCLE_GATEWAY_ACCEPTED_NETWORKS: "eip155:5042", XAI_INPUT_COST_PER_MILLION_USD: "3", XAI_OUTPUT_COST_PER_MILLION_USD: "15" };
  const before = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, settings);
    assert.equal(loadConfig().enabledNetworks[0], "arc");
    for (const [key, value, error] of [
      ["ARC_RPC_URL", "https://rpc.testnet.arc.network", /testnet RPC/],
      ["CIRCLE_GATEWAY_MAINNET_URL", "https://gateway-api-testnet.circle.com", /testnet RPC/],
      ["CIRCLE_GATEWAY_ACCEPTED_NETWORKS", "eip155:5042002", /5042/],
      ["ARC_MAINNET_CHAIN_ID", "5042002", /5042/],
      ["ARC_AI_MODE", "fixture", /requires ARC_AI_MODE=live/],
    ] as const) {
      process.env[key] = value;
      assert.throws(() => loadConfig(), error);
      process.env[key] = settings[key];
    }
  } finally {
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
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
