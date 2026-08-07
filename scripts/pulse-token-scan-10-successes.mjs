#!/usr/bin/env node

/**
 * PULSE — perform exactly 10 successful paid X Layer Token Risk Scan usages.
 *
 * A usage counts only when all of these are true:
 *   1. The paid replay returns HTTP 200.
 *   2. PAYMENT-RESPONSE is present.
 *   3. The JSON body is a valid token_scan report for the requested address.
 *   4. The report contains a components array.
 *
 * Failed or malformed attempts do not increase the success counter. The script
 * retries until it reaches 10 successful usages or MAX_ATTEMPTS is exhausted.
 *
 * Run this file from the root of the mssystem1/Pulse repository.
 */

import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  parseAbi,
} from "viem";

const SUCCESS_TARGET = 10;
const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_RETRY_DELAY_MS = 2_000;

const DEFAULT_ENDPOINT =
  "https://pulse-api-production-8d1f.up.railway.app/v1/token/scan";
const DEFAULT_TOKEN =
  "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const DEFAULT_NETWORK = "eip155:196";
const DEFAULT_RPC = "https://rpc.xlayer.tech";
const DEFAULT_ASSET =
  "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const DEFAULT_AMOUNT_ATOMIC = "10000";

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
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

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseInteger(value, label, min, max) {
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < min ||
    parsed > max
  ) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

function normalizePrivateKey(value) {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(
      "TEST_WALLET_PRIVATE_KEY must be exactly 32 bytes of hexadecimal data.",
    );
  }
  return normalized;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function decodeBase64Json(value) {
  if (!value) return null;

  try {
    const normalized = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");

    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  } catch {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
}

function getPaymentHeader(headers, name) {
  return headers.get(name) ?? headers.get(name.toLowerCase());
}

function firstAcceptedPayment(challenge) {
  const accepted = challenge?.accepts?.[0];
  if (!accepted || typeof accepted !== "object") {
    throw new Error("The 402 response does not contain accepts[0].");
  }
  return accepted;
}

function assertEqual(actual, expected, label) {
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(
      `${label} mismatch: received ${String(actual)}, expected ${String(expected)}.`,
    );
  }
}

function transactionFromReceipt(receipt) {
  return (
    receipt?.transaction ??
    receipt?.txHash ??
    receipt?.tx_hash ??
    receipt?.transactionHash ??
    null
  );
}

async function readJsonResponse(response) {
  const text = await response.text();

  try {
    return { body: JSON.parse(text), raw: text };
  } catch {
    return { body: null, raw: text };
  }
}

function formatTokenAmount(atomic, decimals) {
  const divisor = 10n ** BigInt(decimals);
  const whole = atomic / divisor;
  const fraction = (atomic % divisor)
    .toString()
    .padStart(Number(decimals), "0")
    .replace(/0+$/, "");

  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function writeCheckpoint(path, state) {
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8");
  renameSync(temporaryPath, path);
}

async function inspectPaymentTerms(endpoint, requestBody) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const { body, raw } = await readJsonResponse(response);
  const encodedChallenge = getPaymentHeader(
    response.headers,
    "PAYMENT-REQUIRED",
  );

  if (response.status !== 402 || !encodedChallenge) {
    throw new Error(
      `Expected HTTP 402 with PAYMENT-REQUIRED, received ${response.status}: ` +
        raw.slice(0, 500),
    );
  }

  const challenge = decodeBase64Json(encodedChallenge);
  if (!challenge) {
    throw new Error("Could not decode the PAYMENT-REQUIRED header.");
  }

  return { challenge, responseBody: body };
}

function validateSuccessfulReport({
  response,
  body,
  raw,
  encodedReceipt,
  receipt,
  tokenAddress,
  seenTransactions,
}) {
  if (response.status !== 200) {
    throw new Error(
      `Expected HTTP 200, received ${response.status}: ${raw.slice(0, 800)}`,
    );
  }

  if (!encodedReceipt) {
    throw new Error(
      "HTTP 200 response did not include the PAYMENT-RESPONSE header.",
    );
  }

  if (!receipt) {
    throw new Error("PAYMENT-RESPONSE could not be decoded.");
  }

  if (body?.service !== "token_scan") {
    throw new Error(
      `Unexpected service marker: ${JSON.stringify(body?.service)}.`,
    );
  }

  if (
    typeof body?.address !== "string" ||
    body.address.toLowerCase() !== tokenAddress.toLowerCase()
  ) {
    throw new Error(
      `Response address does not match ${tokenAddress}: ` +
        `${JSON.stringify(body?.address)}.`,
    );
  }

  if (!Array.isArray(body?.components)) {
    throw new Error("Response does not contain a components array.");
  }

  const transaction = transactionFromReceipt(receipt);

  if (transaction) {
    const normalizedTransaction = String(transaction).toLowerCase();
    if (seenTransactions.has(normalizedTransaction)) {
      throw new Error(
        `Duplicate payment transaction returned: ${transaction}.`,
      );
    }
    seenTransactions.add(normalizedTransaction);
  }

  return transaction;
}

async function main() {
  loadDotEnv();

  if (process.env.CONFIRM_LIVE_PAY !== "YES") {
    throw new Error(
      'Set CONFIRM_LIVE_PAY="YES" only after checking the endpoint, price, network, asset, recipient, and wallet balance.',
    );
  }

  const endpoint = process.env.PULSE_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
  const tokenAddress = getAddress(
    process.env.TOKEN_ADDRESS?.trim() || DEFAULT_TOKEN,
  );
  const chainId = process.env.TOKEN_CHAIN_ID?.trim() || "196";
  const rpcUrl = process.env.X_LAYER_RPC?.trim() || DEFAULT_RPC;
  const network = process.env.X402_NETWORK?.trim() || DEFAULT_NETWORK;
  const expectedAsset = getAddress(
    process.env.X402_ASSET?.trim() || DEFAULT_ASSET,
  );
  const expectedAmountAtomic =
    process.env.EXPECTED_AMOUNT_ATOMIC?.trim() || DEFAULT_AMOUNT_ATOMIC;

  const maxAttempts = parseInteger(
    process.env.MAX_ATTEMPTS?.trim() || String(DEFAULT_MAX_ATTEMPTS),
    "MAX_ATTEMPTS",
    SUCCESS_TARGET,
    100,
  );

  const retryDelayMs = parseInteger(
    process.env.RETRY_DELAY_MS?.trim() ||
      String(DEFAULT_RETRY_DELAY_MS),
    "RETRY_DELAY_MS",
    0,
    60_000,
  );

  if (
    !/^\d+$/.test(expectedAmountAtomic) ||
    BigInt(expectedAmountAtomic) <= 0n
  ) {
    throw new Error("EXPECTED_AMOUNT_ATOMIC must be a positive integer.");
  }

  const expectedPayToRaw = process.env.EXPECTED_PAY_TO?.trim();
  const expectedPayTo = expectedPayToRaw
    ? getAddress(expectedPayToRaw)
    : null;

  const privateKey = normalizePrivateKey(
    requiredEnv("TEST_WALLET_PRIVATE_KEY"),
  );

  const buyerModuleUrl = pathToFileURL(
    resolve(process.cwd(), "packages/buyer/dist/index.js"),
  ).href;

  let createPaidFetch;
  let buyerAddress;

  try {
    ({ createPaidFetch, buyerAddress } = await import(buyerModuleUrl));
  } catch (error) {
    throw new Error(
      "Could not load packages/buyer/dist/index.js. Run " +
        '"npm run build -w @pulse/buyer" from the PULSE repository root. ' +
        `Original error: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }

  const walletAddress = getAddress(buyerAddress(privateKey));
  const requestBody = {
    address: tokenAddress,
    chainId,
  };

  const outputFile = resolve(
    process.cwd(),
    process.env.OUTPUT_FILE?.trim() ||
      `pulse-token-scan-10-successes-${safeTimestamp()}.json`,
  );

  const state = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "running",
    endpoint,
    walletAddress,
    tokenAddress,
    chainId,
    successTarget: SUCCESS_TARGET,
    successfulUsages: 0,
    attemptsMade: 0,
    maxAttempts,
    payment: null,
    successfulResults: [],
    failedAttempts: [],
  };

  writeCheckpoint(outputFile, state);

  console.log("PULSE X Layer Token Risk Scan");
  console.log(`Endpoint:            ${endpoint}`);
  console.log(`Wallet:              ${walletAddress}`);
  console.log(`Token:               ${tokenAddress}`);
  console.log(`Successful usages:   ${SUCCESS_TARGET}`);
  console.log(`Maximum attempts:    ${maxAttempts}`);
  console.log(`Checkpoint:          ${outputFile}`);
  console.log("");

  console.log("Inspecting x402 payment terms...");
  const { challenge } = await inspectPaymentTerms(endpoint, requestBody);
  const accepted = firstAcceptedPayment(challenge);

  assertEqual(accepted.scheme, "exact", "Payment scheme");
  assertEqual(accepted.network, network, "Payment network");
  assertEqual(accepted.asset, expectedAsset, "Payment asset");
  assertEqual(accepted.amount, expectedAmountAtomic, "Payment amount");

  if (!isAddress(accepted.payTo)) {
    throw new Error(
      `Invalid payTo address in challenge: ${String(accepted.payTo)}`,
    );
  }

  const payTo = getAddress(accepted.payTo);

  if (/^0x0{40}$/i.test(payTo)) {
    throw new Error("The challenge contains the zero address as payTo.");
  }

  if (expectedPayTo) {
    assertEqual(payTo, expectedPayTo, "Payment recipient");
  }

  state.payment = {
    scheme: accepted.scheme,
    network: accepted.network,
    asset: getAddress(accepted.asset),
    amountAtomicPerUsage: String(accepted.amount),
    payTo,
  };
  writeCheckpoint(outputFile, state);

  console.log(`Network:              ${accepted.network}`);
  console.log(`Asset:                ${getAddress(accepted.asset)}`);
  console.log(`Amount per usage:     ${accepted.amount} atomic units`);
  console.log(`Recipient:            ${payTo}`);
  console.log("");

  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  });

  const [initialBalance, decimals, symbol] = await Promise.all([
    publicClient.readContract({
      address: expectedAsset,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [walletAddress],
    }),
    publicClient.readContract({
      address: expectedAsset,
      abi: ERC20_ABI,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: expectedAsset,
      abi: ERC20_ABI,
      functionName: "symbol",
    }),
  ]);

  const minimumRequired =
    BigInt(expectedAmountAtomic) * BigInt(SUCCESS_TARGET);

  if (initialBalance < minimumRequired) {
    throw new Error(
      `Insufficient ${symbol}. Wallet has ` +
        `${formatTokenAmount(initialBalance, decimals)} ${symbol}; ` +
        `${SUCCESS_TARGET} successful usages require at least ` +
        `${formatTokenAmount(minimumRequired, decimals)} ${symbol}.`,
    );
  }

  console.log(
    `Initial balance:     ${formatTokenAmount(initialBalance, decimals)} ${symbol}`,
  );
  console.log(
    `Minimum for 10:      ${formatTokenAmount(minimumRequired, decimals)} ${symbol}`,
  );
  console.log("");

  const paidFetch = createPaidFetch({
    privateKey,
    rpcUrl,
    network,
  });

  const seenTransactions = new Set();

  while (
    state.successfulUsages < SUCCESS_TARGET &&
    state.attemptsMade < maxAttempts
  ) {
    state.attemptsMade += 1;
    const attempt = state.attemptsMade;

    console.log(
      `Attempt ${attempt}/${maxAttempts} — ` +
        `${state.successfulUsages}/${SUCCESS_TARGET} successful`,
    );

    try {
      const currentBalance = await publicClient.readContract({
        address: expectedAsset,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [walletAddress],
      });

      if (currentBalance < BigInt(expectedAmountAtomic)) {
        throw new Error(
          `Insufficient ${symbol} for another paid usage. Current balance: ` +
            `${formatTokenAmount(currentBalance, decimals)} ${symbol}.`,
        );
      }

      const response = await paidFetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const { body, raw } = await readJsonResponse(response);
      const encodedReceipt = getPaymentHeader(
        response.headers,
        "PAYMENT-RESPONSE",
      );
      const receipt = decodeBase64Json(encodedReceipt);

      const transaction = validateSuccessfulReport({
        response,
        body,
        raw,
        encodedReceipt,
        receipt,
        tokenAddress,
        seenTransactions,
      });

      state.successfulUsages += 1;

      state.successfulResults.push({
        usage: state.successfulUsages,
        attempt,
        completedAt: new Date().toISOString(),
        httpStatus: response.status,
        transaction,
        receipt,
        report: body,
      });

      writeCheckpoint(outputFile, state);

      console.log(
        `  SUCCESS ${state.successfulUsages}/${SUCCESS_TARGET}: ` +
          `riskScore=${String(body.riskScore)}, ` +
          `verdict=${String(body.verdict)}, ` +
          `tx=${transaction || "receipt decoded"}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      state.failedAttempts.push({
        attempt,
        failedAt: new Date().toISOString(),
        error: message,
      });

      writeCheckpoint(outputFile, state);
      console.error(`  FAILED: ${message}`);

      if (
        /Insufficient .* for another paid usage/i.test(message)
      ) {
        break;
      }
    }

    if (
      state.successfulUsages < SUCCESS_TARGET &&
      state.attemptsMade < maxAttempts &&
      retryDelayMs > 0
    ) {
      console.log(`  Waiting ${retryDelayMs} ms before next attempt...`);
      await sleep(retryDelayMs);
    }
  }

  state.finishedAt = new Date().toISOString();

  if (state.successfulUsages === SUCCESS_TARGET) {
    state.status = "completed";
    writeCheckpoint(outputFile, state);

    console.log("");
    console.log("==================================================");
    console.log("COMPLETED: 10/10 successful paid service usages.");
    console.log(`Attempts made: ${state.attemptsMade}`);
    console.log(`Results file:  ${outputFile}`);
    console.log("==================================================");
    return;
  }

  state.status = "incomplete";
  writeCheckpoint(outputFile, state);

  throw new Error(
    `Only ${state.successfulUsages}/${SUCCESS_TARGET} successful usages ` +
      `were completed after ${state.attemptsMade} attempts. ` +
      `Review ${outputFile}. No success was counted without a validated ` +
      "HTTP 200 report and PAYMENT-RESPONSE receipt.",
  );
}

main().catch((error) => {
  console.error("");
  console.error(
    `ERROR: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
