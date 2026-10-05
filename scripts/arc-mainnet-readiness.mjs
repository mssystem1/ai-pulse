// Read-only: no signing, payments, approvals, deposits, swaps or deployment.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { createHmac } from "node:crypto";
import { decodeFunctionData, encodeFunctionData, keccak256, parseAbi } from "viem";

const root = resolve(import.meta.dirname, "..");
const env = { ...parse(await readFile(resolve(root, ".env"), "utf8")), ...process.env };
env.OKX_API_KEY ||= env.OKX_XLAYER_API_KEY;
env.OKX_SECRET_KEY ||= env.OKX_XLAYER_API_SECRET || env.OKX_API_SECRET;
env.OKX_PASSPHRASE ||= env.OKX_XLAYER_API_PASSPHRASE;
env.CIRCLE_API_KEY = env.CIRCLE_API_KEY_MAINNET || env.CIRCLE_API_KEY;
const rpc = env.ARC_RPC_URL || "https://rpc.mainnet.arc.io";
const gateway = env.CIRCLE_GATEWAY_MAINNET_URL || "https://gateway-api.circle.com";
const checks = [];
async function check(name, operation) {
  try { checks.push({ name, ...await operation() }); }
  catch (error) { checks.push({ name, ready: false, detail: /^(HTTP \d{3}|OKX code \d{1,10})$/.test(error.message || "") ? `Read-only upstream returned ${error.message}` : "Read-only upstream request failed" }); }
}
async function json(url, init = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 1 || /^HTTP (?:400|401|403|404)$/.test(error.message || "")) throw error;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
}
let nextId = 0;
async function okxGet(path, params = {}) {
  if (!env.OKX_API_KEY || !env.OKX_SECRET_KEY || !env.OKX_PASSPHRASE) throw new Error("OKX credentials missing");
  const query = new URLSearchParams(params).toString();
  const requestPath = `${path}${query ? `?${query}` : ""}`;
  const timestamp = new Date().toISOString();
  const headers = { "OK-ACCESS-KEY": env.OKX_API_KEY.trim(), "OK-ACCESS-PASSPHRASE": env.OKX_PASSPHRASE.trim(), "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-SIGN": createHmac("sha256", env.OKX_SECRET_KEY.trim()).update(`${timestamp}GET${requestPath}`).digest("base64") };
  const body = await json(`${env.OKX_BASE_URL || "https://web3.okx.com"}${requestPath}`, { headers });
  if (String(body.code) !== "0") throw new Error(/^\d{1,10}$/.test(String(body.code)) ? `OKX code ${body.code}` : "Invalid provider result");
  return body.data;
}
async function call(method, params = []) {
  const body = await json(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++nextId, method, params }) });
  if (body.error || body.result == null) throw new Error("RPC rejected the request");
  return body.result;
}
await check("arc-mainnet-rpc", async () => {
  const chainId = Number(BigInt(await call("eth_chainId")));
  return { ready: chainId === 5042, chainId, latestBlock: String(BigInt(await call("eth_blockNumber"))) };
});
if (checks[0].ready) {
  await check("arc-usdc-decimals", async () => {
    const decimals = Number(BigInt(await call("eth_call", [{ to: "0x3600000000000000000000000000000000000000", data: "0x313ce567" }, "latest"])));
    return { ready: decimals === 6, decimals, nativeDecimals: 18 };
  });
  for (const [name, address] of [
    ["gateway-wallet", "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE"],
    ["WETH", "0x128cC466B61f542da60c70e3aA11c10e19B84EDB"],
    ["cirBTC", "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0"],
  ]) await check(name, async () => ({ ready: (await call("eth_getCode", [address, "latest"])) !== "0x", address }));
}
await check("gateway-mainnet-nanopayments", async () => {
  const body = await json(`${gateway.replace(/\/$/, "")}/v1/x402/supported`);
  const kind = body.kinds?.find(item => item.network === "eip155:5042" && item.scheme === "exact" && item.x402Version === 2);
  const asset = kind?.extra?.assets?.find(item => item.address?.toLowerCase() === "0x3600000000000000000000000000000000000000" && item.decimals === 6);
  return { ready: Boolean(asset && kind.extra.name === "GatewayWalletBatched" && kind.extra.verifyingContract?.toLowerCase() === "0x77777777dcc4d5a8b6e418fd04d8997ef11000ee"), network: kind?.network || null };
});
await check("okx-arc-swap-provider", async () => {
  if (!env.OKX_API_KEY || !env.OKX_SECRET_KEY || !env.OKX_PASSPHRASE) return { ready: false, detail: "OKX credentials missing" };
  const data = await okxGet("/api/v6/dex/aggregator/supported/chain");
  const chain = data?.find(item => String(item.chainIndex ?? item.chainId) === "5042");
  return { ready: Boolean(chain), detail: chain ? "Provider advertises Arc mainnet" : "Provider does not advertise Arc mainnet" };
});
await check("okx-arc-live-route", async () => {
  const from = "0x3600000000000000000000000000000000000000", to = "0x128cc466b61f542da60c70e3aa11c10e19b84edb";
  const owner = env.TEST_WALLET_ADDRESS;
  if (!/^0x(?!0{40}$)[a-fA-F0-9]{40}$/.test(owner || "")) return { ready: false, detail: "Qualification wallet address missing" };
  const input = { chainIndex: "5042", fromTokenAddress: from, toTokenAddress: to, amount: "1000000", swapMode: "exactIn" };
  const quote = (await okxGet("/api/v6/dex/aggregator/quote", input))?.[0];
  const prepared = (await okxGet("/api/v6/dex/aggregator/swap", { ...input, userWalletAddress: owner, slippagePercent: "0.5" }))?.[0];
  const approval = (await okxGet("/api/v6/dex/aggregator/approve-transaction", { chainIndex: "5042", tokenContractAddress: from, approveAmount: input.amount }))?.[0];
  const matches = value => value && (value.chainIndex == null || String(value.chainIndex) === "5042")
    && value.fromToken?.tokenContractAddress?.toLowerCase() === from && value.toToken?.tokenContractAddress?.toLowerCase() === to
    && value.fromTokenAmount === input.amount && /^[1-9]\d*$/.test(String(value.toTokenAmount));
  const tx = prepared?.tx, router = tx?.to, spender = approval?.dexContractAddress;
  if (!matches(quote) || !matches(prepared?.routerResult) || tx?.from?.toLowerCase() !== owner.toLowerCase() || String(tx?.value) !== "0"
    || !/^0x[\da-f]{8}(?:[\da-f]{2})*$/i.test(tx?.data || "") || ![router, spender].every(value => /^0x(?!0{40}$)[\da-f]{40}$/i.test(value || ""))) {
    return { ready: false, detail: "Arc route identity or approval evidence mismatch" };
  }
  const [routerCode, spenderCode] = await Promise.all([call("eth_getCode", [router, "latest"]), call("eth_getCode", [spender, "latest"])]);
  const abi = parseAbi([
    "function dagSwapByOrderId(uint256 orderId, (uint256 fromToken,address toToken,uint256 fromTokenAmount,uint256 minReturnAmount,uint256 deadLine) baseRequest, (address[] mixAdapters,address[] assetTo,uint256[] rawData,bytes[] extraData,uint256 fromToken)[] paths) payable returns (uint256 returnAmount)",
    "function dagSwapTo(uint256 orderId, address receiver, (uint256 fromToken,address toToken,uint256 fromTokenAmount,uint256 minReturnAmount,uint256 deadLine) baseRequest, (address[] mixAdapters,address[] assetTo,uint256[] rawData,bytes[] extraData,uint256 fromToken)[] paths) payable returns (uint256 returnAmount)",
    "function uniswapV3SwapTo(uint256 receiver,uint256 amount,uint256 minReturn,uint256[] pools) payable returns(uint256 returnAmount)",
  ]);
  const decoded = decodeFunctionData({ abi, data: tx.data });
  let minimum;
  if (decoded.functionName === "uniswapV3SwapTo") {
    const [receiver, amount, minReturn, pools] = decoded.args;
    const mask = (1n << 160n) - 1n;
    if (((receiver & mask) !== 0n && (receiver & mask) !== BigInt(owner)) || amount !== BigInt(input.amount) || pools.length < 1 || pools.length > 16 || (pools.at(-1) & (1n << 253n)) !== 0n) return { ready: false, detail: "Arc direct pool route intent mismatch" };
    let current = from;
    for (const packed of pools) {
      const address = `0x${(packed & mask).toString(16).padStart(40, "0")}`;
      const [token0, token1] = await Promise.all([call("eth_call", [{ to: address, data: "0x0dfe1681" }, "latest"]), call("eth_call", [{ to: address, data: "0xd21220a7" }, "latest"])]);
      const tokens = [token0, token1].map(value => `0x${value.slice(-40)}`.toLowerCase());
      if ((packed & (1n << 255n)) !== 0n) tokens.reverse();
      if (tokens[0] !== current) return { ready: false, detail: "Arc pool token path mismatch" };
      current = tokens[1];
    }
    if (current !== to) return { ready: false, detail: "Arc pool output token mismatch" };
    minimum = minReturn;
  } else {
    const receiver = decoded.functionName === "dagSwapTo" ? decoded.args[1] : tx.from;
    const base = decoded.functionName === "dagSwapTo" ? decoded.args[2] : decoded.args[1];
    if (receiver.toLowerCase() !== owner.toLowerCase() || base.toToken.toLowerCase() !== to || (base.fromToken & ((1n << 160n) - 1n)) !== BigInt(from)
      || base.fromTokenAmount !== BigInt(input.amount) || base.deadLine <= BigInt(Math.floor(Date.now() / 1000) + 15)) return { ready: false, detail: "Arc executable calldata does not match the requested trade" };
    minimum = base.minReturnAmount;
  }
  if (minimum <= 0n || minimum < BigInt(prepared.routerResult.toTokenAmount) * 995n / 1000n || minimum > BigInt(prepared.routerResult.toTokenAmount)) return { ready: false, detail: "Arc route minimum output mismatch" };
  return { ready: routerCode !== "0x" && spenderCode !== "0x", mode: "prepared-only; no signature or broadcast", from, to, inputUSDC: "1",
    outputAtomic: prepared.routerResult.toTokenAmount, minimumOutputAtomic: String(minimum), router, spender, selector: tx.data.slice(0, 10), calldataFunction: decoded.functionName,
    routerRuntimeCodeHash: keccak256(routerCode), spenderRuntimeCodeHash: keccak256(spenderCode),
    detail: "Prepared route and decoded calldata match chain, assets, amount, recipient and 0.5% minimum output; this read-only check alone does not qualify funded execution" };
});
await check("arc-source-verifier", async () => {
  const chains = await json("https://sourcify.dev/server/chains");
  return { ready: Boolean(chains.find(item => Number(item.chainId) === 5042)?.supported), provider: "Sourcify" };
});
await check("pulse-arc-deployment", async () => {
  const manifest = await readFile(resolve(root, "packages/contracts/deployments/5042.json"), "utf8").then(JSON.parse).catch(() => null);
  const contracts = Object.entries(manifest?.contracts || {});
  if (manifest?.chainId !== 5042 || contracts.length !== 7) return { ready: false, detail: "Seven-contract Arc mainnet manifest required" };
  const matches = await Promise.all(contracts.map(async ([key, contract]) => {
    const code = await call("eth_getCode", [contract.address, "latest"]);
    return code !== "0x" && keccak256(code).toLowerCase() === contract.runtimeCodeHash.toLowerCase()
      && manifest.verification?.results?.[key]?.status === "verified";
  }));
  return { ready: matches.every(Boolean), contractCount: contracts.length, runtimeMatches: matches.filter(Boolean).length,
    detail: "Deployed runtime hashes checked against the source-verified mainnet manifest; release activation is a separate gate" };
});
await check("pulse-arc-release", async () => {
  const manifest = await readFile(resolve(root, "packages/contracts/deployments/5042.json"), "utf8").then(JSON.parse).catch(() => null);
  if (manifest?.chainId !== 5042) return { ready: false, detail: "Arc mainnet manifest required" };
  const paused = BigInt(await call("eth_call", [{ to: manifest.contracts.registry.address,
    data: encodeFunctionData({ abi: parseAbi(["function automationPaused() view returns(bool)"]), functionName: "automationPaused" }) }, "latest"])) !== 0n;
  return { ready: Boolean(manifest.productionReady && manifest.tradingEnabled && !paused && /^(1|true)$/.test(env.FEATURE_ARC_TRADING || "")),
    registryPaused: paused, detail: "Production release requires completed wallet/UI/hosted acceptance and explicit trading activation" };
});
checks.push({ name: "circle-email-wallet", ready: Boolean(env.CIRCLE_API_KEY && env.VITE_CIRCLE_APP_ID && !/TEST_API_KEY/i.test(env.CIRCLE_API_KEY) && /^(1|true)$/.test(env.FEATURE_CIRCLE_MAINNET_WALLETS || "")),
  detail: /TEST_API_KEY/i.test(env.CIRCLE_API_KEY || "") ? "Test API key cannot initialize ARC mainnet wallets" : "Production app/subscription setup and email OTP acceptance are pending until explicitly enabled" });
await check("circle-mainnet-key-authentication", async () => {
  if (!env.CIRCLE_API_KEY || /^TEST_API_KEY/i.test(env.CIRCLE_API_KEY)) return { ready: false, detail: "Production Circle key missing" };
  await json("https://api.circle.com/v1/w3s/users?pageSize=1", { headers: { Authorization: `Bearer ${env.CIRCLE_API_KEY}` } });
  return { ready: true, detail: "Production key authenticated; user data omitted" };
});
const report = { asOf: new Date().toISOString(), mode: "read-only", chainId: 5042, checks,
  researchInfrastructureReady: checks.filter(item => ["arc-mainnet-rpc", "arc-usdc-decimals", "gateway-wallet", "gateway-mainnet-nanopayments"].includes(item.name)).length === 4
    && checks.filter(item => ["arc-mainnet-rpc", "arc-usdc-decimals", "gateway-wallet", "gateway-mainnet-nanopayments"].includes(item.name)).every(item => item.ready),
  fullExecutionReady: checks.every(item => item.ready) };
const output = process.argv.indexOf("--output");
if (output >= 0) {
  const target = resolve(root, process.argv[output + 1] || ".tmp/arc-mainnet-readiness.json");
  if (!target.startsWith(`${root}\\`) && !target.startsWith(`${root}/`)) throw new Error("Readiness output must remain in this workspace");
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--strict") && !report.fullExecutionReady) process.exitCode = 1;
