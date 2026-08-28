import { config as loadEnv } from "dotenv";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

loadEnv({ path: resolve(import.meta.dirname, "../../../.env"), override: false });

const network = process.argv[2];
const configs = {
  xlayer: { chainId: 196, rpc: process.env.X_LAYER_RPC, prefix: "XLAYER" },
  base: { chainId: 8453, rpc: process.env.BASE_RPC_URL, prefix: "BASE" },
  arbitrum: { chainId: 42161, rpc: process.env.ARBITRUM_RPC_URL, prefix: "ARBITRUM" },
};
const selected = configs[network];
if (!selected) throw new Error("Usage: node scripts/deploy.mjs <xlayer|base|arbitrum>");
if (!selected.rpc) throw new Error(`RPC is not configured for ${network}`);
const rawKey = process.env.CONTRACT_DEPLOYER_PRIVATE_KEY || process.env.TEST_WALLET_PRIVATE_KEY;
if (!/^0x[a-fA-F0-9]{64}$/.test(rawKey || "")) throw new Error("CONTRACT_DEPLOYER_PRIVATE_KEY (or TEST_WALLET_PRIVATE_KEY) must be a 0x-prefixed private key");
const account = privateKeyToAccount(rawKey);
if (process.env.TEST_WALLET_ADDRESS && account.address.toLowerCase() !== process.env.TEST_WALLET_ADDRESS.toLowerCase()) throw new Error("Deployer key does not match TEST_WALLET_ADDRESS");
const chain = { id: selected.chainId, name: network, nativeCurrency: { name: "Native", symbol: network === "xlayer" ? "OKB" : "ETH", decimals: 18 }, rpcUrls: { default: { http: [selected.rpc] } } };
const publicClient = createPublicClient({ chain, transport: http(selected.rpc) });
const walletClient = createWalletClient({ account, chain, transport: http(selected.rpc) });
const artifactDir = resolve(import.meta.dirname, "../artifacts");
async function artifact(name){return JSON.parse(await readFile(resolve(artifactDir,`${name}.json`),"utf8"));}
async function deploy(name,args){const a=await artifact(name);const hash=await walletClient.deployContract({account,abi:a.abi,bytecode:a.bytecode,args});console.log(`${name} tx ${hash}`);const receipt=await publicClient.waitForTransactionReceipt({hash,confirmations:network==="arbitrum"?20:5});if(receipt.status!=="success"||!receipt.contractAddress)throw new Error(`${name} deployment failed`);console.log(`${name} ${receipt.contractAddress}`);return {address:receipt.contractAddress,txHash:hash,blockNumber:String(receipt.blockNumber)};}
const guardian = process.env.CONTRACT_GUARDIAN_ADDRESS || account.address;
const updater = process.env.ORACLE_UPDATER_ADDRESS || account.address;
const registry=await deploy("PulseRegistryV1",[guardian]);
const oracle=await deploy("OracleRouterV1",[updater]);
const adapter=await deploy("OkxSwapAdapterV1",[account.address]);
const spot=await deploy("SpotOrderAccountFactoryV1",[registry.address,oracle.address]);
const autopilot=await deploy("AutopilotVaultFactoryV1",[registry.address]);
const registryArtifact=await artifact("PulseRegistryV1");
const allowHash=await walletClient.writeContract({account,address:registry.address,abi:registryArtifact.abi,functionName:"setAdapter",args:[adapter.address,true]});
await publicClient.waitForTransactionReceipt({hash:allowHash,confirmations:network==="arbitrum"?20:5});
const manifest={release:"pulse-v6.0.0",network,chainId:selected.chainId,deployer:account.address,guardian,oracleUpdater:updater,deployedAt:new Date().toISOString(),contracts:{registry,oracleRouter:oracle,executionAdapter:adapter,spotFactory:spot,autopilotFactory:autopilot},configurationTransactions:{allowAdapter:allowHash}};
const deploymentDir=resolve(import.meta.dirname,"../deployments");
await mkdir(deploymentDir,{recursive:true});
await writeFile(resolve(deploymentDir,`${selected.chainId}.json`),JSON.stringify(manifest,null,2));
console.log(`\nAdd these public addresses to .env:\n${selected.prefix}_PULSE_REGISTRY_ADDRESS=${registry.address}\n${selected.prefix}_ORACLE_ROUTER_ADDRESS=${oracle.address}\n${selected.prefix}_EXECUTION_ADAPTER_ADDRESS=${adapter.address}\n${selected.prefix}_SPOT_ORDER_FACTORY_ADDRESS=${spot.address}\n${selected.prefix}_AUTOPILOT_VAULT_FACTORY_ADDRESS=${autopilot.address}`);
