import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const network = process.argv[2];
const ids = { xlayer: 196, base: 8453, arbitrum: 42161 };
const chainId = ids[network];
if (!chainId) throw new Error("Usage: node scripts/verify-bracket.mjs <network>");
const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "deployments", `${chainId}.json`);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const deployment = manifest.contracts.spotBracketFactory;
if (!deployment?.address || !deployment?.txHash) throw new Error("Bracket deployment is missing from manifest");
const stdJsonInput = JSON.parse(await readFile(resolve(root, "artifacts/standard-input.json"), "utf8"));
const compilerVersion = (await readFile(resolve(root, "artifacts/compiler-version.txt"), "utf8")).trim();
const response = await fetch(`https://sourcify.dev/server/v2/verify/${chainId}/${deployment.address}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stdJsonInput, compilerVersion, contractIdentifier: "SpotBracketAccountFactoryV1.sol:SpotBracketAccountFactoryV1", creationTransactionHash: deployment.txHash }) });
const submitted = await response.json().catch(() => ({}));
let result = { status: "already_verified", address: deployment.address };
if (response.status !== 409) {
  if (!response.ok || !submitted.verificationId) throw new Error(`submission failed ${response.status}: ${JSON.stringify(submitted)}`);
  let final;
  for (let index = 0; index < 90; index += 1) { await new Promise((resolveWait) => setTimeout(resolveWait, 2000)); final = await (await fetch(`https://sourcify.dev/server/v2/verify/${submitted.verificationId}`)).json(); if (final.isJobCompleted) break; }
  if (!final?.isJobCompleted || final.error || !final.contract?.match) throw new Error(`verification failed: ${JSON.stringify(final)}`);
  result = { status: "verified", address: deployment.address, verificationId: submitted.verificationId, result: final };
}
manifest.verificationBracket = { provider: "Sourcify v2", verifiedAt: new Date().toISOString(), result };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`${network} bracket factory verified at ${deployment.address}`);
