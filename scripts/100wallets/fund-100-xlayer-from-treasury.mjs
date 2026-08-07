#!/usr/bin/env node

/**
 * Fast, resumable X Layer distributor.
 *
 * For each address in PULSE_WALLETS_JSON:
 *   - top up USD₮0 to TARGET_USDT0_PER_WALLET;
 *   - top up native OKB to TARGET_OKB_PER_WALLET.
 *
 * Speed:
 *   - reads balances concurrently;
 *   - uses explicit sequential nonces;
 *   - submits several wallets per batch without waiting after each tx;
 *   - waits for all receipts in the batch concurrently.
 *
 * Reliability:
 *   - receipt success is the authoritative transaction result;
 *   - destination balances are polled because public load-balanced RPC nodes
 *     can briefly return stale state immediately after a receipt;
 *   - a final verification pass checks every wallet;
 *   - all submitted hashes are checkpointed.
 */

import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseEther,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const XLAYER_CHAIN_ID = 196;
const DEFAULT_XLAYER_RPC = "https://rpc.xlayer.tech";
const DEFAULT_XLAYER_USDT0 =
  "0x779ded0c9e1022225f8e0630b35a9b54be713736";

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

function loadEnvFiles(paths = [".env", ".env.wallets"]) {
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

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizePrivateKey(value, label) {
  const normalized = String(value || "").startsWith("0x")
    ? String(value)
    : `0x${String(value || "")}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`${label} must be exactly 32 bytes of hexadecimal data.`);
  }

  return normalized;
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
    throw new Error("PULSE_WALLETS_JSON must be a JSON array.");
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

    // Generated private keys are deliberately ignored.
    return {
      id:
        typeof entry.id === "string" && entry.id.trim()
          ? entry.id.trim()
          : `pulse-wallet-${String(index + 1).padStart(3, "0")}`,
      address,
    };
  });
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function checkpoint(path, state) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
  renameSync(temporary, path);
}

function addBuffer(value, percent) {
  return (value * BigInt(100 + percent) + 99n) / 100n;
}

function chunk(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
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

async function readWalletBalances(client, tokenAddress, wallet) {
  const [usdt0Balance, okbBalance] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [wallet.address],
    }),
    client.getBalance({ address: wallet.address }),
  ]);

  return {
    ...wallet,
    usdt0Balance,
    okbBalance,
  };
}

async function readManyWalletBalances({
  client,
  tokenAddress,
  wallets,
  concurrency,
}) {
  return mapWithConcurrency(
    wallets,
    concurrency,
    (wallet) => readWalletBalances(client, tokenAddress, wallet),
  );
}

async function waitForWalletTargets({
  client,
  tokenAddress,
  wallet,
  targetUsdt0,
  targetOkb,
  timeoutMs,
  pollMs,
}) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;

  while (Date.now() <= deadline) {
    latest = await readWalletBalances(client, tokenAddress, wallet);

    if (
      latest.usdt0Balance >= targetUsdt0 &&
      latest.okbBalance >= targetOkb
    ) {
      return { met: true, ...latest };
    }

    await sleep(pollMs);
  }

  return { met: false, ...latest };
}

function removePending(state, hash) {
  state.pending = state.pending.filter(
    (entry) => entry.transactionHash !== hash,
  );
}

async function waitForReceipt(publicClient, tx, timeoutMs) {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: tx.transactionHash,
    confirmations: 1,
    timeout: timeoutMs,
    pollingInterval: 500,
  });

  if (receipt.status !== "success") {
    throw new Error(`${tx.asset} transaction ${tx.transactionHash} reverted.`);
  }

  return {
    ...tx,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
  };
}

async function main() {
  loadEnvFiles();

  if (process.env.CONFIRM_LIVE_FUNDING !== "YES") {
    throw new Error(
      'Set CONFIRM_LIVE_FUNDING="YES" after reviewing the treasury, amounts, and recipients.',
    );
  }

  const rpcUrl =
    process.env.X_LAYER_RPC_URL?.trim() ||
    process.env.X_LAYER_RPC?.trim() ||
    DEFAULT_XLAYER_RPC;

  const treasuryPrivateKey = normalizePrivateKey(
    requiredEnv("X_LAYER_TREASURY_PRIVATE_KEY"),
    "X_LAYER_TREASURY_PRIVATE_KEY",
  );
  const treasury = privateKeyToAccount(treasuryPrivateKey);

  const tokenAddress = getAddress(
    process.env.XLAYER_USDT0_ADDRESS?.trim() ||
      DEFAULT_XLAYER_USDT0,
  );

  const expectedWalletCount = parseInteger(
    process.env.EXPECTED_WALLET_COUNT?.trim() || "100",
    "EXPECTED_WALLET_COUNT",
    1,
    10000,
  );

  const targetUsdt0Human =
    process.env.TARGET_USDT0_PER_WALLET?.trim() || "0.11";
  const targetOkbHuman =
    process.env.TARGET_OKB_PER_WALLET?.trim() || "0.001";
  const treasuryOkbReserveHuman =
    process.env.TREASURY_OKB_RESERVE?.trim() || "0.001";

  const balanceReadConcurrency = parseInteger(
    process.env.BALANCE_READ_CONCURRENCY?.trim() || "15",
    "BALANCE_READ_CONCURRENCY",
    1,
    50,
  );
  const batchWalletCount = parseInteger(
    process.env.FUNDING_BATCH_WALLETS?.trim() || "10",
    "FUNDING_BATCH_WALLETS",
    1,
    25,
  );
  const submitDelayMs = parseInteger(
    process.env.SUBMIT_DELAY_MS?.trim() || "50",
    "SUBMIT_DELAY_MS",
    0,
    10000,
  );
  const receiptTimeoutMs = parseInteger(
    process.env.RECEIPT_TIMEOUT_MS?.trim() || "180000",
    "RECEIPT_TIMEOUT_MS",
    10000,
    1800000,
  );
  const verificationTimeoutMs = parseInteger(
    process.env.BALANCE_VERIFY_TIMEOUT_MS?.trim() || "60000",
    "BALANCE_VERIFY_TIMEOUT_MS",
    5000,
    600000,
  );
  const verificationPollMs = parseInteger(
    process.env.BALANCE_VERIFY_POLL_MS?.trim() || "1000",
    "BALANCE_VERIFY_POLL_MS",
    250,
    30000,
  );
  const gasBufferPercent = parseInteger(
    process.env.GAS_ESTIMATE_BUFFER_PERCENT?.trim() || "30",
    "GAS_ESTIMATE_BUFFER_PERCENT",
    0,
    500,
  );

  const wallets = loadWallets(expectedWalletCount);

  if (
    wallets.some(
      (wallet) =>
        wallet.address.toLowerCase() === treasury.address.toLowerCase(),
    )
  ) {
    throw new Error(
      `Treasury ${treasury.address} is present in PULSE_WALLETS_JSON.`,
    );
  }

  const xLayer = {
    id: XLAYER_CHAIN_ID,
    name: "X Layer",
    nativeCurrency: {
      name: "OKB",
      symbol: "OKB",
      decimals: 18,
    },
    rpcUrls: { default: { http: [rpcUrl] } },
  };

  const publicClient = createPublicClient({
    chain: xLayer,
    transport: http(rpcUrl, {
      retryCount: 4,
      retryDelay: 500,
      timeout: 30_000,
    }),
  });

  const walletClient = createWalletClient({
    account: treasury,
    chain: xLayer,
    transport: http(rpcUrl, {
      retryCount: 4,
      retryDelay: 500,
      timeout: 30_000,
    }),
  });

  const [actualChainId, tokenCode] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getCode({ address: tokenAddress }),
  ]);

  if (actualChainId !== XLAYER_CHAIN_ID) {
    throw new Error(
      `RPC reports chain ${actualChainId}; expected ${XLAYER_CHAIN_ID}.`,
    );
  }

  if (!tokenCode || tokenCode === "0x") {
    throw new Error(`No contract code exists at ${tokenAddress}.`);
  }

  const [
    decimalsRaw,
    symbolRaw,
    treasuryUsdt0Balance,
    treasuryOkbBalance,
  ] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "symbol",
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [treasury.address],
    }),
    publicClient.getBalance({ address: treasury.address }),
  ]);

  const decimals = Number(decimalsRaw);
  const symbol = String(symbolRaw);
  const normalizedSymbol = symbol
    .normalize("NFKC")
    .replace(/₮/g, "T")
    .replace(/\s+/g, "")
    .toUpperCase();

  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error(`Token returned invalid decimals: ${decimalsRaw}.`);
  }

  if (normalizedSymbol !== "USDT0") {
    throw new Error(
      `Token ${tokenAddress} reports unsupported symbol ${symbol}.`,
    );
  }

  const targetUsdt0 = parseUnits(targetUsdt0Human, decimals);
  const targetOkb = parseEther(targetOkbHuman);
  const treasuryOkbReserve = parseEther(treasuryOkbReserveHuman);

  console.log(
    `Reading ${wallets.length} destination balances with concurrency ${balanceReadConcurrency}...`,
  );

  const initialBalances = await readManyWalletBalances({
    client: publicClient,
    tokenAddress,
    wallets,
    concurrency: balanceReadConcurrency,
  });

  const initialPlan = initialBalances.map((wallet) => ({
    ...wallet,
    usdt0Needed:
      wallet.usdt0Balance >= targetUsdt0
        ? 0n
        : targetUsdt0 - wallet.usdt0Balance,
    okbNeeded:
      wallet.okbBalance >= targetOkb
        ? 0n
        : targetOkb - wallet.okbBalance,
  }));

  const totalUsdt0Needed = initialPlan.reduce(
    (sum, wallet) => sum + wallet.usdt0Needed,
    0n,
  );
  const totalOkbTopups = initialPlan.reduce(
    (sum, wallet) => sum + wallet.okbNeeded,
    0n,
  );
  const usdt0TxCount = initialPlan.filter(
    (wallet) => wallet.usdt0Needed > 0n,
  ).length;
  const okbTxCount = initialPlan.filter(
    (wallet) => wallet.okbNeeded > 0n,
  ).length;

  if (treasuryUsdt0Balance < totalUsdt0Needed) {
    throw new Error(
      `Treasury has ${formatUnits(
        treasuryUsdt0Balance,
        decimals,
      )} ${symbol}; ${formatUnits(
        totalUsdt0Needed,
        decimals,
      )} is required.`,
    );
  }

  let gasPrice = 0n;
  let tokenGas = 0n;
  let okbGas = 0n;

  if (usdt0TxCount > 0 || okbTxCount > 0) {
    gasPrice = await publicClient.getGasPrice();
  }

  const firstUsdt0 = initialPlan.find(
    (wallet) => wallet.usdt0Needed > 0n,
  );
  if (firstUsdt0) {
    tokenGas = await publicClient.estimateContractGas({
      account: treasury,
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [firstUsdt0.address, firstUsdt0.usdt0Needed],
    });
  }

  const firstOkb = initialPlan.find((wallet) => wallet.okbNeeded > 0n);
  if (firstOkb) {
    okbGas = await publicClient.estimateGas({
      account: treasury,
      to: firstOkb.address,
      value: firstOkb.okbNeeded,
    });
  }

  const estimatedGas = addBuffer(
    gasPrice *
      (tokenGas * BigInt(usdt0TxCount) +
        okbGas * BigInt(okbTxCount)),
    gasBufferPercent,
  );

  const requiredOkb =
    totalOkbTopups + estimatedGas + treasuryOkbReserve;

  if (treasuryOkbBalance < requiredOkb) {
    throw new Error(
      `Treasury has ${formatEther(
        treasuryOkbBalance,
      )} OKB; approximately ${formatEther(
        requiredOkb,
      )} OKB is required including top-ups, buffered gas, and reserve.`,
    );
  }

  const outputPath = resolve(
    process.cwd(),
    process.env.FUNDING_LOG?.trim() ||
      `xlayer-fast-funding-${safeTimestamp()}.json`,
  );

  const state = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "running",
    rpcUrl,
    treasury: treasury.address,
    token: tokenAddress,
    symbol,
    targets: {
      usdt0Human: targetUsdt0Human,
      okbHuman: targetOkbHuman,
    },
    settings: {
      balanceReadConcurrency,
      batchWalletCount,
      submitDelayMs,
      receiptTimeoutMs,
      verificationTimeoutMs,
      verificationPollMs,
    },
    pending: [],
    confirmedTransactions: [],
    verifiedWallets: [],
    skippedWallets: [],
    verificationWarnings: [],
    failures: [],
  };

  checkpoint(outputPath, state);

  console.log("");
  console.log("FAST X LAYER USD₮0 + OKB FUNDING");
  console.log(`Treasury:             ${treasury.address}`);
  console.log(`Wallets:              ${wallets.length}`);
  console.log(`USD₮0 target:         ${targetUsdt0Human}`);
  console.log(`OKB target:           ${targetOkbHuman}`);
  console.log(`USD₮0 transactions:   ${usdt0TxCount}`);
  console.log(`OKB transactions:     ${okbTxCount}`);
  console.log(`Wallets per batch:    ${batchWalletCount}`);
  console.log(`Total USD₮0 needed:   ${formatUnits(totalUsdt0Needed, decimals)}`);
  console.log(`Total OKB top-ups:    ${formatEther(totalOkbTopups)}`);
  console.log(`Estimated gas:        ${formatEther(estimatedGas)} OKB`);
  console.log(`Log:                  ${outputPath}`);
  console.log("");

  let nextNonce = await publicClient.getTransactionCount({
    address: treasury.address,
    blockTag: "pending",
  });

  const walletBatches = chunk(wallets, batchWalletCount);

  for (let batchIndex = 0; batchIndex < walletBatches.length; batchIndex += 1) {
    const batch = walletBatches[batchIndex];

    console.log(
      `Batch ${batchIndex + 1}/${walletBatches.length}: wallets ${
        batchIndex * batchWalletCount + 1
      }-${batchIndex * batchWalletCount + batch.length}`,
    );

    // Re-read each batch immediately before submission. This makes reruns safe
    // and avoids using stale balances from the initial planning pass.
    const currentBatch = await readManyWalletBalances({
      client: publicClient,
      tokenAddress,
      wallets: batch,
      concurrency: Math.min(balanceReadConcurrency, batch.length),
    });

    const submitted = [];
    const walletTxs = new Map();

    for (const wallet of currentBatch) {
      const usdt0Needed =
        wallet.usdt0Balance >= targetUsdt0
          ? 0n
          : targetUsdt0 - wallet.usdt0Balance;
      const okbNeeded =
        wallet.okbBalance >= targetOkb
          ? 0n
          : targetOkb - wallet.okbBalance;

      walletTxs.set(wallet.address.toLowerCase(), []);

      if (usdt0Needed === 0n && okbNeeded === 0n) {
        state.skippedWallets.push({
          id: wallet.id,
          address: wallet.address,
          reason: "targets_already_met",
        });
        console.log(`  ${wallet.id}: already funded`);
        continue;
      }

      try {
        if (usdt0Needed > 0n) {
          const nonce = nextNonce;
          nextNonce += 1;

          const hash = await walletClient.writeContract({
            account: treasury,
            chain: xLayer,
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: "transfer",
            args: [wallet.address, usdt0Needed],
            nonce,
          });

          const tx = {
            id: wallet.id,
            address: wallet.address,
            asset: symbol,
            amountAtomic: usdt0Needed.toString(),
            amountHuman: formatUnits(usdt0Needed, decimals),
            nonce,
            transactionHash: hash,
          };

          submitted.push(tx);
          walletTxs.get(wallet.address.toLowerCase()).push(tx);
          state.pending.push(tx);
          checkpoint(outputPath, state);

          console.log(
            `  ${wallet.id}: submitted ${formatUnits(
              usdt0Needed,
              decimals,
            )} ${symbol} — nonce ${nonce}`,
          );

          if (submitDelayMs > 0) await sleep(submitDelayMs);
        }

        if (okbNeeded > 0n) {
          const nonce = nextNonce;
          nextNonce += 1;

          const hash = await walletClient.sendTransaction({
            account: treasury,
            chain: xLayer,
            to: wallet.address,
            value: okbNeeded,
            nonce,
          });

          const tx = {
            id: wallet.id,
            address: wallet.address,
            asset: "OKB",
            amountAtomic: okbNeeded.toString(),
            amountHuman: formatEther(okbNeeded),
            nonce,
            transactionHash: hash,
          };

          submitted.push(tx);
          walletTxs.get(wallet.address.toLowerCase()).push(tx);
          state.pending.push(tx);
          checkpoint(outputPath, state);

          console.log(
            `  ${wallet.id}: submitted ${formatEther(
              okbNeeded,
            )} OKB — nonce ${nonce}`,
          );

          if (submitDelayMs > 0) await sleep(submitDelayMs);
        }
      } catch (error) {
        state.status = "halted_after_partial_batch_submission";
        state.failures.push({
          id: wallet.id,
          address: wallet.address,
          stage: "submission",
          error: error instanceof Error ? error.message : String(error),
        });
        checkpoint(outputPath, state);
        throw error;
      }
    }

    if (submitted.length === 0) {
      checkpoint(outputPath, state);
      console.log("  No transactions needed.");
      continue;
    }

    console.log(`  Waiting for ${submitted.length} receipts together...`);

    const receiptResults = await Promise.allSettled(
      submitted.map((tx) =>
        waitForReceipt(publicClient, tx, receiptTimeoutMs),
      ),
    );

    let receiptFailure = false;

    for (let index = 0; index < receiptResults.length; index += 1) {
      const result = receiptResults[index];
      const tx = submitted[index];

      if (result.status === "fulfilled") {
        state.confirmedTransactions.push(result.value);
        removePending(state, tx.transactionHash);
      } else {
        receiptFailure = true;
        state.failures.push({
          ...tx,
          stage: "receipt",
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
      }
    }

    checkpoint(outputPath, state);

    if (receiptFailure) {
      state.status = "halted_for_receipt_review";
      checkpoint(outputPath, state);
      throw new Error(
        "At least one submitted transaction did not confirm successfully. Check the checkpoint log before rerunning.",
      );
    }

    console.log("  Receipts confirmed. Polling destination balances...");

    const verificationResults = await mapWithConcurrency(
      batch,
      Math.min(balanceReadConcurrency, batch.length),
      (wallet) =>
        waitForWalletTargets({
          client: publicClient,
          tokenAddress,
          wallet,
          targetUsdt0,
          targetOkb,
          timeoutMs: verificationTimeoutMs,
          pollMs: verificationPollMs,
        }),
    );

    for (const verification of verificationResults) {
      const txs =
        walletTxs.get(verification.address.toLowerCase()) || [];

      if (verification.met) {
        state.verifiedWallets.push({
          id: verification.id,
          address: verification.address,
          usdt0Human: formatUnits(
            verification.usdt0Balance,
            decimals,
          ),
          okbHuman: formatEther(verification.okbBalance),
          transactionHashes: txs.map((tx) => tx.transactionHash),
          verifiedAt: new Date().toISOString(),
        });
      } else if (txs.length > 0) {
        // Do not stop the complete distribution solely because a public RPC
        // balance read is lagging after successful receipts. The final pass
        // checks every address again.
        state.verificationWarnings.push({
          id: verification.id,
          address: verification.address,
          usdt0Human: formatUnits(
            verification.usdt0Balance,
            decimals,
          ),
          okbHuman: formatEther(verification.okbBalance),
          transactionHashes: txs.map((tx) => tx.transactionHash),
          reason: "receipts_successful_but_rpc_balance_not_updated_before_timeout",
        });
      }
    }

    checkpoint(outputPath, state);

    console.log(
      `  Batch complete: ${receiptResults.length} transactions confirmed.`,
    );
  }

  console.log("");
  console.log("Running final verification for all 100 wallets...");

  // Give load-balanced public RPC nodes a short opportunity to converge before
  // the final read.
  await sleep(2000);

  const finalBalances = await readManyWalletBalances({
    client: publicClient,
    tokenAddress,
    wallets,
    concurrency: balanceReadConcurrency,
  });

  const belowTarget = finalBalances.filter(
    (wallet) =>
      wallet.usdt0Balance < targetUsdt0 ||
      wallet.okbBalance < targetOkb,
  );

  state.finishedAt = new Date().toISOString();
  state.finalBelowTarget = belowTarget.map((wallet) => ({
    id: wallet.id,
    address: wallet.address,
    usdt0Human: formatUnits(wallet.usdt0Balance, decimals),
    okbHuman: formatEther(wallet.okbBalance),
  }));

  state.status =
    belowTarget.length === 0 && state.failures.length === 0
      ? "completed"
      : belowTarget.length > 0
        ? "completed_with_balance_warnings"
        : "completed_with_failures";

  checkpoint(outputPath, state);

  console.log("");
  console.log("FINAL SUMMARY");
  console.log(`Confirmed transactions: ${state.confirmedTransactions.length}`);
  console.log(`Verified wallets:       ${wallets.length - belowTarget.length}`);
  console.log(`Below target:           ${belowTarget.length}`);
  console.log(`Failures:               ${state.failures.length}`);
  console.log(`Status:                 ${state.status}`);
  console.log(`Log:                    ${outputPath}`);

  if (belowTarget.length > 0 || state.failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("");
  console.error(
    `ERROR: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode ||= 2;
});
