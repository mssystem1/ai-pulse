/** Real APIs, read-only. No signatures, payments or background execution. */
import { config } from "dotenv";
import { writeFile } from "node:fs/promises";

async function main() {
  config({ quiet: true });
  process.env.AUTOMATION_WORKER_ENABLED = "0";
  if (process.env.REDIS_PUBLIC_URL) process.env.REDIS_URL = process.env.REDIS_PUBLIC_URL;
  process.env.PERSISTENCE_NAMESPACE = "pulse-arc-mainnet-qualification";
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { createApp } = await import("../apps/api/src/app.js");
  const { PolymarketClient } = await import("../packages/market/src/polymarket.js");
  const { isAnalyticsEligible } = await import("../packages/analysis/src/selection.js");
  const cfg = { ...loadConfig(), BASE_URL: "http://127.0.0.1:8789", X402_MOCK: false, ARC_AI_MODE: "live" as const };
  const app = createApp(cfg, { startDurableWorker: false });
  const server = app.listen(8789, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const checks: Array<Record<string, unknown>> = [];
  try {
    const meta = await fetch(`${cfg.BASE_URL}/v1/meta?network=arc`).then(r => r.json()) as { chainId: number; network: string; paymentProvider: string };
    checks.push({ name: "selected-network-metadata", ready: meta.chainId === 5042 && meta.network === "eip155:5042" && meta.paymentProvider === "circle-gateway" });
    const capability = await fetch(`${cfg.BASE_URL}/v1/trading/capabilities?network=arc`).then(r => r.json()) as { chainId: number; contracts: Record<string, string>; autopilot?: { enabled: boolean } };
    checks.push({ name: "ui-contract-capabilities", ready: capability.chainId === 5042 && Object.values(capability.contracts || {}).length === 7 && Object.values(capability.contracts).every(address => /^0x[\da-f]{40}$/i.test(String(address))), executionEnabled: capability.autopilot?.enabled === true });
    const wallet = await fetch(`${cfg.BASE_URL}/v1/circle/wallet/status`).then(r => r.json()) as { blockchain: string; network: string; enabled: boolean; reason?: string };
    checks.push({ name: "circle-email-status", ready: wallet.blockchain === "ARC" && wallet.network === "arc", enabled: wallet.enabled, detail: wallet.reason });
    const source = new PolymarketClient({ gammaUrl: cfg.POLYMARKET_GAMMA_URL, clobUrl: cfg.POLYMARKET_CLOB_URL, dataUrl: cfg.POLYMARKET_DATA_URL });
    let prediction: { primaryMarketId: string; additionalMarketIds: string[]; lang: string } | undefined;
    for (const market of await source.trending(30)) {
      if (!isAnalyticsEligible(market) || market.outcomes.length !== 2) continue;
      try { await Promise.all(market.outcomes.map(outcome => source.getOrderBook(outcome.tokenId))); } catch { continue; }
      prediction = { primaryMarketId: market.id, additionalMarketIds: [], lang: "en" }; break;
    }
    const services = [
      { name: "risk", path: "/v1/preflight", amount: "200000", body: { tokenAddress: "0x3600000000000000000000000000000000000000", chainId: "5042", lang: "en" } },
      { name: "global-quick", path: "/v1/analysis/spot/standard", amount: "200000", body: { instId: "ETH-USDT", timeframe: "1H", lang: "en" } },
      { name: "global-pro", path: "/v1/analysis/spot/premium", amount: "300000", body: { instId: "ETH-USDT", timeframe: "1H", lang: "en" } },
      { name: "prediction-quick", path: "/v1/analysis/prediction/standard", amount: "200000", body: prediction },
      { name: "prediction-pro", path: "/v1/analysis/prediction/premium", amount: "300000", body: prediction },
    ];
    for (const service of services) {
      if (!service.body) { checks.push({ name: service.name, ready: false, detail: "Live prediction selection unavailable" }); continue; }
      const url = `${cfg.BASE_URL}/arc${service.path}`;
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(service.body), signal: AbortSignal.timeout(90_000) });
      const header = response.headers.get("PAYMENT-REQUIRED");
      const body = header ? JSON.parse(Buffer.from(header, "base64").toString("utf8")) : await response.json().catch(() => null);
      const requirement = body?.accepts?.[0];
      const ready = response.status === 402 && body.x402Version === 2 && body.accepts.length === 1 && requirement.network === "eip155:5042"
        && requirement.asset.toLowerCase() === "0x3600000000000000000000000000000000000000" && requirement.amount === service.amount
        && requirement.payTo.toLowerCase() === cfg.PAY_TO_ADDRESS.toLowerCase()
        && requirement.extra?.name === "GatewayWalletBatched" && String(requirement.extra?.version) === "1"
        && requirement.extra?.verifyingContract?.toLowerCase() === "0x77777777dcc4d5a8b6e418fd04d8997ef11000ee" && body.resource?.url === url;
      checks.push({ name: service.name, ready, status: response.status, amountUSDC: Number(service.amount) / 1_000_000, ...(requirement ? {
        network: requirement.network, signingDomain: requirement.extra?.name,
        challenge: { x402Version: body.x402Version, resource: body.resource, accepts: body.accepts }, requestedUrl: url,
      } : { error: body?.code || "upstream_not_ready" }) });
    }
    const result = { asOf: new Date().toISOString(), chainId: 5042, mode: "read-only; no signatures or payments", checks, ready: checks.every(check => check.ready), predictionSelection: prediction };
    await writeFile("docs/ARC_MAINNET_API_READINESS.json", `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 1;
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().then(() => process.exit(process.exitCode || 0)).catch(() => { console.error("Arc API readiness stopped; no payments were submitted. Inspect the sanitized readiness report."); process.exit(1); });
