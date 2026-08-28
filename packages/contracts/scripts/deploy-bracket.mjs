import { config as loadEnv } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, encodeDeployData, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

loadEnv({ path: resolve(import.meta.dirname, "../../../.env"), override: false });
const network = process.argv[2];
const configurations = {
  xlayer: { chainId: 196, rpc: process.env.X_LAYER_RPC },
  base: { chainId: 8453, rpc: process.env.BASE_RPC_URL },
  arbitrum: { chainId: 42161, rpc: process.env.ARBITRUM_RPC_URL },
};
const selected = configurations[network];
if (!selected?.rpc) throw new Error("Usage: node scripts/deploy-bracket.mjs <xlayer|base|arbitrum>");
const rawKey = process.env.CONTRACT_DEPLOYER_PRIVATE_KEY || process.env.TEST_WALLET_PRIVATE_KEY;
if (!/^0x[a-fA-F0-9]{64}$/.test(rawKey || "")) throw new Error("Deployer key is missing");
const account = privateKeyToAccount(rawKey);
if (process.env.TEST_WALLET_ADDRESS && account.address.toLowerCase() !== process.env.TEST_WALLET_ADDRESS.toLowerCase()) throw new Error("Deployer key/address mismatch");
const chain = { id: selected.chainId, name: network, nativeCurrency: { name: "Native", symbol: network === "xlayer" ? "OKB" : "ETH", decimals: 18 }, rpcUrls: { default: { http: [selected.rpc] } } };
const publicClient = createPublicClient({ chain, transport: http(selected.rpc, { retryCount: 5, retryDelay: 800 }) });
const walletClient = createWalletClient({ account, chain, transport: http(selected.rpc, { retryCount: 5, retryDelay: 800 }) });
const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "deployments", `${selected.chainId}.json`);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const artifact = JSON.parse(await readFile(resolve(root, "artifacts", "SpotBracketAccountFactoryV1.json"), "utf8"));
const args = [manifest.contracts.registry.address, manifest.contracts.oracleRouter.address];
const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });
async function estimateDeploymentGas() {
  try { return await publicClient.estimateGas({ account, data }); }
  catch {
    const response = await fetch(selected.rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_estimateGas", params: [{ from: account.address, data }] }) });
    const body = await response.json();
    if (!body.result) throw new Error(`Raw deployment gas estimate failed: ${body.error?.message || response.status}`);
    return BigInt(body.result);
  }
}
const [gas, gasPrice, balance] = await Promise.all([estimateDeploymentGas(), publicClient.getGasPrice(), publicClient.getBalance({ address: account.address })]);
const required = gas * gasPrice * 13n / 10n;
console.log(`Bracket preflight ${network}: balance=${balance} requiredWith30PercentBuffer=${required}`);
if (balance < required) throw new Error(`${network} deployer balance is insufficient`);
if (process.argv.includes("--preflight")) process.exit(0);
const txHash = await walletClient.deployContract({ account, abi: artifact.abi, bytecode: artifact.bytecode, args });
console.log(`SpotBracketAccountFactoryV1 tx ${txHash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: network === "arbitrum" ? 20 : 5, timeout: 300000 });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Bracket factory deployment failed");
manifest.contracts.spotBracketFactory = { address: receipt.contractAddress, txHash, blockNumber: String(receipt.blockNumber) };
manifest.bracket = { model: "OTOCO", phases: ["pending entry", "protected TP/SL", "executed or owner-cancelled"], ownerRecovery: true, keeperMayNotChangePolicy: true };
manifest.release = "pulse-v6.2.0";
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`SpotBracketAccountFactoryV1 ${receipt.contractAddress}`);
