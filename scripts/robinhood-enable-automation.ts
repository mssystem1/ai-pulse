/** Explicit owner-requested release action. Does not resume individual vaults. */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { encodeFunctionData, keccak256, parseAbi, type Address, type Hex } from "viem";
import { qualificationJournal } from "./robinhood-qualification-journal.js";

async function main() {
  config({ quiet: true });
  const manifest = JSON.parse(await readFile("packages/contracts/deployments/4663.json", "utf8"));
  const registry = manifest.contracts.registry.address as Address;
  const broadcast = process.argv.includes("--broadcast");
  const q = await qualificationJournal({ path: "packages/contracts/deployments/4663-automation-activation.json",
    rpcUrl: process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
    privateKey: process.env.TEST_WALLET_PRIVATE_KEY as Hex, owner: manifest.guardian,
    budgetETH: "0.00002", targets: [registry], broadcast });
  const abi = parseAbi(["function guardian() view returns(address)", "function automationPaused() view returns(bool)", "function pauseAutomation(bool)"]);
  try {
    const code = await q.client.getCode({ address: registry });
    if (!code || keccak256(code) !== manifest.contracts.registry.runtimeCodeHash) throw new Error("Registry code does not match reviewed deployment");
    const guardian = await q.client.readContract({ address: registry, abi, functionName: "guardian" });
    if (guardian.toLowerCase() !== q.account.address.toLowerCase()) throw new Error("Signer is not the current registry guardian");
    await q.reconcile();
    const before = await q.client.readContract({ address: registry, abi, functionName: "automationPaused" });
    console.log(JSON.stringify({ chainId: 4663, registry, guardian, automationPaused: before, broadcast }));
    if (before && broadcast) await q.send("owner-approved-automation-enable", registry, encodeFunctionData({ abi, functionName: "pauseAutomation", args: [false] }));
    const after = await q.client.readContract({ address: registry, abi, functionName: "automationPaused" });
    if (broadcast && after) throw new Error("Automation remains paused");
    q.journal.data.automationPaused = after;
    q.journal.data.individualVaultsUnchanged = true;
    if (broadcast) await q.save();
    console.log(JSON.stringify({ automationPaused: after, individualVaultsUnchanged: true }));
  } finally { await q.close(); }
}
main().catch(() => { console.error("Registry activation could not be verified. Inspect the saved public transaction journal before retrying; no secrets printed."); process.exitCode = 1; });
