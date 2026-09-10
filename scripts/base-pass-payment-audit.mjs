// Read-only indexed Base history for the incident window. No signing/RPC calls.
import assert from "node:assert/strict";
const owner = process.env.TEST_WALLET_ADDRESS;
assert.match(owner || "", /^0x[\da-f]{40}$/i, "TEST_WALLET_ADDRESS required");
const apiKey = process.env.BLOCKSCOUT_API_KEY;
assert.ok(apiKey, "BLOCKSCOUT_API_KEY required");
const since = Date.parse("2026-09-08T00:00:00Z");
const until = Date.parse("2026-09-11T00:00:00Z");
const seen = new Set();
let next = {}, complete = false, pages = 0, examined = 0;
try {
  for (; pages < 12; pages++) {
    const url = new URL(`https://api.blockscout.com/8453/api/v2/addresses/${owner}/token-transfers`);
    url.searchParams.set("apikey", apiKey);
    for (const [key, value] of Object.entries(next)) if (value != null) url.searchParams.set(key, String(value));
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!response.ok) throw new Error(`Blockscout history HTTP ${response.status}; history coverage is incomplete`);
    const body = await response.json();
    assert.ok(Array.isArray(body.items), "Unexpected history response");
    for (const item of body.items) {
      examined++;
      const at = Date.parse(item.timestamp);
      if (!Number.isFinite(at) || at < since || at >= until) continue;
      if (item.from?.hash?.toLowerCase() !== owner.toLowerCase()) continue;
      if (item.token?.address_hash?.toLowerCase() !== "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913") continue;
      console.log(JSON.stringify({ kind: "outgoing-usdc", at: item.timestamp, transaction: item.transaction_hash,
        to: item.to?.hash, amountUSDC: Number(item.total?.value) / 1e6, method: item.method }));
    }
    const oldest = body.items.at(-1)?.timestamp;
    if (!body.next_page_params || (oldest && Date.parse(oldest) < since)) { complete = true; pages++; break; }
    const marker = JSON.stringify(body.next_page_params);
    assert.ok(!seen.has(marker), "Pagination repeated; history coverage is incomplete");
    seen.add(marker); next = body.next_page_params;
  }
  console.log(JSON.stringify({ pages, examined, incidentWindowCovered: complete, noWrites: true }));
  if (!complete) process.exitCode = 1;
} catch (error) {
  // Never print a request URL: it includes the API key.
  console.error(error instanceof Error && /^(Blockscout|Unexpected|Pagination)/.test(error.message) ? error.message : "Indexed history request failed; history coverage is incomplete");
  process.exitCode = 1;
}
