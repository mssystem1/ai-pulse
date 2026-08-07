import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASELINE = "540d9f1b31295f1f39bc197a14b270c2de8b0a98";
const root = process.cwd();

function parseEnv(text) {
  const values = new Map();
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = raw.indexOf("=");
    if (separator < 1) continue;
    const key = raw.slice(0, separator).trim();
    let value = raw.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (/^[A-Z][A-Z0-9_]*$/.test(key)) values.set(key, value);
  }
  return values;
}

function serialize(keys, local) {
  return [
    `# Generated from .env; variables added after ${BASELINE}.`,
    "# Contains secrets. Do not commit this file.",
    ...keys.map((key) => `${key}=${JSON.stringify(local.get(key) ?? "")}`),
    "",
  ].join("\n");
}

const baseline = parseEnv(execFileSync("git", ["show", `${BASELINE}:.env.example`], { cwd: root, encoding: "utf8" }));
const template = parseEnv(readFileSync(resolve(root, ".env.example"), "utf8"));
const local = parseEnv(readFileSync(resolve(root, ".env"), "utf8"));
const excluded = new Set(["TEST_WALLET_ADDRESS", "TEST_WALLET_PRIVATE_KEY", "ENABLE_SERVER_PAY", "RUN_LIVE_PAY"]);
const added = [...template.keys()].filter((key) => !baseline.has(key) && local.has(key) && local.get(key) !== "" && !excluded.has(key));
writeFileSync(resolve(root, ".env.cloud"), serialize(added, local), { encoding: "utf8", mode: 0o600 });
console.log(`Created .env.cloud (${added.length} newly added PULSE variables).`);
console.log("Import this same file into both Vercel and Railway so the added configuration is identical.");
console.log("Excluded test-wallet keys and operator-only live-payment controls.");
console.log("Excluded optional variables whose value is empty in .env.");
