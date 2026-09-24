/** Read-only Robinhood deployment/payment discovery. Never signs wallet messages or sends transactions.
 * Run: npx tsx scripts/robinhood-readiness.ts --run
 * Credentials stay local; CDP authentication is sent only to its fixed official host.
 */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { createPublicClient, http, parseAbi, formatEther, formatUnits, hashDomain, keccak256 } from "viem";
import { createCdpAuthHeaders } from "../packages/payments/src/cdpAuth.js";
import { ROBINHOOD_PAYMENT, advertisesRobinhoodExactV2 } from "../packages/payments/src/robinhoodPayment.js";
import { createRobinhoodPaymentServer, robinhoodFacilitator } from "../packages/payments/src/robinhoodServer.js";

if (!process.argv.includes("--run")) {
  console.log("Read-only network probes. Run with --run. No wallet keys, signatures, payments or deployment.");
  process.exit(0);
}
config({ quiet: true });
const { network, chainId } = ROBINHOOD_PAYMENT;
// Official https://docs.robinhood.com/chain/contracts/ (verify bytecode and metadata below).
const tokens = { USDG: ROBINHOOD_PAYMENT.asset, WETH: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" } as const;
const rpc = createPublicClient({ transport: http(process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com", { timeout: 15_000, retryCount: 0 }) });
const abi = parseAbi(["function symbol() view returns(string)", "function name() view returns(string)", "function decimals() view returns(uint8)", "function DOMAIN_SEPARATOR() view returns(bytes32)", "function balanceOf(address) view returns(uint256)"]);
const errorName = (e: any) => e?.cause?.code || e?.name || "Request failed"; // Do not log credential-bearing URLs or headers.
const result = (check: string, data: unknown) => console.log(JSON.stringify({ at: new Date().toISOString(), check, data }));
async function json(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { Accept: "application/json", ...headers }, redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw Object.assign(new Error("Upstream unavailable"), { name: `HTTP_${r.status}` });
  return r.json();
}
async function probe(name: string, action: () => Promise<unknown>) {
  try { result(name, await action()); } catch (e) { result(name, { unavailable: true, reason: errorName(e) }); }
}
await probe("mainnet", async () => {
  const actual = await rpc.getChainId();
  if (actual !== chainId) throw Object.assign(new Error("Chain mismatch"), { name: "WrongChain" });
  const latest = await rpc.getBlock();
  const manifest = JSON.parse(await readFile(new URL("../packages/contracts/deployments/42161.json", import.meta.url), "utf8"));
  const balance = await rpc.getBalance({ address: manifest.deployer });
  const usdg = await rpc.readContract({ address: tokens.USDG, abi, functionName: "balanceOf", args: [manifest.deployer] });
  return { chainId: actual, block: String(latest.number), timestamp: new Date(Number(latest.timestamp) * 1000).toISOString(), existingDeployer: manifest.deployer, gasBalanceETH: formatEther(balance), balanceUSDG: formatUnits(usdg, 6), matchesConfiguredTestWallet: process.env.TEST_WALLET_ADDRESS?.toLowerCase() === manifest.deployer.toLowerCase() };
});
await probe("tokens", async () => {
  if (await rpc.getChainId() !== chainId) throw Object.assign(new Error("Chain mismatch"), { name: "WrongChain" });
  return Promise.all(Object.entries(tokens).map(async ([expected, address]) => {
    const [code, symbol, name, decimals] = await Promise.all([rpc.getCode({ address }), rpc.readContract({ address, abi, functionName: "symbol" }), rpc.readContract({ address, abi, functionName: "name" }), rpc.readContract({ address, abi, functionName: "decimals" })]);
    let signingDomainMatches: boolean | null = null;
    if (expected === "USDG") {
      const separator = await rpc.readContract({ address, abi, functionName: "DOMAIN_SEPARATOR" }).catch(() => null);
      signingDomainMatches = separator ? separator === hashDomain({
        domain: { name: "Global Dollar", version: "1", chainId, verifyingContract: address },
        types: { EIP712Domain: [
          { name: "name", type: "string" }, { name: "version", type: "string" },
          { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
        ] },
      }) : null;
    }
    return { expected, address, hasBytecode: Boolean(code && code !== "0x"), symbol, name, decimals, signingDomainMatches };
  }));
});
await probe("PULSE deployment", async () => {
  if (await rpc.getChainId() !== chainId) throw Object.assign(new Error("Chain mismatch"), { name: "WrongChain" });
  const manifest = JSON.parse(await readFile(new URL("../packages/contracts/deployments/4663.json", import.meta.url), "utf8"));
  const checks = [];
  for (const [name, deployment] of Object.entries(manifest.contracts) as Array<[string, any]>) {
    const code = await rpc.getCode({ address: deployment.address });
    const receipt = await rpc.getTransactionReceipt({ hash: deployment.txHash });
    checks.push({ name, runtimeMatches: Boolean(code && keccak256(code) === deployment.runtimeCodeHash),
      receiptSuccessful: receipt.status === "success", sourceVerified: manifest.verification?.results?.[name]?.status === "verified" });
  }
  const paused = await rpc.readContract({ address: manifest.contracts.registry.address, abi: parseAbi(["function automationPaused() view returns(bool)"]), functionName: "automationPaused" });
  const txReceipts = await Promise.all(manifest.transactions.map((tx: any) => rpc.getTransactionReceipt({ hash: tx.hash })));
  const fee = txReceipts.reduce((sum: bigint, receipt: any) => sum + receipt.gasUsed * receipt.effectiveGasPrice, 0n);
  return { checks, automationPaused: paused, allReceiptsSuccessful: txReceipts.every((r: any) => r.status === "success"),
    deploymentAndConfigurationFeeETH: formatEther(fee), productionReady: false };
});
const providers = [
  ["Primer", "https://x402.primer.systems/supported"],
  ["Vantis", "https://facilitator.vantis.sh/supported"],
  ["Aeron", "https://x402.aeron.sh/supported"],
  ["Canopy", "https://facilitator.canopyfinance.io/supported"],
] as const;
await probe("SDK seller requirements", async () => {
  const server = await createRobinhoodPaymentServer(robinhoodFacilitator("primer"));
  const recipient = process.env.PAY_TO_ADDRESS;
  if (!recipient) return { unavailable: true, reason: "RecipientNotConfigured" };
  const requirements = await server.requirements("0.20", recipient);
  const first = requirements[0];
  return { network: first.network, symbol: "USDG", amountUSDG: formatUnits(BigInt(first.amount), 6),
    assetMatches: first.asset.toLowerCase() === tokens.USDG.toLowerCase(), signingDomain: first.extra,
    challengeBuilt: requirements.length === 1, settlementTested: false };
});
await Promise.all(providers.map(([name, url]) => probe(name, async () => {
  const body = await json(url);
  if (!Array.isArray(body.kinds)) throw Object.assign(new Error("Invalid capabilities"), { name: "InvalidSupportedResponse" });
  return { endpoint: url, kinds: body.kinds.filter((k: any) => k?.network === network), exactV2Advertised: advertisesRobinhoodExactV2(body), settlementTested: false };
})));
// Optional negative validation only: no signature, authorization, /settle or wallet access.
if (process.argv.includes("--verify-invalid")) {
  await Promise.all(providers.slice(0, 3).map(([name, supported]) => probe(`${name} invalid verification`, async () => {
    const r = await fetch(supported.replace(/\/supported$/, "/verify"), {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    const body = await r.json().catch(() => null);
    return { status: r.status, isValid: body?.isValid ?? null, reason: body?.invalidReason ?? body?.error ?? null, settlementTested: false };
  })));
}
await probe("CDP", async () => {
  const { CDP_API_KEY_ID: id, CDP_API_KEY_SECRET: secret } = process.env;
  if (!id || !secret) return { unavailable: true, reason: "CredentialsNotConfigured" };
  const url = "https://api.cdp.coinbase.com/platform/v2/x402";
  const headers = await createCdpAuthHeaders(url, id, secret)();
  const body = await json(`${url}/supported`, headers.supported);
  if (!Array.isArray(body.kinds)) throw Object.assign(new Error("Invalid capabilities"), { name: "InvalidSupportedResponse" });
  return { networks: [...new Set(body.kinds.map((k: any) => k.network))], robinhoodKinds: body.kinds.filter((k: any) => k.network === network) };
});
await probe("GeckoTerminal", async () => {
  for (let page = 1; page <= 5; page++) {
    const body = await json(`https://api.geckoterminal.com/api/v2/networks?page=${page}`);
    if (!Array.isArray(body.data)) throw Object.assign(new Error("Invalid networks"), { name: "InvalidNetworksResponse" });
    const found = body.data.filter((row: any) => /robinhood/i.test(`${row.id} ${row.attributes?.name}`));
    if (found.length) return { matchingNetworks: found, identityStillRequiresChainVerification: true };
    if (!body.data.length) break;
  }
  return { matchingNetworks: [], note: "No match in bounded five-page discovery; not proof of permanent lack of support." };
});
await probe("Blockscout", async () => {
  const url = `https://robinhoodchain.blockscout.com/api/v2/smart-contracts/${tokens.USDG}`;
  const b = await json(url);
  return { endpoint: url, verified: b.is_verified ?? null, name: b.name ?? null };
});
