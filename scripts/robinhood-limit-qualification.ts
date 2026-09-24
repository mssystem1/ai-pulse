/** Real 0.10 USDG limit-account execution and owner payout. Defaults to read-only. */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { decodeEventLog, encodeFunctionData, erc20Abi, formatUnits, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { qualificationJournal } from "./robinhood-qualification-journal.js";

const amount = parseUnits("0.10", 6);
const abi = parseAbi([
  "function owner() view returns(address)", "function admin() view returns(address)",
  "function automationPaused() view returns(bool)", "function pauseAutomation(bool)",
  "function createOrder(address,address,address,address,uint128,uint128,bool,uint128,uint64) returns(uint256)",
  "function orders(uint256) view returns(address,address,address,address,uint128,uint128,uint128,uint64,uint64,bool,uint8)",
  "function execute(uint256,address,bytes) returns(uint256)",
  "function setPrice(address,address,uint192,uint64)",
  "function execute(address,address,address,address,uint256,uint256,bytes) returns(uint256)",
  "event OrderCreated(uint256 indexed id,address indexed sellToken,address indexed buyToken,uint256 amount,uint256 triggerPrice,bool triggerAbove,uint256 minOut)",
  "event OrderFilled(uint256 indexed id,address indexed adapter,uint256 amountIn,uint256 amountOut)",
]);
async function main() {
  config({ quiet: true });
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { executionContracts, executionContractAddress } = await import("../apps/api/src/executionContracts.js");
  const { getGenericOkxSwap } = await import("../apps/api/src/okxDex.js");
  const { validateRobinhoodSwap } = await import("../apps/api/src/robinhoodFunding.js");
  const { executionSettlementTicker, robinhoodMarketId } = await import("../apps/api/src/robinhoodMarkets.js");
  const { ROBINHOOD_USDG, ROBINHOOD_WETH } = await import("../apps/api/src/robinhoodExecutionAssets.js");
  const cfg = loadConfig(), contracts = executionContracts("robinhood");
  const accounts = JSON.parse(await readFile("packages/contracts/deployments/4663-account-qualification.json", "utf8"));
  const limit = accounts.entries.find((entry: { kind: string }) => entry.kind === "spot-limit")?.account as Address;
  if (!limit || accounts.owner.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase()) throw new Error("Qualification account journal mismatch");
  const router = executionContractAddress("robinhood", "okxRouter"), spender = executionContractAddress("robinhood", "okxApproval");
  const broadcast = process.argv.includes("--broadcast");
  const q = await qualificationJournal({ path: "packages/contracts/deployments/4663-limit-qualification.json", rpcUrl: cfg.ROBINHOOD_RPC_URL,
    privateKey: cfg.TEST_WALLET_PRIVATE_KEY as Hex, owner: cfg.TEST_WALLET_ADDRESS, broadcast, budgetETH: "0.00018",
    targets: [limit, ROBINHOOD_USDG, ROBINHOOD_WETH, router, contracts.registry, contracts.oracleRouter] });
  let restorePause = false;
  try {
    await q.reconcile();
    for (const [address, functionName] of [[limit, "owner"], [contracts.registry, "admin"]] as const) {
      if ((await q.client.readContract({ address, abi, functionName })).toLowerCase() !== q.account.address.toLowerCase()) throw new Error("Qualification owner/admin mismatch");
    }
    if (q.journal.data.completed) { console.log("Limit qualification receipts reconciled; no new transactions."); return; }
    const pair = robinhoodMarketId({ symbol: "WETH", address: ROBINHOOD_WETH });
    const prepare = async (from: Address, to: Address, value: bigint, receiver: Address) => {
      const swap = await getGenericOkxSwap(cfg, { chainId: "4663", fromTokenAddress: from, toTokenAddress: to, amount: value.toString(), userWalletAddress: receiver, slippagePercent: "0.5" });
      const checked = validateRobinhoodSwap(swap, { from, to, amount: value.toString(), receiver, slippageBps: 50 });
      if (!Number.isFinite(Number(swap.quote!.priceImpactPercent)) || Math.abs(Number(swap.quote!.priceImpactPercent)) > 1) throw new Error("Qualification impact exceeds 1%");
      return { swap, checked };
    };
    const initial = await prepare(ROBINHOOD_USDG, ROBINHOOD_WETH, amount, contracts.executionAdapter);
    const ticker = await executionSettlementTicker(cfg, pair);
    console.log(JSON.stringify({ broadcast, inputUSDG: "0.10", expectedWETH: formatUnits(BigInt(initial.swap.quote!.toTokenAmount), 18), contractAccount: limit, priceUSDG: ticker.last }));
    if (!broadcast) return;
    if (!q.journal.data.orderId) {
      await q.send("approve-order", ROBINHOOD_USDG, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [limit, amount] }));
      const receipt = await q.send("create-order", limit, encodeFunctionData({ abi, functionName: "createOrder", args: [ROBINHOOD_USDG, ROBINHOOD_WETH, ROBINHOOD_WETH, ROBINHOOD_USDG, amount, parseUnits((ticker.last * 1.01).toFixed(18), 18), false, initial.checked.minimum, BigInt(Math.floor(Date.now() / 1000) + 3600)] }));
      const created = receipt.logs.flatMap(log => {
        if (log.address.toLowerCase() !== limit.toLowerCase()) return [];
        try { const event = decodeEventLog({ abi, eventName: "OrderCreated", topics: log.topics, data: log.data }); return [event.args]; } catch { return []; }
      });
      if (created.length !== 1 || created[0].amount !== amount || created[0].sellToken.toLowerCase() !== ROBINHOOD_USDG || created[0].buyToken.toLowerCase() !== ROBINHOOD_WETH) throw new Error("Qualification order event mismatch");
      q.journal.data.orderId = String(created[0].id); await q.save();
    }
    const orderId = BigInt(String(q.journal.data.orderId));
    if (!q.journal.entries.some(entry => entry.step === "execute-order")) {
      if (q.journal.entries.some(entry => entry.step === "registry-pause")) throw new Error("Qualification previous attempt restored pause; inspect before resuming");
      const order = await q.client.readContract({ address: limit, abi, functionName: "orders", args: [orderId] });
      if (order[0].toLowerCase() !== ROBINHOOD_USDG || order[1].toLowerCase() !== ROBINHOOD_WETH || order[4] !== amount || order[10] !== 1) throw new Error("Qualification active order mismatch");
      const paused = await q.client.readContract({ address: contracts.registry, abi, functionName: "automationPaused" });
      if (!paused && !q.journal.entries.some(entry => entry.step === "registry-resume")) throw new Error("Qualification requires an initially paused registry");
      restorePause = true;
      await q.send("registry-resume", contracts.registry, encodeFunctionData({ abi, functionName: "pauseAutomation", args: [false] }));
      const fresh = await executionSettlementTicker(cfg, pair);
      await q.send("oracle-price", contracts.oracleRouter, encodeFunctionData({ abi, functionName: "setPrice", args: [ROBINHOOD_WETH, ROBINHOOD_USDG, parseUnits(fresh.last.toFixed(18), 18), 300n] }));
      const { swap, checked } = await prepare(ROBINHOOD_USDG, ROBINHOOD_WETH, amount, contracts.executionAdapter);
      const adapterData = encodeFunctionData({ abi, functionName: "execute", args: [router, spender, ROBINHOOD_USDG, ROBINHOOD_WETH, amount, order[6], swap.tx.data as Hex] });
      await q.send("execute-order", limit, encodeFunctionData({ abi, functionName: "execute", args: [orderId, contracts.executionAdapter, adapterData] }), checked.expiresAt);
    }
    const execution = q.journal.entries.find(entry => entry.step === "execute-order")!;
    const receipt = await q.client.getTransactionReceipt({ hash: execution.hash });
    const fills = receipt.logs.flatMap(log => {
      if (log.address.toLowerCase() !== limit.toLowerCase()) return [];
      try { return [decodeEventLog({ abi, eventName: "OrderFilled", topics: log.topics, data: log.data }).args]; } catch { return []; }
    });
    if (fills.length !== 1 || fills[0].id !== orderId || fills[0].amountIn !== amount || fills[0].amountOut <= 0n) throw new Error("Qualification fill event mismatch");
    const received = receipt.logs.reduce((sum, log) => {
      if (log.address.toLowerCase() !== ROBINHOOD_WETH) return sum;
      try { const { args } = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics, data: log.data }); return sum + (args.to.toLowerCase() === q.account.address.toLowerCase() ? args.value : 0n) - (args.from.toLowerCase() === q.account.address.toLowerCase() ? args.value : 0n); } catch { return sum; }
    }, 0n);
    if (received !== fills[0].amountOut) throw new Error("Qualification owner payout mismatch");
    q.journal.data.ownerReceivedWETH = formatUnits(received, 18); await q.save();
    if (!q.journal.entries.some(entry => entry.step === "sell-test-output")) {
      await prepare(ROBINHOOD_WETH, ROBINHOOD_USDG, received, q.account.address);
      await q.send("approve-output", ROBINHOOD_WETH, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, received] }));
      const { swap, checked } = await prepare(ROBINHOOD_WETH, ROBINHOOD_USDG, received, q.account.address);
      if (checked.minimum < amount * 95n / 100n) throw new Error("Qualification round-trip loss would exceed 5%");
      await q.send("sell-test-output", router, swap.tx.data as Hex, checked.expiresAt);
    }
    q.journal.data.completed = true; await q.save();
    console.log(JSON.stringify({ contractLimitFilled: true, ownerReceivedWETH: q.journal.data.ownerReceivedWETH, soldOnlyTestOutput: true, automatedSchedulerQualified: false }));
  } finally {
    try {
      if (restorePause || (broadcast && q.journal.entries.some(entry => entry.step === "registry-resume"))) {
        await q.send("registry-pause", contracts.registry, encodeFunctionData({ abi, functionName: "pauseAutomation", args: [true] }));
        if (!await q.client.readContract({ address: contracts.registry, abi, functionName: "automationPaused" })) throw new Error("Qualification registry pause verification failed");
      }
    } finally { await q.close(); }
  }
}
main().catch(error => { console.error(error instanceof Error && error.message.startsWith("Qualification ") ? error.message : "Qualification stopped; inspect the public transaction journal and account state before retrying."); process.exitCode = 1; });
