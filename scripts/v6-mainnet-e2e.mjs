/**
 * Authorized PULSE V6 mainnet workflow test.
 *
 * Default is read-only. Pass --execute to create owner accounts, spend the
 * exact bounded test amounts below, exercise lifecycle transitions, unwind
 * positions, and leave Autopilot paused with its capital returned.
 * Private keys and raw signed transactions are never printed.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  fallback,
  formatUnits,
  http,
  keccak256,
  parseUnits,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

function loadEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      const raw = match[2].trim();
      process.env[match[1].trim()] = ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
        ? raw.slice(1, -1)
        : raw;
    }
  }
}
loadEnv();

const EXECUTE = process.argv.includes("--execute");
const RESUME = process.argv.includes("--resume");
const DIRECT_WORKER = process.argv.includes("--direct-worker");
const LEAVE_AUTOPILOT_ACTIVE = process.argv.includes("--leave-active");
const BASE_LIMIT_ONLY = process.argv.includes("--base-limit-only");
const SKIP_BASE_LIMIT = process.argv.includes("--skip-base-limit");
const SKIP_ARBITRUM_LIMIT = process.argv.includes("--skip-arbitrum-limit");
const SKIP_XLAYER_LIMIT = process.argv.includes("--skip-xlayer-limit");
const WORKER_ONLY = process.argv.includes("--worker-only");
const CLOSE_BASE_ORDER = process.argv.find((value) => value.startsWith("--close-base-order="))?.split("=")[1];
const SELL_BASE_WETH = process.argv.includes("--sell-base-weth");
const CLOSE_ORDER = process.argv.find((value) => value.startsWith("--close-order="))?.split("=")[1];
const SELL_WALLET_ASSET = process.argv.find((value) => value.startsWith("--sell-wallet-asset="))?.split("=")[1];
const CLOSE_PROTECTION = process.argv.find((value) => value.startsWith("--close-protection="))?.split("=")[1];
const AUTOPILOT_ONLY = process.argv.includes("--autopilot-only");
const AUTOPILOT_CYCLE_ONLY = process.argv.includes("--autopilot-cycle-only");
const AUTOPILOT_NETWORK = process.argv.find((value) => value.startsWith("--autopilot-network="))?.split("=")[1] || "base";
const AUTOPILOT_PAIR = String(process.argv.find((value) => value.startsWith("--autopilot-pair="))?.split("=")[1] || "ETH-USDT").toUpperCase();
const AUTOPILOT_TIMEFRAME = process.argv.find((value) => value.startsWith("--autopilot-timeframe="))?.split("=")[1] || "4H";
const AUTOPILOT_CAPITAL = process.argv.find((value) => value.startsWith("--autopilot-capital="))?.split("=")[1] || "0.5";
const AUTOPILOT_STRATEGY = String(process.argv.find((value) => value.startsWith("--autopilot-strategy="))?.split("=")[1] || "trend_following").toLowerCase();
const REUSE_VAULT = process.argv.find((value) => value.startsWith("--reuse-vault="))?.split("=")[1];
const DOGE_ONLY = process.argv.includes("--doge-only");
const API = process.env.BASE_URL || "http://127.0.0.1:4000";
const key = process.env.TEST_WALLET_PRIVATE_KEY;
if (!/^0x[a-fA-F0-9]{64}$/.test(key || "")) throw new Error("TEST_WALLET_PRIVATE_KEY is missing or invalid");
const account = privateKeyToAccount(key);
if (process.env.TEST_WALLET_ADDRESS && process.env.TEST_WALLET_ADDRESS.toLowerCase() !== account.address.toLowerCase())
  throw new Error("TEST_WALLET_ADDRESS does not match TEST_WALLET_PRIVATE_KEY");

const artifact = (name) => JSON.parse(readFileSync(resolve(process.cwd(), `packages/contracts/artifacts/${name}.json`), "utf8"));
const erc20Abi = [
  ...artifact("IERC20Pulse").abi,
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "amount", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "ok", type: "bool" }] },
];
const bracketFactoryAbi = artifact("SpotBracketAccountFactoryV1").abi;
const bracketAbi = artifact("SpotBracketAccountV1").abi;
const protectionFactoryAbi = artifact("SpotOrderAccountFactoryV1").abi;
const protectionAbi = artifact("SpotOrderAccountV1").abi;
const vaultFactoryAbi = artifact("AutopilotVaultFactoryV2").abi;
const vaultAbi = artifact("AutopilotVaultV2").abi;

const ZERO = "0x0000000000000000000000000000000000000000";
const CHAINS = {
  base: {
    id: 8453,
    label: "Base",
    rpc: [process.env.BASE_RPC_URL || "https://mainnet.base.org", process.env.BASE_RPC_FALLBACK_URL || "https://1rpc.io/base"],
    settlement: "USDC",
    amount: "1",
    reportRoute: "base",
    bracketFactory: process.env.BASE_SPOT_BRACKET_FACTORY_ADDRESS,
    protectionFactory: process.env.BASE_SPOT_ORDER_FACTORY_ADDRESS,
    vaultFactory: process.env.BASE_AUTOPILOT_VAULT_FACTORY_ADDRESS,
  },
  arbitrum: {
    id: 42161,
    label: "Arbitrum One",
    rpc: [process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc", process.env.ARBITRUM_RPC_FALLBACK_URL || "https://arbitrum-one-rpc.publicnode.com"],
    settlement: "USDC",
    amount: "1",
    reportRoute: "arbitrum",
    bracketFactory: process.env.ARBITRUM_SPOT_BRACKET_FACTORY_ADDRESS,
    protectionFactory: process.env.ARBITRUM_SPOT_ORDER_FACTORY_ADDRESS,
    vaultFactory: process.env.ARBITRUM_AUTOPILOT_VAULT_FACTORY_ADDRESS,
  },
  xlayer: {
    id: 196,
    label: "X Layer",
    rpc: [process.env.X_LAYER_RPC || "https://rpc.xlayer.tech", process.env.X_LAYER_RPC_FALLBACK || "https://xlayerrpc.okx.com"],
    settlement: "USDT0",
    amount: "1",
    reportRoute: "xlayer",
    bracketFactory: process.env.XLAYER_SPOT_BRACKET_FACTORY_ADDRESS,
    protectionFactory: process.env.XLAYER_SPOT_ORDER_FACTORY_ADDRESS,
    vaultFactory: process.env.XLAYER_AUTOPILOT_VAULT_FACTORY_ADDRESS,
  },
};

for (const chain of Object.values(CHAINS)) {
  chain.chain = { id: chain.id, name: chain.label, nativeCurrency: { name: chain.id === 196 ? "OKB" : "Ether", symbol: chain.id === 196 ? "OKB" : "ETH", decimals: 18 }, rpcUrls: { default: { http: chain.rpc } } };
  const rpcUrls = [...new Set(chain.rpc)];
  const transports = rpcUrls.map((url) => http(url, { retryCount: 2, retryDelay: 700 }));
  chain.rpcClients = rpcUrls.map((url) => createPublicClient({ chain: chain.chain, transport: http(url, { retryCount: 2, retryDelay: 700 }) }));
  chain.publicClient = createPublicClient({ chain: chain.chain, transport: fallback(transports, { retryCount: 1 }) });
  chain.walletClient = createWalletClient({ account, chain: chain.chain, transport: fallback(transports, { retryCount: 1 }) });
}

const results = [];
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const short = (value) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
function log(event, detail = {}) {
  const safe = { at: new Date().toISOString(), event, ...detail };
  results.push(safe);
  console.log(JSON.stringify(safe));
}
async function json(path, init) {
  const response = await fetch(`${API}${path}`, init);
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}
async function post(path, body) {
  return json(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
}
async function resolvePair(network, pair) {
  const response = await json(`/v1/trading/resolve-pair?network=${network}&pair=${encodeURIComponent(pair)}`);
  if (!response.ok) throw new Error(`resolve-pair ${network}/${pair}: ${JSON.stringify(response.data)}`);
  return response.data;
}
async function txWrite(network, address, abi, functionName, args = []) {
  const chain = CHAINS[network];
  const { request } = await chain.publicClient.simulateContract({ account, address, abi, functionName, args });
  const hash = await chain.walletClient.writeContract(request);
  const receipt = await chain.publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${network} ${functionName} reverted`);
  log("transaction_confirmed", { network, action: functionName, hash });
  return hash;
}
async function txSend(network, transaction) {
  const chain = CHAINS[network];
  await chain.publicClient.call({ account: account.address, to: transaction.to, data: transaction.data, value: BigInt(transaction.value || "0") });
  const hash = await chain.walletClient.sendTransaction({ account, to: transaction.to, data: transaction.data, value: BigInt(transaction.value || "0") });
  log("transaction_submitted", { network, action: "okx_swap", hash });
  const receipt = await chain.publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${network} prepared swap reverted: ${hash}`);
  log("transaction_confirmed", { network, action: "okx_swap", hash });
  return hash;
}
async function tokenBalance(network, token, owner = account.address) {
  return CHAINS[network].publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}
async function tokenBalanceAfter(network, token, before, owner = account.address) {
  let balance = await tokenBalance(network, token, owner);
  for (let attempt = 0; attempt < 10 && balance <= before; attempt += 1) {
    await sleep(1_500);
    balance = await tokenBalance(network, token, owner);
  }
  return balance;
}
async function ensureApproval(network, token, spender, amount) {
  const chain = CHAINS[network];
  const allowance = await chain.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, spender] });
  if (allowance >= amount) return null;
  const hash = await txWrite(network, token, erc20Abi, "approve", [spender, amount]);
  // A receipt may be discovered by the fallback RPC before the wallet's
  // primary RPC has indexed the new allowance. Do not submit the dependent
  // account call until that same primary endpoint can read it.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const visible = await chain.rpcClients[0].readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, spender] });
      if (visible >= amount) return hash;
    } catch {}
    await sleep(1_500);
  }
  throw new Error(`${network} approval confirmed but was not readable from the primary RPC`);
}
async function announce(network, source, kind, hash, pair, amount, accountAddress) {
  const response = await post("/v1/trading/activity", { owner: account.address, network, source, kind, status: "pending", txHash: hash, pair, amount: amount ? String(amount) : undefined, account: accountAddress });
  if (!response.ok) log("activity_sync_deferred", { network, kind, status: response.status });
}
async function preparedSwap(network, from, to, amount) {
  const response = await post("/v1/trading/prepare-swap", { network, fromTokenAddress: from, toTokenAddress: to, amount: String(amount), userWalletAddress: account.address, slippageMode: "auto", maxAutoSlippagePercent: 1, slippagePercent: 0.5 });
  if (!response.ok) throw new Error(`prepare-swap ${network}: ${JSON.stringify(response.data)}`);
  return response.data;
}
async function marketSwap(network, pair, from, to, amount, kind) {
  const prepared = await preparedSwap(network, from, to, amount);
  if (!/^0x[a-fA-F0-9]{40}$/.test(prepared.approvalAddress || "")) throw new Error(`${network} prepared swap omitted its approval contract`);
  await ensureApproval(network, from, prepared.approvalAddress, amount);
  const before = await tokenBalance(network, to);
  const hash = await txSend(network, prepared.tx);
  await announce(network, "wallet", kind, hash, pair, amount);
  const after = await tokenBalanceAfter(network, to, before);
  const received = after - before;
  if (received <= 0n) throw new Error(`${network} market swap returned no asset`);
  return { hash, received };
}
async function snapshot(network, fresh = false) {
  const response = await json(`/v1/trading/accounts?network=${network}&owner=${account.address}${fresh ? "&fresh=1" : ""}`);
  if (!response.ok) throw new Error(`account snapshot ${network}: ${JSON.stringify(response.data)}`);
  return response.data;
}
async function ensureOwnerAccount(network, kind) {
  let state = await snapshot(network, true);
  const keyName = kind === "bracket" ? "bracket" : "protection";
  if (state.accounts[keyName]) return state.accounts[keyName];
  const chain = CHAINS[network];
  const factory = kind === "bracket" ? chain.bracketFactory : chain.protectionFactory;
  const abi = kind === "bracket" ? bracketFactoryAbi : protectionFactoryAbi;
  if (!/^0x[a-fA-F0-9]{40}$/.test(factory || "")) throw new Error(`${network} ${kind} factory missing`);
  const hash = await txWrite(network, factory, abi, "createAccount", []);
  await announce(network, kind === "bracket" ? "limit" : "spot", kind === "bracket" ? "create_bracket_account" : "create_account", hash, kind);
  state = await snapshot(network, true);
  const found = state.accounts[keyName];
  if (!found) throw new Error(`${network} ${kind} account not discoverable after confirmation`);
  return found;
}
async function registerOrder(network, payload) {
  let response = await post("/v1/automation/orders", { owner: account.address, network, ...payload });
  if (!response.ok && response.data?.retryable) {
    await sleep(1_500);
    response = await json(`/v1/automation/orders?owner=${account.address}&network=${network}&fresh=1`);
    const found = response.ok && (response.data.orders || []).some((order) => order.account.toLowerCase() === payload.account.toLowerCase() && order.orderId === payload.orderId);
    if (found) return;
  }
  if (!response.ok) throw new Error(`order registration ${network}: ${JSON.stringify(response.data)}`);
}
async function orderView(network, accountAddress, orderId) {
  const response = await json(`/v1/automation/orders?owner=${account.address}&network=${network}&fresh=1`);
  if (!response.ok) throw new Error(`order monitor ${network}: ${JSON.stringify(response.data)}`);
  return (response.data.orders || []).find((order) => order.account.toLowerCase() === accountAddress.toLowerCase() && order.orderId === String(orderId));
}
function levels(report, observed) {
  const plan = report.executionPlan || {};
  const buy = plan.buy || {};
  const trigger = Number(buy.trigger) > 0 ? Number(buy.trigger) : observed;
  let takeProfit = Number(buy.takeProfit) > trigger ? Number(buy.takeProfit) : trigger * 1.02;
  let stopLoss = Number(buy.stopLoss) > 0 && Number(buy.stopLoss) < trigger ? Number(buy.stopLoss) : trigger * 0.98;
  if (takeProfit <= stopLoss) { takeProfit = trigger * 1.02; stopLoss = trigger * 0.98; }
  return { trigger, takeProfit, stopLoss };
}
const oracle = (number) => parseUnits(Number(number).toFixed(8), 18);

async function runLimit(network, pair, report) {
  const mapping = await resolvePair(network, pair);
  if (!mapping.available) return log("workflow_unavailable", { network, pair, requested: "limit", reason: mapping.reason });
  if (!EXECUTE) return log("workflow_ready", { network, pair, mode: "limit", route: `${mapping.quote.symbol}/${mapping.base.symbol}` });
  const chain = CHAINS[network];
  const accountAddress = await ensureOwnerAccount(network, "bracket");
  const amount = parseUnits(chain.amount, mapping.quote.decimals);
  const quote = await post("/v1/trading/quote", { network, fromTokenAddress: mapping.quote.address, toTokenAddress: mapping.base.address, amount: String(amount), slippagePercent: 1 });
  if (!quote.ok) throw new Error(`limit quote ${network}: ${JSON.stringify(quote.data)}`);
  const minimumOut = BigInt(quote.data.quote.toTokenAmount) * 98n / 100n;
  const ticker = await json(`/v1/market/ticker?instId=${pair}`);
  const observed = Number(ticker.data?.ticker?.last || report.executionPlan?.observedPrice || 0);
  const reportLevels = levels(report, observed);
  // A test must traverse Pending -> Protected deterministically. Raising a
  // buy-below entry above the live mark is recorded as a harness override;
  // report TP/SL remain the source unless they would violate contract levels.
  const trigger = Math.max(reportLevels.trigger, observed * 1.005);
  const takeProfit = Math.max(reportLevels.takeProfit, trigger * 1.01);
  const stopLoss = Math.min(reportLevels.stopLoss, trigger * 0.99);
  const nextId = await chain.publicClient.readContract({ address: accountAddress, abi: bracketAbi, functionName: "nextOrderId" });
  await ensureApproval(network, mapping.quote.address, accountAddress, amount);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);
  const hash = await txWrite(network, accountAddress, bracketAbi, "createOrder", [mapping.quote.address, mapping.base.address, mapping.base.address, mapping.quote.address, amount, oracle(trigger), false, minimumOut, oracle(takeProfit), oracle(stopLoss), true, expiry]);
  await announce(network, "limit", "buy_below", hash, pair, amount, accountAddress);
  await registerOrder(network, { account: accountAddress, orderId: String(nextId), version: "bracket-v1", instId: pair, sellToken: mapping.quote.address, buyToken: mapping.base.address, txHash: hash });
  let view = await orderView(network, accountAddress, nextId);
  log("limit_pending", { network, pair, orderId: String(nextId), state: view?.status, phase: view?.phase, trigger: view?.triggerPrice, mark: view?.currentPrice, pnl: view?.estimatedPnlPct ?? null, triggerOverride: trigger });
  if (DIRECT_WORKER) {
    // Run one executor cycle in this process while the API worker is disabled.
    // This prevents the authorized test wallet from racing itself on nonces.
    const [{ loadConfig }, { runTradeAutomationCycle }] = await Promise.all([
      import("../packages/config/dist/index.js"),
      import("../apps/api/dist/tradeAutomation.js"),
    ]);
    await runTradeAutomationCycle(loadConfig());
  }
  view = await orderView(network, accountAddress, nextId);
  if (view?.lastError) {
    await txWrite(network, accountAddress, bracketAbi, "cancelAndWithdraw", [nextId]);
    throw new Error(`${network} ${pair} executor failed: ${view.lastError}`);
  }
  for (let attempt = 0; attempt < 8 && view?.phase !== "protected"; attempt += 1) {
    await sleep(15_000);
    view = await orderView(network, accountAddress, nextId);
  }
  if (view?.phase !== "protected") {
    await txWrite(network, accountAddress, bracketAbi, "cancelAndWithdraw", [nextId]);
    throw new Error(`${network} ${pair} did not transition from pending to protected: ${JSON.stringify(view)}`);
  }
  log("limit_active", { network, pair, orderId: String(nextId), trigger: view.triggerPrice, mark: view.currentPrice, pnl: view.estimatedPnlPct, takeProfit: view.takeProfit, stopLoss: view.stopLoss });
  await sleep(30_000);
  const before = await tokenBalance(network, mapping.base.address);
  const closeHash = await txWrite(network, accountAddress, bracketAbi, "cancelAndWithdraw", [nextId]);
  await announce(network, "limit", "close_immediately", closeHash, pair, undefined, accountAddress);
  const after = await tokenBalanceAfter(network, mapping.base.address, before);
  const returned = after - before;
  if (returned <= 0n) throw new Error(`${network} ${pair} close returned no ${mapping.base.symbol}`);
  const sold = await marketSwap(network, pair, mapping.base.address, mapping.quote.address, returned, "market_sell");
  log("limit_closed_and_sold", { network, pair, orderId: String(nextId), assetReturned: formatUnits(returned, mapping.base.decimals), sellHash: sold.hash });
}

async function runMarket(network, pair, report) {
  const mapping = await resolvePair(network, pair);
  if (!mapping.available) return log("workflow_unavailable", { network, pair, requested: "market", reason: mapping.reason });
  if (!EXECUTE) return log("workflow_ready", { network, pair, mode: "market", route: `${mapping.quote.symbol}/${mapping.base.symbol}` });
  const chain = CHAINS[network];
  const amount = parseUnits(chain.amount, mapping.quote.decimals);
  const observed = Number(report.executionPlan?.observedPrice || 0);
  const protectionLevels = levels(report, observed);
  const bought = await marketSwap(network, pair, mapping.quote.address, mapping.base.address, amount, "market_buy_with_protection");
  const accountAddress = await ensureOwnerAccount(network, "protection");
  const nextId = await chain.publicClient.readContract({ address: accountAddress, abi: protectionAbi, functionName: "nextPositionId" });
  await ensureApproval(network, mapping.base.address, accountAddress, bought.received);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);
  const protectionHash = await txWrite(network, accountAddress, protectionAbi, "createPosition", [mapping.base.address, mapping.quote.address, bought.received, oracle(protectionLevels.takeProfit), oracle(protectionLevels.stopLoss), expiry]);
  await announce(network, "spot", "protected_position", protectionHash, pair, bought.received, accountAddress);
  await registerOrder(network, { account: accountAddress, orderId: String(nextId), version: "oco-v1", instId: pair, sellToken: mapping.base.address, buyToken: mapping.quote.address, txHash: protectionHash, fillTxHash: bought.hash });
  const view = await orderView(network, accountAddress, nextId);
  log("market_active", { network, pair, positionId: String(nextId), mark: view?.currentPrice, pnl: view?.estimatedPnlPct, takeProfit: view?.takeProfit, stopLoss: view?.stopLoss });
  await sleep(30_000);
  const before = await tokenBalance(network, mapping.base.address);
  const closeHash = await txWrite(network, accountAddress, protectionAbi, "cancelAndWithdraw", [nextId]);
  await announce(network, "spot", "close_immediately", closeHash, pair, undefined, accountAddress);
  const after = await tokenBalanceAfter(network, mapping.base.address, before);
  const returned = after - before;
  const sold = await marketSwap(network, pair, mapping.base.address, mapping.quote.address, returned, "market_sell");
  log("market_closed_and_sold", { network, pair, positionId: String(nextId), assetReturned: formatUnits(returned, mapping.base.decimals), sellHash: sold.hash });
}

const AUTOPILOT_POLICY_TEXT = {
  trend_following: "Trend-following with Premium analysis confirmation; buy only on bullish confirmation, exit owned assets on bearish risk, otherwise hold.",
  breakout: "Breakout with Premium analysis confirmation; enter only after price and volume confirm a prior-range break, exit owned assets on invalidation, otherwise hold.",
  mean_reversion: "Mean reversion with Premium analysis confirmation; enter only near verified support or an RSI pullback in a range, exit owned assets after reversion or invalidation, otherwise hold.",
};

async function runAutopilot(network = "base", pair = "ETH-USDT", timeframe = "4H", capitalHuman = "0.5", strategyType = "trend_following") {
  if (!CHAINS[network]) throw new Error(`Unsupported Autopilot network: ${network}`);
  if (!/^(15m|1H|4H|1D)$/.test(timeframe)) throw new Error(`Unsupported Autopilot timeframe: ${timeframe}`);
  if (!/^\d+(?:\.\d+)?$/.test(capitalHuman) || Number(capitalHuman) <= 0) throw new Error("Autopilot capital must be a positive human-readable amount");
  if (!AUTOPILOT_POLICY_TEXT[strategyType]) throw new Error(`Unsupported Autopilot strategy: ${strategyType}`);
  const mapping = await resolvePair(network, pair);
  if (!mapping.available) return log("autopilot_unavailable", { network, pair, reason: mapping.reason });
  if (!EXECUTE) return log("autopilot_ready", { network, pair, timeframe, strategyType, route: `${mapping.quote.symbol}/${mapping.base.symbol}`, capital: `${capitalHuman} ${mapping.quote.symbol}` });
  const chain = CHAINS[network];
  if (!/^0x[a-fA-F0-9]{40}$/.test(chain.vaultFactory || "")) throw new Error(`${network} Autopilot factory missing`);
  const capital = parseUnits(capitalHuman, mapping.quote.decimals);
  // Active profile: 10% per trade, 200% daily turnover, 75% exposure,
  // 1.5% slippage, 5% daily loss stop, 120-second cooldown, 60% signal.
  const maxTrade = capital * 10n / 100n;
  const dailyCap = capital * 200n / 100n;
  const exposureCap = capital * 75n / 100n;
  const policy = {
    pair,
    timeframe,
    maxTradePct: 10,
    dailyLossPct: 5,
    strategy: AUTOPILOT_POLICY_TEXT[strategyType],
  };
  const policyHash = keccak256(toHex(JSON.stringify(policy)));
  let vault = REUSE_VAULT;
  if (vault) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(vault)) throw new Error("--reuse-vault requires a valid address");
    const existing = (await snapshot(network, true)).vaults.find((item) => item.address.toLowerCase() === vault.toLowerCase());
    if (!existing || existing.settlementAsset.toLowerCase() !== mapping.quote.address.toLowerCase() || BigInt(existing.balanceAtomic) < capital)
      throw new Error("Reusable vault was not found with the required settlement capital");
    log("autopilot_vault_reused", { network, pair, vault, capital: formatUnits(BigInt(existing.balanceAtomic), mapping.quote.decimals) });
  } else {
    const beforeSnapshot = await snapshot(network, true);
    const createHash = await txWrite(network, chain.vaultFactory, vaultFactoryAbi, "createVault", [mapping.quote.address, policyHash]);
    await announce(network, "autopilot", "create_vault", createHash, pair);
    const afterSnapshot = await snapshot(network, true);
    vault = afterSnapshot.vaults.map((item) => item.address).find((candidate) => !beforeSnapshot.vaults.some((item) => item.address.toLowerCase() === candidate.toLowerCase())) || afterSnapshot.vaults.at(-1)?.address;
    if (!vault) throw new Error("Created Autopilot vault was not discovered");
    const assetHash = await txWrite(network, vault, vaultAbi, "configureAsset", [mapping.base.address, true, exposureCap]);
    await announce(network, "autopilot", "vault_asset_policy", assetHash, pair, undefined, vault);
    const limitsHash = await txWrite(network, vault, vaultAbi, "configureLimits", [maxTrade, dailyCap, 150, 500, 120n, BigInt(Math.floor(Date.now() / 1000) + 30 * 86400)]);
    await announce(network, "autopilot", "vault_risk_policy", limitsHash, pair, undefined, vault);
    const fundHash = await txWrite(network, mapping.quote.address, erc20Abi, "transfer", [vault, capital]);
    await announce(network, "autopilot", "vault_fund", fundHash, pair, capital, vault);
  }
  const sizing = await post("/v1/trading/quote", { network, fromTokenAddress: mapping.quote.address, toTokenAddress: mapping.base.address, amount: String(maxTrade), slippagePercent: 1.5 });
  if (!sizing.ok || !/^\d+$/.test(String(sizing.data?.quote?.toTokenAmount || ""))) throw new Error(`Autopilot route sizing failed: ${JSON.stringify(sizing.data)}`);
  const payload = {
    owner: account.address,
    network,
    vault,
    settlementAsset: mapping.quote.address,
    targetAsset: mapping.base.address,
    pair,
    timeframe,
    strategyType,
    buyAmountAtomic: String(maxTrade),
    sellAmountAtomic: String(sizing.data.quote.toTokenAmount),
    minConfidence: 60,
    policy,
  };
  const expiresAt = Date.now() + 5 * 60_000;
  const authorizationMessage = `PULSE Autopilot strategy\n${keccak256(toHex(JSON.stringify(payload)))}\nExpires:${expiresAt}`;
  const signature = await account.signMessage({ message: authorizationMessage });
  const registration = await post("/v1/autopilot/strategies", { ...payload, authorization: { expiresAt, signature } });
  if (!registration.ok) throw new Error(`Autopilot registration failed: ${JSON.stringify(registration.data)}`);
  const resumeHash = await txWrite(network, vault, vaultAbi, "setPaused", [false]);
  await announce(network, "autopilot", "vault_resume", resumeHash, pair, undefined, vault);
  log("autopilot_activated", { network, pair, timeframe, strategyType, vault, capital: formatUnits(capital, mapping.quote.decimals) });

  if (DIRECT_WORKER) {
    const [{ loadConfig }, { runAutopilotCycle }] = await Promise.all([
      import("../packages/config/dist/index.js"),
      import("../apps/api/dist/autopilotAutomation.js"),
    ]);
    await runAutopilotCycle(loadConfig());
  }

  let strategyView;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const response = await json(`/v1/autopilot/strategies?owner=${account.address}&network=${network}`);
    strategyView = (response.data?.strategies || []).find((item) => item.vault.toLowerCase() === vault.toLowerCase());
    if (strategyView?.lastRunAt) break;
    await sleep(15_000);
  }
  if (!strategyView?.lastRunAt) throw new Error("Autopilot did not complete its first Premium-analysis cycle within four minutes");
  log("autopilot_decision", { network, pair, vault, decision: strategyView.lastDecision, mark: strategyView.markPrice, portfolioValueAtomic: strategyView.portfolioValueAtomic, pnlPct: strategyView.pnlPct, evidenceHash: strategyView.evidenceHash, txHash: strategyView.lastTxHash, error: strategyView.lastError });
  if (strategyView.lastError) throw new Error(`Autopilot first cycle failed: ${strategyView.lastError}`);

  if (LEAVE_AUTOPILOT_ACTIVE) {
    log("autopilot_left_active", {
      network,
      pair,
      timeframe,
      strategyType,
      vault,
      decision: strategyView.lastDecision,
      capital: strategyView.portfolioValueAtomic,
      note: "The first decision may be Hold. The funded strategy remains active and will evaluate future Premium cycles for Buy, Hold, or Sell.",
    });
    return;
  }

  const pauseHash = await txWrite(network, vault, vaultAbi, "setPaused", [true]);
  await announce(network, "autopilot", "vault_pause", pauseHash, pair, undefined, vault);
  const [targetInVault, settlementInVault] = await Promise.all([
    tokenBalance(network, mapping.base.address, vault),
    tokenBalance(network, mapping.quote.address, vault),
  ]);
  if (targetInVault > 0n) await txWrite(network, vault, vaultAbi, "withdraw", [mapping.base.address, targetInVault]);
  if (settlementInVault > 0n) await txWrite(network, vault, vaultAbi, "withdraw", [mapping.quote.address, settlementInVault]);
  if (targetInVault > 0n) await marketSwap(network, pair, mapping.base.address, mapping.quote.address, targetInVault, "market_sell");
  log("autopilot_paused_and_unwound", { network, pair, vault, returnedSettlement: formatUnits(settlementInVault, mapping.quote.decimals), returnedTarget: formatUnits(targetInVault, mapping.base.decimals) });
}

async function paidReport(network, pair, timeframe = "4H") {
  if (!EXECUTE) return { instId: pair, timeframe, executionPlan: { observedPrice: 1, buy: { trigger: 1, takeProfit: 1.02, stopLoss: 0.98 } } };
  const { createPaidFetch } = await import("../packages/buyer/dist/index.js");
  const chain = CHAINS[network];
  const paidFetch = createPaidFetch({ privateKey: key, rpcUrl: chain.rpc[0], network: `eip155:${chain.id}` });
  const response = await paidFetch(`${API}/${chain.reportRoute}/v1/analysis/spot/standard`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ instId: pair, timeframe, lang: "en", userNote: "Mainnet E2E lifecycle test; return a spot-only buy or wait plan." }) });
  const accepted = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`paid report ${network}/${pair}: ${response.status} ${JSON.stringify(accepted)}`);
  if (response.status !== 202) return accepted;
  const jobId = accepted.job?.id;
  const recoveryToken = accepted.recoveryToken;
  if (!jobId || !recoveryToken) throw new Error("Paid report missing recovery capability");
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const status = await fetch(`${API}/v1/jobs/${jobId}`, { headers: { "PULSE-RECOVERY-TOKEN": recoveryToken } });
    const state = await status.json();
    const stage = state.job?.stage;
    if (stage === "completed" || stage === "completed_partial") {
      const reportResponse = await fetch(`${API}/v1/jobs/${jobId}/report`, { headers: { "PULSE-RECOVERY-TOKEN": recoveryToken } });
      const body = await reportResponse.json();
      if (!reportResponse.ok || !body.report) throw new Error(`report recovery ${network}/${pair}: ${JSON.stringify(body)}`);
      log("analysis_report_ready", { network, pair, jobId, action: body.report.executionPlan?.recommendation?.action, mappedDefiAsset: body.report.defi?.asset });
      return body.report;
    }
    if (["failed_terminal", "manual_reconciliation"].includes(stage)) throw new Error(`report job ${jobId} ended ${stage}`);
    await sleep(2_000);
  }
  throw new Error(`report ${network}/${pair} timed out`);
}

async function preflight() {
  log("preflight", { execute: EXECUTE, wallet: short(account.address), api: API });
  for (const [network, chain] of Object.entries(CHAINS)) {
    const [native, state] = await Promise.all([chain.publicClient.getBalance({ address: account.address }), snapshot(network, true)]);
    const eth = await resolvePair(network, "ETH-USDT");
    const sol = await resolvePair(network, "SOL-USDT");
    const settlementToken = eth.quote || sol.quote;
    const stable = settlementToken ? await tokenBalance(network, settlementToken.address) : 0n;
    log("network_preflight", { network, native: formatUnits(native, 18), settlement: settlementToken ? `${formatUnits(stable, settlementToken.decimals)} ${settlementToken.symbol}` : "unresolved", accounts: state.accounts, vaultCount: state.vaults.length, eth: eth.available ? `${eth.base.symbol}/${eth.quote.symbol}` : eth.reason, sol: sol.available ? `${sol.base.symbol}/${sol.quote.symbol}` : sol.reason });
  }
}

async function main() {
  if (AUTOPILOT_CYCLE_ONLY) {
    const [{ loadConfig }, { runAutopilotCycle }] = await Promise.all([
      import("../packages/config/dist/index.js"),
      import("../apps/api/dist/autopilotAutomation.js"),
    ]);
    await runAutopilotCycle(loadConfig());
    const response = await json(
      `/v1/autopilot/strategies?owner=${account.address}&network=${AUTOPILOT_NETWORK}`,
    );
    const strategy = (response.data?.strategies || []).find(
      (item) =>
        item.pair === AUTOPILOT_PAIR && item.timeframe === AUTOPILOT_TIMEFRAME && item.strategyType === AUTOPILOT_STRATEGY,
    );
    log("autopilot_cycle_complete", {
      network: AUTOPILOT_NETWORK,
      pair: AUTOPILOT_PAIR,
      timeframe: AUTOPILOT_TIMEFRAME,
      strategyType: AUTOPILOT_STRATEGY,
      vault: strategy?.vault,
      status: strategy?.status,
      paused: strategy?.paused,
      decision: strategy?.lastDecision,
      error: strategy?.lastError,
      evidenceHash: strategy?.evidenceHash,
      txHash: strategy?.lastTxHash,
      settlementBalance: strategy?.settlementBalance,
      targetBalance: strategy?.targetBalance,
      portfolioValueAtomic: strategy?.portfolioValueAtomic,
      evaluation: strategy?.evaluations?.at(-1),
    });
    if (!strategy || strategy.lastError)
      throw new Error(
        `Autopilot cycle did not finish cleanly: ${strategy?.lastError || "strategy unavailable"}`,
      );
    return;
  }
  await preflight();
  if (DOGE_ONLY) {
    const report = await paidReport("base", "DOGE-USDT");
    for (const network of ["base", "arbitrum", "xlayer"]) {
      await runLimit(network, "DOGE-USDT", report);
      await runMarket(network, "DOGE-USDT", report);
    }
    log("doge_matrix_complete", { executed: EXECUTE });
    return;
  }
  if (AUTOPILOT_ONLY) {
    await runAutopilot(AUTOPILOT_NETWORK, AUTOPILOT_PAIR, AUTOPILOT_TIMEFRAME, AUTOPILOT_CAPITAL, AUTOPILOT_STRATEGY);
    return;
  }
  if (CLOSE_PROTECTION) {
    const [network, positionId, pair = "SOL-USDT"] = CLOSE_PROTECTION.split(":");
    if (!CHAINS[network] || !/^\d+$/.test(positionId || "")) throw new Error("--close-protection requires network:positionId[:pair]");
    const mapping = await resolvePair(network, pair);
    if (!mapping.available) throw new Error(mapping.reason || `${network} route unavailable`);
    const state = await snapshot(network, true);
    const accountAddress = state.accounts.protection;
    if (!accountAddress) throw new Error(`${network} protection account not found`);
    const before = await tokenBalance(network, mapping.base.address);
    const closeHash = await txWrite(network, accountAddress, protectionAbi, "cancelAndWithdraw", [BigInt(positionId)]);
    await announce(network, "spot", "close_immediately", closeHash, pair, undefined, accountAddress);
    const after = await tokenBalanceAfter(network, mapping.base.address, before);
    const returned = after - before;
    if (returned <= 0n) throw new Error(`${network} close returned no ${mapping.base.symbol}`);
    const sold = await marketSwap(network, pair, mapping.base.address, mapping.quote.address, returned, "market_sell");
    log("protected_position_closed_and_sold", { network, pair, positionId, returned: formatUnits(returned, mapping.base.decimals), sellHash: sold.hash });
    return;
  }
  if (SELL_WALLET_ASSET) {
    const separator = SELL_WALLET_ASSET.indexOf(":");
    const network = SELL_WALLET_ASSET.slice(0, separator);
    const pair = SELL_WALLET_ASSET.slice(separator + 1);
    if (!CHAINS[network] || !pair) throw new Error("--sell-wallet-asset requires network:PAIR");
    const mapping = await resolvePair(network, pair);
    if (!mapping.available) throw new Error(mapping.reason || `${network} route unavailable`);
    const balance = await tokenBalance(network, mapping.base.address);
    if (balance <= 0n) throw new Error(`The test wallet has no ${mapping.base.symbol} on ${network}`);
    const sold = await marketSwap(network, pair, mapping.base.address, mapping.quote.address, balance, "market_sell");
    log("wallet_asset_unwound", { network, pair, amount: formatUnits(balance, mapping.base.decimals), sellHash: sold.hash });
    return;
  }
  if (CLOSE_ORDER) {
    const [network, orderId, pair = "ETH-USDT"] = CLOSE_ORDER.split(":");
    if (!CHAINS[network] || !/^\d+$/.test(orderId || "")) throw new Error("--close-order requires network:orderId[:pair]");
    const mapping = await resolvePair(network, pair);
    if (!mapping.available) throw new Error(mapping.reason || `${network} route unavailable`);
    const state = await snapshot(network, true);
    const accountAddress = state.accounts.bracket;
    if (!accountAddress) throw new Error(`${network} bracket account not found`);
    const before = await tokenBalance(network, mapping.base.address);
    const closeHash = await txWrite(network, accountAddress, bracketAbi, "cancelAndWithdraw", [BigInt(orderId)]);
    await announce(network, "limit", "close_immediately", closeHash, pair, undefined, accountAddress);
    const after = await tokenBalanceAfter(network, mapping.base.address, before);
    const returned = after - before;
    if (returned <= 0n) throw new Error(`${network} close returned no ${mapping.base.symbol}`);
    const sold = await marketSwap(network, pair, mapping.base.address, mapping.quote.address, returned, "market_sell");
    log("existing_order_closed_and_sold", { network, pair, orderId, returned: formatUnits(returned, mapping.base.decimals), sellHash: sold.hash });
    return;
  }
  if (SELL_BASE_WETH) {
    const mapping = await resolvePair("base", "ETH-USDT");
    if (!mapping.available) throw new Error(mapping.reason || "Base ETH route unavailable");
    const balance = await tokenBalance("base", mapping.base.address);
    if (balance <= 0n) throw new Error("The test wallet has no Base WETH to unwind");
    const sold = await marketSwap("base", "ETH-USDT", mapping.base.address, mapping.quote.address, balance, "market_sell");
    log("base_weth_unwound", { amount: formatUnits(balance, mapping.base.decimals), sellHash: sold.hash });
    return;
  }
  if (CLOSE_BASE_ORDER) {
    if (!/^\d+$/.test(CLOSE_BASE_ORDER)) throw new Error("--close-base-order requires a numeric order ID");
    const mapping = await resolvePair("base", "ETH-USDT");
    if (!mapping.available) throw new Error(mapping.reason || "Base ETH route unavailable");
    const state = await snapshot("base", true);
    const accountAddress = state.accounts.bracket;
    if (!accountAddress) throw new Error("Base bracket account not found");
    const before = await tokenBalance("base", mapping.base.address);
    const closeHash = await txWrite("base", accountAddress, bracketAbi, "cancelAndWithdraw", [BigInt(CLOSE_BASE_ORDER)]);
    await announce("base", "limit", "close_immediately", closeHash, "ETH-USDT", undefined, accountAddress);
    const after = await tokenBalance("base", mapping.base.address);
    const returned = after - before;
    if (returned <= 0n) throw new Error("Closing the Base order returned no WETH");
    const sold = await marketSwap("base", "ETH-USDT", mapping.base.address, mapping.quote.address, returned, "market_sell");
    log("existing_base_order_closed_and_sold", { orderId: CLOSE_BASE_ORDER, returned: formatUnits(returned, mapping.base.decimals), sellHash: sold.hash });
    return;
  }
  if (WORKER_ONLY) {
    const [{ loadConfig }, { runTradeAutomationCycle }] = await Promise.all([
      import("../packages/config/dist/index.js"),
      import("../apps/api/dist/tradeAutomation.js"),
    ]);
    await runTradeAutomationCycle(loadConfig());
    for (const network of Object.keys(CHAINS)) {
      const response = await json(`/v1/automation/orders?owner=${account.address}&network=${network}&fresh=1`);
      for (const order of response.data?.orders || []) {
        log("worker_order_state", {
          network,
          account: order.account,
          orderId: order.orderId,
          phase: order.phase,
          status: order.status,
          trigger: order.triggerPrice,
          mark: order.currentPrice,
          pnl: order.estimatedPnlPct ?? null,
          error: order.lastError,
        });
      }
    }
    return;
  }
  const reports = {};
  for (const network of ["base", "arbitrum", "xlayer"])
    for (const pair of ["ETH-USDT", "SOL-USDT"])
      reports[`${network}:${pair}`] = RESUME
        ? { instId: pair, timeframe: "4H", executionPlan: { observedPrice: Number((await json(`/v1/market/ticker?instId=${pair}`)).data?.ticker?.last || 1), buy: {} } }
        : await paidReport(network, pair);

  if (!SKIP_BASE_LIMIT) await runLimit("base", "ETH-USDT", reports["base:ETH-USDT"]);
  if (BASE_LIMIT_ONLY) {
    log("base_limit_workflow_complete", { executed: EXECUTE });
    console.log(`PULSE_E2E_RESULT=${JSON.stringify({ generatedAt: new Date().toISOString(), execute: EXECUTE, wallet: account.address, results })}`);
    return;
  }
  await runMarket("base", "SOL-USDT", reports["base:SOL-USDT"]);
  if (!SKIP_ARBITRUM_LIMIT) await runLimit("arbitrum", "ETH-USDT", reports["arbitrum:ETH-USDT"]);
  await runMarket("arbitrum", "SOL-USDT", reports["arbitrum:SOL-USDT"]);
  if (!SKIP_XLAYER_LIMIT) await runLimit("xlayer", "ETH-USDT", reports["xlayer:ETH-USDT"]);
  await runMarket("xlayer", "SOL-USDT", reports["xlayer:SOL-USDT"]);
  log("spot_workflows_complete", { executed: EXECUTE, supportedExecuted: EXECUTE ? 4 : 0, unsupported: ["base:SOL-USDT", "arbitrum:SOL-USDT"] });
  await runAutopilot("base", "ETH-USDT");
  console.log(`PULSE_E2E_RESULT=${JSON.stringify({ generatedAt: new Date().toISOString(), execute: EXECUTE, wallet: account.address, results })}`);
}

main().catch((error) => {
  log("fatal", { message: error instanceof Error ? error.message : String(error) });
  console.error("PULSE V6 mainnet E2E failed; completed actions remain visible in the dashboard and on-chain.");
  process.exitCode = 1;
});
