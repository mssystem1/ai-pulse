import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createPublicClient, encodeDeployData, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

loadEnv({ path: resolve(import.meta.dirname, "../../../.env"), override: false });
const key = process.env.CONTRACT_DEPLOYER_PRIVATE_KEY || process.env.TEST_WALLET_PRIVATE_KEY || "";
if (!/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("No valid deployer/test private key configured");
const account = privateKeyToAccount(key);
const expected = process.env.TEST_WALLET_ADDRESS || "";
if (expected && account.address.toLowerCase() !== expected.toLowerCase()) throw new Error("Configured private key does not match TEST_WALLET_ADDRESS");
console.log(`Deployer address: ${account.address}`);
console.log(`Address match: ${expected ? "yes" : "TEST_WALLET_ADDRESS not set"}`);
const networks = [
  ["xlayer",196,process.env.X_LAYER_RPC,"OKB"],
  ["base",8453,process.env.BASE_RPC_URL,"ETH"],
  ["arbitrum",42161,process.env.ARBITRUM_RPC_URL,"ETH"],
];
const artifactDir=resolve(import.meta.dirname,"../artifacts");
async function artifact(name){return JSON.parse(await readFile(resolve(artifactDir,`${name}.json`),"utf8"));}
const deploymentSpecs=[
  ["PulseRegistryV1",[account.address]],
  ["OracleRouterV1",[account.address]],
  ["OkxSwapAdapterV1",[account.address]],
  ["SpotOrderAccountFactoryV1",[account.address,account.address]],
  ["AutopilotVaultFactoryV1",[account.address]],
];
for(const [name,id,rpc,symbol] of networks){if(!rpc){console.log(`${name}: RPC missing`);continue;}try{const chain={id,name,nativeCurrency:{name:symbol,symbol,decimals:18},rpcUrls:{default:{http:[rpc]}}};const client=createPublicClient({chain,transport:http(rpc)});const [chainId,balance,block,gasPrice]=await Promise.all([client.getChainId(),client.getBalance({address:account.address}),client.getBlockNumber(),client.getGasPrice()]);let totalGas=0n;for(const [contractName,args] of deploymentSpecs){const a=await artifact(contractName);const data=encodeDeployData({abi:a.abi,bytecode:a.bytecode,args});totalGas+=await client.estimateGas({account:account.address,data});}const estimated=totalGas*gasPrice*125n/100n;console.log(`${name}: chain=${chainId} block=${block} balance=${formatEther(balance)} ${symbol} bufferedDeployEstimate=${formatEther(estimated)} ${symbol} sufficient=${balance>=estimated}`);}catch(error){console.log(`${name}: RPC/preflight failed: ${error instanceof Error?error.message:String(error)}`);}}
console.log(`Verification credentials: Etherscan=${process.env.ETHERSCAN_API_KEY?"configured":"missing"}, OKLink=${process.env.OKLINK_API_KEY?"configured":"missing"}`);
