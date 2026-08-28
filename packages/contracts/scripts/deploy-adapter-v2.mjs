import { config as loadEnv } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, encodeDeployData, fallback, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

loadEnv({ path: resolve(import.meta.dirname, "../../../.env"), override: false });
const networkName = process.argv[2];
const networks = {
  xlayer: { id: 196, primary: process.env.X_LAYER_RPC, secondary: process.env.X_LAYER_RPC_FALLBACK, router: process.env.XLAYER_OKX_ROUTER_ADDRESS, spender: process.env.XLAYER_OKX_APPROVAL_ADDRESS },
  base: { id: 8453, primary: process.env.BASE_RPC_URL, secondary: process.env.BASE_RPC_FALLBACK_URL, router: process.env.BASE_OKX_ROUTER_ADDRESS, spender: process.env.BASE_OKX_APPROVAL_ADDRESS },
  arbitrum: { id: 42161, primary: process.env.ARBITRUM_RPC_URL, secondary: process.env.ARBITRUM_RPC_FALLBACK_URL, router: process.env.ARBITRUM_OKX_ROUTER_ADDRESS, spender: process.env.ARBITRUM_OKX_APPROVAL_ADDRESS },
};
const network = networks[networkName];
if (!network) throw new Error("Usage: node scripts/deploy-adapter-v2.mjs <xlayer|base|arbitrum>");
for (const [label, value] of [["router", network.router], ["spender", network.spender]])
  if (!/^0x[a-fA-F0-9]{40}$/.test(value || "")) throw new Error(`${networkName} ${label} missing`);
const privateKey = process.env.CONTRACT_DEPLOYER_PRIVATE_KEY || process.env.TEST_WALLET_PRIVATE_KEY;
if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey || "")) throw new Error("Deployer key missing");
const signer = privateKeyToAccount(privateKey);
if (process.env.TEST_WALLET_ADDRESS && signer.address.toLowerCase() !== process.env.TEST_WALLET_ADDRESS.toLowerCase()) throw new Error("Deployer key/address mismatch");

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "deployments", `${network.id}.json`);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const adapterArtifact = JSON.parse(await readFile(resolve(root, "artifacts/OkxSwapAdapterV2.json"), "utf8"));
const registryArtifact = JSON.parse(await readFile(resolve(root, "artifacts/PulseRegistryV1.json"), "utf8"));
const urls = [...new Set([network.primary, network.secondary].filter(Boolean))];
const chain = { id: network.id, name: networkName, nativeCurrency: { name: "Native", symbol: networkName === "xlayer" ? "OKB" : "ETH", decimals: 18 }, rpcUrls: { default: { http: urls } } };
const transport = fallback(urls.map((url) => http(url, { retryCount: 2, retryDelay: 700 })), { retryCount: 1 });
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ account: signer, chain, transport });
const deployData = encodeDeployData({ abi: adapterArtifact.abi, bytecode: adapterArtifact.bytecode, args: [signer.address] });
const [gas, gasPrice, balance] = await Promise.all([
  publicClient.estimateGas({ account: signer, data: deployData }),
  publicClient.getGasPrice(),
  publicClient.getBalance({ address: signer.address }),
]);
const required = gas * gasPrice * 14n / 10n;
console.log(`${networkName}: adapter V2 preflight balance=${balance} required=${required}`);
if (balance < required) throw new Error(`${networkName} deployer gas is insufficient`);
if (process.argv.includes("--preflight")) process.exit(0);

const deploymentHash = await walletClient.deployContract({ account: signer, abi: adapterArtifact.abi, bytecode: adapterArtifact.bytecode, args: [signer.address] });
console.log(`${networkName}: deployment tx=${deploymentHash}`);
const deploymentReceipt = await publicClient.waitForTransactionReceipt({ hash: deploymentHash, confirmations: 1, timeout: 300_000 });
if (deploymentReceipt.status !== "success" || !deploymentReceipt.contractAddress) throw new Error(`${networkName} adapter deployment failed`);
const adapter = deploymentReceipt.contractAddress;

async function configure(address, abi, functionName, args) {
  const hash = await walletClient.writeContract({ account: signer, address, abi, functionName, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${networkName} ${functionName} failed`);
  console.log(`${networkName}: ${functionName} tx=${hash}`);
  return hash;
}
const allowAdapterTx = await configure(manifest.contracts.registry.address, registryArtifact.abi, "setAdapter", [adapter, true]);
const routerTx = await configure(adapter, adapterArtifact.abi, "setRouter", [network.router, true]);
const spenderTx = await configure(adapter, adapterArtifact.abi, "setSpender", [network.spender, true]);
const [adapterApproved, routerApproved, spenderApproved] = await Promise.all([
  publicClient.readContract({ address: manifest.contracts.registry.address, abi: registryArtifact.abi, functionName: "approvedAdapters", args: [adapter] }),
  publicClient.readContract({ address: adapter, abi: adapterArtifact.abi, functionName: "approvedRouters", args: [network.router] }),
  publicClient.readContract({ address: adapter, abi: adapterArtifact.abi, functionName: "approvedSpenders", args: [network.spender] }),
]);
if (!adapterApproved || !routerApproved || !spenderApproved) throw new Error(`${networkName} adapter V2 configuration verification failed`);
if (manifest.contracts.executionAdapter.address.toLowerCase() !== adapter.toLowerCase()) {
  manifest.previousExecutionAdapters = [...(manifest.previousExecutionAdapters || []), manifest.contracts.executionAdapter];
}
manifest.contracts.executionAdapter = { address: adapter, txHash: deploymentHash, blockNumber: String(deploymentReceipt.blockNumber), version: "v2" };
manifest.executionAdapterV2 = { deployedAt: new Date().toISOString(), router: network.router, spender: network.spender, allowAdapterTx, routerTx, spenderTx, verifiedOnchain: true };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`${networkName}: OkxSwapAdapterV2=${adapter} router=${network.router} spender=${network.spender}`);
