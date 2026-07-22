import { createHash } from "node:crypto";

const X_LAYER_CHAIN_ID = "0xc4";
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

type RpcResponse<T> = { jsonrpc?: string; id?: number; result?: T; error?: { code: number; message: string } };

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => ({}))) as RpcResponse<T>;
  if (!response.ok || body.error || body.result === undefined) {
    throw new Error(body.error?.message || `X Layer RPC returned HTTP ${response.status}`);
  }
  return body.result;
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

export async function inspectXLayerAddress(rpcUrl: string, address: string) {
  const [chainId, blockNumber, code, balance, transactionCount] = await Promise.all([
    rpc<string>(rpcUrl, "eth_chainId", []),
    rpc<string>(rpcUrl, "eth_blockNumber", []),
    rpc<string>(rpcUrl, "eth_getCode", [address, "latest"]),
    rpc<string>(rpcUrl, "eth_getBalance", [address, "latest"]),
    rpc<string>(rpcUrl, "eth_getTransactionCount", [address, "latest"]),
  ]);

  if (chainId.toLowerCase() !== X_LAYER_CHAIN_ID) {
    throw new Error(`Configured RPC returned chain ${chainId}; expected X Layer mainnet 0xc4 (196)`);
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
    chainId: "196",
    network: "X Layer mainnet",
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
      ? "Runtime bytecode is deployed at this address on X Layer. This is factual RPC evidence, not a safety verdict."
      : "No runtime bytecode is deployed at this address on X Layer at the observed block.",
    limitations: [
      "A deployed contract is not necessarily safe; bytecode presence alone cannot establish intent or trustworthiness.",
      "Proxy detection covers common EIP-1967 and EIP-1167 patterns and is not exhaustive.",
      "This endpoint does not simulate transactions, verify source code, or audit contract logic.",
    ],
    generatedAt: new Date().toISOString(),
  };
}
