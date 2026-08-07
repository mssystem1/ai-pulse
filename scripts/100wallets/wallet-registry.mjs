#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const WALLET_REGISTRY_ENV = "PULSE_WALLETS_JSON";

export function loadEnvFiles(
  paths = [".env", ".env.wallets", ".env.scripts"],
) {
  for (const candidate of paths) {
    const filePath = resolve(process.cwd(), candidate);
    if (!existsSync(filePath)) continue;

    for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const match = line.match(/^([^=]+)=(.*)$/);
      if (!match) continue;

      const key = match[1].trim();
      let value = match[2].trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

export function normalizePrivateKey(value, label = "privateKey") {
  const normalized = String(value || "").startsWith("0x")
    ? String(value)
    : `0x${String(value || "")}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`${label} must be exactly 32 bytes of hexadecimal data.`);
  }

  return normalized;
}

export function loadWalletRegistry({
  expectedCount = 100,
  requirePrivateKeys = true,
} = {}) {
  const raw = process.env[WALLET_REGISTRY_ENV]?.trim();
  if (!raw) {
    throw new Error(
      `${WALLET_REGISTRY_ENV} is missing. Run generate-100-wallets-env.mjs ` +
        "or load the generated .env.wallets file.",
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${WALLET_REGISTRY_ENV} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${WALLET_REGISTRY_ENV} must contain a JSON array.`);
  }

  if (parsed.length !== expectedCount) {
    throw new Error(
      `${WALLET_REGISTRY_ENV} contains ${parsed.length} wallets; ` +
        `${expectedCount} are required.`,
    );
  }

  const seenAddresses = new Set();

  return parsed.map((entry, index) => {
    const id =
      typeof entry?.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : `pulse-wallet-${String(index + 1).padStart(3, "0")}`;

    if (!entry?.address || !isAddress(entry.address)) {
      throw new Error(`Wallet ${index + 1} has an invalid address.`);
    }

    const address = getAddress(entry.address);
    const normalizedAddress = address.toLowerCase();

    if (seenAddresses.has(normalizedAddress)) {
      throw new Error(`Duplicate wallet address found: ${address}.`);
    }
    seenAddresses.add(normalizedAddress);

    let privateKey = null;
    if (entry?.privateKey) {
      privateKey = normalizePrivateKey(
        entry.privateKey,
        `Wallet ${index + 1} privateKey`,
      );
      const derivedAddress = privateKeyToAccount(privateKey).address;
      if (derivedAddress.toLowerCase() !== normalizedAddress) {
        throw new Error(
          `Wallet ${index + 1} private key resolves to ${derivedAddress}, ` +
            `not ${address}.`,
        );
      }
    } else if (requirePrivateKeys) {
      throw new Error(`Wallet ${index + 1} is missing privateKey.`);
    }

    return { id, address, privateKey };
  });
}

export function writeWalletRegistryEnv(wallets, output = ".env.wallets") {
  const outputPath = resolve(process.cwd(), output);
  const compactJson = JSON.stringify(wallets);

  if (compactJson.includes("'")) {
    throw new Error("Wallet JSON unexpectedly contains a single quote.");
  }

  const content = [
    "# Generated locally. Contains private keys. Never commit or share this file.",
    `${WALLET_REGISTRY_ENV}='${compactJson}'`,
    "",
  ].join("\n");

  writeFileSync(outputPath, content, "utf8");

  try {
    chmodSync(outputPath, 0o600);
  } catch {
    // Windows does not apply POSIX permissions in the same way.
  }

  return outputPath;
}
