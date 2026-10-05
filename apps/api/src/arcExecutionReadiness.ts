import { createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AppConfig } from "@pulse/config";
import { executionContracts, executionContractAddress } from "./executionContracts.js";

type Readiness = { ready: boolean; reason?: string };
const ADDRESS = /^0x(?!0{40}$)[a-fA-F0-9]{40}$/;
const registryAbi = parseAbi(["function automationPaused() view returns (bool)", "function approvedAdapters(address) view returns (bool)", "function spotKeepers(address) view returns (bool)", "function autopilotExecutors(address) view returns (bool)"]);
const adapterAbi = parseAbi(["function approvedRouters(address) view returns (bool)", "function approvedSpenders(address) view returns (bool)"]);
const oracleAbi = parseAbi(["function updaters(address) view returns (bool)"]);
const factoryAbi = parseAbi(["function registry() view returns (address)", "function oracle() view returns (address)"]);

/** Mainnet deployment evidence is required before paid activation or keeper work. */
export async function arcAutomationReadiness(cfg: AppConfig): Promise<Readiness> {
  if (!cfg.enabledNetworks.includes("arc") || !cfg.FEATURE_ARC_MAINNET || process.env.FEATURE_ARC_TRADING !== "1") {
    return { ready: false, reason: "Arc mainnet execution has not been activated" };
  }
  const contracts = executionContracts("arc");
  if (Object.values(contracts).some(address => !address || !ADDRESS.test(address))) {
    return { ready: false, reason: "Arc mainnet requires its own registry, oracle, adapter and Spot/Autopilot factory deployments" };
  }
  const router = executionContractAddress("arc", "okxRouter");
  const spender = executionContractAddress("arc", "okxApproval");
  const key = cfg.AUTOMATION_EXECUTOR_PRIVATE_KEY || cfg.TEST_WALLET_PRIVATE_KEY;
  if (!cfg.hasOkxCredentials) return { ready: false, reason: "Arc execution requires live OKX route credentials" };
  if (!ADDRESS.test(router) || !ADDRESS.test(spender) || !/^0x[a-fA-F0-9]{64}$/.test(key)) return { ready: false, reason: "Arc requires verified router/spender addresses and a configured execution signer" };
  try {
    const executor = privateKeyToAccount(key as `0x${string}`).address;
    const client = createPublicClient({ transport: http(cfg.ARC_RPC_URL, { timeout: 8_000, retryCount: 0 }) });
    if (await client.getChainId() !== 5042) return { ready: false, reason: "Arc RPC returned the wrong network" };
    const code = await Promise.all([...Object.values(contracts), router, spender].map(address => client.getCode({ address: address as `0x${string}` })));
    if (code.some(value => !value || value === "0x")) return { ready: false, reason: "An Arc execution contract has no deployed bytecode" };
    for (const factory of [contracts.spotFactory, contracts.spotLimitFactory, contracts.spotBracketFactory, contracts.autopilotFactory]) {
      const [registry, oracle] = await Promise.all([
        client.readContract({ address: factory as `0x${string}`, abi: factoryAbi, functionName: "registry" }),
        client.readContract({ address: factory as `0x${string}`, abi: factoryAbi, functionName: "oracle" }),
      ]);
      if (registry.toLowerCase() !== contracts.registry.toLowerCase() || oracle.toLowerCase() !== contracts.oracleRouter.toLowerCase()) {
        return { ready: false, reason: "Arc factory references do not match the configured registry and oracle" };
      }
    }
    const [paused, adapterApproved, keeperApproved, executorApproved, routerApproved, spenderApproved, updaterApproved, gasPrice, balance] = await Promise.all([
      client.readContract({ address: contracts.registry, abi: registryAbi, functionName: "automationPaused" }),
      client.readContract({ address: contracts.registry, abi: registryAbi, functionName: "approvedAdapters", args: [contracts.executionAdapter] }),
      client.readContract({ address: contracts.registry, abi: registryAbi, functionName: "spotKeepers", args: [executor] }),
      client.readContract({ address: contracts.registry, abi: registryAbi, functionName: "autopilotExecutors", args: [executor] }),
      client.readContract({ address: contracts.executionAdapter, abi: adapterAbi, functionName: "approvedRouters", args: [router] }),
      client.readContract({ address: contracts.executionAdapter, abi: adapterAbi, functionName: "approvedSpenders", args: [spender] }),
      client.readContract({ address: contracts.oracleRouter, abi: oracleAbi, functionName: "updaters", args: [executor] }),
      client.getGasPrice(), client.getBalance({ address: executor }),
    ]);
    if (!adapterApproved || !keeperApproved || !executorApproved || !routerApproved || !spenderApproved || !updaterApproved) return { ready: false, reason: "Arc adapter, router/spender or execution/oracle roles are not approved on-chain" };
    if (balance < 2_000_000n * gasPrice) return { ready: false, reason: "Arc execution signer needs USDC for transaction gas" };
    return paused ? { ready: false, reason: "Arc automated execution is paused on-chain" } : { ready: true };
  } catch {
    return { ready: false, reason: "Arc mainnet execution evidence is temporarily unavailable" };
  }
}
