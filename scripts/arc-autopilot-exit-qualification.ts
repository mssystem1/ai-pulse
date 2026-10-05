/** Close only the real worker's test position, then recover its remaining cash. */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import express from "express";
import { decodeEventLog, decodeFunctionData, encodeFunctionData, erc20Abi, formatUnits, keccak256, parseAbi, parseEther, parseUnits, toHex, type Address, type Hex } from "viem";
import { qualificationJournal } from "./arc-qualification-journal.js";

async function main() {
  config({ quiet: true });
  process.env.REDIS_URL = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL;
  process.env.AUTOMATION_WORKER_ENABLED = "0";
  process.env.FEATURE_ARC_TRADING = "1";
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { executionContracts, executionContractAddress } = await import("../apps/api/src/executionContracts.js");
  const { getGenericOkxSwap } = await import("../apps/api/src/okxDex.js");
  const { validateArcSwap } = await import("../apps/api/src/arcSwap.js");
  const { executionSettlementTicker } = await import("../apps/api/src/robinhoodMarkets.js");
  const { minimumOracleOutput } = await import("../apps/api/src/autopilotPolicy.js");
  const { createAutopilotAutomationRouter } = await import("../apps/api/src/autopilotAutomation.js");
  const { recordV6Activity, listV6Activity, reconcileV6Activity } = await import("../apps/api/src/v6Store.js");
  const { PulseClient } = await import("../packages/sdk/src/index.js");
  const cfg = loadConfig(), contracts = executionContracts("arc");
  const setup = JSON.parse(await readFile("packages/contracts/deployments/5042-autopilot-setup-qualification.json", "utf8"));
  const cycle = JSON.parse(await readFile("packages/contracts/deployments/5042-autopilot-cycle-qualification.json", "utf8"));
  const budget = JSON.parse(await readFile("docs/ARC_MAINNET_BALANCE_AUDIT_2026-10-05.json", "utf8"));
  const vault = setup.data.vault as Address;
  const usdc = "0x3600000000000000000000000000000000000000" as Address;
  const weth = "0x128cC466B61f542da60c70e3aA11c10e19B84EDB" as Address;
  if (!cycle.data.completed || cycle.data.lastDecision !== "buy_filled" || setup.owner.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase()) throw new Error("Qualification real worker entry is required");
  if (!budget.receiptAccountingComplete || Date.now() - Date.parse(budget.auditedAt) > 3600_000 || parseEther(budget.remainingAuthorizedSpendUSDC) < parseEther("0.10")) throw new Error("Qualification fresh spending reconciliation required");
  const broadcast = process.argv.includes("--broadcast");
  const q = await qualificationJournal({ path: "packages/contracts/deployments/5042-autopilot-exit-qualification.json", rpcUrl: cfg.ARC_RPC_URL,
    privateKey: cfg.TEST_WALLET_PRIVATE_KEY as Hex, owner: cfg.TEST_WALLET_ADDRESS, budgetUSDC: "0.10", broadcast, targets: [vault, contracts.registry, contracts.oracleRouter] });
  const abi = parseAbi([
    "function owner() view returns(address)", "function paused() view returns(bool)", "function setPaused(bool)",
    "function automationPaused() view returns(bool)", "function pauseAutomation(bool)", "function withdraw(address,uint256)",
    "function policyVersion() view returns(uint64)", "function actionNonce() view returns(uint64)",
    "function maxTradeValue() view returns(uint128)", "function lastActionAt() view returns(uint64)", "function cooldown() view returns(uint64)",
    "function setPrice(address,address,uint192,uint64)",
    "function execute(bytes32,uint64,uint64,address,address,address,uint256,uint256,bytes,bytes32) returns(uint256)",
    "event Executed(bytes32 indexed decisionId,address indexed adapter,uint256 nonce,address sellToken,address buyToken,uint256 sellAmount,uint256 amountOut,bytes32 evidenceHash)",
  ]);
  const adapterAbi = parseAbi(["function execute(address,address,address,address,uint256,uint256,bytes) returns(uint256)"]);
  const balance = (token: Address) => q.client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [vault] });
  let cleanup = false;
  const app = express(); app.use(express.json()); app.use(createAutopilotAutomationRouter(cfg));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Qualification SDK server unavailable");
  const sdk = new PulseClient({ baseUrl: `http://127.0.0.1:${address.port}`, network: "arc" });
  try {
    await q.reconcile();
    if (q.journal.data.completed) { console.log("Autopilot exit and capital recovery already complete; no duplicate sale."); return; }
    if (q.journal.entries.length) {
      const entry = q.journal.entries.find(item => item.step === "execute-exit");
      if (!process.argv.includes("--reconcile-exit") || !entry || !broadcast) throw new Error("Qualification interrupted exit requires receipt and state reconciliation");
      if (!await q.client.readContract({ address: vault, abi, functionName: "paused" }) || !await q.client.readContract({ address: contracts.registry, abi, functionName: "automationPaused" })) throw new Error("Qualification reconciliation requires both pauses");
      const receipt = await q.client.getTransactionReceipt({ hash: entry.hash });
      const transaction = await q.client.getTransaction({ hash: entry.hash });
      const decoded = decodeFunctionData({ abi, data: transaction.input });
      if (decoded.functionName !== "execute") throw new Error("Qualification receipt is not a vault execution");
      const args = decoded.args;
      const fills = receipt.logs.flatMap(log => { if (log.address.toLowerCase() !== vault.toLowerCase()) return []; try { return [decodeEventLog({ abi, eventName: "Executed", data: log.data, topics: log.topics }).args]; } catch { return []; } });
      if (fills.length !== 1 || fills[0].nonce !== args[2] || fills[0].decisionId !== args[0] || fills[0].evidenceHash !== args[9]
        || fills[0].sellAmount !== BigInt(cycle.data.targetBalanceAfterCycle) || fills[0].sellToken.toLowerCase() !== weth.toLowerCase()
        || fills[0].buyToken.toLowerCase() !== usdc.toLowerCase() || fills[0].amountOut < args[7] || args[7] < 95000n
        || await balance(weth) !== 0n || await q.client.readContract({ address: vault, abi, functionName: "actionNonce" }) !== args[2] + 1n) throw new Error("Qualification prior exit receipt mismatch");
      const cash = 100000n + fills[0].amountOut;
      if (!q.journal.entries.some(item => item.step === "recover-cash") && await balance(usdc) !== cash) throw new Error("Qualification prior exit cash mismatch");
      q.journal.data.workerPositionClosed = true; q.journal.data.returnedAtomic = String(fills[0].amountOut); await q.save();
      if (!(await listV6Activity(q.account.address, "arc")).some(item => item.txHash === receipt.transactionHash && item.kind === "sell_filled"))
        await recordV6Activity({ owner: q.account.address, network: "arc", source: "autopilot", kind: "sell_filled", status: "confirmed", txHash: receipt.transactionHash, account: vault, pair: "ETH-USDT", amount: String(fills[0].sellAmount) });
      const withdrawal = await q.send("recover-cash", vault, encodeFunctionData({ abi, functionName: "withdraw", args: [usdc, cash] }));
      const received = withdrawal.logs.reduce((sum, log) => { if (log.address.toLowerCase() !== usdc.toLowerCase()) return sum;
        try { const { args } = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: log.topics }); return sum + (args.to.toLowerCase() === q.account.address.toLowerCase() && args.from.toLowerCase() === vault.toLowerCase() ? args.value : 0n); } catch { return sum; } }, 0n);
      if (received !== cash || await balance(usdc) !== 0n) throw new Error("Qualification recovery transfer mismatch");
      if (!(await listV6Activity(q.account.address, "arc")).some(item => item.txHash === withdrawal.transactionHash && item.kind === "vault_withdraw"))
        await recordV6Activity({ owner: q.account.address, network: "arc", source: "autopilot", kind: "vault_withdraw", status: "confirmed", txHash: withdrawal.transactionHash, account: vault, amount: String(cash) });
      const view = await sdk.autopilotStrategies(q.account.address) as { strategies: Array<{ vault: string; targetBalance: string; settlementBalance: string; paused: boolean }> };
      const strategy = view.strategies.find(item => item.vault.toLowerCase() === vault.toLowerCase());
      const activity = await reconcileV6Activity(q.account.address, "arc", cfg.ARC_RPC_URL);
      console.log(JSON.stringify({ check: "recovered-vault-view", found: Boolean(strategy), paused: strategy?.paused, target: strategy?.targetBalance,
        settlement: strategy?.settlementBalance, fills: activity.filter(item => item.txHash === entry.hash).map(item => ({ kind: item.kind, status: item.status, fillSide: item.fillSide })) }));
      if (!strategy?.paused || strategy.targetBalance !== "0" || strategy.settlementBalance !== "0"
        || !activity.some(item => item.txHash === entry.hash && item.fillSide === "sell")) throw new Error("Qualification SDK or activity recovery failed");
      q.journal.data.recoveredCashAtomic = String(cash); q.journal.data.sdkBalancesVerified = true; q.journal.data.enrichedActivityVerified = true;
      q.journal.data.workflowCompleted = true; q.journal.data.completed = true; await q.save();
      console.log(JSON.stringify({ reconciledSuccessfulExit: entry.hash, noRepeatedSale: true, recoveredCashUSDC: formatUnits(cash, 6), sdkBalancesVerified: true, registryPaused: true, vaultPaused: true }));
      return;
    }
    if ((await q.client.readContract({ address: vault, abi, functionName: "owner" })).toLowerCase() !== q.account.address.toLowerCase()
      || !await q.client.readContract({ address: vault, abi, functionName: "paused" })
      || !await q.client.readContract({ address: contracts.registry, abi, functionName: "automationPaused" })) throw new Error("Qualification requires owner-controlled paused execution");
    const amount = BigInt(cycle.data.targetBalanceAfterCycle);
    if (amount <= 0n || await balance(weth) !== amount || await balance(usdc) !== 100000n) throw new Error("Qualification position does not match the worker's bounded test buy");
    const ticker = await executionSettlementTicker(cfg, "ETH-USDT");
    const price = parseUnits(ticker.last.toFixed(18), 18);
    const version = await q.client.readContract({ address: vault, abi, functionName: "policyVersion" });
    const nonce = await q.client.readContract({ address: vault, abi, functionName: "actionNonce" });
    const maxTrade = await q.client.readContract({ address: vault, abi, functionName: "maxTradeValue" });
    if (maxTrade > 110000n || amount * price * 1000000n / 10n ** 36n > maxTrade) throw new Error("Qualification exit exceeds signed capital limits");
    const lastAction = await q.client.readContract({ address: vault, abi, functionName: "lastActionAt" });
    const cooldown = await q.client.readContract({ address: vault, abi, functionName: "cooldown" });
    if (BigInt(Math.floor(Date.now() / 1000)) < lastAction + cooldown) throw new Error("Qualification exit cooldown has not elapsed");
    const prepare = async () => {
      const swap = await getGenericOkxSwap(cfg, { chainId: "5042", fromTokenAddress: weth, toTokenAddress: usdc, amount: String(amount), userWalletAddress: contracts.executionAdapter, slippagePercent: "0.5" });
      const checked = await validateArcSwap(swap, { from: weth, to: usdc, amount: String(amount), receiver: contracts.executionAdapter, slippageBps: 50 });
      const floor = minimumOracleOutput({ action: "sell", sellAmount: amount, priceE18: price, targetDecimals: 18, settlementDecimals: 6, slippageBps: 100n });
      if (checked.minimum < floor || checked.minimum < 95000n || Math.abs(Number(swap.quote!.priceImpactPercent)) > 1) throw new Error("Qualification exit route exceeds the oracle or 5% round-trip loss limit");
      return { swap, checked };
    };
    await prepare();
    console.log(JSON.stringify({ broadcast, vault, sellOnlyWorkerWETH: formatUnits(amount, 18), maximumPhaseGasUSDC: "0.10", executionSource: "bounded qualification close; no fabricated AI signal" }));
    if (!broadcast) return;
    cleanup = true;
    await q.send("registry-resume", contracts.registry, encodeFunctionData({ abi, functionName: "pauseAutomation", args: [false] }));
    const resume = await q.send("vault-resume", vault, encodeFunctionData({ abi, functionName: "setPaused", args: [false] }));
    await recordV6Activity({ owner: q.account.address, network: "arc", source: "autopilot", kind: "vault_resume", status: "confirmed", txHash: resume.transactionHash, account: vault });
    await q.send("oracle-price", contracts.oracleRouter, encodeFunctionData({ abi, functionName: "setPrice", args: [weth, usdc, price, 300n] }));
    const { swap, checked } = await prepare();
    const evidenceHash = keccak256(toHex(JSON.stringify({ reason: "recover bounded Arc mainnet qualification capital", source: "actual worker buy", amount: String(amount), ticker, version: String(version), nonce: String(nonce) })));
    const decisionId = keccak256(toHex(`pulse:arc:qualification:exit:${vault}:${nonce}`));
    const adapterData = encodeFunctionData({ abi: adapterAbi, functionName: "execute", args: [executionContractAddress("arc", "okxRouter"), executionContractAddress("arc", "okxApproval"), weth, usdc, amount, checked.minimum, swap.tx.data as Hex] });
    const execution = await q.send("execute-exit", vault, encodeFunctionData({ abi, functionName: "execute", args: [decisionId, version, nonce, contracts.executionAdapter, weth, usdc, amount, checked.minimum, adapterData, evidenceHash] }), checked.expiresAt);
    const fills = execution.logs.flatMap(log => { if (log.address.toLowerCase() !== vault.toLowerCase()) return []; try { return [decodeEventLog({ abi, eventName: "Executed", data: log.data, topics: log.topics }).args]; } catch { return []; } });
    if (fills.length !== 1 || fills[0].sellAmount !== amount || fills[0].amountOut < checked.minimum || fills[0].nonce !== nonce
      || fills[0].decisionId !== decisionId || fills[0].evidenceHash !== evidenceHash || await balance(weth) !== 0n) throw new Error("Qualification vault exit event mismatch");
    q.journal.data.workerPositionClosed = true; q.journal.data.returnedAtomic = String(fills[0].amountOut); await q.save();
    await recordV6Activity({ owner: q.account.address, network: "arc", source: "autopilot", kind: "sell_filled", status: "confirmed", txHash: execution.transactionHash, account: vault, pair: "ETH-USDT", amount: String(amount) });
    const cash = await balance(usdc);
    if (cash !== 100000n + fills[0].amountOut) throw new Error("Qualification vault settlement mismatch");
    const withdrawal = await q.send("recover-cash", vault, encodeFunctionData({ abi, functionName: "withdraw", args: [usdc, cash] }));
    const received = withdrawal.logs.reduce((sum, log) => { if (log.address.toLowerCase() !== usdc.toLowerCase()) return sum;
      try { const { args } = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: log.topics }); return sum + (args.to.toLowerCase() === q.account.address.toLowerCase() && args.from.toLowerCase() === vault.toLowerCase() ? args.value : 0n); } catch { return sum; } }, 0n);
    if (received !== cash || await balance(usdc) !== 0n) throw new Error("Qualification recovered capital transfer mismatch");
    await recordV6Activity({ owner: q.account.address, network: "arc", source: "autopilot", kind: "vault_withdraw", status: "confirmed", txHash: withdrawal.transactionHash, account: vault, amount: String(cash) });
    q.journal.data.recoveredCashAtomic = String(cash); q.journal.data.workflowCompleted = true; await q.save();
  } finally {
    try {
      if (cleanup) {
        await q.send("registry-pause", contracts.registry, encodeFunctionData({ abi, functionName: "pauseAutomation", args: [true] }));
        const pause = await q.send("vault-pause", vault, encodeFunctionData({ abi, functionName: "setPaused", args: [true] }));
        await recordV6Activity({ owner: q.account.address, network: "arc", source: "autopilot", kind: "vault_pause", status: "confirmed", txHash: pause.transactionHash, account: vault });
        if (!await q.client.readContract({ address: vault, abi, functionName: "paused" }) || !await q.client.readContract({ address: contracts.registry, abi, functionName: "automationPaused" })) throw new Error("Qualification cleanup pause failed");
        if (q.journal.data.workflowCompleted) {
          const view = await sdk.autopilotStrategies(q.account.address) as { strategies: Array<{ vault: string; targetBalance: string; settlementBalance: string; paused: boolean }> };
          const strategy = view.strategies.find(item => item.vault.toLowerCase() === vault.toLowerCase());
          const activity = await reconcileV6Activity(q.account.address, "arc", cfg.ARC_RPC_URL);
          if (!strategy?.paused || strategy.targetBalance !== "0" || strategy.settlementBalance !== "0"
            || !activity.some(item => item.txHash === q.journal.entries.find(entry => entry.step === "execute-exit")?.hash && item.fillSide === "sell")) throw new Error("Qualification SDK or enriched activity recovery failed");
          q.journal.data.sdkBalancesVerified = true; q.journal.data.enrichedActivityVerified = true; q.journal.data.completed = true; await q.save();
          console.log(JSON.stringify({ completed: true, recoveredCashUSDC: formatUnits(BigInt(q.journal.data.recoveredCashAtomic as string), 6), sdkBalancesVerified: true, executionSource: "bounded qualification close", registryPaused: true, vaultPaused: true }));
        }
      }
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await q.close(); }
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error && error.message.startsWith("Qualification ") ? error.message : "Qualification exit stopped; inspect receipts and current pause state before retrying."); process.exit(1); });
