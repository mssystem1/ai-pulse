/** Temporarily open Arc's execution gate for the authorized 1.50 USDC pass test. */
import { config } from "dotenv";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { qualificationJournal } from "./arc-qualification-journal.js";

async function main() {
  config({ quiet: true });
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { executionContracts } = await import("../apps/api/src/executionContracts.js");
  const cfg = loadConfig(), contracts = executionContracts("arc");
  const setup = JSON.parse(await readFile("packages/contracts/deployments/5042-autopilot-setup-qualification.json", "utf8"));
  if (!setup.data.registered || setup.owner.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase()) throw new Error("Qualification registered vault mismatch");
  const broadcast = process.argv.includes("--broadcast");
  const q = await qualificationJournal({ path: "packages/contracts/deployments/5042-autopilot-pass-gate-qualification.json", rpcUrl: cfg.ARC_RPC_URL,
    privateKey: cfg.TEST_WALLET_PRIVATE_KEY as Hex, owner: cfg.TEST_WALLET_ADDRESS, broadcast, budgetUSDC: "0.03", targets: [contracts.registry] });
  const abi = parseAbi(["function automationPaused() view returns(bool)", "function pauseAutomation(bool)", "function paused() view returns(bool)"]);
  let cleanup = false;
  try {
    await q.reconcile();
    if (q.journal.data.completed) { console.log("Autopilot pass qualification is complete; no new payment."); return; }
    if (!await q.client.readContract({ address: contracts.registry, abi, functionName: "automationPaused" })
      || !await q.client.readContract({ address: setup.data.vault, abi, functionName: "paused" })) throw new Error("Qualification requires paused registry and vault");
    console.log(JSON.stringify({ broadcast, service: "autopilot-24h", priceUSDC: "1.50", maximumGateGasUSDC: "0.03", vault: setup.data.vault }));
    if (!broadcast) return;
    if (q.journal.entries.length) throw new Error("Qualification partial gate attempt requires receipt reconciliation before retry");
    cleanup = true;
    await q.send("registry-resume", contracts.registry, encodeFunctionData({ abi, functionName: "pauseAutomation", args: [false] }));
    // The child persists and reuses its encrypted authorization. It runs no keeper loop.
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/arc-paid-qualification.ts", "--service=autopilot-24h", "--pay"], {
        stdio: "inherit", windowsHide: true, env: { ...process.env, AUTOMATION_WORKER_ENABLED: "0" },
      });
      child.once("error", reject); child.once("exit", code => resolve(code ?? 1));
    });
    if (code !== 0) throw new Error("Qualification pass request stopped; retain its existing authorization");
    const proof = JSON.parse(await readFile("packages/contracts/deployments/5042-autopilot-pass-qualification.json", "utf8"));
    if (proof.owner.toLowerCase() !== q.account.address.toLowerCase() || proof.vault.toLowerCase() !== setup.data.vault.toLowerCase()
      || !proof.paused || !proof.replayDidNotExtendPass || proof.paidUSDC !== "1.50") throw new Error("Qualification pass evidence mismatch");
    q.journal.data.passQualified = true; await q.save();
  } finally {
    try {
      if (cleanup) {
        await q.send("registry-pause", contracts.registry, encodeFunctionData({ abi, functionName: "pauseAutomation", args: [true] }));
        if (!await q.client.readContract({ address: contracts.registry, abi, functionName: "automationPaused" })) throw new Error("Qualification pause restoration failed");
        if (q.journal.data.passQualified) { q.journal.data.completed = true; await q.save(); }
      }
    } finally { await q.close(); }
  }
}
main().then(() => process.exit(0)).catch(error => {
  console.error(error instanceof Error && error.message.startsWith("Qualification ") ? error.message : "Arc pass qualification stopped; inspect its public journal before retrying.");
  process.exit(1);
});
