/** Live, non-spending checks. No signing, AI requests, transactions or deployment. */
import { loadConfig, getNetwork } from "../packages/config/dist/index.js";
import { collectTokenRiskEvidence } from "../apps/api/dist/tokenRiskEvidence.js";

const cfg = loadConfig();
for (const network of ["base", "xlayer", "arbitrum"]) {
  try {
    const response = await fetch(`http://127.0.0.1:4000/v1/trading/pairs?network=${network}&limit=1000`, { signal: AbortSignal.timeout(20_000) });
    const body = await response.json();
    console.log(JSON.stringify({ check: "local pair catalog", network, status: response.status, count: body.pairs?.length,
      link: body.pairs?.find(item => item.pair === "LINK-USDT")?.token.address,
      wifMapped: !!body.pairs?.find(item => item.pair === "WIF-USDT") }));
  } catch (error) { console.log(JSON.stringify({ check: "local pair catalog", network, error: error.message })); }
}
const evidence = await collectTokenRiskEvidence({ cfg, networkKey: "base", network: getNetwork("base"), address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631" });
console.log(JSON.stringify({ check: "live AERO evidence collector", sources: evidence.sources.map(item => ({
  source: item.source, status: item.status, error: item.error,
  ...(item.source === "GeckoTerminal token" ? { marketCapUsd: item.data?.marketCapUsd, liquidityUsd: item.data?.liquidityUsd } : {}),
  ...(item.source === "GeckoTerminal profile" ? { score: item.data?.gtScore, websites: item.data?.websites, holders: item.data?.holders?.count } : {}),
  ...(item.source === "Blockscout verified contract" ? { isVerified: item.data?.isVerified, evidenceApi: item.data?.evidenceApi } : {}),
})) }));

const owner = process.env.TEST_WALLET_ADDRESS;
if (owner && /^0x[\da-f]{40}$/i.test(owner)) {
  const response = await fetch(`https://pulse-api-production-7aae.up.railway.app/v1/autopilot/strategies?owner=${owner}&network=base`, { signal: AbortSignal.timeout(30_000) });
  const body = await response.json();
  for (const item of body.strategies || []) {
    const latest = item.evaluations?.at(-1);
    console.log(JSON.stringify({ check: "deployed Base runtime (read-only)", pair: item.pair, vault: item.vault,
      runtime: item.runtimeState, lastRun: item.lastRunAt, total: item.evaluationCount,
      retained: item.detailedEvaluationCount, storage: item.journalStorage, buys: item.filledBuyCount, sells: item.filledSellCount,
      latest: latest ? { at: latest.evaluatedAt, reason: latest.reason, rules: latest.rules, aiStatus: latest.context?.aiStatus } : null,
    }));
  }
}
