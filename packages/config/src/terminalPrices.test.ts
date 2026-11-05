import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, usdToAtomic, buildAspMetadata } from "./index.js";

test("standalone Terminal catalog prices are env-configured exact amounts and disabled by their own flag", () => {
  const keys = ["FEATURE_TRADING_TERMINAL", "PRICE_TERMINAL_PASS_24H", "PRICE_TERMINAL_PASS_7D", "PRICE_TERMINAL_PASS_30D"] as const;
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.FEATURE_TRADING_TERMINAL = "1";
    process.env.PRICE_TERMINAL_PASS_24H = "1.234567";
    process.env.PRICE_TERMINAL_PASS_7D = "12.345678";
    process.env.PRICE_TERMINAL_PASS_30D = "49.876543";
    const config = loadConfig();
    assert.equal(config.FEATURE_TRADING_TERMINAL, true);
    assert.equal(config.routes["POST /v1/terminal/pass/24h"].priceUsd, 1.234567);
    assert.equal(usdToAtomic(config.routes["POST /v1/terminal/pass/24h"].priceUsd), "1234567");
    assert.equal(usdToAtomic(config.routes["POST /v1/terminal/pass/7d"].priceUsd), "12345678");
    assert.equal(usdToAtomic(config.routes["POST /v1/terminal/pass/30d"].priceUsd), "49876543");
    assert.equal(buildAspMetadata(config).asp.services.some(service => service.path.startsWith("/v1/terminal/")), false, "Existing report/execution marketplace catalog is unchanged");
    process.env.FEATURE_TRADING_TERMINAL = "0";
    assert.equal(loadConfig().routes["POST /v1/terminal/pass/24h"], undefined);
    for (const key of ["PRICE_TERMINAL_PASS_24H", "PRICE_TERMINAL_PASS_7D", "PRICE_TERMINAL_PASS_30D"] as const) {
      for (const value of ["0", "-1", "not-money", "0.0000001", "0.0000000000001", "0.000000000001", "0.0000009999999", "1.2345678"]) {
        process.env[key] = value; assert.throws(() => loadConfig(), Error, `${key}: ${value}`);
      }
      process.env[key] = "0.000001";
      assert.equal(usdToAtomic(loadConfig()[key]), "1", `${key} accepts one payment unit`);
      process.env[key] = "1.50";
    }
  } finally { for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } }
});
