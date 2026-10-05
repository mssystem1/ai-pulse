// Fresh mainnet deployment only. Durable hash journal precedes every broadcast.
// On interruption, reconcile the recorded hash/nonce: never blindly re-deploy.
import { readFile, writeFile, rename, open } from "node:fs/promises";
import { resolve } from "node:path";
import { createWalletClient, encodeFunctionData, formatEther, http, keccak256, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildArcDeploymentPlan, publicPlan, root } from "./arc-deployment-plan.mjs";

async function main() {
  const plan = await buildArcDeploymentPlan();
  console.log(JSON.stringify(publicPlan(plan), null, 2));
  if (!process.argv.includes("--broadcast")) return;
  const capText = process.argv.find((arg) => arg.startsWith("--max-spend-usdc="))?.split("=")[1];
  if (!capText || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(capText) || parseEther(capText) <= 0n) throw new Error("Explicit positive --max-spend-usdc budget is required");
  const cap = parseEther(capText);
  if (plan.required > cap || plan.required > plan.balance) throw new Error("Deployment exceeds budget or funded balance");
  const key = process.env.CONTRACT_DEPLOYER_PRIVATE_KEY || process.env.TEST_WALLET_PRIVATE_KEY;
  if (!/^0x[a-fA-F0-9]{64}$/.test(key || "")) throw new Error("Deployer key missing");
  const account = privateKeyToAccount(key);
  if (account.address.toLowerCase() !== plan.address.toLowerCase()) throw new Error("Signer does not match existing deployment arrangement");
  const wallet = createWalletClient({ account, chain: plan.chain, transport: http(plan.url, { retryCount: 0, timeout: 30_000 }) });
  const path = resolve(root, "deployments/5042.json");
  const initial = await open(path, "wx"); // Refuse an existing or interrupted deployment.
  const manifest = {
    release: "pulse-v6.2.0", network: "arc", chainId: 5042,
    deployer: account.address, guardian: plan.baseline.guardian, oracleUpdater: plan.baseline.oracleUpdater,
    deployedAt: new Date().toISOString(), status: "deploying", contracts: {}, transactions: [],
    configurationTransactions: {}, productionReady: false, tradingEnabled: false,
    budgetUSDC: capText, feeCeilingUSDC: formatEther(plan.required),
    compilerVersion: (await readFile(resolve(root, "artifacts/compiler-version.txt"), "utf8")).trim(),
    standardInput: JSON.parse(await readFile(resolve(root, "artifacts/standard-input.json"), "utf8")),
  };
  const serialize = () => JSON.stringify(manifest, null, 2);
  await initial.writeFile(serialize()); await initial.sync(); await initial.close();
  async function save() {
    const staged = `${path}.tmp`;
    await writeFile(staged, serialize());
    await rename(staged, path);
  }
  let nonce = plan.nonce, reserved = 0n;
  async function send(label, data, gas, to) {
    if (await plan.client.getChainId() !== 5042) throw new Error("RPC chain changed");
    if (await plan.client.getTransactionCount({ address: account.address, blockTag: "pending" }) !== nonce) throw new Error("Deployer nonce changed; refusing replacement");
    reserved += gas * plan.fees.maxFeePerGas;
    if (reserved > cap) throw new Error("Transaction would exceed deployment budget");
    if (await plan.client.getBalance({ address: account.address }) < gas * plan.fees.maxFeePerGas) throw new Error("Insufficient gas balance");
    const serialized = await wallet.signTransaction({ account, chain: plan.chain, type: "eip1559", chainId: 5042,
      nonce, gas, data, ...(to ? { to } : {}), value: 0n, ...plan.fees });
    const hash = keccak256(serialized);
    const entry = { label, hash, nonce, dataHash: keccak256(data), status: "signed_not_confirmed", to: to || null,
      gasLimit: String(gas), maxFeePerGas: String(plan.fees.maxFeePerGas), maxPriorityFeePerGas: String(plan.fees.maxPriorityFeePerGas) };
    manifest.transactions.push(entry); await save();
    const broadcast = await plan.client.sendRawTransaction({ serializedTransaction: serialized });
    if (broadcast.toLowerCase() !== hash.toLowerCase()) throw new Error("Broadcast hash mismatch");
    console.log(`${label} tx ${hash}`);
    const receipt = await plan.client.waitForTransactionReceipt({ hash, confirmations: 5, timeout: 180_000, pollingInterval: 1500 });
    entry.status = receipt.status; entry.blockNumber = String(receipt.blockNumber);
    entry.feeUSDC = formatEther(receipt.gasUsed * receipt.effectiveGasPrice);
    await save();
    if (receipt.status !== "success") throw new Error("Transaction reverted; deployment halted");
    nonce++;
    return receipt;
  }
  for (const contract of plan.contracts) {
    const receipt = await send(contract.name, contract.data, contract.gasLimit);
    if (receipt.contractAddress?.toLowerCase() !== contract.address.toLowerCase()) throw new Error("Unexpected deployed address");
    const code = await plan.client.getCode({ address: receipt.contractAddress });
    if (!code || code === "0x") throw new Error("Deployed bytecode absent");
    manifest.contracts[contract.key] = { address: receipt.contractAddress, txHash: receipt.transactionHash,
      blockNumber: String(receipt.blockNumber), contractName: contract.name, constructorArguments: contract.args,
      creationDataHash: contract.dataHash, runtimeCodeHash: keccak256(code) };
    await save();
    console.log(`${contract.name} deployed ${receipt.contractAddress}`);
  }
  const registry = plan.contracts.find((c) => c.key === "registry");
  for (const [functionName, args] of [["pauseAutomation", [true]], ["setAdapter", [manifest.contracts.executionAdapter.address, true]]]) {
    await plan.client.simulateContract({ address: registry.address, account, abi: registry.artifact.abi, functionName, args });
    const data = encodeFunctionData({ abi: registry.artifact.abi, functionName, args });
    const gas = (await plan.client.estimateGas({ account, to: registry.address, data })) * 125n / 100n;
    const receipt = await send(functionName, data, gas, registry.address);
    manifest.configurationTransactions[functionName] = receipt.transactionHash; await save();
  }
  for (const contract of plan.contracts) {
    const checks = contract.key === "registry" ? [["admin", account.address], ["guardian", manifest.guardian], ["automationPaused", true]]
      : contract.key === "oracleRouter" || contract.key === "executionAdapter" ? [["admin", account.address]]
      : [["registry", manifest.contracts.registry.address], ["oracle", manifest.contracts.oracleRouter.address]];
    for (const [functionName, expected] of checks) {
      const actual = await plan.client.readContract({ address: contract.address, abi: contract.artifact.abi, functionName });
      if (String(actual).toLowerCase() !== String(expected).toLowerCase()) throw new Error("Deployed role/reference verification failed");
    }
  }
  manifest.status = "deployed_paused_verification_pending";
  manifest.completedAt = new Date().toISOString();
  manifest.remainingUSDC = formatEther(await plan.client.getBalance({ address: account.address }));
  await save();
  console.log(JSON.stringify({ status: manifest.status, remainingUSDC: manifest.remainingUSDC, productionReady: false }));
}
main().catch((error) => {
  // Never print signing errors, transaction objects, RPC credentials or private keys.
  console.error("Arc deployment stopped:", error.name === "Error" ? error.message : error.name);
  process.exitCode = 1;
});
