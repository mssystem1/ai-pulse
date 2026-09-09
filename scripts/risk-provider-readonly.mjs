/** Public evidence probe: no credentials, report generation or transactions. */
const address = "0x940181a94a35a4569e4529a3cdfb74e38fd98631";
const root = `https://api.geckoterminal.com/api/v2/networks/base/tokens/${address}`;
for (const [name, url, accept] of [
  ["Gecko token (versioned Accept)", root, "application/json;version=20230203"],
  ["Gecko token", root, "application/json"],
  ["Gecko pools", `${root}/pools`, "application/json"],
  ["Gecko profile", `${root}/info`, "application/json"],
  ["Blockscout contract", `https://base.blockscout.com/api/v2/smart-contracts/${address}`, "application/json"],
  ["Blockscout holders", `https://base.blockscout.com/api/v2/tokens/${address}/holders`, "application/json"],
]) {
  try {
    const res = await fetch(url, { headers: { Accept: accept }, signal: AbortSignal.timeout(12000) });
    const body = await res.json().catch(() => null);
    const a = body?.data?.attributes;
    console.log(JSON.stringify({ name, status: res.status, error: body?.errors || body?.message,
      attributes: a ? { address: a.address, symbol: a.symbol, marketCapUsd: a.market_cap_usd, liquidityUsd: a.total_reserve_in_usd,
        websites: a.websites, gtScore: a.gt_score, gtVerified: a.gt_verified, holders: a.holders, keys: Object.keys(a) } : undefined,
      pools: Array.isArray(body?.data) ? body.data.length : undefined,
      contract: name.includes("contract") ? { verified: body?.is_verified, hasSource: !!body?.source_code, name: body?.name } : undefined,
      holderRows: body?.items?.length,
    }));
  } catch (error) { console.log(JSON.stringify({ name, error: error.message })); }
}
