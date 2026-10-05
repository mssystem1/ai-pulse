/** Arc-only configuration. Default read-only; explicit --broadcast and
 * bounded gas budget required. Public hash journal is persisted before send. */
import { config } from "dotenv";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, http, keccak256, parseAbi, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { executionContractAddress, executionContracts } from "../apps/api/src/executionContracts.js";

async function main() {
  config({ quiet: true });
  const url = process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io";
  const chain = { id: 5042, name: "Arc Mainnet", nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [url] } } };
  const client = createPublicClient({ chain, transport: http(url, { timeout: 15_000, retryCount: 0 }) });
  const key = process.env.CONTRACT_DEPLOYER_PRIVATE_KEY || process.env.TEST_WALLET_PRIVATE_KEY;
  const executorKey = process.env.ARC_AUTOMATION_EXECUTOR_PRIVATE_KEY || process.env.AUTOMATION_EXECUTOR_PRIVATE_KEY || process.env.TEST_WALLET_PRIVATE_KEY;
  if (!/^0x[\da-f]{64}$/i.test(key || "") || !/^0x[\da-f]{64}$/i.test(executorKey || "")) throw new Error("Required local signer is missing");
  const account = privateKeyToAccount(key as Hex);
  const executor = privateKeyToAccount(executorKey as Hex).address;
  const contracts = executionContracts("arc");
  const router = executionContractAddress("arc", "okxRouter");
  const spender = executionContractAddress("arc", "okxApproval");
  if (await client.getChainId() !== 5042) throw new Error("Wrong chain");
  const adminAbi = parseAbi(["function admin() view returns(address)"]);
  for (const address of [contracts.registry, contracts.oracleRouter, contracts.executionAdapter]) {
    if ((await client.readContract({ address, abi: adminAbi, functionName: "admin" })).toLowerCase() !== account.address.toLowerCase()) throw new Error("Deployer is not contract admin");
  }
  for (const address of [router, spender]) {
    const code = await client.getCode({ address });
    if (!code || code === "0x") throw new Error("Route contract missing");
  }
  const abi = parseAbi([
    "function approvedRouters(address) view returns(bool)", "function approvedSpenders(address) view returns(bool)",
    "function spotKeepers(address) view returns(bool)", "function autopilotExecutors(address) view returns(bool)",
    "function updaters(address) view returns(bool)", "function approvedAdapters(address) view returns(bool)",
    "function setRouter(address,bool)", "function setSpender(address,bool)", "function setSpotKeeper(address,bool)",
    "function setAutopilotExecutor(address,bool)", "function setUpdater(address,bool)", "function setAdapter(address,bool)",
  ]);
  const changes = [
    { address: contracts.executionAdapter, read: "approvedRouters", write: "setRouter", role: router },
    { address: contracts.executionAdapter, read: "approvedSpenders", write: "setSpender", role: spender },
    { address: contracts.registry, read: "spotKeepers", write: "setSpotKeeper", role: executor },
    { address: contracts.registry, read: "autopilotExecutors", write: "setAutopilotExecutor", role: executor },
    { address: contracts.oracleRouter, read: "updaters", write: "setUpdater", role: executor },
    { address: contracts.registry, read: "approvedAdapters", write: "setAdapter", role: contracts.executionAdapter },
  ] as const;
  const broadcast = process.argv.includes("--broadcast");
  const budget = parseEther(process.argv.find(arg => arg.startsWith("--max-gas-usdc="))?.split("=")[1] || "0");
  if (broadcast && (budget <= 0n || budget > parseEther("1"))) throw new Error("Explicit configuration gas budget up to 1 USDC required");
  const path = "packages/contracts/deployments/5042-execution-configuration.json";
  type Entry = { functionName: string; address: Address; role: Address; hash: Hex; nonce: number; status: string; gasUSDC?: string; maxGasUSDC: string };
  let journal: { chainId: number; transactions: Entry[] };
  try { journal = JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; journal = { chainId: 5042, transactions: [] }; }
  if (journal.chainId !== 5042) throw new Error("Wrong journal network");
  const save = async () => { await mkdir("packages/contracts/deployments", { recursive: true }); await writeFile(`${path}.tmp`, JSON.stringify(journal, null, 2)); await rename(`${path}.tmp`, path); };
  let spent = journal.transactions.reduce((sum, item) => sum + parseEther(item.maxGasUSDC), 0n);
  for (const entry of journal.transactions.filter(item => item.status === "pending")) {
    const receipt = await client.getTransactionReceipt({ hash: entry.hash });
    entry.status = receipt.status; entry.gasUSDC = formatEther(receipt.gasUsed * receipt.effectiveGasPrice);
    await save();
    if (receipt.status !== "success") throw new Error("Previous configuration reverted; inspect before proceeding");
  }
  const wallet = createWalletClient({ account, chain, transport: http(url, { retryCount: 0 }) });
  for (const change of changes) {
    const ready = await client.readContract({ address: change.address, abi, functionName: change.read, args: [change.role] });
    console.log(JSON.stringify({ functionName: change.write, role: change.role, configured: ready, broadcast }));
    if (ready || !broadcast) continue;
    const data = encodeFunctionData({ abi, functionName: change.write, args: [change.role, true] });
    await client.call({ account, to: change.address, data });
    const gas = (await client.estimateGas({ account, to: change.address, data })) * 125n / 100n;
    const fees = await client.estimateFeesPerGas();
    const maxCost = gas * fees.maxFeePerGas;
    if (spent + maxCost > budget || maxCost > parseEther("0.05")) throw new Error("Configuration gas budget exceeded");
    const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
    if (nonce !== await client.getTransactionCount({ address: account.address, blockTag: "latest" })) throw new Error("Wait for pending wallet transaction");
    if (await client.getBalance({ address: account.address }) < maxCost + parseEther("0.01")) throw new Error("Insufficient configuration gas reserve");
    const signed = await wallet.signTransaction({ account, chain, type: "eip1559", nonce, to: change.address, data, value: 0n, gas, ...fees });
    const hash = keccak256(signed);
    const entry: Entry = { functionName: change.write, address: change.address, role: change.role, hash, nonce, status: "pending", maxGasUSDC: formatEther(maxCost) };
    journal.transactions.push(entry); await save(); spent += maxCost;
    if (await client.sendRawTransaction({ serializedTransaction: signed }) !== hash) throw new Error("Broadcast hash mismatch");
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
    entry.status = receipt.status; entry.gasUSDC = formatEther(receipt.gasUsed * receipt.effectiveGasPrice); await save();
    console.log(JSON.stringify({ functionName: change.write, hash, status: receipt.status, gasUSDC: entry.gasUSDC }));
    if (receipt.status !== "success") throw new Error("Configuration transaction reverted");
  }
  console.log("Configuration checked. This script does not unpause registry automation or move user capital.");
}
main().catch(error => { console.error(error instanceof Error && /^(Required|Wrong|Deployer|Route|Explicit|Previous|Configuration|Wait|Insufficient|Broadcast)/.test(error.message) ? error.message : "Configuration check stopped; inspect the public hash journal before any retry."); process.exitCode = 1; });
