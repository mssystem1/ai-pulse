/** Configure/register only the journaled test vault; keep it paused until pass tests. */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import express from "express";
import { encodeFunctionData, erc20Abi, formatUnits, keccak256, parseAbi, parseUnits, toHex, type Address, type Hex } from "viem";
import { qualificationJournal } from "./arc-qualification-journal.js";

async function main() {
  config({ quiet: true });
  process.env.REDIS_URL = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL;
  process.env.QUEUE_PROVIDER = "redis";
  process.env.PERSISTENCE_NAMESPACE = "pulse-arc-mainnet-qualification";
  process.env.AUTOMATION_WORKER_ENABLED = "0";
  process.env.FEATURE_ARC_TRADING = "1";
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { createAutopilotAutomationRouter } = await import("../apps/api/src/autopilotAutomation.js");
  const ARC_USDC = "0x3600000000000000000000000000000000000000" as Address;
  const ARC_WETH = "0x128cc466b61f542da60c70e3aa11c10e19b84edb" as Address;
  const { executionMarketContext, executionSettlementTicker } = await import("../apps/api/src/robinhoodMarkets.js");
  const cfg = loadConfig();
  const accounts = JSON.parse(await readFile("packages/contracts/deployments/5042-account-qualification.json", "utf8"));
  const vault = accounts.entries.find((entry: { kind: string }) => entry.kind === "autopilot")?.account as Address;
  if (!vault || accounts.owner.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase()) throw new Error("Qualification account journal mismatch");
  const broadcast = process.argv.includes("--broadcast");
  const q = await qualificationJournal({ path: "packages/contracts/deployments/5042-autopilot-setup-qualification.json", rpcUrl: cfg.ARC_RPC_URL,
    privateKey: cfg.TEST_WALLET_PRIVATE_KEY as Hex, owner: cfg.TEST_WALLET_ADDRESS, broadcast, budgetUSDC: "0.10", targets: [vault, ARC_USDC] });
  const abi = parseAbi([
    "function owner() view returns(address)", "function settlementAsset() view returns(address)", "function policyHash() view returns(bytes32)",
    "function paused() view returns(bool)", "function configureAsset(address,bool,uint256)",
    "function configureLimits(uint128,uint128,uint16,uint16,uint64,uint64)",
  ]);
  try {
    await q.reconcile();
    if ((await q.client.readContract({ address: vault, abi, functionName: "owner" })).toLowerCase() !== q.account.address.toLowerCase()
      || (await q.client.readContract({ address: vault, abi, functionName: "settlementAsset" })).toLowerCase() !== ARC_USDC
      || await q.client.readContract({ address: vault, abi, functionName: "policyHash" }) !== keccak256(toHex(JSON.stringify(accounts.policy)))) throw new Error("Qualification vault identity mismatch");
    if (q.journal.data.registered) { console.log("Autopilot setup receipts reconciled; no funding or configuration repeated."); return; }
    const market = await executionMarketContext(cfg, { instId: accounts.policy.pair, timeframe: accounts.policy.timeframe, candleLimit: 120, completedOnly: true });
    if (market.candles.length < 50 || market.candles.slice(-50).some(c => c.confirmed !== true)) throw new Error("Qualification requires completed live market history");
    await executionSettlementTicker(cfg, accounts.policy.pair);
    const balance = await q.client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [q.account.address] });
    console.log(JSON.stringify({ broadcast, pair: accounts.policy.pair, completedCandles: market.candles.length, walletUSDC: formatUnits(balance, 6), testDepositUSDC: "0.20", paidPassNotPurchased: true }));
    if (!broadcast) return;
    if (!await q.client.readContract({ address: vault, abi, functionName: "paused" })) throw new Error("Qualification vault must remain paused for setup");
    await q.send("allow-WETH", vault, encodeFunctionData({ abi, functionName: "configureAsset", args: [ARC_WETH, true, parseUnits("0.30", 6)] }));
    await q.send("configure-limits", vault, encodeFunctionData({ abi, functionName: "configureLimits", args: [parseUnits("0.11", 6), parseUnits("0.40", 6), 100, 500, 60n, BigInt(Math.floor(Date.now() / 1000) + 2 * 86400)] }));
    await q.send("fund-vault", ARC_USDC, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [vault, parseUnits("0.20", 6)] }), undefined, parseUnits("0.20", 6));
    const payload = { owner: q.account.address, network: "arc", vault, settlementAsset: ARC_USDC, targetAsset: ARC_WETH,
      pair: accounts.policy.pair, timeframe: accounts.policy.timeframe, strategyType: "trend_following", buyAmountAtomic: parseUnits("0.10", 6).toString(),
      sellAmountAtomic: parseUnits("0.0001", 18).toString(), minConfidence: 60, policy: accounts.policy };
    const expiresAt = Date.now() + 5 * 60_000;
    const signature = await q.account.signMessage({ message: `PULSE Autopilot strategy\n${keccak256(toHex(JSON.stringify(payload)))}\nExpires:${expiresAt}` });
    const app = express(); app.use(express.json()); app.use(createAutopilotAutomationRouter(cfg));
    // Never return raw provider errors from a credential-bearing process.
    app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ error: "Qualification API dependency unavailable" }); });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    try {
      const address = server.address(); if (!address || typeof address === "string") throw new Error("Qualification local server unavailable");
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/autopilot/strategies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, authorization: { expiresAt, signature } }), signal: AbortSignal.timeout(90_000) });
      const body = await response.json() as { strategy?: { id?: string; vault?: string; pair?: string } };
      if (response.status !== 201 || body.strategy?.vault?.toLowerCase() !== vault.toLowerCase() || body.strategy.pair !== accounts.policy.pair) throw new Error(`Qualification strategy registration returned HTTP ${response.status}`);
      q.journal.data.registered = true; q.journal.data.strategyId = body.strategy.id!; q.journal.data.vault = vault; await q.save();
      console.log(JSON.stringify({ registered: true, vault, depositUSDC: "0.20", paused: await q.client.readContract({ address: vault, abi, functionName: "paused" }), passPurchased: false }));
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  } finally { await q.close(); }
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error && error.message.startsWith("Qualification ") ? error.message : "Qualification stopped; inspect the public journal before retrying. The test vault is not automatically resumed."); process.exit(1); });
