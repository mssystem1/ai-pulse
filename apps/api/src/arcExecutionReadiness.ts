import { createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AppConfig } from "@pulse/config";
import { executionContracts, executionContractAddress } from "./executionContracts.js";
import { executionSignerKey } from "./executionSigner.js";

type Readiness = { ready: boolean; reason?: string };
const ADDRESS = /^0x(?!0{40}$)[a-fA-F0-9]{40}$/;
const registryAbi = parseAbi(["function automationPaused() view returns (bool)", "function approvedAdapters(address) view returns (bool)", "function spotKeepers(address) view returns (bool)", "function autopilotExecutors(address) view returns (bool)"]);
const adapterAbi = parseAbi(["function approvedRouters(address) view returns (bool)", "function approvedSpenders(address) view returns (bool)"]);
const oracleAbi = parseAbi(["function updaters(address) view returns (bool)"]);
const factoryAbi = parseAbi(["function registry() view returns (address)", "function oracle() view returns (address)"]);
const pendingChecks = new Map<string, Promise<Readiness>>();

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
  const key = executionSignerKey(cfg, "arc");
  if (!cfg.hasOkxCredentials) return { ready: false, reason: "Arc execution requires live OKX route credentials" };
  if (!ADDRESS.test(router) || !ADDRESS.test(spender) || !/^0x[a-fA-F0-9]{64}$/.test(key)) return { ready: false, reason: "Arc requires verified router/spender addresses and a configured execution signer" };
  try {
    const executor = privateKeyToAccount(key as `0x${string}`).address;
    const urls = [...new Set([cfg.ARC_RPC_URL, cfg.ARC_RPC_FALLBACK_URL]
      .filter((url): url is string => Boolean(url?.trim())).map(url => url.trim()))];
    // Share concurrent checks without caching completed permission/pause state.
    const identity = JSON.stringify([urls, contracts, router, spender, executor]);
    const pending = pendingChecks.get(identity);
    if (pending) return await pending;
    const inspect = async (): Promise<Readiness> => {
      for (const url of urls) {
        try {
          // Recheck every piece of evidence on a single endpoint after an outage.
          // Explicit negative evidence (wrong chain, absent code, roles or pause)
          // must fail closed rather than be hidden by another provider.
          const client = createPublicClient({ transport: http(url, { timeout: 8_000, retryCount: 0 }) });
          if (await client.getChainId() !== 5042) return { ready: false, reason: "Arc RPC returned the wrong network" };
          const code = await Promise.allSettled([...Object.values(contracts), router, spender].map(address => client.getCode({ address: address as `0x${string}` })));
          if (code.some(value => value.status === "fulfilled" && (!value.value || value.value === "0x"))) return { ready: false, reason: "An Arc execution contract has no deployed bytecode" };
          if (code.some(value => value.status === "rejected")) throw new Error("Arc bytecode evidence unavailable");
          const factoryReads = [contracts.spotFactory, contracts.spotLimitFactory, contracts.spotBracketFactory, contracts.autopilotFactory]
            .flatMap(address => (["registry", "oracle"] as const).map(functionName => ({ address: address as `0x${string}`, abi: factoryAbi, functionName })));
          // One simulated read replaces fifteen separate RPC calls. It requires
          // no deployed Multicall contract and performs no transaction.
          const evidence = await client.multicall({ deployless: true, batchSize: 0, contracts: [
            ...factoryReads,
            { address: contracts.registry, abi: registryAbi, functionName: "automationPaused" },
            { address: contracts.registry, abi: registryAbi, functionName: "approvedAdapters", args: [contracts.executionAdapter] },
            { address: contracts.registry, abi: registryAbi, functionName: "spotKeepers", args: [executor] },
            { address: contracts.registry, abi: registryAbi, functionName: "autopilotExecutors", args: [executor] },
            { address: contracts.executionAdapter, abi: adapterAbi, functionName: "approvedRouters", args: [router] },
            { address: contracts.executionAdapter, abi: adapterAbi, functionName: "approvedSpenders", args: [spender] },
            { address: contracts.oracleRouter, abi: oracleAbi, functionName: "updaters", args: [executor] },
          ] });
          const bindings = evidence.slice(0, factoryReads.length);
          if (bindings.some((value, i) => value.status === "success" && (typeof value.result !== "string"
            || value.result.toLowerCase() !== (i % 2 ? contracts.oracleRouter : contracts.registry).toLowerCase()))) {
            return { ready: false, reason: "Arc factory references do not match the configured registry and oracle" };
          }
          const [paused, ...roles] = evidence.slice(factoryReads.length);
          if (roles.some(value => value.status === "success" && value.result !== true)) return { ready: false, reason: "Arc adapter, router/spender or execution/oracle roles are not approved on-chain" };
          if (paused?.status === "success" && paused.result === true) return { ready: false, reason: "Arc automated execution is paused on-chain" };
          if (evidence.length !== factoryReads.length + 7 || evidence.some(value => value.status === "failure")) throw new Error("Arc contract evidence unavailable");
          const [gasPrice, balance] = await Promise.all([client.getGasPrice(), client.getBalance({ address: executor })]);
          if (balance < 2_000_000n * gasPrice) return { ready: false, reason: "Arc execution signer needs USDC for transaction gas" };
          return { ready: true };
        } catch { /* Retry all reads against the configured fallback. */ }
      }
      return { ready: false, reason: "Arc mainnet execution evidence is temporarily unavailable" };
    };
    const operation = inspect();
    pendingChecks.set(identity, operation);
    try { return await operation; }
    finally { pendingChecks.delete(identity); }
  } catch {
    return { ready: false, reason: "Arc mainnet execution evidence is temporarily unavailable" };
  }
}
