#!/usr/bin/env node

/**
 * Fast, balance-based PULSE x402 runner.
 *
 * For every generated wallet:
 *   affordableCalls = floor(current USDT0 balance / x402 price)
 *   plannedCalls    = min(MAX_CALLS_PER_WALLET, affordableCalls)
 *
 * Examples at a 0.01 USDT0 price:
 *   0.00 USDT0 -> 0 calls
 *   0.01 USDT0 -> 1 call
 *   0.05 USDT0 -> 5 calls
 *   0.10 USDT0 -> 10 calls
 *   0.11 USDT0 -> 10 calls (per-run cap)
 *
 * Speed improvements:
 *   - loads PULSE_WALLETS_JSON directly from .env/.env.wallets;
 *   - reads wallet balances concurrently once before execution;
 *   - runs several independent wallets concurrently;
 *   - keeps calls sequential inside each wallet;
 *   - does not sleep after successful calls;
 *   - retries only failures with exponential backoff + jitter;
 *   - reduces checkpoint disk writes.
 *
 * It deliberately does NOT inspect prior transaction history. A rerun uses the
 * wallet's current USDT0 balance to decide how many additional calls to make.
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
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_ENDPOINT =
  "https://pulse-api-production-8d1f.up.railway.app/v1/token/scan";
const DEFAULT_TOKEN =
  "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const DEFAULT_RPC = "https://rpc.xlayer.tech";
const DEFAULT_NETWORK = "eip155:196";
const DEFAULT_ASSET =
  "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const DEFAULT_AMOUNT_ATOMIC = "10000";

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

function loadEnvFiles(paths = [".env", ".env.wallets", ".env.scripts", ".env.scripts"]) {
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

      // Shell/Codespaces secrets override local env files.
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function loadWallets(expectedCount) {
  const raw = process.env.PULSE_WALLETS_JSON?.trim();

  if (!raw) {
    throw new Error(
      "PULSE_WALLETS_JSON is missing. Put it in .env.wallets or export it.",
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `PULSE_WALLETS_JSON is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("PULSE_WALLETS_JSON must contain a JSON array.");
  }

  if (parsed.length !== expectedCount) {
    throw new Error(
      `PULSE_WALLETS_JSON contains ${parsed.length} wallets; expected ${expectedCount}.`,
    );
  }

  const seen = new Set();

  return parsed.map((entry, index) => {
    if (!entry?.address || !isAddress(entry.address)) {
      throw new Error(`Wallet ${index + 1} has an invalid address.`);
    }

    const address = getAddress(entry.address);
    const key = address.toLowerCase();

    if (seen.has(key)) {
      throw new Error(`Duplicate wallet address: ${address}.`);
    }
    seen.add(key);

    const privateKey = String(entry.privateKey || "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      throw new Error(`Wallet ${index + 1} has an invalid private key.`);
    }

    const derivedAddress = privateKeyToAccount(privateKey).address;
    if (derivedAddress.toLowerCase() !== key) {
      throw new Error(
        `Wallet ${index + 1} private key does not match ${address}.`,
      );
    }

    return {
      id:
        typeof entry.id === "string" && entry.id.trim()
          ? entry.id.trim()
          : `pulse-wallet-${String(index + 1).padStart(3, "0")}`,
      address,
      privateKey,
    };
  });
}

function parseInteger(value, name, minimum, maximum) {
  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  }

  return parsed;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function decodeHeader(value) {
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

function paymentHeader(headers, name) {
  return headers.get(name) || headers.get(name.toLowerCase());
}

function transactionFromReceipt(receipt) {
  return (
    receipt?.transaction ||
    receipt?.txHash ||
    receipt?.tx_hash ||
    receipt?.transactionHash ||
    null
  );
}

function checkpoint(path, state) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
  renameSync(temporary, path);
}

async function responseJson(response) {
  const raw = await response.text();

  try {
    return { body: JSON.parse(raw), raw };
  } catch {
    return { body: null, raw };
  }
}

async function inspectTerms(endpoint, body, timeoutMs) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const encoded = paymentHeader(response.headers, "PAYMENT-REQUIRED");
  const parsed = await responseJson(response);

  if (response.status !== 402 || !encoded) {
    throw new Error(
      `Expected 402 challenge; received ${response.status}: ${parsed.raw.slice(0, 500)}`,
    );
  }

  const challenge = decodeHeader(encoded);
  const accepted = challenge?.accepts?.[0];

  if (!accepted) {
    throw new Error("402 challenge does not contain accepts[0].");
  }

  return accepted;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );

  return results;
}

function retryDelay(baseMs, maximumMs, consecutiveFailures) {
  const exponential = Math.min(
    maximumMs,
    baseMs * 2 ** Math.max(0, consecutiveFailures - 1),
  );
  const jitter = Math.floor(Math.random() * Math.max(100, baseMs));
  return exponential + jitter;
}

loadEnvFiles();

if (process.env.CONFIRM_LIVE_PAY !== "YES") {
  throw new Error(
    'Set CONFIRM_LIVE_PAY="YES" only after verifying the endpoint, price, recipient, wallets, and balances.',
  );
}

const expectedWalletCount = parseInteger(
  process.env.EXPECTED_WALLET_COUNT?.trim() || "100",
  "EXPECTED_WALLET_COUNT",
  1,
  10000,
);
const maxCallsPerWallet = parseInteger(
  process.env.MAX_CALLS_PER_WALLET?.trim() || "10",
  "MAX_CALLS_PER_WALLET",
  1,
  100,
);
const walletConcurrency = parseInteger(
  process.env.WALLET_CONCURRENCY?.trim() || "5",
  "WALLET_CONCURRENCY",
  1,
  25,
);
const balanceReadConcurrency = parseInteger(
  process.env.BALANCE_READ_CONCURRENCY?.trim() || "15",
  "BALANCE_READ_CONCURRENCY",
  1,
  50,
);
const maxExtraAttempts = parseInteger(
  process.env.MAX_EXTRA_ATTEMPTS_PER_WALLET?.trim() || "5",
  "MAX_EXTRA_ATTEMPTS_PER_WALLET",
  0,
  100,
);
const retryBaseDelayMs = parseInteger(
  process.env.RETRY_BASE_DELAY_MS?.trim() || "400",
  "RETRY_BASE_DELAY_MS",
  0,
  60000,
);
const retryMaxDelayMs = parseInteger(
  process.env.RETRY_MAX_DELAY_MS?.trim() || "5000",
  "RETRY_MAX_DELAY_MS",
  0,
  120000,
);
const requestTimeoutMs = parseInteger(
  process.env.REQUEST_TIMEOUT_MS?.trim() || "90000",
  "REQUEST_TIMEOUT_MS",
  5000,
  600000,
);
const receiptTimeoutMs = parseInteger(
  process.env.RECEIPT_TIMEOUT_MS?.trim() || "120000",
  "RECEIPT_TIMEOUT_MS",
  10000,
  600000,
);
const receiptPollMs = parseInteger(
  process.env.RECEIPT_POLL_MS?.trim() || "500",
  "RECEIPT_POLL_MS",
  100,
  30000,
);
const checkpointEverySuccesses = parseInteger(
  process.env.CHECKPOINT_EVERY_SUCCESSES?.trim() || "10",
  "CHECKPOINT_EVERY_SUCCESSES",
  1,
  1000,
);

const wallets = loadWallets(expectedWalletCount);

const endpoint = process.env.PULSE_ENDPOINT || DEFAULT_ENDPOINT;
const tokenAddress = getAddress(process.env.TOKEN_ADDRESS || DEFAULT_TOKEN);
const tokenChainId = process.env.TOKEN_CHAIN_ID || "196";
const rpcUrl =
  process.env.X_LAYER_RPC_URL ||
  process.env.X_LAYER_RPC ||
  DEFAULT_RPC;
const network = process.env.X402_NETWORK || DEFAULT_NETWORK;
const asset = getAddress(process.env.X402_ASSET || DEFAULT_ASSET);
const expectedAmountAtomic = BigInt(
  process.env.EXPECTED_AMOUNT_ATOMIC || DEFAULT_AMOUNT_ATOMIC,
);

const buyerModuleUrl = pathToFileURL(
  resolve(process.cwd(), "packages/buyer/dist/index.js"),
).href;

let createPaidFetch;
try {
  ({ createPaidFetch } = await import(buyerModuleUrl));
} catch (error) {
  throw new Error(
    'Could not load the PULSE buyer. Run "npm run build -w @pulse/buyer" first. ' +
      `${error instanceof Error ? error.message : String(error)}`,
  );
}

const requestBody = {
  address: tokenAddress,
  chainId: tokenChainId,
};

const accepted = await inspectTerms(
  endpoint,
  requestBody,
  requestTimeoutMs,
);

if (String(accepted.scheme).toLowerCase() !== "exact") {
  throw new Error(`Unexpected payment scheme: ${accepted.scheme}`);
}
if (String(accepted.network).toLowerCase() !== network.toLowerCase()) {
  throw new Error(`Unexpected network: ${accepted.network}`);
}
if (String(accepted.asset).toLowerCase() !== asset.toLowerCase()) {
  throw new Error(`Unexpected asset: ${accepted.asset}`);
}

const amountAtomic = BigInt(accepted.amount);
if (amountAtomic !== expectedAmountAtomic) {
  throw new Error(
    `Unexpected amount: ${accepted.amount}; expected ${expectedAmountAtomic}.`,
  );
}

const expectedPayTo = process.env.EXPECTED_PAY_TO?.trim();
if (
  expectedPayTo &&
  String(accepted.payTo).toLowerCase() !==
    getAddress(expectedPayTo).toLowerCase()
) {
  throw new Error(`Unexpected payment recipient: ${accepted.payTo}`);
}

const publicClient = createPublicClient({
  transport: http(rpcUrl, {
    retryCount: 4,
    retryDelay: 500,
    timeout: 30000,
  }),
});

const [decimalsRaw, symbolRaw] = await Promise.all([
  publicClient.readContract({
    address: asset,
    abi: ERC20_ABI,
    functionName: "decimals",
  }),
  publicClient.readContract({
    address: asset,
    abi: ERC20_ABI,
    functionName: "symbol",
  }),
]);

const decimals = Number(decimalsRaw);
const symbol = String(symbolRaw);

console.log(
  `Reading ${wallets.length} ${symbol} balances with concurrency ${balanceReadConcurrency}...`,
);

const balances = await mapWithConcurrency(
  wallets,
  balanceReadConcurrency,
  async (wallet) => {
    try {
      const balance = await publicClient.readContract({
        address: asset,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [wallet.address],
      });

      return {
        ok: true,
        balance,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

const outputPath = resolve(
  process.cwd(),
  process.env.RUN_LOG || "pulse-100-wallets-results.json",
);

const state = {
  startedAt: new Date().toISOString(),
  finishedAt: null,
  status: "running",
  walletCount: wallets.length,
  maxCallsPerWallet,
  walletConcurrency,
  totalPlannedTransactions: 0,
  totalSuccessfulTransactions: 0,
  endpoint,
  tokenAddress,
  payment: {
    network: accepted.network,
    asset: accepted.asset,
    amountAtomic: amountAtomic.toString(),
    amountHuman: formatUnits(amountAtomic, decimals),
    symbol,
    payTo: accepted.payTo,
  },
  wallets: wallets.map((wallet, index) => {
    const balanceResult = balances[index];

    if (!balanceResult.ok) {
      return {
        id: wallet.id,
        address: wallet.address,
        status: "skipped",
        initialBalanceAtomic: null,
        initialBalanceHuman: null,
        affordableCalls: 0,
        plannedCalls: 0,
        attempts: 0,
        successes: 0,
        skipReason: `balance_read_failed: ${balanceResult.error}`,
        transactions: [],
        failures: [],
      };
    }

    const affordableCallsBigInt =
      balanceResult.balance / amountAtomic;
    const affordableCalls = Number(
      affordableCallsBigInt >
        BigInt(Number.MAX_SAFE_INTEGER)
        ? BigInt(Number.MAX_SAFE_INTEGER)
        : affordableCallsBigInt,
    );
    const plannedCalls = Math.min(
      maxCallsPerWallet,
      affordableCalls,
    );

    return {
      id: wallet.id,
      address: wallet.address,
      status: plannedCalls > 0 ? "pending" : "skipped",
      initialBalanceAtomic: balanceResult.balance.toString(),
      initialBalanceHuman: formatUnits(
        balanceResult.balance,
        decimals,
      ),
      affordableCalls,
      plannedCalls,
      attempts: 0,
      successes: 0,
      skipReason:
        plannedCalls > 0
          ? null
          : `balance_below_one_payment: ${formatUnits(
              balanceResult.balance,
              decimals,
            )} ${symbol}`,
      transactions: [],
      failures: [],
    };
  }),
};

state.totalPlannedTransactions = state.wallets.reduce(
  (sum, wallet) => sum + wallet.plannedCalls,
  0,
);

checkpoint(outputPath, state);

console.log("");
console.log("FAST BALANCE-BASED PULSE RUN");
console.log(`Wallets:                 ${wallets.length}`);
console.log(`Wallet concurrency:      ${walletConcurrency}`);
console.log(
  `Payment per call:        ${formatUnits(
    amountAtomic,
    decimals,
  )} ${symbol}`,
);
console.log(`Maximum calls/wallet:    ${maxCallsPerWallet}`);
console.log(
  `Total calls from balance:${state.totalPlannedTransactions}`,
);
console.log(`Log:                     ${outputPath}`);
console.log("");

const globallySeenTransactions = new Set();
let successesSinceCheckpoint = 0;

function saveProgress(force = false) {
  if (
    force ||
    successesSinceCheckpoint >= checkpointEverySuccesses
  ) {
    checkpoint(outputPath, state);
    successesSinceCheckpoint = 0;
  }
}

async function processWallet(wallet, index) {
  const walletState = state.wallets[index];

  if (walletState.plannedCalls === 0) {
    console.log(
      `[${wallet.id}] SKIPPED — ${walletState.skipReason}`,
    );
    return;
  }

  walletState.status = "running";
  saveProgress(true);

  const paidFetch = createPaidFetch({
    privateKey: wallet.privateKey,
    rpcUrl,
    network,
  });

  const maximumAttempts =
    walletState.plannedCalls + maxExtraAttempts;
  let consecutiveFailures = 0;

  console.log(
    `[${wallet.id}] balance=${walletState.initialBalanceHuman} ${symbol}; planned=${walletState.plannedCalls}`,
  );

  while (
    walletState.successes < walletState.plannedCalls &&
    walletState.attempts < maximumAttempts
  ) {
    walletState.attempts += 1;
    const attempt = walletState.attempts;

    try {
      const response = await paidFetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });

      const parsed = await responseJson(response);
      const encodedReceipt = paymentHeader(
        response.headers,
        "PAYMENT-RESPONSE",
      );
      const paymentReceipt = decodeHeader(encodedReceipt);
      const transaction = transactionFromReceipt(paymentReceipt);

      if (response.status !== 200) {
        throw new Error(
          `HTTP ${response.status}: ${parsed.raw.slice(0, 500)}`,
        );
      }

      if (
        parsed.body?.service !== "token_scan" ||
        String(parsed.body?.address).toLowerCase() !==
          tokenAddress.toLowerCase() ||
        !Array.isArray(parsed.body?.components)
      ) {
        throw new Error("Malformed token_scan response.");
      }

      if (!/^0x[0-9a-fA-F]{64}$/.test(transaction || "")) {
        throw new Error(
          "Missing valid transaction hash in PAYMENT-RESPONSE.",
        );
      }

      const normalizedHash = transaction.toLowerCase();
      if (globallySeenTransactions.has(normalizedHash)) {
        throw new Error(`Duplicate transaction hash: ${transaction}`);
      }

      const chainReceipt =
        await publicClient.waitForTransactionReceipt({
          hash: transaction,
          confirmations: 1,
          timeout: receiptTimeoutMs,
          pollingInterval: receiptPollMs,
        });

      if (chainReceipt.status !== "success") {
        throw new Error(
          `Transaction ${transaction} status is ${chainReceipt.status}.`,
        );
      }

      globallySeenTransactions.add(normalizedHash);
      walletState.successes += 1;
      state.totalSuccessfulTransactions += 1;
      consecutiveFailures = 0;

      walletState.transactions.push({
        walletSuccessNumber: walletState.successes,
        globalSuccessNumber: state.totalSuccessfulTransactions,
        attempt,
        transaction,
        blockNumber: chainReceipt.blockNumber.toString(),
        completedAt: new Date().toISOString(),
      });

      successesSinceCheckpoint += 1;
      saveProgress(false);

      console.log(
        `[${wallet.id}] SUCCESS ${walletState.successes}/${walletState.plannedCalls} — ${transaction}`,
      );

      // No delay after success.
    } catch (error) {
      consecutiveFailures += 1;
      const message =
        error instanceof Error ? error.message : String(error);

      walletState.failures.push({
        attempt,
        failedAt: new Date().toISOString(),
        error: message,
      });

      console.error(
        `[${wallet.id}] FAILED attempt ${attempt}: ${message}`,
      );

      if (
        walletState.successes < walletState.plannedCalls &&
        walletState.attempts < maximumAttempts
      ) {
        const delay = retryDelay(
          retryBaseDelayMs,
          retryMaxDelayMs,
          consecutiveFailures,
        );

        if (delay > 0) {
          console.log(`[${wallet.id}] retrying in ${delay} ms`);
          await sleep(delay);
        }
      }
    }
  }

  if (walletState.successes === walletState.plannedCalls) {
    walletState.status = "completed";
  } else {
    walletState.status = "incomplete";
  }

  saveProgress(true);

  console.log(
    `[${wallet.id}] DONE — ${walletState.successes}/${walletState.plannedCalls} confirmed`,
  );
}

let nextWalletIndex = 0;

async function walletWorker() {
  while (true) {
    const index = nextWalletIndex;
    nextWalletIndex += 1;

    if (index >= wallets.length) return;
    await processWallet(wallets[index], index);
  }
}

await Promise.all(
  Array.from(
    { length: Math.min(walletConcurrency, wallets.length) },
    () => walletWorker(),
  ),
);

state.finishedAt = new Date().toISOString();

const completed = state.wallets.filter(
  (wallet) => wallet.status === "completed",
).length;
const skipped = state.wallets.filter(
  (wallet) => wallet.status === "skipped",
).length;
const incomplete = state.wallets.filter(
  (wallet) => wallet.status === "incomplete",
).length;

state.status =
  incomplete > 0
    ? "incomplete"
    : skipped > 0
      ? "completed_with_skips"
      : "completed";

checkpoint(outputPath, state);

console.log("");
console.log("FINAL SUMMARY");
console.log(`Completed wallets: ${completed}/${wallets.length}`);
console.log(`Skipped wallets:   ${skipped}/${wallets.length}`);
console.log(`Incomplete wallets:${incomplete}/${wallets.length}`);
console.log(
  `Confirmed txs:     ${state.totalSuccessfulTransactions}/${state.totalPlannedTransactions}`,
);
console.log(`Status:            ${state.status}`);
console.log(`Log:               ${outputPath}`);

if (incomplete > 0) {
  process.exitCode = 1;
}
