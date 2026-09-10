// Read-only incident evidence. Never signs, pays, starts workers or writes KV.
import { runKvCommand } from '../apps/api/dist/resilientKv.js';
const owner = process.env.TEST_WALLET_ADDRESS;
if (!/^0x[0-9a-f]{40}$/i.test(owner || '')) throw new Error('TEST_WALLET_ADDRESS is required');
const raw = process.argv.includes('--providers-only') ? null : await runKvCommand(['HGETALL', 'pulse:v6:autopilot:strategy-map']);
const values = Array.isArray(raw) ? raw.filter((_, i) => i % 2) : Object.values(raw || {});
for (const value of values) {
  const row = JSON.parse(value);
  if (row.owner.toLowerCase() !== owner.toLowerCase() || row.network !== 'base') continue;
  const pass = await runKvCommand(['GET', `pulse:v6:autopilot:pass:base:${row.vault.toLowerCase()}`]);
  console.log(JSON.stringify({ vault: row.vault, pair: row.pair, createdAt: row.createdAt,
    pass: pass ? JSON.parse(pass) : null, evaluations: row.evaluations?.slice(-8).map(e => ({ at: e.evaluatedAt, status: e.status, reason: e.reason })) }));
}
const key = process.env.BLOCKSCOUT_API_KEY?.trim();
console.log(JSON.stringify({ blockscoutKeyConfigured: !!key, proKey: key?.startsWith('proapi_') || false }));
if (key) for (const chain of [8453, 42161]) {
  const token = chain === 8453 ? '0x940181a94a35a4569e4529a3cdfb74e38fd98631' : '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
  for (const path of [`/api?module=token&action=getToken&contractaddress=${token}`, `/api?module=contract&action=getsourcecode&address=${token}`, `/api?module=token&action=getTokenHolders&contractaddress=${token}&page=1&offset=20`]) {
    const url = new URL(`https://api.blockscout.com/${chain}${path}`); url.searchParams.set('apikey', key);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const body = await res.json().catch(() => ({}));
      console.log(JSON.stringify({ chain, path, status: res.status, resultStatus: body.status, symbol: body.result?.symbol, sourcePresent: !!body.result?.[0]?.SourceCode, resultRows: Array.isArray(body.result) ? body.result.length : undefined }));
    } catch { console.log(JSON.stringify({ chain, path, unavailable: true })); }
  }
}
