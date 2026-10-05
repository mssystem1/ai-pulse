/** Actual buyer -> MCP -> Circle payment -> free SDK/MCP recovery, bounded to $0.20. */
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { encodeFunctionData, erc20Abi, parseAbi, parseEther, parseUnits, type Address, type Hex } from "viem";
import { createPaidFetch, type BuyerPaymentRecoveryStore, type BuyerPendingPayment } from "../packages/buyer/src/index.js";
import { PulseClient } from "../packages/sdk/src/index.js";
import { qualificationJournal } from "./arc-qualification-journal.js";

async function main() {
  config({ quiet: true });
  process.env.AUTOMATION_WORKER_ENABLED = "0";
  process.env.REDIS_URL = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL;
  process.env.QUEUE_PROVIDER = "redis";
  process.env.PERSISTENCE_NAMESPACE = "pulse-arc-mainnet-qualification";
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { StoreRedis } = await import("../apps/api/src/storeRedis.js");
  const { createApp } = await import("../apps/api/src/app.js");
  const cfg = { ...loadConfig(), BASE_URL: "http://127.0.0.1:8789", X402_MOCK: false, ARC_AI_MODE: "live" as const };
  const budget = JSON.parse(await readFile("docs/ARC_MAINNET_BALANCE_AUDIT_2026-10-05.json", "utf8"));
  if (!budget.receiptAccountingComplete || Date.now() - Date.parse(budget.auditedAt) > 3600_000 || parseEther(budget.remainingAuthorizedSpendUSDC) < parseEther("0.25")) throw new Error("Qualification fresh spending reconciliation required");
  if (!cfg.hasXaiKey || cfg.STORAGE_PROVIDER !== "vercel_blob" || cfg.PRICE_PREFLIGHT !== .20) throw new Error("Qualification live report configuration unavailable");
  const redis = new StoreRedis(cfg.REDIS_URL);
  const usdc = "0x3600000000000000000000000000000000000000" as Address;
  const gateway = "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE" as Address;
  const broadcast = process.argv.includes("--pay");
  const q = await qualificationJournal({ path: "packages/contracts/deployments/5042-agent-gateway-qualification.json", rpcUrl: cfg.ARC_RPC_URL,
    privateKey: cfg.TEST_WALLET_PRIVATE_KEY as Hex, owner: cfg.TEST_WALLET_ADDRESS, broadcast, budgetUSDC: "0.05", targets: [usdc, gateway] });
  const encryptionKey = createHash("sha256").update(`pulse:arc:agent-qualification:${cfg.TEST_WALLET_PRIVATE_KEY}`).digest();
  const redisKey = (key: string) => `pulse:arc:agent-qualification:v1:${createHash("sha256").update(key).digest("hex")}`;
  const recovery: BuyerPaymentRecoveryStore = {
    async get(key) {
      const envelope = await redis.get<{ iv: string; tag: string; ciphertext: string }>(redisKey(key));
      if (!envelope) return null;
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(envelope.iv, "base64")); decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString()) as BuyerPendingPayment;
    },
    async set(key, value) {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      await redis.set(redisKey(key), { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
    },
    async remove(key) { await redis.del(redisKey(key)); },
    async exclusive(key, run) {
      const lock = `${redisKey(key)}:lock`, token = randomBytes(16).toString("hex");
      if (await redis.set(lock, token, { nx: true, ex: 600 }) !== "OK") throw new Error("Qualification agent payment already running");
      try { return await run(); } finally { await redis.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", [lock], [token]); }
    },
  };
  const balance = async () => {
    const response = await fetch(`${cfg.CIRCLE_GATEWAY_MAINNET_URL}/v1/balances`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "USDC", sources: [{ domain: 26, depositor: q.account.address }] }), signal: AbortSignal.timeout(20_000) });
    const result = await response.json() as { balances: Array<{ domain: number; balance: string }> };
    if (!response.ok || result.balances?.length !== 1 || result.balances[0].domain !== 26 || !/^\d+(?:\.\d{1,6})?$/.test(result.balances[0].balance || "")) throw new Error("Qualification Gateway evidence unavailable");
    return parseUnits(result.balances[0].balance, 6);
  };
  const app = createApp(cfg, { startDurableWorker: false });
  const server = app.listen(8789, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  try {
    await q.reconcile();
    if (q.journal.data.completed) { console.log("Agent qualification already complete; no additional payment."); return; }
    const url = `${cfg.BASE_URL}/arc/mcp`;
    const call = { jsonrpc: "2.0", id: "arc-mainnet-buyer-qualification-v1", method: "tools/call", params: { name: "preflight", arguments: { tokenAddress: usdc, chainId: "5042", lang: "en" } } };
    const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(call) };
    const unsigned = await fetch(url, init);
    if (unsigned.status !== 402) throw new Error("Qualification MCP payment challenge unavailable");
    console.log(JSON.stringify({ chainId: 5042, actualBuyer: true, actualMcp: true, maximumChargeUSDC: "0.20", broadcast }));
    if (!broadcast) return;
    if (!q.journal.data.depositAtomic) {
      if (await balance() !== 0n) throw new Error("Qualification Gateway must be empty before this exact deposit");
      q.journal.data.depositAtomic = "200000"; await q.save();
    }
    await q.send("approve-gateway", usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [gateway, 200000n] }));
    await q.send("deposit-gateway", gateway, encodeFunctionData({ abi: parseAbi(["function deposit(address,uint256)"]), functionName: "deposit", args: [usdc, 200000n] }), undefined, 200000n);
    // Only wait for a newly funded, not-yet-submitted authorization. Recovery
    // must still work after the original payment consumed the Gateway balance.
    if (!q.journal.data.responseLossSimulated) {
      for (let attempt = 0; await balance() < 200000n; attempt++) { if (attempt >= 30) throw new Error("Qualification Gateway credit pending"); await new Promise(resolve => setTimeout(resolve, 2000)); }
    }
    const buyerCfg = { privateKey: cfg.TEST_WALLET_PRIVATE_KEY, network: "eip155:5042", rpcUrl: cfg.ARC_RPC_URL, maxPaymentUsd: .20,
      expectedPayTo: cfg.CIRCLE_GATEWAY_SELLER_ADDRESS, paymentRecoveryStore: recovery,
      fetchImpl: (async (input: Parameters<typeof fetch>[0], options?: RequestInit) => {
        const request = new Request(input, { ...options, signal: AbortSignal.timeout(240_000) });
        const result = await fetch(request);
        if (request.headers.has("PAYMENT-SIGNATURE") && result.ok && result.headers.has("PAYMENT-RESPONSE") && !q.journal.data.responseLossSimulated) {
          q.journal.data.responseLossSimulated = true; await q.save();
          throw new Error("Qualification simulated lost response after actual settlement");
        }
        return result;
      }) as typeof fetch };
    let paid: Response;
    try { paid = await createPaidFetch(buyerCfg)(url, init); }
    catch { if (!q.journal.data.responseLossSimulated) throw new Error("Qualification buyer request failed; preserve its saved authorization"); paid = await createPaidFetch(buyerCfg)(url, init); }
    const delivered: any = await paid.json();
    const result = delivered?.result?.structuredContent;
    const handle = result?.history || { jobId: result?.job?.id, recoveryToken: result?.recoveryToken };
    if (!paid.ok || !paid.headers.has("PAYMENT-RESPONSE") || !handle.jobId || !handle.recoveryToken) throw new Error("Qualification paid MCP result unavailable");
    const sdk = new PulseClient({ baseUrl: cfg.BASE_URL, network: "arc" });
    const report = await sdk.getJobReport<any>(handle.jobId, handle.recoveryToken);
    if (report.job.network !== "eip155:5042" || report.report.analysisProfile?.mode !== "live") throw new Error("Qualification SDK report identity mismatch");
    const free = await fetch(url, { ...init, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "job_report", arguments: handle } }) });
    const freeBody: any = await free.json();
    if (!free.ok || free.headers.has("PAYMENT-REQUIRED") || freeBody?.result?.structuredContent?.job?.id !== handle.jobId) throw new Error("Qualification free MCP recovery failed");
    const after = await balance();
    const replay = await createPaidFetch(buyerCfg)(url, init), replayBody: any = await replay.json();
    if (!replay.ok || replayBody?.result?.structuredContent?.history?.jobId !== handle.jobId || after !== await balance() || after !== 0n) throw new Error("Qualification buyer replay charged again or changed its job");
    const proof = { chainId: 5042, service: "agent-mcp-risk", owner: q.account.address, paidUSDC: ".20", reportJobId: handle.jobId,
      actualBuyer: true, actualMcp: true, liveReport: true, sdkRecovery: true, freeMcpRecovery: true, lostResponseRecovery: true, sameJobOnReplay: true,
      gatewayRemainingUSDC: "0", qualifiedAt: new Date().toISOString() };
    await writeFile("packages/contracts/deployments/5042-agent-paid-qualification.json", JSON.stringify(proof, null, 2));
    q.journal.data.completed = true; await q.save(); console.log(JSON.stringify(proof));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await q.close(); }
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error && error.message.startsWith("Qualification ") ? error.message : "Arc agent qualification stopped; preserve its encrypted authorization and reconcile before retrying."); process.exit(1); });
