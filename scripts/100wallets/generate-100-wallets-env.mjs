#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  loadEnvFiles,
  writeWalletRegistryEnv,
} from "./wallet-registry.mjs";

loadEnvFiles([".env"]);

const walletCount = Number(process.env.WALLET_COUNT || "100");
const output = process.env.WALLET_ENV_FILE || ".env.wallets" || ".env.scripts";
const outputPath = resolve(process.cwd(), output);

if (!Number.isSafeInteger(walletCount) || walletCount !== 100) {
  throw new Error("WALLET_COUNT must be exactly 100 for this architecture.");
}

if (existsSync(outputPath) && process.env.FORCE_OVERWRITE !== "YES") {
  throw new Error(
    `${outputPath} already exists. Set FORCE_OVERWRITE="YES" only when ` +
      "you intentionally want to destroy and replace the current registry.",
  );
}

const wallets = [];
const seen = new Set();

while (wallets.length < walletCount) {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const normalized = account.address.toLowerCase();
  if (seen.has(normalized)) continue;
  seen.add(normalized);

  wallets.push({
    id: `pulse-wallet-${String(wallets.length + 1).padStart(3, "0")}`,
    address: account.address,
    privateKey,
  });
}

const savedPath = writeWalletRegistryEnv(wallets, output);

console.log(`Generated ${wallets.length} unique EVM wallets.`);
console.log(`Wallet registry env file: ${savedPath}`);
console.log(`Environment variable: PULSE_WALLETS_JSON`);
console.log("");
console.log("The private keys were not printed to the terminal.");
console.log("Add .env.wallets to .gitignore and keep an encrypted offline backup.");
