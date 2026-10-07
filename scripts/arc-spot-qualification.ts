/** One bounded reviewed Arc token round trip. Separate journals; no duplicate sends on rerun. */
import { config } from "dotenv";
import { readFile, writeFile, rename, open, unlink } from "node:fs/promises";
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, erc20Abi, formatEther, formatUnits, http, keccak256, parseEther, parseUnits, type Address, type Hex, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const input = parseUnits("0.10", 6);
type Entry = { step: string; hash: Hex; nonce: number; to: Address; status: string; maxGasUSDC: string; gasUSDC?: string; inputToken?: Address; outputToken?: Address; inputAmount?: string; minimumOutput?: string; outputAmount?: string };
async function main() {
  config({ quiet: true });
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { getGenericOkxSwap } = await import("../apps/api/src/okxDex.js");
  const { validateArcSwap } = await import("../apps/api/src/arcSwap.js");
  const { ARC_OKX_MARKETS, arcOkxMarketContext, verifyArcToken } = await import("../apps/api/src/arcMarkets.js");
  const ARC_USDC = "0x3600000000000000000000000000000000000000" as Address;
  const pair = process.argv.find(arg => arg.startsWith("--pair="))?.slice(7) || "ETH-USDT";
  const token = ARC_OKX_MARKETS.find(market => market.pair === pair);
  if (!token) throw new Error("Spot qualification requires a reviewed Arc OKX market");
  const path = pair === "BTC-USDT" ? "packages/contracts/deployments/5042-cirbtc-spot-qualification.json" : "packages/contracts/deployments/5042-spot-qualification.json";
  const { executionContractAddress } = await import("../apps/api/src/executionContracts.js");
  const cfg = loadConfig(), account = privateKeyToAccount(cfg.TEST_WALLET_PRIVATE_KEY as Hex);
  if (account.address.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase()) throw new Error("Spot qualification wallet mismatch");
  const chain = { id: 5042, name: "Arc Mainnet", nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [cfg.ARC_RPC_URL] } } };
  const client = createPublicClient({ chain, transport: http(cfg.ARC_RPC_URL, { timeout: 15_000, retryCount: 0 }) });
  const wallet = createWalletClient({ chain, account, transport: http(cfg.ARC_RPC_URL, { retryCount: 0 }) });
  const usdc = ARC_USDC, weth = token.address as Address, spender = executionContractAddress("arc", "okxApproval");
  if (await client.getChainId() !== 5042) throw new Error("Spot qualification wrong network");
  for (const address of [usdc, weth, spender, executionContractAddress("arc", "okxRouter")]) {
    const code = await client.getCode({ address });
    if (!code || code === "0x") throw new Error("Spot qualification contract has no bytecode");
  }
  const lock = await open(`${path}.lock`, "wx");
  try {
    let journal: { chainId: number; owner: Address; pair?: string; target?: Address; inputUSDC: string; entries: Entry[]; completed?: boolean };
    try { journal = JSON.parse(await readFile(path, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; journal = { chainId: 5042, owner: account.address, pair, target: weth, inputUSDC: "0.1", entries: [] }; }
    if (journal.chainId !== 5042 || journal.owner.toLowerCase() !== account.address.toLowerCase() || journal.inputUSDC !== "0.1"
      || (journal.pair || "ETH-USDT") !== pair || (journal.target && journal.target.toLowerCase() !== weth.toLowerCase())) throw new Error("Spot qualification journal mismatch");
    const save = async () => { await writeFile(`${path}.tmp`, JSON.stringify(journal, null, 2)); await rename(`${path}.tmp`, path); };
    const delta = (receipt: TransactionReceipt, token: Address) => receipt.logs.reduce((total, log) => {
      if (log.address.toLowerCase() !== token.toLowerCase()) return total;
      try {
        const { args } = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics, data: log.data });
        return total + (args.to.toLowerCase() === account.address.toLowerCase() ? args.value : 0n) - (args.from.toLowerCase() === account.address.toLowerCase() ? args.value : 0n);
      } catch { return total; }
    }, 0n);
    const reconcile = async (entry: Entry) => {
      const receipt = await client.waitForTransactionReceipt({ hash: entry.hash, confirmations: 2, timeout: 90_000 });
      if (receipt.from.toLowerCase() !== account.address.toLowerCase() || receipt.to?.toLowerCase() !== entry.to.toLowerCase()) throw new Error("Spot qualification receipt identity mismatch");
      entry.status = receipt.status; entry.gasUSDC = formatEther(receipt.gasUsed * receipt.effectiveGasPrice);
      if (entry.outputToken && entry.inputToken) {
        const received = delta(receipt, entry.outputToken);
        entry.outputAmount = received.toString();
        await save();
        if (received < BigInt(entry.minimumOutput!) || delta(receipt, entry.inputToken) !== -BigInt(entry.inputAmount!)) throw new Error("Spot qualification token-transfer verification failed");
      }
      await save();
      if (receipt.status !== "success") throw new Error("Spot qualification transaction reverted; do not repeat automatically");
      console.log(JSON.stringify({ step: entry.step, hash: entry.hash, status: entry.status, gasUSDC: entry.gasUSDC }));
    };
    for (const entry of journal.entries) await reconcile(entry);
    if (journal.completed) { console.log("Spot qualification already complete; no transactions repeated."); return; }
    await verifyArcToken(token);
    let expectedNextNonce = journal.entries.length
      ? journal.entries.at(-1)!.nonce + 1
      : await client.getTransactionCount({ address: account.address, blockTag: "latest" });
    if (pair === "BTC-USDT" && process.argv.includes("--broadcast")) {
      const budget = JSON.parse(await readFile(".tmp/arc-mainnet-current-budget.json", "utf8"));
      const auditAge = Date.now() - Date.parse(budget.auditedAt);
      const reserved = journal.entries.reduce((sum, entry) => sum + parseEther(entry.maxGasUSDC), 0n);
      const spentInput = journal.entries.some(entry => entry.step === "buy") ? 0n : parseEther("0.1");
      if (budget.chainId !== 5042 || budget.owner.toLowerCase() !== account.address.toLowerCase()
        || budget.receiptAccountingComplete !== true || budget.maximumTotalSpendUSDC !== "5"
        || !Number.isSafeInteger(budget.latestNonce) || budget.latestNonce < 0
        || !Number.isFinite(auditAge) || auditAge < 0 || auditAge > 3600_000
        || parseEther(budget.remainingAuthorizedSpendUSDC) < spentInput + parseEther("0.15") - reserved
        || await client.getTransactionCount({address:account.address,blockTag:"latest"}) !== budget.latestNonce)
        throw new Error("Spot qualification requires fresh reconciled 5 USDC spending evidence");
      if (!journal.entries.length) expectedNextNonce = budget.latestNonce;
    }
    const balance = async (token: Address) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
    const send = async (step: string, to: Address, data: Hex, details: Partial<Entry> = {}, expiresAt?: number) => {
      if (journal.entries.some(entry => entry.step === step)) return;
      const tx = { account, to, data, value: 0n };
      await client.call(tx);
      const gas = (await client.estimateGas(tx)) * 125n / 100n, fees = await client.estimateFeesPerGas();
      const cost = gas * fees.maxFeePerGas;
      const total = journal.entries.reduce((sum, entry) => sum + parseEther(entry.maxGasUSDC), 0n);
      if (cost > parseEther("0.05") || total + cost > parseEther("0.15")) throw new Error("Spot qualification gas budget exceeded");
      if (await client.getBalance({ address: account.address }) < cost + (details.inputToken?.toLowerCase() === usdc.toLowerCase() ? BigInt(details.inputAmount || "0") * 1_000_000_000_000n : 0n) + parseEther("0.05")) throw new Error("Spot qualification gas reserve would be consumed");
      const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
      if (nonce !== await client.getTransactionCount({ address: account.address, blockTag: "latest" })) throw new Error("Spot qualification wallet has pending transactions");
      if (nonce !== expectedNextNonce) throw new Error("Spot qualification wallet changed between test steps; reconcile spending before continuing");
      if (expiresAt && Date.now() + 3000 >= expiresAt) throw new Error("Spot qualification quote expired before signing");
      const signed = await wallet.signTransaction({ ...tx, chain, nonce, gas, ...fees, type: "eip1559" });
      const entry: Entry = { ...details, step, to, nonce, hash: keccak256(signed), status: "pending", maxGasUSDC: formatEther(cost) };
      journal.entries.push(entry); await save();
      if (await client.sendRawTransaction({ serializedTransaction: signed }) !== entry.hash) throw new Error("Spot qualification broadcast hash mismatch");
      await reconcile(entry);
      expectedNextNonce = nonce + 1;
    };
    const prepare = async (from: Address, to: Address, amount: bigint) => {
      await arcOkxMarketContext({ instId: pair, timeframe: "1H", candleLimit: 60 });
      const swap = await getGenericOkxSwap(cfg, { chainId: "5042", fromTokenAddress: from.toLowerCase(), toTokenAddress: to.toLowerCase(), amount: amount.toString(), userWalletAddress: account.address, slippagePercent: "0.5" });
      const checked = await validateArcSwap(swap, { from, to, amount: amount.toString(), receiver: account.address, slippageBps: 50 });
      if (!Number.isFinite(Number(swap.quote!.priceImpactPercent)) || Math.abs(Number(swap.quote!.priceImpactPercent)) > 1) throw new Error("Spot qualification price impact exceeds 1%");
      return { swap, checked };
    };
    if (!process.argv.includes("--broadcast")) {
      const { swap } = await prepare(usdc, weth, input);
      console.log(JSON.stringify({ mode: "read-only", pair, targetSymbol: token.symbol, inputUSDC: "0.1", expectedTarget: formatUnits(BigInt(swap.quote!.toTokenAmount), token.decimals), USDC: formatUnits(await balance(usdc), 6) }));
      return;
    }
    for (const step of ["buy", "sell"] as const) {
      if (journal.entries.some(entry => entry.step === step)) continue;
      const amount = step === "buy" ? input : BigInt(journal.entries.find(entry => entry.step === "buy")!.outputAmount!);
      const from = step === "buy" ? usdc : weth, to = step === "buy" ? weth : usdc;
      if (amount <= 0n || await balance(from) < amount) throw new Error("Spot qualification insufficient token balance");
      await prepare(from, to, amount); // route validation before granting approval
      const allowance = await client.readContract({ address: from, abi: erc20Abi, functionName: "allowance", args: [account.address, spender] });
      if (allowance !== amount) await send(`${step}-approve`, from, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }));
      const { swap, checked } = await prepare(from, to, amount);
      if (step === "sell" && checked.minimum < input * 95n / 100n) throw new Error("Spot qualification round-trip loss would exceed 5%; position retained for review");
      await send(step, swap.tx.to as Address, swap.tx.data as Hex, { inputToken: from, outputToken: to, inputAmount: amount.toString(), minimumOutput: checked.minimum.toString() }, checked.expiresAt);
    }
    for (const [name, tokenAddress] of [["USDC", usdc], [token.symbol, weth]] as const) {
      const allowance = await client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "allowance", args: [account.address, spender] });
      if (allowance > 0n) await send(`revoke-${name}`, tokenAddress, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, 0n] }));
    }
    journal.completed = true; await save();
    console.log(JSON.stringify({ completed: true, pair, targetSymbol: token.symbol, inputUSDC: "0.1", returnedUSDC: formatUnits(BigInt(journal.entries.find(entry => entry.step === "sell")!.outputAmount!), 6), existingHoldingsSold: false }));
  } finally { await lock.close(); await unlink(`${path}.lock`); }
}
main().catch(error => { console.error(error instanceof Error && error.message.startsWith("Spot qualification ") ? error.message : "Spot qualification stopped. Inspect the public transaction journal before retrying; no automatic duplicate spending."); process.exitCode = 1; });
