/** User-authorized Arc registry resume. Defaults to read-only, with durable receipts. */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { encodeFunctionData, parseAbi, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { qualificationJournal } from "./arc-qualification-journal.js";

async function main() {
  config({ quiet: true });
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { executionContracts, executionContractAddress } = await import("../apps/api/src/executionContracts.js");
  const cfg = loadConfig(), contracts = executionContracts("arc");
  const broadcast = process.argv.includes("--broadcast");
  const key = (process.env.CONTRACT_DEPLOYER_PRIVATE_KEY || cfg.TEST_WALLET_PRIVATE_KEY) as Hex;
  const executorKey = (cfg.ARC_AUTOMATION_EXECUTOR_PRIVATE_KEY || cfg.AUTOMATION_EXECUTOR_PRIVATE_KEY || cfg.TEST_WALLET_PRIVATE_KEY) as Hex;
  const executor = privateKeyToAccount(executorKey).address;
  const q = await qualificationJournal({ path: "packages/contracts/deployments/5042-user-resume.json", rpcUrl: cfg.ARC_RPC_URL,
    privateKey: key, owner: cfg.TEST_WALLET_ADDRESS, broadcast, budgetUSDC: "0.03", targets: [contracts.registry] });
  const abi = parseAbi(["function admin() view returns(address)", "function automationPaused() view returns(bool)",
    "function pauseAutomation(bool)", "function spotKeepers(address) view returns(bool)",
    "function autopilotExecutors(address) view returns(bool)", "function updaters(address) view returns(bool)",
    "function approvedAdapters(address) view returns(bool)", "function approvedRouters(address) view returns(bool)",
    "function approvedSpenders(address) view returns(bool)"]);
  try {
    await q.reconcile();
    if ((await q.client.readContract({ address: contracts.registry, abi, functionName: "admin" })).toLowerCase() !== q.account.address.toLowerCase())
      throw new Error("Resume signer is not the registry admin");
    const router = executionContractAddress("arc", "okxRouter"), spender = executionContractAddress("arc", "okxApproval");
    const checks = await Promise.all([
      q.client.readContract({ address: contracts.registry, abi, functionName: "spotKeepers", args: [executor] }),
      q.client.readContract({ address: contracts.registry, abi, functionName: "autopilotExecutors", args: [executor] }),
      q.client.readContract({ address: contracts.oracleRouter, abi, functionName: "updaters", args: [executor] }),
      q.client.readContract({ address: contracts.registry, abi, functionName: "approvedAdapters", args: [contracts.executionAdapter] }),
      q.client.readContract({ address: contracts.executionAdapter, abi, functionName: "approvedRouters", args: [router] }),
      q.client.readContract({ address: contracts.executionAdapter, abi, functionName: "approvedSpenders", args: [spender] }),
    ]);
    if (!checks.every(Boolean)) throw new Error("Resume execution roles or router permissions are missing");
    for (const address of Object.values(contracts)) {
      if (typeof address !== "string" || !/^0x[\da-f]{40}$/i.test(address)) continue;
      const code = await q.client.getCode({ address: address as `0x${string}` });
      if (!code || code === "0x") throw new Error("Resume contract bytecode is missing");
    }
    const paused = await q.client.readContract({ address: contracts.registry, abi, functionName: "automationPaused" });
    console.log(JSON.stringify({ chainId: 5042, registry: contracts.registry, executor, paused, rolesReady: true, broadcast }));
    if (!broadcast || !paused) return;
    const auditPath = process.argv.find(arg => arg.startsWith("--budget-audit="))?.slice(15);
    if (!auditPath) throw new Error("Resume requires a fresh receipt-complete budget audit");
    const audit = JSON.parse(await readFile(auditPath, "utf8"));
    const auditAge = Date.now() - Date.parse(audit.auditedAt);
    if (audit.chainId !== 5042 || audit.owner?.toLowerCase() !== q.account.address.toLowerCase()
      || audit.maximumTotalSpendUSDC !== "5" || audit.receiptAccountingComplete !== true
      || !Number.isFinite(auditAge) || auditAge < 0 || auditAge > 3_600_000
      || parseEther(audit.remainingAuthorizedSpendUSDC) < parseEther("0.03")
      || await q.client.getTransactionCount({ address: q.account.address, blockTag: "latest" }) !== audit.latestNonce)
      throw new Error("Resume budget or wallet nonce requires reconciliation");
    await q.send(`user-resume-${q.journal.entries.length + 1}`, contracts.registry,
      encodeFunctionData({ abi, functionName: "pauseAutomation", args: [false] }));
    if (await q.client.readContract({ address: contracts.registry, abi, functionName: "automationPaused" }))
      throw new Error("Resume registry remains paused after confirmation");
    q.journal.data.automationPaused = false;
    q.journal.data.authorizedBy = "User explicitly requested immediate unpause on 2026-10-07";
    q.journal.data.confirmedAt = new Date().toISOString();
    await q.save();
    console.log(JSON.stringify({ registryPaused: false, individualVaultPoliciesUnchanged: true }));
  } finally { await q.close(); }
}
main().then(() => process.exit(0)).catch(error => {
  console.error(error instanceof Error && /^(Resume |Qualification )/.test(error.message) ? error.message : "Arc resume stopped; inspect the public journal before retrying.");
  process.exit(1);
});
