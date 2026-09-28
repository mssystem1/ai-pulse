import { executionPublicClient, type ExecutionNetwork } from "./onchainDiscovery.js";

const fields = ["maxTradeValue", "dailyTurnoverCap", "maxSlippageBps", "maxDailyLossBps", "cooldown", "expiry"] as const;
export async function readAutopilotConfiguration(network: ExecutionNetwork, vault: `0x${string}`, asset: `0x${string}`) {
  const client = executionPublicClient(network);
  const values = await client.multicall({ allowFailure: false, contracts: [
    ...fields.map(name => ({ address: vault, abi: [{ type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const, functionName: name })),
    { address: vault, abi: [{ type: "function", name: "exposureCap", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const, functionName: "exposureCap", args: [asset] },
    { address: vault, abi: [{ type: "function", name: "allowedAssets", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] }] as const, functionName: "allowedAssets", args: [asset] },
    { address: vault, abi: [{ type: "function", name: "policyHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }] as const, functionName: "policyHash" },
    { address: vault, abi: [{ type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] }] as const, functionName: "paused" },
    { address: asset, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const, functionName: "balanceOf", args: [vault] },
  ] });
  return { ...Object.fromEntries(fields.map((name,index)=>[name,String(values[index])])), exposureCap: String(values[6]), assetAllowed: Boolean(values[7]), policyHash: String(values[8]), paused: Boolean(values[9]), targetBalance: String(values[10]) };
}
