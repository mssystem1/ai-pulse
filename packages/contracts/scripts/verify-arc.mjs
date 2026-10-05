// Source verification only: submits public source/metadata, never a transaction.
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
const instances = process.argv.includes("--instances");
const manifestPath = resolve(import.meta.dirname, instances ? "../deployments/5042-instance-verification.json" : "../deployments/5042.json");
async function request(url, init = {}) {
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok && response.status !== 409) throw new Error(`Sourcify HTTP ${response.status}`);
  return { status: response.status, body };
}
async function main() {
  const deployment = JSON.parse(await readFile(resolve(import.meta.dirname, "../deployments/5042.json"), "utf8"));
  if (deployment.chainId !== 5042 || Object.keys(deployment.contracts || {}).length !== 7 || !deployment.contracts.spotProtectionFactory || !deployment.completedAt) throw new Error("Complete seven-contract mainnet deployment required");
  let manifest = deployment;
  if (instances) {
    const accounts = JSON.parse(await readFile(resolve(import.meta.dirname, "../deployments/5042-account-qualification.json"), "utf8"));
    if (accounts.chainId !== 5042 || !accounts.completed || accounts.entries.length !== 4) throw new Error("Completed mainnet account qualification required");
    const names = { autopilot: "AutopilotVaultV2", "spot-limit": "SpotOrderAccountV2", "spot-protection": "SpotOrderAccountV1", "spot-bracket": "SpotBracketAccountV1" };
    manifest = { chainId: 5042, owner: accounts.owner, completedAt: deployment.completedAt, standardInput: deployment.standardInput, compilerVersion: deployment.compilerVersion,
      contracts: Object.fromEntries(accounts.entries.map(entry => [entry.kind, { address: entry.account, txHash: entry.hash, contractName: names[entry.kind] }])), verification: { provider: "Sourcify v2", results: {} } };
    try { manifest.verification = JSON.parse(await readFile(manifestPath, "utf8")).verification; } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const available = await request("https://sourcify.dev/server/chains");
  if (!available.body?.some((item) => item.chainId === 5042 && item.supported)) throw new Error("Sourcify mainnet support unavailable");
  manifest.verification ||= { provider: "Sourcify v2", results: {} };
  async function save() { await writeFile(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2)); await rename(`${manifestPath}.tmp`, manifestPath); }
  for (const [key, contract] of Object.entries(manifest.contracts)) {
    // Even a previously recorded match must be independently available now.
    const existing = await fetch(`https://sourcify.dev/server/v2/contract/5042/${contract.address}`, { signal: AbortSignal.timeout(20_000) });
    const match = existing.ok ? await existing.json() : null;
    if (match?.creationMatch === "exact_match" && match?.runtimeMatch === "exact_match") {
      manifest.verification.results[key] = { status: "verified", address: contract.address, creationMatch: match.creationMatch, runtimeMatch: match.runtimeMatch };
      await save(); console.log(`${key}: verified exact creation/runtime match`); continue;
    }
    const submission = await request(`https://sourcify.dev/server/v2/verify/5042/${contract.address}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stdJsonInput: manifest.standardInput, compilerVersion: manifest.compilerVersion,
        contractIdentifier: `${contract.contractName}.sol:${contract.contractName}`, creationTransactionHash: contract.txHash }),
    });
    const verificationId = submission.body?.verificationId;
    if (!verificationId) throw new Error(`${key}: verification ID missing; inspect public verification status`);
    manifest.verification.results[key] = { status: "pending", address: contract.address, verificationId }; await save();
    let result;
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((done) => setTimeout(done, 2000));
      result = (await request(`https://sourcify.dev/server/v2/verify/${verificationId}`)).body;
      if (result?.isJobCompleted) break;
    }
    if (!result?.isJobCompleted || result.error || result.contract?.creationMatch !== "exact_match" || result.contract?.runtimeMatch !== "exact_match") {
      manifest.verification.results[key] = { status: "not_verified", address: contract.address, verificationId, result }; await save();
      throw new Error(`${key}: source verification did not produce exact creation/runtime matches`);
    }
    manifest.verification.results[key] = { status: "verified", address: contract.address, verificationId, result }; await save();
    console.log(`${key}: verified exact creation/runtime match`);
  }
  manifest.verification.verifiedAt = new Date().toISOString();
  manifest.status = "deployed_verified_paused"; await save();
  console.log(instances ? "All four owner account/vault instances verified." : "All seven contracts verified. Trading remains disabled pending integration and route/oracle checks.");
}
main().catch((error) => { console.error("Arc verification stopped:", error.name === "Error" ? error.message : error.name); process.exitCode = 1; });
