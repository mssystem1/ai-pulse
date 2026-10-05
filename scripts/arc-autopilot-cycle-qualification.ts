/** One scoped live strategy cycle, followed by pause and a bounded withdrawal check. */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import express from "express";
import { decodeEventLog, encodeFunctionData, erc20Abi, formatEther, formatUnits, parseAbi, parseEther, parseUnits, type Address, type Hex, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { qualificationJournal } from "./arc-qualification-journal.js";

async function main() {
  config({ quiet: true });
  process.env.REDIS_URL = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL;
  process.env.QUEUE_PROVIDER = "redis";
  process.env.AUTOMATION_WORKER_ENABLED = "0"; // No background/all-network loop.
  process.env.FEATURE_ARC_TRADING = "1";
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { executionContracts } = await import("../apps/api/src/executionContracts.js");
  const { createAutopilotAutomationRouter, runAutopilotCycle } = await import("../apps/api/src/autopilotAutomation.js");
  const { recordV6Activity } = await import("../apps/api/src/v6Store.js");
  const { getAutopilotPass, autopilotPassRemainingMs } = await import("../apps/api/src/autopilotPassStore.js");
  const ARC_USDC = "0x3600000000000000000000000000000000000000" as Address;
  const cfg = loadConfig(), contracts = executionContracts("arc");
  const setup = JSON.parse(await readFile("packages/contracts/deployments/5042-autopilot-setup-qualification.json", "utf8"));
  const vault = setup.data.vault as Address;
  if (!setup.data.registered || setup.owner.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase()) throw new Error("Qualification registered vault mismatch");
  const executor = privateKeyToAccount((cfg.AUTOMATION_EXECUTOR_PRIVATE_KEY || cfg.TEST_WALLET_PRIVATE_KEY) as Hex);
  if (executor.address.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase()) throw new Error("Qualification executor must be the test wallet");
  const broadcast = process.argv.includes("--broadcast");
  const q = await qualificationJournal({ path: "packages/contracts/deployments/5042-autopilot-cycle-qualification.json", rpcUrl: cfg.ARC_RPC_URL,
    privateKey: cfg.TEST_WALLET_PRIVATE_KEY as Hex, owner: cfg.TEST_WALLET_ADDRESS, broadcast, budgetUSDC: "0.25", targets: [vault, ARC_USDC, contracts.registry] });
  const abi = parseAbi(["function automationPaused() view returns(bool)", "function pauseAutomation(bool)", "function paused() view returns(bool)", "function setPaused(bool)", "function withdraw(address,uint256)", "function maxTradeValue() view returns(uint128)", "function dailyTurnoverCap() view returns(uint128)"]);
  let cleanup = false;
  const app = express(); app.use(express.json()); app.use(createAutopilotAutomationRouter(cfg));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ error: "Qualification dependency unavailable" }); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Qualification server unavailable");
  const base = `http://127.0.0.1:${address.port}`;
  const view = async () => {
    const response = await fetch(`${base}/v1/autopilot/strategies?owner=${q.account.address}&network=arc`, { signal: AbortSignal.timeout(90_000) });
    const body = await response.json() as { strategies?: Array<Record<string, any>> };
    const strategy = body.strategies?.find(item => String(item.vault).toLowerCase() === vault.toLowerCase());
    if (!response.ok || !strategy || strategy.telemetryError) {
      console.log(JSON.stringify({ check: "strategy-view", status: response.status, found: Boolean(strategy), reason: String(strategy?.telemetryError || "missing strategy").split("\n")[0].replace(/https?:\/\/\S+/g, "[RPC]").slice(0, 220) }));
      throw new Error("Qualification strategy telemetry unavailable");
    }
    return strategy;
  };
  try {
    await q.reconcile();
    cleanup = broadcast && q.journal.entries.some(entry => entry.step === "registry-resume");
    if (q.journal.data.completed) { console.log("Autopilot cycle qualification already complete; no second cycle or withdrawal."); return; }
    const pass = await getAutopilotPass("arc", vault);
    if (!pass || !pass.pausedAt || autopilotPassRemainingMs(pass) < 23 * 3600_000) throw new Error("Qualification requires a funded paused Entry Pass");
    const initial = await view();
    if (initial.targetBalance !== "0" || initial.settlementBalance !== parseUnits("0.20", 6).toString()) throw new Error("Qualification initial vault balance mismatch");
    if (await q.client.readContract({ address: vault, abi, functionName: "maxTradeValue" }) > parseUnits("0.11", 6)
      || await q.client.readContract({ address: vault, abi, functionName: "dailyTurnoverCap" }) > parseUnits("0.40", 6)) throw new Error("Qualification on-chain capital limits exceed scope");
    const balanceBefore = await q.client.getBalance({ address: q.account.address });
    if (balanceBefore < parseEther("0.50")) throw new Error("Qualification execution gas headroom unavailable");
    console.log(JSON.stringify({ broadcast, vault, passHoursRemaining: autopilotPassRemainingMs(pass) / 3600_000, maxTradeUSDC: "0.11", allNetworkWorker: false }));
    if (!broadcast) return;
    if (q.journal.entries.some(entry => entry.step === "vault-pause")) throw new Error("Qualification prior attempt paused the vault; inspect before retrying");
    if (q.journal.data.cycleAttempted) throw new Error("Qualification prior worker attempt requires receipt and strategy reconciliation");
    if (!await q.client.readContract({ address: contracts.registry, abi, functionName: "automationPaused" })) throw new Error("Qualification requires an initially paused registry");
    cleanup = true;
    await q.send("registry-resume", contracts.registry, encodeFunctionData({ abi, functionName: "pauseAutomation", args: [false] }));
    const resumed = await q.send("vault-resume", vault, encodeFunctionData({ abi, functionName: "setPaused", args: [false] }));
    await recordV6Activity({ owner: q.account.address, network: "arc", source: "autopilot", kind: "vault_resume", status: "confirmed", txHash: resumed.transactionHash, account: vault, pair: initial.pair });
    const running = await view();
    if (running.paused || running.aiPass?.pausedAt) throw new Error("Qualification resume did not start the pass timer");
    q.journal.data.cycleAttempted = true; await q.save();
    await runAutopilotCycle(cfg, { network: "arc", vault });
    const evaluated = await view();
    if (evaluated.lastError || Number(evaluated.evaluationCount || 0) <= Number(initial.evaluationCount || 0)) throw new Error("Qualification cycle did not produce a successful journal evaluation");
    q.journal.data.lastDecision = String(evaluated.lastDecision);
    q.journal.data.evaluationCount = String(evaluated.evaluationCount);
    q.journal.data.aiCalls = String(evaluated.aiCallsToday || 0);
    q.journal.data.aiSource = String(evaluated.aiSignalSource || "unknown");
    q.journal.data.targetBalanceAfterCycle = String(evaluated.targetBalance);
    q.journal.data.cycleCompleted = true; await q.save();
    console.log(JSON.stringify({ evaluated: true, lastDecision: evaluated.lastDecision, aiCalls: evaluated.aiCallsToday || 0, reason: evaluated.evaluations?.at(-1)?.reason, targetWETH: formatUnits(BigInt(evaluated.targetBalance), 18) }));
    const paused = await q.send("vault-pause", vault, encodeFunctionData({ abi, functionName: "setPaused", args: [true] }));
    await recordV6Activity({ owner: q.account.address, network: "arc", source: "autopilot", kind: "vault_pause", status: "confirmed", txHash: paused.transactionHash, account: vault, pair: initial.pair });
    const frozen = await view();
    if (!frozen.paused || !frozen.aiPass?.pausedAt) throw new Error("Qualification pause did not freeze the pass timer");
    const remaining = autopilotPassRemainingMs(frozen.aiPass);
    if (autopilotPassRemainingMs(frozen.aiPass, Date.now() + 3600_000) !== remaining) throw new Error("Qualification paused timer decreases");
    const withdrawAmount = parseUnits("0.01", 6);
    const withdrawal = await q.send("withdraw-check", vault, encodeFunctionData({ abi, functionName: "withdraw", args: [ARC_USDC, withdrawAmount] }));
    const received = (receipt: TransactionReceipt) => receipt.logs.reduce((sum, log) => {
      if (log.address.toLowerCase() !== ARC_USDC) return sum;
      try { const {args}=decodeEventLog({abi:erc20Abi,eventName:"Transfer",data:log.data,topics:log.topics});
        return sum+(args.to.toLowerCase()===q.account.address.toLowerCase()?args.value:0n)-(args.from.toLowerCase()===q.account.address.toLowerCase()?args.value:0n);
      } catch {return sum;}
    },0n);
    // Arc's native and ERC-20 USDC share a balance; gas invalidates wallet deltas.
    if (received(withdrawal) !== withdrawAmount) throw new Error("Qualification withdrawal transfer receipt mismatch");
    await q.send("return-withdrawal", ARC_USDC, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [vault, withdrawAmount] }));
    q.journal.data.pausedTimerVerified = true; q.journal.data.withdrawalVerified = true;
    q.journal.data.workerGasAndWithdrawalUSDC = formatEther(balanceBefore - await q.client.getBalance({ address: q.account.address }));
    q.journal.data.workflowComplete = true; await q.save();
  } finally {
    try {
      if (cleanup) {
        // Restore the global execution gate even if activity persistence fails.
        await q.send("registry-pause", contracts.registry, encodeFunctionData({ abi, functionName: "pauseAutomation", args: [true] }));
        const paused = await q.send("vault-pause", vault, encodeFunctionData({ abi, functionName: "setPaused", args: [true] }));
        await recordV6Activity({ owner: q.account.address, network: "arc", source: "autopilot", kind: "vault_pause", status: "confirmed", txHash: paused.transactionHash, account: vault });
        if (!await q.client.readContract({ address: vault, abi, functionName: "paused" }) || !await q.client.readContract({ address: contracts.registry, abi, functionName: "automationPaused" })) throw new Error("Qualification cleanup pause failed");
        if (q.journal.data.workflowComplete) { q.journal.data.completed = true; await q.save(); }
      }
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await q.close(); }
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error && error.message.startsWith("Qualification ") ? error.message : "Qualification stopped; inspect the scoped vault journal before retrying."); process.exit(1); });
