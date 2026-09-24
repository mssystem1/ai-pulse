/** Bounded, resumable factory qualification. Never funds or resumes an account. */
import { config } from "dotenv";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, formatEther, http, keccak256, parseAbi, parseEther, toHex, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const path = "packages/contracts/deployments/4663-account-qualification.json";
const abi = parseAbi([
  "function createVault(address,bytes32) returns(address)", "function createAccount() returns(address)",
  "function accountOf(address) view returns(address)", "function vaultsOf(address) view returns(address[])",
  "function owner() view returns(address)", "function settlementAsset() view returns(address)",
  "function paused() view returns(bool)", "function policyHash() view returns(bytes32)",
  "event VaultCreated(address indexed owner,address indexed vault,address indexed settlementAsset,bytes32 policyHash)",
  "event AccountCreated(address indexed owner,address indexed account)",
]);
type Entry = { kind: "autopilot" | "spot-limit"; factory: Address; hash: Hex; nonce: number; status: string; maxGasETH: string; gasETH?: string; account?: Address; observedPaused?: boolean };
async function main() {
  config({ quiet: true });
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { executionContracts } = await import("../apps/api/src/executionContracts.js");
  const { ROBINHOOD_USDG, ROBINHOOD_WETH } = await import("../apps/api/src/robinhoodExecutionAssets.js");
  const { robinhoodMarketId } = await import("../apps/api/src/robinhoodMarkets.js");
  const cfg = loadConfig(), account = privateKeyToAccount(cfg.TEST_WALLET_PRIVATE_KEY as Hex);
  if (account.address.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase()) throw new Error("Account qualification signer mismatch");
  const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.ROBINHOOD_RPC_URL] } } };
  const client = createPublicClient({ chain, transport: http(cfg.ROBINHOOD_RPC_URL, { timeout: 15_000, retryCount: 0 }) });
  const wallet = createWalletClient({ chain, account, transport: http(cfg.ROBINHOOD_RPC_URL, { retryCount: 0 }) });
  if (await client.getChainId() !== 4663) throw new Error("Account qualification wrong network");
  const contracts = executionContracts("robinhood");
  const policy = { pair: robinhoodMarketId({ symbol: "WETH", address: ROBINHOOD_WETH }), timeframe: "1H", maxTradePct: 50, dailyLossPct: 5, strategy: "trend_following" };
  const policyHash = keccak256(toHex(JSON.stringify(policy)));
  const broadcast = process.argv.includes("--broadcast");
  const lock = await open(`${path}.lock`, "wx");
  try {
    let journal: { chainId: number; owner: Address; policy: typeof policy; entries: Entry[]; completed?: boolean };
    try { journal = JSON.parse(await readFile(path, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; journal = { chainId: 4663, owner: account.address, policy, entries: [] }; }
    if (journal.chainId !== 4663 || journal.owner.toLowerCase() !== account.address.toLowerCase() || JSON.stringify(journal.policy) !== JSON.stringify(policy)) throw new Error("Account qualification journal mismatch");
    const save = async () => { await writeFile(`${path}.tmp`, JSON.stringify(journal, null, 2)); await rename(`${path}.tmp`, path); };
    const reconcile = async (entry: Entry) => {
      const receipt = await client.waitForTransactionReceipt({ hash: entry.hash, confirmations: 2, timeout: 90_000 });
      if (receipt.from.toLowerCase() !== account.address.toLowerCase() || receipt.to?.toLowerCase() !== entry.factory.toLowerCase()) throw new Error("Account qualification receipt mismatch");
      entry.status = receipt.status; entry.gasETH = formatEther(receipt.gasUsed * receipt.effectiveGasPrice); await save();
      if (receipt.status !== "success") throw new Error("Account qualification reverted; do not repeat automatically");
      const created = receipt.logs.flatMap(log => {
        if (log.address.toLowerCase() !== entry.factory.toLowerCase()) return [];
        try {
          const event = decodeEventLog({ abi, topics: log.topics, data: log.data });
          if (event.args.owner.toLowerCase() !== account.address.toLowerCase()) return [];
          if (entry.kind === "autopilot" && event.eventName === "VaultCreated" && event.args.settlementAsset.toLowerCase() === ROBINHOOD_USDG && event.args.policyHash === policyHash) return [event.args.vault];
          if (entry.kind === "spot-limit" && event.eventName === "AccountCreated") return [event.args.account];
        } catch { /* unrelated event */ }
        return [];
      });
      if (created.length !== 1) throw new Error("Account qualification creation event missing or ambiguous");
      entry.account = created[0];
      const owner = await client.readContract({ address: entry.account, abi, functionName: "owner" });
      if (owner.toLowerCase() !== account.address.toLowerCase()) throw new Error("Account qualification owner mismatch");
      if (entry.kind === "autopilot") {
        const vaults = await client.readContract({ address: entry.factory, abi, functionName: "vaultsOf", args: [account.address] });
        if (!vaults.some(vault => vault.toLowerCase() === entry.account!.toLowerCase())) throw new Error("Account qualification factory mismatch");
        if (await client.readContract({ address: entry.account, abi, functionName: "policyHash" }) !== policyHash) throw new Error("Account qualification policy mismatch");
        if ((await client.readContract({ address: entry.account, abi, functionName: "settlementAsset" })).toLowerCase() !== ROBINHOOD_USDG) throw new Error("Account qualification settlement mismatch");
        entry.observedPaused = await client.readContract({ address: entry.account, abi, functionName: "paused" });
      } else if ((await client.readContract({ address: entry.factory, abi, functionName: "accountOf", args: [account.address] })).toLowerCase() !== entry.account.toLowerCase()) throw new Error("Account qualification factory mismatch");
      await save(); console.log(JSON.stringify({ kind: entry.kind, account: entry.account, hash: entry.hash, status: entry.status, gasETH: entry.gasETH, paused: entry.observedPaused }));
    };
    for (const entry of journal.entries) await reconcile(entry);
    for (const kind of ["autopilot", "spot-limit"] as const) {
      if (journal.entries.some(entry => entry.kind === kind)) continue;
      const factory = kind === "autopilot" ? contracts.autopilotFactory : contracts.spotLimitFactory;
      if (!factory) throw new Error("Account qualification factory missing");
      const code = await client.getCode({ address: factory });
      if (!code || code === "0x") throw new Error("Account qualification factory bytecode missing");
      if (kind === "spot-limit" && await client.readContract({ address: factory, abi, functionName: "accountOf", args: [account.address] }) !== zeroAddress) throw new Error("Account qualification existing Spot account requires reconciliation");
      if (kind === "autopilot" && (await client.readContract({ address: factory, abi, functionName: "vaultsOf", args: [account.address] })).length) throw new Error("Account qualification existing Autopilot vault requires reconciliation");
      const data = kind === "autopilot" ? encodeFunctionData({ abi, functionName: "createVault", args: [ROBINHOOD_USDG, policyHash] }) : encodeFunctionData({ abi, functionName: "createAccount" });
      const tx = { account, to: factory, data, value: 0n };
      await client.call(tx);
      const gas = (await client.estimateGas(tx)) * 125n / 100n, fees = await client.estimateFeesPerGas(), cost = gas * fees.maxFeePerGas;
      const total = journal.entries.reduce((sum, entry) => sum + parseEther(entry.maxGasETH), 0n);
      if (cost > parseEther("0.00018") || total + cost > parseEther("0.0003")) throw new Error("Account qualification gas budget exceeded");
      if (await client.getBalance({ address: account.address }) < cost + parseEther("0.0002")) throw new Error("Account qualification gas reserve insufficient");
      console.log(JSON.stringify({ kind, broadcast, bufferedMaxETH: formatEther(cost) }));
      if (!broadcast) continue;
      const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
      if (nonce !== await client.getTransactionCount({ address: account.address, blockTag: "latest" })) throw new Error("Account qualification wallet has pending transactions");
      const signed = await wallet.signTransaction({ ...tx, chain, nonce, gas, ...fees, type: "eip1559" });
      const entry: Entry = { kind, factory, hash: keccak256(signed), nonce, status: "pending", maxGasETH: formatEther(cost) };
      journal.entries.push(entry); await save();
      if (await client.sendRawTransaction({ serializedTransaction: signed }) !== entry.hash) throw new Error("Account qualification broadcast mismatch");
      await reconcile(entry);
    }
    if (broadcast) { journal.completed = true; await save(); }
    console.log(JSON.stringify({ factoryQualificationComplete: journal.completed === true, fundsMoved: false, automationResumed: false }));
  } finally { await lock.close(); await unlink(`${path}.lock`); }
}
main().catch(error => { console.error(error instanceof Error && error.message.startsWith("Account qualification ") ? error.message : "Account qualification stopped; reconcile the public hash journal before retrying."); process.exitCode = 1; });
