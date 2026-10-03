/** Bounded mainnet test of the real registration/worker flow. No fabricated signal.
 * Reuses the explicitly designated, empty test vault and its existing paid pass.
 * Never changes the global registry. Always pauses this vault before returning.
 */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import express from "express";
import { encodeFunctionData, erc20Abi, formatUnits, keccak256, parseAbi, parseUnits, toHex, type Address, type Hex } from "viem";
import { qualificationJournal } from "./robinhood-qualification-journal.js";

async function main() {
  config({ quiet: true });
  process.env.REDIS_URL = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL;
  process.env.QUEUE_PROVIDER = "redis";
  process.env.KV_REQUEST_TIMEOUT_MS = "15000"; // Public Railway TCP hop, not production settings.
  process.env.AUTOMATION_WORKER_ENABLED = "0"; // This process only: scoped cycles below.
  process.env.FEATURE_ROBINHOOD_TRADING = "1";
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { createAutopilotAutomationRouter, runAutopilotCycle } = await import("../apps/api/src/autopilotAutomation.js");
  const { resolveRobinhoodMarket } = await import("../apps/api/src/robinhoodMarkets.js");
  const { recordV6Activity } = await import("../apps/api/src/v6Store.js");
  const { getAutopilotPass, autopilotPassRemainingMs } = await import("../apps/api/src/autopilotPassStore.js");
  const { ROBINHOOD_USDG } = await import("../apps/api/src/robinhoodExecutionAssets.js");
  const cfg = loadConfig();
  const setup = JSON.parse(await readFile("packages/contracts/deployments/4663-autopilot-setup-qualification.json", "utf8"));
  if (setup.owner.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase() || !setup.data.registered) throw Error("Workflow test vault identity mismatch");
  const vault = setup.data.vault as Address;
  const trendScenario = process.argv.includes("--trend-scenario");
  const pair = trendScenario ? "AMAT.36046893810A7E7F-USDG" : "AAOI.521CF887E6531C6F-USDG", timeframe = "1H";
  const strategyType = trendScenario ? "trend_following" : "mean_reversion";
  const market = await resolveRobinhoodMarket(cfg, pair);
  const target = market.token.address as Address;
  const broadcast = process.argv.includes("--broadcast");
  const q = await qualificationJournal({ path: `packages/contracts/deployments/4663-autopilot-live-${trendScenario ? "trend-" : ""}workflow.json`,
    privateKey: cfg.TEST_WALLET_PRIVATE_KEY as Hex, owner: cfg.TEST_WALLET_ADDRESS, rpcUrl: cfg.ROBINHOOD_RPC_URL,
    broadcast, budgetETH: "0.00006", targets: [vault, ROBINHOOD_USDG] });
  const abi = parseAbi([
    "function owner() view returns(address)", "function paused() view returns(bool)", "function assetsOf() view returns(address[])",
    "function updatePolicy(bytes32)", "function configureAsset(address,bool,uint256)",
    "function configureLimits(uint128,uint128,uint16,uint16,uint64,uint64)", "function setPaused(bool)",
    "function withdraw(address,uint256)",
  ]);
  const app = express(); app.use(express.json()); app.use(createAutopilotAutomationRouter(cfg));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: "Workflow dependency unavailable" }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = async (path: string, body: unknown) => {
    const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    const data = await response.json() as any;
    if (!response.ok) throw Error(`Workflow ${path} HTTP ${response.status}: ${String(data.error || "unavailable").split("\n")[0].replace(/https?:\/\/\S+/g, "[provider]").slice(0, 180)}`);
    return data;
  };
  const view = async () => {
    const response = await fetch(`${base}/v1/autopilot/strategies?owner=${q.account.address}&network=robinhood`, { signal: AbortSignal.timeout(90_000) });
    const data = await response.json() as any;
    const s = data.strategies?.find((s: any) => s.vault.toLowerCase() === vault.toLowerCase());
    if (!response.ok || !s || s.telemetryError) throw Error("Workflow strategy telemetry unavailable");
    return s;
  };
  let mustPause = false;
  const attempt = Number(q.journal.data.attempt || (q.journal.data.cycleAttempted ? "1" : "0")) + 1;
  try {
    await q.reconcile();
    if (q.journal.data.cycleAttempted && (!process.argv.includes("--retry-cycle") || attempt > 3)) throw Error("Workflow already attempted; inspect its journal before another live cycle");
    if ((await q.client.readContract({ address: vault, abi, functionName: "owner" })).toLowerCase() !== q.account.address.toLowerCase()
      || !await q.client.readContract({ address: vault, abi, functionName: "paused" })) throw Error("Workflow requires the owner’s paused test vault");
    if (!q.journal.entries.length) {
      const assets = await q.client.readContract({ address: vault, abi, functionName: "assetsOf" });
      for (const asset of assets) {
        const expected = trendScenario && asset.toLowerCase() === ROBINHOOD_USDG ? 200000n : 0n;
        if (await q.client.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [vault] }) !== expected)
          throw Error("Workflow requires the exact test deposit and no invested assets; existing positions are not modified");
      }
    }
    const initial = await view();
    const nextAi = Date.parse(initial.lastAiAttemptAt || initial.lastAiSignalAt || "") + Math.max(900000, cfg.AUTOPILOT_AI_MIN_INTERVAL_MS);
    if (!process.argv.includes("--retry-cycle") && Number.isFinite(nextAi) && nextAi > Date.now()) throw Error(`Workflow AI cooldown is active until ${new Date(nextAi).toISOString()}; no new transaction requested`);
    if (q.journal.data.cycleAttempted && (BigInt(initial.targetBalance) !== 0n || initial.settlementBalance !== "200000" || q.journal.data.tradeConfirmed))
      throw Error("Workflow retry has an existing trade or changed balances; reconcile it instead of buying again");
    const pass = await getAutopilotPass("robinhood", vault);
    if (!pass || autopilotPassRemainingMs(pass) < 3600_000 || pass.signalsUsed >= pass.signalLimit) throw Error("Workflow existing paid pass unavailable; no replacement purchased");
    const preflight = await post("/v1/autopilot/preflight", { network: "robinhood", pair, timeframe, targetAsset: target, settlementAsset: ROBINHOOD_USDG, amountAtomic: "100000" });
    if (!preflight.signalMarket) throw Error("Workflow verified signal source missing");
    const policy = { pair, timeframe, maxTradePct: 50, dailyLossPct: 5, strategy: strategyType, signalMarket: preflight.signalMarket };
    console.log(JSON.stringify({ broadcast, vault, pair, signalMarket: policy.signalMarket, depositUSDG: "0.20", orderUSDG: "0.10", existingPassHours: autopilotPassRemainingMs(pass) / 3600_000, newPaymentUSDG: "0", globalRegistryChange: false }));
    if (!broadcast) return;
    mustPause = true;
    await q.send("policy", vault, encodeFunctionData({ abi, functionName: "updatePolicy", args: [keccak256(toHex(JSON.stringify(policy)))] }));
    await q.send("asset", vault, encodeFunctionData({ abi, functionName: "configureAsset", args: [target, true, parseUnits("0.20", 6)] }));
    await q.send("limits", vault, encodeFunctionData({ abi, functionName: "configureLimits", args: [110000n, 400000n, 100, 500, 60n, BigInt(Math.floor(Date.now() / 1000) + 86400)] }));
    if (!trendScenario) {
      const funded = await q.send("fund", ROBINHOOD_USDG, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [vault, 200000n] }));
      await recordV6Activity({ owner: q.account.address, network: "robinhood", source: "autopilot", kind: "vault_fund", status: "confirmed", txHash: funded.transactionHash, account: vault, pair, amount: "200000" });
    }
    const decimals = await q.client.readContract({ address: target, abi: erc20Abi, functionName: "decimals" });
    const payload = { owner: q.account.address, network: "robinhood", vault, settlementAsset: ROBINHOOD_USDG, targetAsset: target,
      pair, timeframe, strategyType, buyAmountAtomic: "100000", sellAmountAtomic: parseUnits("0.001", decimals).toString(), minConfidence: 60, policy };
    const expiresAt = Date.now() + 300000;
    const signature = await q.account.signMessage({ message: `PULSE Autopilot strategy\n${keccak256(toHex(JSON.stringify(payload)))}\nExpires:${expiresAt}` });
    await post("/v1/autopilot/strategies", { ...payload, authorization: { expiresAt, signature } });
    console.log(JSON.stringify({ stage: "registered", attempt }));
    const resumed = await q.send(`resume-${attempt}`, vault, encodeFunctionData({ abi, functionName: "setPaused", args: [false] }));
    await recordV6Activity({ owner: q.account.address, network: "robinhood", source: "autopilot", kind: "vault_resume", status: "confirmed", txHash: resumed.transactionHash, account: vault, pair });
    const running = await view();
    if (running.paused || running.aiPass?.pausedAt) throw Error("Workflow resume/pass synchronization failed");
    q.journal.data.cycleAttempted = true; q.journal.data.attempt = String(attempt); await q.save();
    console.log(JSON.stringify({ stage: "worker", attempt }));
    await runAutopilotCycle(cfg, { network: "robinhood", vault });
    const result = await view();
    q.journal.data.lastDecision = String(result.lastDecision);
    q.journal.data.targetBalance = String(result.targetBalance);
    q.journal.data.evaluationCount = String(result.evaluationCount);
    q.journal.data.tradeConfirmed = result.lastDecision === "buy_filled" && BigInt(result.targetBalance) > 0n;
    if (q.journal.data.tradeConfirmed) {
      q.journal.data.tradeHash = result.lastTxHash;
      q.journal.data.takeProfit = String(result.activeTakeProfit);
      q.journal.data.stopLoss = String(result.activeStopLoss);
    }
    await q.save();
    console.log(JSON.stringify({ lastDecision: result.lastDecision, lastError: result.lastError, evaluationsAdded: result.evaluationCount - initial.evaluationCount,
      aiCalls: result.aiCallsToday, signalsUsed: result.aiPass?.signalsUsed, targetBalance: formatUnits(BigInt(result.targetBalance), decimals),
      tradeConfirmed: q.journal.data.tradeConfirmed, latestReason: result.evaluations?.at(-1)?.reason }));
  } finally {
    try {
      if (mustPause) {
        if (!await q.client.readContract({ address: vault, abi, functionName: "paused" })) {
          const paused = await q.send(`pause-${attempt}`, vault, encodeFunctionData({ abi, functionName: "setPaused", args: [true] }));
          await recordV6Activity({ owner: q.account.address, network: "robinhood", source: "autopilot", kind: "vault_pause", status: "confirmed", txHash: paused.transactionHash, account: vault, pair }).catch(() => console.log("Workflow pause receipt confirmed; activity persistence must be reconciled."));
        }
        if (!await q.client.readContract({ address: vault, abi, functionName: "paused" })) throw Error("Workflow on-chain cleanup pause failed");
        q.journal.data.safelyPaused = true; await q.save();
        try {
          const final = await view();
          console.log(JSON.stringify({ safelyPaused: final.paused, passTimerPaused: Boolean(final.aiPass?.pausedAt) }));
        } catch { console.log("Workflow on-chain pause verified; pass telemetry needs reconciliation."); }
      }
    } finally { server.closeAllConnections(); server.close(); await q.close(); }
  }
}
main().then(() => process.exit(0)).catch(error => {
  console.error(error instanceof Error && /^(Workflow |Redis )/.test(error.message) ? error.message : `Workflow stopped (${error?.name || "unknown error"}); inspect the public transaction journal before retrying.`); process.exit(1);
});
