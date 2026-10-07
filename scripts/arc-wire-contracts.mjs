// Consume actual verified deployment evidence; never infer addresses from a plan.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, http, keccak256 } from "viem";
const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "packages/contracts/deployments/5042.json"), "utf8"));
if (manifest.chainId !== 5042 || !manifest.completedAt || !manifest.verification?.verifiedAt) throw new Error("Completed and source-verified Arc mainnet deployment required");
const names = { registry: "ARC_PULSE_REGISTRY_ADDRESS", oracleRouter: "ARC_ORACLE_ROUTER_ADDRESS", executionAdapter: "ARC_EXECUTION_ADAPTER_ADDRESS", spotProtectionFactory: "ARC_SPOT_ORDER_FACTORY_ADDRESS", spotFactory: "ARC_SPOT_LIMIT_FACTORY_ADDRESS", spotBracketFactory: "ARC_SPOT_BRACKET_FACTORY_ADDRESS", autopilotFactory: "ARC_AUTOPILOT_VAULT_FACTORY_ADDRESS" };
const values = {};
for (const [key, name] of Object.entries(names)) {
  const address = manifest.contracts[key]?.address;
  if (!/^0x(?!0{40}$)[a-fA-F0-9]{40}$/.test(address || "") || manifest.verification.results[key]?.status !== "verified") throw new Error(`Verified Arc contract missing: ${key}`);
  values[name] = address;
}
const readiness = JSON.parse(await readFile(resolve(root, "docs/ARC_MAINNET_READINESS_2026-10-04.json"), "utf8"));
const route = readiness.checks?.find(check => check.name === "okx-arc-live-route");
if (readiness.chainId !== 5042 || !route?.ready || Date.now() - Date.parse(readiness.asOf) > 86_400_000) throw new Error("Fresh successful Arc route evidence is required before wiring router/spender addresses");
const client = createPublicClient({ transport: http(process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io", { timeout: 15_000, retryCount: 1 }) });
if (await client.getChainId() !== 5042) throw new Error("Arc wiring RPC network mismatch");
for (const [key, name] of [["router", "ARC_OKX_ROUTER_ADDRESS"], ["spender", "ARC_OKX_APPROVAL_ADDRESS"]]) {
  const address = route[key];
  if (!/^0x(?!0{40}$)[a-fA-F0-9]{40}$/.test(address || "")) throw new Error("Invalid Arc route contract address");
  const code = await client.getCode({ address });
  if (!code || code === "0x" || keccak256(code) !== route[`${key}RuntimeCodeHash`]) throw new Error("Arc route bytecode changed since qualification");
  values[name] = address;
}
// Operational activation is explicit; the API still checks live on-chain readiness.
// Full acceptance may remain incomplete after the owner has resumed execution.
values.FEATURE_ARC_TRADING = manifest.tradingEnabled ? "1" : "0";
console.log(JSON.stringify({ chainId: 5042, source: "verified deployment manifest", environment: values, api: "network=arc; /v1/trading/capabilities", ui: "Arc Mainnet; reads contract capabilities from API", sdk: "network arc; eip155:5042" }, null, 2));
const targets = [
  ...(process.argv.includes("--write-env") ? [".env"] : []),
  ...(process.argv.includes("--write-examples") ? [".env.example", ".env.local.example", ".env.production.example"] : []),
];
for (const file of targets) {
  const path = resolve(root, file);
  const original = await readFile(path, "utf8");
  let next = original;
  for (const [name, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${name}=.*$`, "gm");
    next = pattern.test(next) ? next.replace(pattern, `${name}=${value}`) : `${next.trimEnd()}\n${name}=${value}\n`;
  }
  // Refuse to overwrite a concurrent credential/configuration edit.
  if (await readFile(path, "utf8") !== original) throw new Error("Environment changed during wiring; retry from a fresh read");
  await writeFile(path, next);
  console.log(`Arc public contract settings wired into ${file}.`);
}
