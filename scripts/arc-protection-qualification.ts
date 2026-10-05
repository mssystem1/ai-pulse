/** Bounded bracket, TP/SL and cancellation tests using real prices and routes. */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { decodeEventLog, encodeFunctionData, erc20Abi, parseAbi, parseUnits, type Address, type Hex, type TransactionReceipt } from "viem";
import { qualificationJournal } from "./arc-qualification-journal.js";

const amount = 100000n;
const abi = parseAbi([
  "function automationPaused() view returns(bool)", "function pauseAutomation(bool)", "function setPrice(address,address,uint192,uint64)",
  "function createOrder(address,address,address,address,uint128,uint128,bool,uint128,uint128,uint128,bool,uint64) returns(uint256)",
  "function executeEntry(uint256,address,bytes) returns(uint256)", "function executeExit(uint256,address,bytes,uint256) returns(uint256)",
  "function createPosition(address,address,uint128,uint128,uint128,uint64) returns(uint256)", "function updateProtection(uint256,uint128,uint128,uint64)",
  "function setPaused(uint256,bool)", "function cancelAndWithdraw(uint256)",
  "function execute(address,address,address,address,uint256,uint256,bytes) returns(uint256)",
  "event BracketCreated(uint256 indexed id,address indexed sellToken,address indexed buyToken,uint256 entryAmount,uint256 entryTrigger,uint256 takeProfit,uint256 stopLoss,bool triggerAbove,bool protectAfterFill)",
  "event EntryFilled(uint256 indexed id,address indexed adapter,uint256 amountIn,uint256 amountOut,bool protectedAfterFill)",
  "event PositionCreated(uint256 indexed id,address indexed asset,uint256 amount,uint256 takeProfit,uint256 stopLoss)",
]);
async function main() {
  config({ quiet: true });
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { executionContracts, executionContractAddress } = await import("../apps/api/src/executionContracts.js");
  const { getGenericOkxSwap } = await import("../apps/api/src/okxDex.js");
  const { validateArcSwap } = await import("../apps/api/src/arcSwap.js");
  const { executionSettlementTicker } = await import("../apps/api/src/robinhoodMarkets.js");
  const cfg = loadConfig(), contracts = executionContracts("arc");
  const accounts = JSON.parse(await readFile("packages/contracts/deployments/5042-account-qualification.json", "utf8"));
  const account = (kind: string) => accounts.entries.find((entry: { kind: string }) => entry.kind === kind)?.account as Address;
  const bracket = account("spot-bracket"), protection = account("spot-protection");
  const usdc = "0x3600000000000000000000000000000000000000" as Address, weth = "0x128cc466b61f542da60c70e3aa11c10e19b84edb" as Address;
  const router = executionContractAddress("arc", "okxRouter"), spender = executionContractAddress("arc", "okxApproval");
  const broadcast = process.argv.includes("--broadcast");
  const resume = process.argv.includes("--resume-existing");
  const phase = resume ? "-2" : "";
  if (!bracket || !protection || accounts.owner.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase()) throw new Error("Qualification account mismatch");
  const q = await qualificationJournal({ path: "packages/contracts/deployments/5042-protection-qualification.json", rpcUrl: cfg.ARC_RPC_URL,
    privateKey: cfg.TEST_WALLET_PRIVATE_KEY as Hex, owner: cfg.TEST_WALLET_ADDRESS, broadcast, budgetUSDC: "0.35",
    targets: [bracket, protection, usdc, weth, router, contracts.registry, contracts.oracleRouter] });
  const transfer = (receipt: TransactionReceipt, token: Address, receiver: Address) => receipt.logs.reduce((sum, log) => {
    if (log.address.toLowerCase() !== token.toLowerCase()) return sum;
    try { const { args } = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: log.topics });
      return sum + (args.to.toLowerCase() === receiver.toLowerCase() ? args.value : 0n) - (args.from.toLowerCase() === receiver.toLowerCase() ? args.value : 0n);
    } catch { return sum; }
  }, 0n);
  function event(receipt: TransactionReceipt, target: Address, name: "EntryFilled"): { id: bigint; amountOut: bigint };
  function event(receipt: TransactionReceipt, target: Address, name: "BracketCreated" | "PositionCreated"): { id: bigint };
  function event(receipt: TransactionReceipt, target: Address, name: "BracketCreated" | "PositionCreated" | "EntryFilled"): { id: bigint; amountOut?: bigint } {
    const found = receipt.logs.flatMap(log => {
      if (log.address.toLowerCase() !== target.toLowerCase()) return [];
      try { return [decodeEventLog({ abi, eventName: name, data: log.data, topics: log.topics }).args]; } catch { return []; }
    });
    if (found.length !== 1) throw new Error("Qualification event missing or ambiguous"); return found[0];
  }
  const prepare = async (from: Address, to: Address, value: bigint, receiver: Address) => {
    const swap = await getGenericOkxSwap(cfg, { chainId: "5042", fromTokenAddress: from, toTokenAddress: to, amount: String(value), userWalletAddress: receiver, slippagePercent: "0.5" });
    const checked = await validateArcSwap(swap, { from, to, amount: String(value), receiver, slippageBps: 50 });
    if (!Number.isFinite(Number(swap.quote!.priceImpactPercent)) || Math.abs(Number(swap.quote!.priceImpactPercent)) > 1) throw new Error("Qualification price impact exceeds scope");
    return { swap, checked };
  };
  const adapterData = async (from: Address, to: Address, value: bigint, minOut: bigint) => {
    const route = await prepare(from, to, value, contracts.executionAdapter);
    if (to === usdc && route.checked.minimum < amount * 95n / 100n) throw new Error("Qualification loss would exceed 5%");
    return { data: encodeFunctionData({ abi, functionName: "execute", args: [router, spender, from, to, value, minOut, route.swap.tx.data as Hex] }), expiresAt: route.checked.expiresAt, minimum: route.checked.minimum };
  };
  const price = async (step: string) => {
    const ticker = await executionSettlementTicker(cfg, "ETH-USDT");
    const value = parseUnits(ticker.last.toFixed(18), 18);
    await q.send(step, contracts.oracleRouter, encodeFunctionData({ abi, functionName: "setPrice", args: [weth, usdc, value, 300n] }));
    return value;
  };
  let cleanup = false;
  try {
    await q.reconcile();
    if (q.journal.data.completed) { console.log("Protection qualification already completed; no transactions repeated."); return; }
    await prepare(usdc, weth, amount, contracts.executionAdapter);
    console.log(JSON.stringify({ broadcast, bracket, protection, inputPerRoundTripUSDC: "0.10", maximumGasUSDC: "0.35", fabricatedPrices: false }));
    if (!broadcast) return;
    if (!await q.client.readContract({ address: contracts.registry, abi, functionName: "automationPaused" })) throw new Error("Qualification requires an initially paused registry");
    if (q.journal.entries.some(entry => entry.step === "registry-pause") && !resume) throw new Error("Qualification was already paused after an attempt; reconcile before resuming");
    if (resume && !q.journal.entries.some(entry => entry.step === "registry-pause" && entry.status === "success")) throw new Error("Qualification explicit resume requires a reconciled pause");
    cleanup = true;
    await q.send(`registry-resume${phase}`, contracts.registry, encodeFunctionData({ abi, functionName: "pauseAutomation", args: [false] }));
    let bracketReturned: bigint;
    const priorBracketExit = q.journal.entries.find(entry => entry.step === "bracket-exit" && entry.status === "success");
    if (priorBracketExit) {
      bracketReturned = transfer(await q.client.getTransactionReceipt({ hash: priorBracketExit.hash }), usdc, q.account.address);
    } else {
    const initialPrice = await price("bracket-oracle");
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const quote = await prepare(usdc, weth, amount, contracts.executionAdapter);
    await q.send("bracket-approve", usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [bracket, amount] }));
    const created = await q.send("bracket-create", bracket, encodeFunctionData({ abi, functionName: "createOrder", args: [usdc, weth, weth, usdc, amount,
      initialPrice * 102n / 100n, false, quote.checked.minimum * 99n / 100n, initialPrice * 995n / 1000n, initialPrice * 98n / 100n, true, expiry] }), undefined, amount);
    const bracketId = BigInt(String(event(created, bracket, "BracketCreated").id));
    let entryAmount: bigint;
    const existingEntry = q.journal.entries.find(entry => entry.step === "bracket-entry");
    if (existingEntry) entryAmount = BigInt(String(event(await q.client.getTransactionReceipt({ hash: existingEntry.hash }), bracket, "EntryFilled").amountOut));
    else {
      await price("bracket-entry-price");
      const entry = await adapterData(usdc, weth, amount, quote.checked.minimum * 99n / 100n);
      const filled = await q.send("bracket-entry", bracket, encodeFunctionData({ abi, functionName: "executeEntry", args: [bracketId, contracts.executionAdapter, entry.data] }), entry.expiresAt);
      entryAmount = BigInt(String(event(filled, bracket, "EntryFilled").amountOut));
    }
    await q.send("bracket-pause", bracket, encodeFunctionData({ abi, functionName: "setPaused", args: [bracketId, true] }));
    await q.send("bracket-resume", bracket, encodeFunctionData({ abi, functionName: "setPaused", args: [bracketId, false] }));
    const exitPrice = await price("bracket-exit-price");
    await q.send("bracket-update", bracket, encodeFunctionData({ abi, functionName: "updateProtection", args: [bracketId, exitPrice * 995n / 1000n, exitPrice * 98n / 100n, expiry] }));
    const exit = await adapterData(weth, usdc, entryAmount, amount * 95n / 100n);
    const closed = await q.send("bracket-exit", bracket, encodeFunctionData({ abi, functionName: "executeExit", args: [bracketId, contracts.executionAdapter, exit.data, amount * 95n / 100n] }), exit.expiresAt);
    bracketReturned = transfer(closed, usdc, q.account.address);
    }
    if (bracketReturned < amount * 95n / 100n) throw new Error("Qualification bracket owner payout mismatch");
    const existingBuy = q.journal.entries.find(entry => entry.step === "protection-buy" && entry.status === "success");
    let bought: TransactionReceipt;
    if (existingBuy) bought = await q.client.getTransactionReceipt({ hash: existingBuy.hash });
    else {
      await prepare(usdc, weth, amount, q.account.address);
      await q.send("protection-buy-approve", usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }));
      const buy = await prepare(usdc, weth, amount, q.account.address);
      bought = await q.send("protection-buy", router, buy.swap.tx.data as Hex, buy.checked.expiresAt, amount);
      if (transfer(bought, weth, q.account.address) < buy.checked.minimum) throw new Error("Qualification protection buy output mismatch");
    }
    const ownedWeth = transfer(bought, weth, q.account.address);
    if (ownedWeth <= 0n || transfer(bought, usdc, q.account.address) !== -amount) throw new Error("Qualification protection buy mismatch");
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const exitPrice = await executionSettlementTicker(cfg, "ETH-USDT").then(ticker => parseUnits(ticker.last.toFixed(18), 18));
    await q.send("protection-approve", weth, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [protection, ownedWeth] }));
    const createdProtection = await q.send("protection-create", protection, encodeFunctionData({ abi, functionName: "createPosition", args: [weth, usdc, ownedWeth,
      exitPrice * 995n / 1000n, exitPrice * 98n / 100n, expiry] }));
    const positionId = BigInt(String(event(createdProtection, protection, "PositionCreated").id));
    await q.send("protection-pause", protection, encodeFunctionData({ abi, functionName: "setPaused", args: [positionId, true] }));
    await q.send("protection-resume", protection, encodeFunctionData({ abi, functionName: "setPaused", args: [positionId, false] }));
    const protectivePrice = await price("protection-exit-price");
    await q.send("protection-update", protection, encodeFunctionData({ abi, functionName: "updateProtection", args: [positionId, protectivePrice * 995n / 1000n, protectivePrice * 98n / 100n, expiry] }));
    const protectedExit = await adapterData(weth, usdc, ownedWeth, amount * 95n / 100n);
    const protectedClose = await q.send("protection-exit", protection, encodeFunctionData({ abi, functionName: "executeExit", args: [positionId, contracts.executionAdapter, protectedExit.data, amount * 95n / 100n] }), protectedExit.expiresAt);
    const protectionReturned = transfer(protectedClose, usdc, q.account.address);
    if (protectionReturned < amount * 95n / 100n) throw new Error("Qualification TP/SL owner payout mismatch");
    const cancelAmount = 10000n;
    await q.send("cancel-approve", usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [bracket, cancelAmount] }));
    const cancelCreated = await q.send("cancel-create", bracket, encodeFunctionData({ abi, functionName: "createOrder", args: [usdc, weth, weth, usdc, cancelAmount,
      protectivePrice / 10n, false, 1n, protectivePrice * 2n, protectivePrice / 2n, true, expiry] }), undefined, cancelAmount);
    const cancelId = BigInt(String(event(cancelCreated, bracket, "BracketCreated").id));
    const cancelled = await q.send("cancel-withdraw", bracket, encodeFunctionData({ abi, functionName: "cancelAndWithdraw", args: [cancelId] }));
    if (transfer(cancelled, usdc, q.account.address) !== cancelAmount) throw new Error("Qualification cancellation did not return exact escrow");
    for (const [name, token, target] of [["USDC-router", usdc, spender], ["USDC-bracket", usdc, bracket], ["WETH-protection", weth, protection]] as const) {
      if (await q.client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [q.account.address, target] }) > 0n)
        await q.send(`revoke-${name}`, token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [target, 0n] }));
    }
    q.journal.data.workflowCompleted = true; q.journal.data.bracketReturnedAtomic = String(bracketReturned); q.journal.data.protectionReturnedAtomic = String(protectionReturned);
    q.journal.data.existingHoldingsSold = false; q.journal.data.cancelledEscrowReturned = true; await q.save();
    console.log(JSON.stringify({ bracketEntryAndExit: true, tpSlExit: true, pauseResumeUpdate: true, cancellationReturnedUSDC: "0.01", returnedUSDC: Number(bracketReturned + protectionReturned) / 1e6 }));
  } finally {
    try { if (cleanup) { await q.send(`registry-pause${phase}`, contracts.registry, encodeFunctionData({ abi, functionName: "pauseAutomation", args: [true] }));
      if (!await q.client.readContract({ address: contracts.registry, abi, functionName: "automationPaused" })) throw new Error("Qualification pause restoration failed");
      if (q.journal.data.workflowCompleted) { q.journal.data.completed = true; await q.save(); } }
    } finally { await q.close(); }
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error && /^(Qualification |Arc route )/.test(error.message) ? error.message : "Arc protection stopped; reconcile the public journal and escrow before resuming."); process.exit(1); });
