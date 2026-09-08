import assert from "node:assert/strict";
import test from "node:test";
import { collectGeckoEvidence, optionalNumber } from "./geckoEvidence.js";

test("unknown numeric evidence never becomes zero", () => {
  for (const value of [null, undefined, "", "not known"]) assert.equal(optionalNumber(value), null);
  assert.equal(optionalNumber("0"), 0);
  assert.equal(optionalNumber("4000000"), 4000000);
});

test("Gecko fallback uses the X Layer network ID, profile website and a shared cache", async () => {
  const previous = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input); requests.push(url);
    const attributes = url.endsWith("/info") ? { websites: ["https://xdog.meme"], twitter_handle: "xdog_meme" } : { symbol: "XDOG", market_cap_usd: null, fdv_usd: "4000000" };
    return new Response(JSON.stringify({ data: url.endsWith("/pools") ? [{ attributes: { address: "pool" } }] : { attributes } }), { status: 200 });
  };
  try {
    const address = "0x0000000000000000000000000000000000000123";
    const [sources] = await Promise.all([collectGeckoEvidence("xlayer", address), collectGeckoEvidence("xlayer", address)]);
    assert.equal(requests.length, 3);
    assert.ok(requests.every((url) => url.includes("/networks/x-layer/tokens/")));
    assert.equal((sources[0].data as any).marketCapUsd, null);
    assert.equal((sources[0].data as any).fdvUsd, 4000000);
    assert.deepEqual((sources[2].data as any).websites, ["https://xdog.meme"]);
  } finally { globalThis.fetch = previous; }
});
