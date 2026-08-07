import { createHash } from "node:crypto";
import { decodeFunctionResult, erc20Abi } from "viem";

const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

type RpcResponse<T> = { jsonrpc?: string; id?: number; result?: T; error?: { code: number; message: string } };

async function rpc<T>(rpcUrl: string | readonly string[], method: string, params: unknown[]): Promise<T> {
  const urls = (Array.isArray(rpcUrl) ? rpcUrl : [rpcUrl]).filter(Boolean);
  let lastError: unknown;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json().catch(() => ({}))) as RpcResponse<T>;
      if (!response.ok || body.error || body.result === undefined) {
        throw new Error(body.error?.message || `RPC returned HTTP ${response.status}`);
      }
      return body.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`All configured RPC endpoints failed for ${method}: ${lastError instanceof Error ? lastError.message : "unknown RPC error"}`);
}

function hexQuantity(value: string): string {
  try {
    return BigInt(value || "0x0").toString();
  } catch {
    return "0";
  }
}

function implementationAddress(storage: string): string | null {
  const normalized = storage.replace(/^0x/, "").padStart(64, "0");
  const candidate = normalized.slice(-40);
  return /^0{40}$/.test(candidate) ? null : `0x${candidate}`;
}

function minimalProxyImplementation(code: string): string | null {
  const normalized = code.toLowerCase().replace(/^0x/, "");
  const match = normalized.match(/363d3d373d3d3d363d73([a-f0-9]{40})5af43d82803e903d91602b57fd5bf3/);
  return match ? `0x${match[1]}` : null;
}

export async function inspectEvmAddress(input: { rpcUrl: string | readonly string[]; address: string; expectedChainHex: string; chainId: string; network: string }) {
  const { rpcUrl, address } = input;
  const [chainId, blockNumber, code, balance, transactionCount] = await Promise.all([
    rpc<string>(rpcUrl, "eth_chainId", []),
    rpc<string>(rpcUrl, "eth_blockNumber", []),
    rpc<string>(rpcUrl, "eth_getCode", [address, "latest"]),
    rpc<string>(rpcUrl, "eth_getBalance", [address, "latest"]),
    rpc<string>(rpcUrl, "eth_getTransactionCount", [address, "latest"]),
  ]);

  if (chainId.toLowerCase() !== input.expectedChainHex.toLowerCase()) {
    throw new Error(`Configured RPC returned chain ${chainId}; expected ${input.network} ${input.expectedChainHex} (${input.chainId})`);
  }

  const normalizedCode = code.toLowerCase();
  const deployed = normalizedCode !== "0x" && normalizedCode !== "0x0";
  const bytecodeSize = deployed ? Math.max(0, (normalizedCode.length - 2) / 2) : 0;
  let eip1967Implementation: string | null = null;
  if (deployed) {
    try {
      const storage = await rpc<string>(rpcUrl, "eth_getStorageAt", [
        address,
        EIP1967_IMPLEMENTATION_SLOT,
        "latest",
      ]);
      eip1967Implementation = implementationAddress(storage);
    } catch {
      // Some public RPC tiers may restrict storage reads. The rest of the evidence is still useful.
    }
  }
  const minimalImplementation = deployed ? minimalProxyImplementation(normalizedCode) : null;
  const proxyImplementation = eip1967Implementation || minimalImplementation;

  return {
    service: "contract_inspect",
    free: true,
    chainId: input.chainId,
    network: input.network,
    rpcMethodSet: [
      "eth_chainId",
      "eth_blockNumber",
      "eth_getCode",
      "eth_getBalance",
      "eth_getTransactionCount",
      ...(deployed ? ["eth_getStorageAt"] : []),
    ],
    address,
    observedAtBlock: hexQuantity(blockNumber),
    accountType: deployed ? "contract" : "no_deployed_code",
    deployed,
    bytecodeSize,
    bytecodeSha256: deployed
      ? createHash("sha256").update(Buffer.from(normalizedCode.slice(2), "hex")).digest("hex")
      : null,
    nativeBalanceWei: hexQuantity(balance),
    transactionCount: hexQuantity(transactionCount),
    proxy: {
      detected: Boolean(proxyImplementation),
      standard: eip1967Implementation ? "EIP-1967" : minimalImplementation ? "EIP-1167" : null,
      implementation: proxyImplementation,
    },
    conclusion: deployed
      ? `Runtime bytecode is deployed at this address on ${input.network}. This is factual RPC evidence, not a safety verdict.`
      : `No runtime bytecode is deployed at this address on ${input.network} at the observed block.`,
    limitations: [
      "A deployed contract is not necessarily safe; bytecode presence alone cannot establish intent or trustworthiness.",
      "Proxy detection covers common EIP-1967 and EIP-1167 patterns and is not exhaustive.",
      "This endpoint does not simulate transactions, verify source code, or audit contract logic.",
    ],
    generatedAt: new Date().toISOString(),
  };
}

async function optionalErc20Field(
  rpcUrl: string | readonly string[],
  address: string,
  functionName: "symbol" | "decimals" | "totalSupply",
  selector: string,
): Promise<{ status: "observed"; value: string | number } | { status: "unknown"; reason: string }> {
  try {
    const data = await rpc<`0x${string}`>(rpcUrl, "eth_call", [{ to: address, data: selector }, "latest"]);
    const decoded = decodeFunctionResult({ abi: erc20Abi, functionName, data });
    return { status: "observed", value: typeof decoded === "bigint" ? decoded.toString() : decoded };
  } catch (error) {
    return { status: "unknown", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Live, factual evidence only. Unsupported or reverted probes are explicitly unknown. */
export async function collectLiveContractEvidence(input: { rpcUrl: string | readonly string[]; address: string; expectedChainHex: string; chainId: string; network: string }) {
  const inspection = await inspectEvmAddress(input);
  if (!inspection.deployed) {
    return {
      service: "live_contract_evidence", evidenceStatus: "observed", inspection,
      tokenInterface: { status: "unknown", reason: "No runtime bytecode is deployed at the observed block." },
      safetyVerdict: "unknown", generatedAt: new Date().toISOString(),
      limitations: ["No safety score is inferred from missing code or interface probes."],
    };
  }
  const [symbol, decimals, totalSupply] = await Promise.all([
    optionalErc20Field(input.rpcUrl, input.address, "symbol", "0x95d89b41"),
    optionalErc20Field(input.rpcUrl, input.address, "decimals", "0x313ce567"),
    optionalErc20Field(input.rpcUrl, input.address, "totalSupply", "0x18160ddd"),
  ]);
  const complete = [symbol, decimals, totalSupply].every((field) => field.status === "observed");
  return {
    service: "live_contract_evidence", evidenceStatus: complete ? "observed" : "partial", inspection,
    tokenInterface: { status: complete ? "observed" : "partial", symbol, decimals, totalSupply },
    safetyVerdict: "unknown",
    conclusion: "These are live RPC observations, not an audit, endorsement, or proof that a token is tradable or safe.",
    generatedAt: new Date().toISOString(),
    limitations: [
      "ERC-20 interface responses can be spoofed and do not establish contract safety.",
      "Source verification, ownership privileges, liquidity, honeypot behavior, and transfer taxes are not inferred when evidence is absent.",
      "Unknown fields remain unknown; PULSE does not replace them with heuristic scores.",
    ],
  };
}

export async function simulateEvmTransaction(input: {
  rpcUrl: string | readonly string[]; expectedChainHex: string; chainId: string; network: string;
  transaction: { from: string; to: string; data?: string; value?: string };
}) {
  const chainId = await rpc<string>(input.rpcUrl, "eth_chainId", []);
  if (chainId.toLowerCase() !== input.expectedChainHex.toLowerCase()) {
    throw new Error(`Configured RPC returned chain ${chainId}; expected ${input.network} ${input.expectedChainHex} (${input.chainId})`);
  }
  const blockNumber = await rpc<string>(input.rpcUrl, "eth_blockNumber", []);
  const transaction = {
    from: input.transaction.from, to: input.transaction.to,
    data: input.transaction.data || "0x", value: input.transaction.value || "0x0",
  };
  const [estimate, call] = await Promise.allSettled([
    rpc<string>(input.rpcUrl, "eth_estimateGas", [transaction]),
    rpc<string>(input.rpcUrl, "eth_call", [transaction, "latest"]),
  ]);
  const reason = (result: PromiseSettledResult<string>) => result.status === "rejected"
    ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : null;
  const status = estimate.status === "fulfilled" && call.status === "fulfilled" ? "executable"
    : estimate.status === "rejected" && call.status === "rejected" ? "reverted" : "unknown";
  return {
    service: "transaction_simulation", status, safetyVerdict: "unknown",
    chainId: input.chainId, network: input.network, observedAtBlock: hexQuantity(blockNumber),
    transaction: { ...transaction, dataBytes: Math.max(0, (transaction.data.length - 2) / 2) },
    evidence: {
      estimateGas: estimate.status === "fulfilled" ? { status: "observed", gas: hexQuantity(estimate.value) } : { status: "unknown", reason: reason(estimate) },
      ethCall: call.status === "fulfilled" ? { status: "observed", returnData: call.value } : { status: "unknown", reason: reason(call) },
    },
    conclusion: status === "executable"
      ? "The RPC accepted this exact transaction for estimation and eth_call at the observed block; this is not a guarantee of inclusion or safety."
      : "The exact transaction could not be fully simulated; no positive safety conclusion is available.",
    limitations: [
      "Simulation does not broadcast, sign, or modify chain state.",
      "State, fees, nonces, prices, and contract behavior can change after the observed block.",
      "Successful execution does not prove economic safety or absence of malicious behavior.",
    ],
    generatedAt: new Date().toISOString(),
  };
}

export const inspectXLayerAddress = (rpcUrl: string, address: string) => inspectEvmAddress({ rpcUrl, address, expectedChainHex: "0xc4", chainId: "196", network: "X Layer mainnet" });
