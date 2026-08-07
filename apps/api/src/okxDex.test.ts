import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { createOkxDexHeaders, createOkxSignature } from "./okxDex.js";

test("OKX signing includes the exact path and query in the prehash", () => {
  const timestamp = "2026-08-03T12:34:56.789Z";
  const requestPath = "/api/v6/dex/aggregator/quote?chainIndex=196&amount=1";
  const expected = createHmac("sha256", "secret")
    .update(`${timestamp}GET${requestPath}`)
    .digest("base64");

  assert.equal(createOkxSignature("secret", timestamp, "GET", requestPath), expected);
});

test("OKX DEX headers use documented authentication and trim environment values", () => {
  const timestamp = "2026-08-03T12:34:56.789Z";
  const requestPath = "/api/v6/dex/aggregator/quote?chainIndex=196&amount=1";
  const headers = createOkxDexHeaders({
    OKX_API_KEY: " key ",
    OKX_SECRET_KEY: " secret ",
    OKX_PASSPHRASE: " passphrase ",
  }, timestamp, "GET", requestPath);

  assert.equal(headers["OK-ACCESS-KEY"], "key");
  assert.equal(headers["OK-ACCESS-PASSPHRASE"], "passphrase");
  assert.equal(headers["OK-ACCESS-PROJECT"], undefined);
  assert.equal(headers["OK-ACCESS-SIGN"], createOkxSignature("secret", timestamp, "GET", requestPath));
});

test("OKX DEX headers do not require a separate project ID", () => {
  assert.doesNotThrow(() => createOkxDexHeaders({
    OKX_API_KEY: "key",
    OKX_SECRET_KEY: "secret",
    OKX_PASSPHRASE: "passphrase",
  }, new Date().toISOString(), "GET", "/api/v6/dex/aggregator/quote"));
});
