// Read-only by default. Builds an exact mainnet deployment plan, never signs.
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, encodeDeployData, formatEther, getContractAddress, http, keccak256 } from "viem";
config({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true });

export const root = resolve(import.meta.dirname, "..");
export const deploymentContracts = [
  ["registry", "PulseRegistryV1"], ["oracleRouter", "OracleRouterV1"],
  ["executionAdapter", "OkxSwapAdapterV2"], ["spotFactory", "SpotOrderAccountFactoryV2"],
  ["autopilotFactory", "AutopilotVaultFactoryV2"], ["spotBracketFactory", "SpotBracketAccountFactoryV1"],
  ["spotProtectionFactory", "SpotOrderAccountFactoryV1"],
];
export async function buildArcDeploymentPlan() {
  const baseline = JSON.parse(await readFile(resolve(root, "deployments/42161.json"), "utf8"));
  const address = baseline.deployer;
  if (process.env.TEST_WALLET_ADDRESS?.toLowerCase() !== address.toLowerCase()) throw new Error("Test wallet does not match the existing deployer");
  for (const [key, expected] of [["CONTRACT_GUARDIAN_ADDRESS", baseline.guardian], ["ORACLE_UPDATER_ADDRESS", baseline.oracleUpdater]]) {
    if (process.env[key] && process.env[key].toLowerCase() !== expected.toLowerCase()) throw new Error(`Existing manifest and ${key} disagree`);
  }
  const url = process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io";
  const chain = { id: 5042, name: "Arc Mainnet", nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [url] } } };
  const client = createPublicClient({ chain, transport: http(url, { timeout: 20_000, retryCount: 1 }) });
  if (await client.getChainId() !== 5042) throw new Error("Wrong chain: mainnet 5042 is required");
  const [nonce, latestNonce, balance, fees] = await Promise.all([
    client.getTransactionCount({ address, blockTag: "pending" }), client.getTransactionCount({ address, blockTag: "latest" }),
    client.getBalance({ address }), client.estimateFeesPerGas(),
  ]);
  if (nonce !== latestNonce) throw new Error("Deployer has pending transactions; wait before planning");
  const predicted = Object.fromEntries(deploymentContracts.map(([key], i) => [key, getContractAddress({ from: address, nonce: BigInt(nonce + i) })]));
  const contracts = [];
  for (const [key, name] of deploymentContracts) {
    const artifact = JSON.parse(await readFile(resolve(root, "artifacts", `${name}.json`), "utf8"));
    const args = key === "registry" ? [baseline.guardian] : key === "oracleRouter" ? [baseline.oracleUpdater]
      : key === "executionAdapter" ? [address] : [predicted.registry, predicted.oracleRouter];
    const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });
    const estimatedGas = await client.estimateGas({ account: address, data });
    const gasLimit = estimatedGas * 125n / 100n;
    contracts.push({ key, name, artifact, args, data, dataHash: keccak256(data), nonce: nonce + contracts.length,
      address: predicted[key], estimatedGas, gasLimit });
  }
  // Reserve room for initial pause/configuration transactions; no swaps/approvals.
  const gasPriceCap = fees.maxFeePerGas;
  const deploymentCeiling = contracts.reduce((total, item) => total + item.gasLimit * gasPriceCap, 0n);
  const configurationReserve = 300_000n * gasPriceCap;
  return { client, chain, url, baseline, address, nonce, balance, fees, contracts, deploymentCeiling, configurationReserve,
    required: deploymentCeiling + configurationReserve };
}

export function publicPlan(plan) {
  return { chainId: 5042, deployer: plan.address, guardian: plan.baseline.guardian, oracleUpdater: plan.baseline.oracleUpdater,
    balanceUSDC: formatEther(plan.balance), deploymentFeeCeilingUSDC: formatEther(plan.deploymentCeiling),
    configurationReserveUSDC: formatEther(plan.configurationReserve), requiredUSDC: formatEther(plan.required),
    enoughGas: plan.balance >= plan.required, contracts: plan.contracts.map(({ key, name, address, estimatedGas, gasLimit, nonce, dataHash, args }) =>
      ({ key, name, predictedAddress: address, estimatedGas: String(estimatedGas), gasLimit: String(gasLimit), nonce, dataHash, constructorArguments: args })) };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try { console.log(JSON.stringify(publicPlan(await buildArcDeploymentPlan()), null, 2)); }
  catch (error) { console.error("Arc preflight failed:", error.shortMessage || error.message?.split("\n")[0] || error.name); process.exitCode = 1; }
}
