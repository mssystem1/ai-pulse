import assert from "node:assert/strict";
import test from "node:test";
import { collectGeckoEvidence, optionalNumber } from "./geckoEvidence.js";

test("unknown numeric evidence never becomes zero", () => {
  for (const value of [null, undefined, "", "  ", false, true, [], "not known"]) assert.equal(optionalNumber(value), null);
  assert.equal(optionalNumber("0"), 0);
  assert.equal(optionalNumber("4000000"), 4000000);
});

test("Gecko primary evidence uses the X Layer network ID, profile website and a shared cache", async () => {
  const previous = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input); requests.push(url);
    const address = "0x0000000000000000000000000000000000000123";
    const attributes = url.endsWith("/info") ? { address, websites: ["https://xdog.meme"], twitter_handle: "xdog_meme" } : { address, symbol: "XDOG", market_cap_usd: null, fdv_usd: "4000000" };
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

test("transient 500 retries once, 429 is cached, and token identity must match", async () => {
  const previous = globalThis.fetch;
  const address = "0x0000000000000000000000000000000000000456";
  const counts = new Map<string, number>();
  globalThis.fetch = async input => {
    const url = String(input); const count = (counts.get(url) || 0) + 1; counts.set(url, count);
    if (url.endsWith("/info")) return new Response("quota", { status: 429 });
    if (url.endsWith("/pools")) return new Response(JSON.stringify({ data: [] }));
    if (count === 1) return new Response("upstream", { status: 500 });
    return new Response(JSON.stringify({ data: { attributes: { address: "0x0000000000000000000000000000000000000999" } } }));
  };
  try {
    const results = await collectGeckoEvidence("base", address);
    await collectGeckoEvidence("base", address);
    assert.match(results[0].error || "", /identity/);
    assert.match(results[2].error || "", /429/);
    assert.equal([...counts.entries()].find(([url]) => url.endsWith(address))?.[1], 2);
    assert.equal([...counts.entries()].find(([url]) => url.endsWith("/info"))?.[1], 1);
  } finally { globalThis.fetch = previous; }
});

test("pool evidence excludes unrelated contracts and never assigns base-token price changes to the quote", async () => {
  const previous = globalThis.fetch;
  const address = "0x0000000000000000000000000000000000000789";
  const target = `base_${address}`;
  globalThis.fetch = async input => new Response(JSON.stringify({ data: String(input).endsWith("/pools") ? [
    { attributes: { address: "unrelated", reserve_in_usd: "99999" }, relationships: { base_token: { data: { id: "base_other" } } } },
    { attributes: { address: "matched", reserve_in_usd: "42", price_change_percentage: { h24: "20" } }, relationships: { base_token: { data: { id: "base_other" } }, quote_token: { data: { id: target } } } },
  ] : { attributes: { address, gt_score: 91, gt_verified: true, holders: { count: 12 } } } }));
  try {
    const sources = await collectGeckoEvidence("base", address);
    const pools = sources[1].data as any[];
    assert.equal(pools.length, 1); assert.equal(pools[0].address, "matched");
    assert.equal(pools[0].priceChange, null);
    assert.equal((sources[2].data as any).gtScore, 91);
    assert.equal((sources[2].data as any).holders.count, 12);
  } finally { globalThis.fetch = previous; }
});
