import { collectLiveContractEvidence } from "./contractInspect.js";
import { collectRobinhoodStockEvidence } from "./robinhoodAssetRegistry.js";

const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
export function robinhoodAssetContext(chainId: number, address: string) {
  if (chainId !== 4663 || !/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error("Robinhood mainnet token identity required");
  const token = address.toLowerCase();
  return {
    chainId, address: token,
    assetClass: token === USDG ? "issuer_stablecoin" : token === WETH ? "wrapped_native" : "unclassified_erc20",
    canonicalListing: token === USDG || token === WETH ? "https://docs.robinhood.com/chain/contracts/" : null,
    limitations: token === USDG
      ? ["Assess issuer/redemption, freeze/pause and upgrade powers, bridge/OFT dependencies, depeg and liquidity separately.", "A canonical issuer listing is not a perfect safety rating or evidence that all controls are absent."]
      : token === WETH
        ? ["Assess wrapping/redemption implementation and pool liquidity; identity alone does not establish swap availability."]
        : ["Do not infer stock ownership, redemption rights or official stock-token identity from a symbol. Verify against the official asset registry first."],
  };
}

export function parseRobinhoodVerification(value: unknown, address: string) {
  const body = value as { chainId?: unknown; address?: unknown; creationMatch?: unknown; runtimeMatch?: unknown } | null;
  if (!body || Number(body.chainId) !== 4663 || String(body.address).toLowerCase() !== address.toLowerCase()) throw new Error("Source verification identity mismatch");
  const matches = new Set(["exact_match", "match"]);
  if (!matches.has(String(body.runtimeMatch))) throw new Error("No verified runtime source match returned");
  return { chainId: 4663, address: address.toLowerCase(), runtimeMatch: body.runtimeMatch,
    creationMatch: body.creationMatch ?? null, sourceVerified: true,
    scope: "Source-to-bytecode match for this contract only; does not certify proxy implementation, permissions or economic safety." };
}

export async function collectRobinhoodEvidence(address: string, rpcUrl: string) {
  const context = robinhoodAssetContext(4663, address);
  const tasks = [
    collectLiveContractEvidence({ address, rpcUrl, chainId: "4663", expectedChainHex: "0x1237", network: "Robinhood Chain mainnet" }),
    (async () => {
      const response = await fetch(`https://sourcify.dev/server/v2/contract/4663/${context.address}`, {
        headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`Sourcify HTTP ${response.status}`);
      return parseRobinhoodVerification(await response.json(), address);
    })(),
    collectRobinhoodStockEvidence(address),
  ];
  const sources = ["Robinhood RPC evidence", "Sourcify contract verification", "Robinhood official stock registry"];
  const results = await Promise.allSettled(tasks);
  return [
    { source: "Robinhood asset context", status: "observed" as const, data: context },
    ...results.map((result, i) => result.status === "fulfilled"
      ? { source: sources[i], status: "observed" as const, data: result.value }
      : { source: sources[i], status: "unavailable" as const, error: i === 0 ? "Live RPC contract evidence unavailable; no safety inference made" : String(result.reason?.message || "Source verification unavailable") }),
  ];
}
