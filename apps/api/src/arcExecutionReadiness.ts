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
export const ARC_EVIDENCE_UNAVAILABLE = "Arc mainnet execution evidence is temporarily unavailable";
export const isArcEvidenceUnavailable = (reason?: string) => Boolean(reason?.startsWith(ARC_EVIDENCE_UNAVAILABLE));

/** Report the failure class without publishing URLs, credentials or RPC bodies. */
function readFailure(error: unknown): string {
  let value = error;
  for (let depth = 0; depth < 6 && value && typeof value === "object"; depth++) {
    const e = value as { name?: string; message?: string; details?: string; status?: number; code?: number; cause?: unknown };
    if (e.name === "TimeoutError" || e.name === "AbortError") return "request timed out";
    if (typeof e.status === "number") return e.status === 429 ? "RPC rate limited (HTTP 429)" : `RPC HTTP ${e.status}`;
    if (typeof e.code === "number") return `RPC rejected the read (code ${e.code})`;
    if (/timed? ?out|timeout/i.test(`${e.message || ""} ${e.details || ""}`)) return "request timed out";
    value = e.cause;
  }
  return "RPC read failed or returned incomplete evidence";
}

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
    const urls = [...new Set([cfg.ARC_RPC_URL?.trim() || "https://rpc.mainnet.arc.io", cfg.ARC_RPC_FALLBACK_URL?.trim() || "https://rpc.quicknode.mainnet.arc.io"]
      .filter((url): url is string => Boolean(url?.trim())).map(url => url.trim()))];
    // Share concurrent checks without caching completed permission/pause state.
    const identity = JSON.stringify([urls, contracts, router, spender, executor]);
    const pending = pendingChecks.get(identity);
    if (pending) return await pending;
    const inspect = async (): Promise<Readiness> => {
      const failures: string[] = [];
      for (const [index, url] of urls.entries()) {
        let stage = "network identity";
        try {
          // Recheck every piece of evidence on a single endpoint after an outage.
          // Explicit negative evidence (wrong chain, absent code, roles or pause)
          // must fail closed rather than be hidden by another provider.
          // Nine code reads and the gas/balance reads share HTTP batches. This
          // avoids request bursts while retaining every fresh on-chain check.
          const client = createPublicClient({ transport: http(url, { timeout: 8_000, retryCount: 0, batch: { batchSize: 20, wait: 0 } }) });
          if (await client.getChainId() !== 5042) return { ready: false, reason: "Arc RPC returned the wrong network" };
          stage = "contract bytecode";
          const code = await Promise.allSettled([...Object.values(contracts), router, spender].map(address => client.getCode({ address: address as `0x${string}` })));
          if (code.some(value => value.status === "fulfilled" && (!value.value || value.value === "0x"))) return { ready: false, reason: "An Arc execution contract has no deployed bytecode" };
          const failedCode = code.find(value => value.status === "rejected");
          if (failedCode?.status === "rejected") throw failedCode.reason;
          const factoryReads = [contracts.spotFactory, contracts.spotLimitFactory, contracts.spotBracketFactory, contracts.autopilotFactory]
            .flatMap(address => (["registry", "oracle"] as const).map(functionName => ({ address: address as `0x${string}`, abi: factoryAbi, functionName })));
          // One simulated read replaces fifteen separate RPC calls. It requires
          // no deployed Multicall contract and performs no transaction.
          stage = "factory bindings and permissions";
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
          stage = "executor gas";
          const [gasPrice, balance] = await Promise.all([client.getGasPrice(), client.getBalance({ address: executor })]);
          if (balance < 2_000_000n * gasPrice) return { ready: false, reason: "Arc execution signer needs USDC for transaction gas" };
          return { ready: true };
        } catch (error) {
          failures.push(`${index === 0 ? "Primary" : "Fallback"}: ${stage}: ${readFailure(error)}`);
          // Retry complete evidence on fallback; no successful permission or
          // pause result is reused from an earlier call or failed provider.
        }
      }
      return { ready: false, reason: `${ARC_EVIDENCE_UNAVAILABLE}. ${failures.join("; ")}.` };
    };
    const operation = inspect();
    pendingChecks.set(identity, operation);
    try { return await operation; }
    finally { pendingChecks.delete(identity); }
  } catch {
    return { ready: false, reason: ARC_EVIDENCE_UNAVAILABLE };
  }
}
