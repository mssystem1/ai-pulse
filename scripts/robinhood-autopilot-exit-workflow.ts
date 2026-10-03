/** Verify the existing test position's real TP/SL exit; never alter its levels. */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import express from "express";
import { decodeEventLog, encodeFunctionData, erc20Abi, parseAbi, type Address, type Hex } from "viem";
import { qualificationJournal } from "./robinhood-qualification-journal.js";

async function main() {
  config({ quiet: true });
  process.env.REDIS_URL = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL;
  process.env.QUEUE_PROVIDER = "redis";
  process.env.KV_REQUEST_TIMEOUT_MS = "15000";
  process.env.AUTOMATION_WORKER_ENABLED = "0";
  process.env.FEATURE_ROBINHOOD_TRADING = "1";
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { createAutopilotAutomationRouter, runAutopilotCycle } = await import("../apps/api/src/autopilotAutomation.js");
  const { executionSettlementTicker } = await import("../apps/api/src/robinhoodMarkets.js");
  const { evaluateAutopilotRiskExit } = await import("../apps/api/src/autopilotPolicy.js");
  const { recordV6Activity } = await import("../apps/api/src/v6Store.js");
  const cfg = loadConfig();
  const entry = JSON.parse(await readFile("packages/contracts/deployments/4663-autopilot-live-trend-workflow.json", "utf8"));
  const setup = JSON.parse(await readFile("packages/contracts/deployments/4663-autopilot-setup-qualification.json", "utf8"));
  if (!entry.data.tradeConfirmed || entry.owner.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase()
    || setup.owner.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase()) throw Error("Exit workflow test identity mismatch");
  const vault = setup.data.vault as Address;
  const broadcast = process.argv.includes("--broadcast");
  const toleranceOption = process.argv.find(value => value.startsWith("--test-slippage-bps="));
  const testSlippage = toleranceOption ? Number(toleranceOption.split("=")[1]) : undefined;
  if (testSlippage !== undefined && (!Number.isInteger(testSlippage) || testSlippage < 0 || testSlippage > 1000))
    throw Error("Exit workflow test slippage must be an integer from 0 to 1000 bps");
  const q = await qualificationJournal({ path: "packages/contracts/deployments/4663-autopilot-exit-workflow.json",
    privateKey: cfg.TEST_WALLET_PRIVATE_KEY as Hex, owner: cfg.TEST_WALLET_ADDRESS,
    rpcUrl: cfg.ROBINHOOD_RPC_URL, broadcast, budgetETH: "0.00004", targets: [vault] });
  const abi = parseAbi([
    "function owner() view returns(address)", "function paused() view returns(bool)", "function actionNonce() view returns(uint64)",
    "function maxTradeValue() view returns(uint128)", "function dailyTurnoverCap() view returns(uint128)",
    "function maxSlippageBps() view returns(uint16)", "function maxDailyLossBps() view returns(uint16)",
    "function cooldown() view returns(uint64)", "function expiry() view returns(uint64)",
    "function configureLimits(uint128,uint128,uint16,uint16,uint64,uint64)", "function setPaused(bool)", "function withdraw(address,uint256)",
    "event Executed(bytes32 indexed decisionId,address indexed adapter,uint256 nonce,address sellToken,address buyToken,uint256 sellAmount,uint256 amountOut,bytes32 evidenceHash)",
  ]);
  const app = express(); app.use(express.json()); app.use(createAutopilotAutomationRouter(cfg));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: "Exit workflow dependency unavailable" }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const view = async () => {
    const response = await fetch(`${base}/v1/autopilot/strategies?owner=${q.account.address}&network=robinhood`, { signal: AbortSignal.timeout(90000) });
    const body = await response.json() as any;
    const s = body.strategies?.find((s: any) => s.vault.toLowerCase() === vault.toLowerCase());
    if (!response.ok || !s || s.telemetryError || s.telemetryUnavailable || s.pair !== "AMAT.36046893810A7E7F-USDG") throw Error("Exit workflow strategy telemetry unavailable");
    return s;
  };
  const recordTrade = async (hash: Hex, side: "buy" | "sell", s: any, label: string) => {
    const receipt = await q.client.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 90000 });
    if (receipt.status !== "success" || receipt.to?.toLowerCase() !== vault.toLowerCase()) throw Error("Exit workflow receipt mismatch");
    const events = receipt.logs.filter(log => log.address.toLowerCase() === vault.toLowerCase()).flatMap(log => {
      try { const event = decodeEventLog({ abi, data: log.data, topics: log.topics }); return event.eventName === "Executed" ? [event.args] : []; }
      catch { return []; }
    });
    const expectedSell = side === "buy" ? s.settlementAsset : s.targetAsset;
    const expectedBuy = side === "buy" ? s.targetAsset : s.settlementAsset;
    if (events.length !== 1 || events[0].sellToken.toLowerCase() !== expectedSell.toLowerCase()
      || events[0].buyToken.toLowerCase() !== expectedBuy.toLowerCase() || events[0].sellAmount <= 0n || events[0].amountOut <= 0n)
      throw Error("Exit workflow execution event mismatch");
    Object.assign(q.journal.data, { [`${label}Hash`]: hash, [`${label}Block`]: String(receipt.blockNumber),
      [`${label}Amount`]: String(events[0].sellAmount), [`${label}AmountOut`]: String(events[0].amountOut), [`${label}EvidenceHash`]: events[0].evidenceHash });
    if (side === "sell") {
      const hashes = JSON.parse(String(q.journal.data.sellHashes || "[]")) as string[];
      if (!hashes.includes(hash)) {
        q.journal.data.soldAtomic = String(BigInt(String(q.journal.data.soldAtomic || "0")) + events[0].sellAmount);
        q.journal.data.sellHashes = JSON.stringify([...hashes, hash]);
      }
    }
    await q.save();
  };
  const attempt = Number(q.journal.data.attempt || "0") + 1;
  let mustPause = false;
  let restoreLimits: readonly [bigint, bigint, number, number, bigint, bigint] | undefined;
  try {
    await q.reconcile();
    if ((await q.client.readContract({ address: vault, abi, functionName: "owner" })).toLowerCase() !== q.account.address.toLowerCase()
      || !await q.client.readContract({ address: vault, abi, functionName: "paused" })) throw Error("Exit workflow requires the owner's paused test vault");
    if (q.journal.data.riskControlsRestored === false)
      throw Error("Exit workflow has unfinished risk-limit restoration. Restore the recorded original limits before attempting another test; no resume was requested.");
    const initial = await view();
    if (!initial.activeTakeProfit || !initial.activeStopLoss || BigInt(initial.targetBalance) <= 0n) throw Error("Exit workflow requires the existing protected AMAT position");
    if (!q.journal.data.buyHash) await recordTrade(initial.lastTxHash, "buy", initial, "buy");
    if (BigInt(initial.targetBalance) !== BigInt(String(q.journal.data.buyAmountOut)) - BigInt(String(q.journal.data.soldAtomic || "0")))
      throw Error("Exit workflow position differs from its verified test receipts");
    const ticker = await executionSettlementTicker(cfg, initial.pair);
    const risk = evaluateAutopilotRiskExit({ strategyType: initial.strategyType, mark: ticker.last, hasPosition: true,
      activeTakeProfit: initial.activeTakeProfit, activeStopLoss: initial.activeStopLoss, exitPending: initial.exitPending, cooldownReady: true });
    Object.assign(q.journal.data, { takeProfit: String(initial.activeTakeProfit), stopLoss: String(initial.activeStopLoss), checkedMark: String(ticker.last), trigger: risk.reason });
    await q.save();
    console.log(JSON.stringify({ broadcast, vault, mark: ticker.last, takeProfit: initial.activeTakeProfit, stopLoss: initial.activeStopLoss, action: risk.action, reason: risk.reason }));
    if (!broadcast || risk.action !== "sell") return;
    if (attempt > 3) throw Error("Exit workflow attempt limit reached; reconcile the recorded receipts");
    q.journal.data.attempt = String(attempt); await q.save(); mustPause = true;
    const [maxTrade, dailyCap, slippage, dailyLoss, cooldown, expiry, block] = await Promise.all([
      q.client.readContract({ address: vault, abi, functionName: "maxTradeValue" }), q.client.readContract({ address: vault, abi, functionName: "dailyTurnoverCap" }),
      q.client.readContract({ address: vault, abi, functionName: "maxSlippageBps" }), q.client.readContract({ address: vault, abi, functionName: "maxDailyLossBps" }),
      q.client.readContract({ address: vault, abi, functionName: "cooldown" }), q.client.readContract({ address: vault, abi, functionName: "expiry" }), q.client.getBlock(),
    ]);
    const configuredSlippage = testSlippage ?? slippage;
    Object.assign(q.journal.data, { previousSlippageBps: String(slippage), testSlippageBps: String(configuredSlippage), dailyLossBps: String(dailyLoss) });
    if (configuredSlippage !== slippage) {
      restoreLimits = [maxTrade, dailyCap, slippage, dailyLoss, cooldown, expiry > block.timestamp ? expiry : block.timestamp + 3600n];
      q.journal.data.originalLimits = JSON.stringify(restoreLimits.map(String));
      q.journal.data.riskControlsRestored = false;
    }
    await q.save();
    if (expiry <= block.timestamp || configuredSlippage !== slippage) await q.send(`risk-limits-${attempt}`, vault, encodeFunctionData({ abi, functionName: "configureLimits",
      args: [maxTrade, dailyCap, configuredSlippage, dailyLoss, cooldown, expiry > block.timestamp ? expiry : block.timestamp + 3600n] }));
    const resumed = await q.send(`resume-exit-${attempt}`, vault, encodeFunctionData({ abi, functionName: "setPaused", args: [false] }));
    await recordV6Activity({ owner: q.account.address, network: "robinhood", source: "autopilot", kind: "vault_resume", status: "confirmed", txHash: resumed.transactionHash, account: vault, pair: initial.pair });
    await view();
    let previousHash = initial.lastTxHash;
    for (let cycle = 0; cycle < 3; cycle++) {
      await runAutopilotCycle(cfg, { network: "robinhood", vault });
      const current = await view();
      console.log(JSON.stringify({ cycle, lastDecision: current.lastDecision, targetBalance: current.targetBalance, settlementBalance: current.settlementBalance, signalsUsed: current.aiPass?.signalsUsed, error: current.lastError?.split("\n")[0] }));
      if (current.lastTxHash !== previousHash) {
        await recordTrade(current.lastTxHash, "sell", current, `sell${cycle + 1}`); previousHash = current.lastTxHash;
      }
      q.journal.data.lastDecision = current.lastDecision;
      q.journal.data.exitConfirmed = BigInt(current.targetBalance) === 0n
        && BigInt(String(q.journal.data.soldAtomic || "0")) === BigInt(String(q.journal.data.buyAmountOut));
      q.journal.data.targetBalance = current.targetBalance; q.journal.data.settlementBalance = current.settlementBalance;
      await q.save();
      if (q.journal.data.exitConfirmed || current.lastError) break;
      if (cycle < 2) await new Promise(r => setTimeout(r, Math.max(61000, Number(cooldown) * 1000 + 1000)));
    }
  } finally {
    try {
      if (mustPause) {
        if (!await q.client.readContract({ address: vault, abi, functionName: "paused" })) {
          const receipt = await q.send(`pause-exit-${attempt}`, vault, encodeFunctionData({ abi, functionName: "setPaused", args: [true] }));
          await recordV6Activity({ owner: q.account.address, network: "robinhood", source: "autopilot", kind: "vault_pause", status: "confirmed", txHash: receipt.transactionHash, account: vault }).catch(() => undefined);
        }
        if (restoreLimits) {
          const restored = await q.send(`restore-risk-limits-${attempt}`, vault, encodeFunctionData({ abi, functionName: "configureLimits", args: restoreLimits }));
          await recordV6Activity({ owner: q.account.address, network: "robinhood", source: "autopilot", kind: "vault_risk_policy", status: "confirmed", txHash: restored.transactionHash, account: vault }).catch(() => undefined);
          const limits = await Promise.all([
            q.client.readContract({ address: vault, abi, functionName: "maxTradeValue" }),
            q.client.readContract({ address: vault, abi, functionName: "dailyTurnoverCap" }),
            q.client.readContract({ address: vault, abi, functionName: "maxSlippageBps" }),
            q.client.readContract({ address: vault, abi, functionName: "maxDailyLossBps" }),
            q.client.readContract({ address: vault, abi, functionName: "cooldown" }),
            q.client.readContract({ address: vault, abi, functionName: "expiry" }),
          ]);
          if (limits.some((value, index) => value !== restoreLimits![index]))
            throw Error("Exit workflow original risk controls were not restored");
          q.journal.data.riskControlsRestored = true;
        }
        q.journal.data.safelyPaused = await q.client.readContract({ address: vault, abi, functionName: "paused" });
        if (!q.journal.data.safelyPaused) throw Error("Exit workflow cleanup pause failed");
        await q.save(); await view();
      }
    } finally { server.closeAllConnections(); server.close(); await q.close(); }
  }
}
main().then(() => process.exit(0)).catch(error => {
  console.error(error instanceof Error && error.message.startsWith("Exit workflow ") ? error.message : `Exit workflow stopped (${error?.name || "unknown error"}); inspect its public journal.`);
  process.exit(1);
});
