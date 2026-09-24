/** Bounded mainnet qualification, not a production service. Default is read-only.
 * --pay --allow-shared-signer explicitly permits the owner's temporary test
 * arrangement. One encrypted, durable authorization is reused across reruns.
 * No .env edits, hosting changes, general wallet sends or automation workers. */
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createPublicClient, http, parseAbi, formatEther, formatUnits, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ExactEvmScheme as Buyer } from "@x402/evm/exact/client";
import { ROBINHOOD_PAYMENT as CHAIN } from "../packages/payments/src/robinhoodPayment.js";
import { createRobinhoodGasSigner } from "../packages/payments/src/robinhoodGasSigner.js";
import { createRobinhoodSelfHostedFacilitator } from "../packages/payments/src/robinhoodSelfHosted.js";
import { createRobinhoodPaymentMiddleware } from "../packages/payments/src/robinhoodMiddleware.js";
import { robinhoodPaymentObserver } from "../packages/payments/src/robinhoodReceipt.js";

let stage = "configuration";
const output = (check: string, result: unknown) => console.log(JSON.stringify({ check, result }));
const services = {
  risk: { path: "/v1/preflight", price: "0.20", amount: "200000", recovery: "report-v1", mode: "risk" },
  "global-quick": { path: "/v1/analysis/spot/standard", price: "0.20", amount: "200000", recovery: "global-quick-v1", mode: "spot" },
  "global-pro": { path: "/v1/analysis/spot/premium", price: "0.30", amount: "300000", recovery: "global-pro-v1", mode: "spot" },
  "prediction-quick": { path: "/v1/analysis/prediction/standard", price: "0.20", amount: "200000", recovery: "prediction-quick-v1", mode: "prediction" },
  "prediction-pro": { path: "/v1/analysis/prediction/premium", price: "0.30", amount: "300000", recovery: "prediction-pro-v1", mode: "prediction" },
  "autopilot-24h": { path: "/v1/autopilot/pass/24h", price: "1.50", amount: "1500000", recovery: "autopilot-24h-v1", mode: "pass" },
} as const;
async function main() {
  const serviceName = (process.argv.find(arg => arg.startsWith("--service="))?.slice(10) || "risk") as keyof typeof services;
  const service = services[serviceName];
  if (!service) throw new Error();
  config({ quiet: true });
  process.env.DOTENV_CONFIG_QUIET = "true";
  process.env.AUTOMATION_WORKER_ENABLED = "0"; // This process only; never edits .env.
  if (service.mode === "pass") process.env.FEATURE_ROBINHOOD_TRADING = "1";
  const publicRedis = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || "";
  if (!/^rediss?:\/\//.test(publicRedis)) throw new Error();
  process.env.REDIS_URL = publicRedis;
  const buyerKey = process.env.TEST_WALLET_PRIVATE_KEY || "";
  const gasKey = process.env.ROBINHOOD_FACILITATOR_PRIVATE_KEY || "";
  if (![buyerKey, gasKey].every(key => /^0x[\da-f]{64}$/i.test(key))) throw new Error();
  const buyer = privateKeyToAccount(buyerKey as Hex);
  const gas = privateKeyToAccount(gasKey as Hex);
  if (buyer.address.toLowerCase() !== process.env.TEST_WALLET_ADDRESS?.toLowerCase()) throw new Error();
  const payTo = process.env.PAY_TO_ADDRESS as Address;
  if (!/^0x[\da-f]{40}$/i.test(payTo || "") || /^0x0{40}$/i.test(payTo) || payTo.toLowerCase() === buyer.address.toLowerCase()) throw new Error();
  const rpcUrl = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
  const rpc = createPublicClient({ transport: http(rpcUrl, { timeout: 12_000, retryCount: 0 }) });
  const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
  stage = "mainnet_preflight";
  if (await rpc.getChainId() !== 4663) throw new Error();
  const [before, gasBefore, nonce, pending] = await Promise.all([
    rpc.readContract({ address: CHAIN.asset, abi, functionName: "balanceOf", args: [buyer.address] }),
    rpc.getBalance({ address: gas.address }),
    rpc.getTransactionCount({ address: gas.address, blockTag: "latest" }),
    rpc.getTransactionCount({ address: gas.address, blockTag: "pending" }),
  ]);
  output(stage, { chainId: 4663, buyer: buyer.address, facilitator: gas.address, payTo,
    balanceUSDG: formatUnits(before, 6), gasETH: formatEther(gasBefore), pendingTransactions: pending - nonce,
    service: serviceName, maximumPaymentUSDG: service.price, maximumExecutionGasETH: "0.00001", sameSignerAsBuyer: buyer.address === gas.address });
  if (!process.argv.includes("--pay")) return;
  if (!process.argv.includes("--allow-shared-signer")) throw new Error();
  if (nonce !== pending || gasBefore < parseEther("0.00001")) throw new Error();
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { StoreRedis } = await import("../apps/api/src/storeRedis.js");
  const { RedisRobinhoodGasJournal } = await import("../apps/api/src/robinhoodGasJournal.js");
  const { RobinhoodPaymentJournal } = await import("../apps/api/src/robinhoodPaymentJournal.js");
  const { createApp } = await import("../apps/api/src/app.js");
  const cfg = { ...loadConfig(), NODE_ENV: "development" as const, BASE_URL: "http://127.0.0.1:8788", X402_MOCK: false,
    paymentMode: "okx" as const, FEATURE_ROBINHOOD_PAYMENTS: true, QUEUE_PROVIDER: "redis" as const, REDIS_URL: publicRedis,
    enabledNetworks: ["robinhood" as const], PERSISTENCE_NAMESPACE: "pulse-robinhood-qualification",
  };
  if (!cfg.hasXaiKey || cfg.STORAGE_PROVIDER !== "vercel_blob" || cfg.routes[`POST ${service.path}`]?.priceUsd !== Number(service.price)) throw new Error();
  const redis = new StoreRedis(publicRedis);
  const journal = new RobinhoodPaymentJournal(redis);
  const observer = robinhoodPaymentObserver(rpcUrl);
  const signer = createRobinhoodGasSigner({ privateKey: gasKey as Hex, rpcUrl, payTo, amounts: [service.amount],
    maxGasCostEth: "0.00001", journal: new RedisRobinhoodGasJournal(redis) });
  const payment = createRobinhoodPaymentMiddleware(cfg, {
    facilitator: createRobinhoodSelfHostedFacilitator({ signer, payTo, amounts: [service.amount] }), journal, observer, provider: "robinhood-self-hosted",
  });
  // Only the isolated qualification namespace can be consumed by this worker.
  const app = createApp(cfg, { robinhoodPayment: payment, startDurableWorker: service.mode !== "risk" && service.mode !== "pass" });
  const server = app.listen(8788, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  try {
    const url = `${cfg.BASE_URL}/robinhood${service.path}`;
    let requestBody: object = service.mode === "risk" ? { tokenAddress: CHAIN.asset, lang: "en" }
      : { instId: "ETH-USDT", timeframe: "1H", lang: "en" };
    if (service.mode === "pass") {
      const setup = JSON.parse(await readFile("packages/contracts/deployments/4663-autopilot-setup-qualification.json", "utf8"));
      if (!setup.data.registered || setup.owner.toLowerCase() !== buyer.address.toLowerCase() || !/^0x[\da-f]{40}$/i.test(setup.data.vault)) throw new Error();
      requestBody = { owner: buyer.address, vault: setup.data.vault };
    }
    if (service.mode === "prediction") {
      stage = "prediction_selection";
      const selectionKey = `pulse:payments:robinhood:qualification:prediction-selection-v1:${buyer.address.toLowerCase()}`;
      let selected = await redis.get<{ primaryMarketId: string; additionalMarketIds: string[]; lang: string }>(selectionKey);
      if (!selected) {
        const { PolymarketClient } = await import("../packages/market/src/polymarket.js");
        const { isAnalyticsEligible } = await import("../packages/analysis/src/selection.js");
        const source = new PolymarketClient({ gammaUrl: cfg.POLYMARKET_GAMMA_URL, clobUrl: cfg.POLYMARKET_CLOB_URL, dataUrl: cfg.POLYMARKET_DATA_URL });
        const markets = await source.trending(30);
        for (const market of markets) {
          if (!isAnalyticsEligible(market) || market.outcomes.length !== 2) continue;
          try { await Promise.all(market.outcomes.map(outcome => source.getOrderBook(outcome.tokenId))); }
          catch { continue; }
          selected = { primaryMarketId: market.id, additionalMarketIds: [], lang: "en" };
          await redis.set(selectionKey, selected, { nx: true });
          selected = await redis.get(selectionKey);
          break;
        }
      }
      if (!selected) throw new Error();
      requestBody = selected;
      output(stage, { marketId: selected.primaryMarketId });
    }
    const body = JSON.stringify(requestBody);
    const post = (header?: string, requestBody = body) => fetch(url, { method: "POST", body: requestBody,
      headers: { "Content-Type": "application/json", ...(header ? { "PAYMENT-SIGNATURE": header } : {}) }, signal: AbortSignal.timeout(240_000) });
    stage = "input_validation";
    const bad = await post(undefined, "{}");
    if (bad.status !== 400 || bad.headers.has("PAYMENT-REQUIRED")) throw new Error();
    output(stage, { status: bad.status, challenged: false });
    stage = "challenge";
    const response = await post();
    if (response.status !== 402) { output(stage, { status: response.status }); throw new Error(); }
    const challenge = await response.json();
    const requirement = challenge.accepts?.[0];
    if (challenge.x402Version !== 2 || challenge.accepts.length !== 1 || requirement.network !== CHAIN.network
      || requirement.scheme !== "exact" || requirement.amount !== service.amount || requirement.asset.toLowerCase() !== CHAIN.asset.toLowerCase()
      || requirement.payTo.toLowerCase() !== payTo.toLowerCase() || requirement.extra?.name !== CHAIN.name
      || requirement.extra?.version !== "1" || challenge.resource?.url !== url) throw new Error();
    output(stage, { amountUSDG: service.price, token: "USDG", chainId: 4663, payTo });
    // A fixed qualification ID deliberately cannot mint a second authorization.
    const recoveryKey = `pulse:payments:robinhood:qualification:${service.recovery}:${buyer.address.toLowerCase()}`;
    const encryptionKey = createHash("sha256").update(`pulse-robinhood-qualification:${buyerKey}`).digest();
    let envelope = await redis.get<{ iv: string; tag: string; ciphertext: string }>(recoveryKey);
    stage = "authorization_recovery";
    if (!envelope) {
      if (before < BigInt(service.amount)) throw new Error();
      const signed = await new Buyer(buyer).createPaymentPayload(2, requirement);
      const header = Buffer.from(JSON.stringify({ ...signed, accepted: requirement, resource: challenge.resource })).toString("base64");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ header, url, body, payTo }), "utf8"), cipher.final()]);
      const next = { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
      await redis.set(recoveryKey, next, { nx: true });
      envelope = await redis.get(recoveryKey);
    }
    if (!envelope) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const saved = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8"));
    if (saved.url !== url || saved.body !== body || saved.payTo !== payTo) throw new Error();
    stage = "paid_request";
    const paid = await post(saved.header);
    const delivered = await paid.json();
    if (!paid.ok) output("delivery_failure", { category: String(delivered.error || "").match(/checksum mismatch|Blob HTTP \d+|fetch failed|decrypt|Unsupported state|Invalid initialization vector/i)?.[0] || "unclassified", jobId: delivered.jobId });
    output(stage, { status: paid.status, code: delivered.code, receiptPresent: paid.headers.has("PAYMENT-RESPONSE"),
      liveAnalysis: delivered.analysisProfile?.mode === "live", recoveryPresent: !!(delivered.history?.recoveryToken || delivered.recoveryToken) });
    if (!paid.headers.has("PAYMENT-RESPONSE")) throw new Error();
    const receipt = JSON.parse(Buffer.from(paid.headers.get("PAYMENT-RESPONSE")!, "base64").toString());
    const mined = await rpc.getTransactionReceipt({ hash: receipt.transaction });
    if (mined.status !== "success" || receipt.amount !== service.amount) throw new Error();
    output("settlement", { transaction: receipt.transaction, status: mined.status, feeETH: formatEther(mined.gasUsed * mined.effectiveGasPrice), finality: receipt.finality });
    if (!paid.ok) throw new Error();
    if (service.mode === "pass") {
      stage = "pass_entitlement_and_replay";
      const pass = delivered.aiPass;
      const vault = (requestBody as { vault: string }).vault;
      if (paid.status !== 201 || pass?.owner !== buyer.address.toLowerCase() || pass?.vault !== vault.toLowerCase()
        || pass.network !== "robinhood" || !pass.pausedAt || Date.parse(pass.expiresAt) - Date.parse(pass.pausedAt) !== 86_400_000 || pass.signalLimit !== 3 || pass.signalsUsed !== 0) throw new Error();
      const replay = await post(saved.header);
      const replayBody = await replay.json();
      const replayReceipt = JSON.parse(Buffer.from(replay.headers.get("PAYMENT-RESPONSE") || "", "base64").toString());
      if (replay.status !== 201 || replayReceipt.transaction !== receipt.transaction || replayBody.aiPass?.expiresAt !== pass.expiresAt
        || replayBody.aiPass?.signalLimit !== pass.signalLimit) throw new Error();
      const { getAutopilotPass } = await import("../apps/api/src/autopilotPassStore.js");
      const persisted = await getAutopilotPass("robinhood", vault);
      if (persisted?.expiresAt !== pass.expiresAt || persisted?.creditedPaymentIds?.length !== 1) throw new Error();
      const after = await rpc.readContract({ address: CHAIN.asset, abi, functionName: "balanceOf", args: [buyer.address] });
      const result = { service: serviceName, transaction: receipt.transaction, owner: buyer.address, vault, paidUSDG: service.price,
        paused: true, remainingHours: 24, confirmations: 3, persisted: true, sameTransactionOnReplay: true,
        replayDidNotExtendPass: true, observedUSDGChange: formatUnits(before - after, 6), hostingChanged: false };
      await writeFile("packages/contracts/deployments/4663-autopilot-pass-qualification.json", JSON.stringify(result, null, 2));
      output("complete", result);
      return;
    }
    const handle = delivered.history || { jobId: delivered.job?.id, recoveryToken: delivered.recoveryToken };
    if (!handle.jobId || !handle.recoveryToken) throw new Error();
    stage = "same_payment_replay";
    const replay = await post(saved.header);
    const replayBody = await replay.json();
    if (!replay.ok) output("replay_failure", { category: String(replayBody.error || "").match(/checksum mismatch|Blob HTTP \d+|fetch failed|decrypt|Unsupported state|Invalid initialization vector/i)?.[0] || "unclassified", jobId: replayBody.jobId });
    const replayReceipt = JSON.parse(Buffer.from(replay.headers.get("PAYMENT-RESPONSE") || "", "base64").toString());
    const replayHandle = replayBody.history || { jobId: replayBody.job?.id, recoveryToken: replayBody.recoveryToken };
    if (!replay.ok || replayReceipt.transaction !== receipt.transaction || replayHandle.jobId !== handle.jobId || !replayHandle.recoveryToken) throw new Error();
    if (service.mode !== "risk") {
      stage = "await_report";
      let complete = false;
      const deadline = Date.now() + 240_000;
      while (Date.now() < deadline) {
        const polled = await fetch(`${cfg.BASE_URL}/robinhood/v1/jobs/${handle.jobId}`, { headers: { "PULSE-RECOVERY-TOKEN": replayHandle.recoveryToken }, signal: AbortSignal.timeout(20_000) });
        const status = await polled.json();
        if (!polled.ok) throw new Error();
        output(stage, { service: serviceName, jobId: handle.jobId, stage: status.job.stage });
        if (["completed", "completed_partial"].includes(status.job.stage)) { complete = true; break; }
        if (["failed_terminal", "failed_retriable", "manual_reconciliation"].includes(status.job.stage)) throw new Error();
        await new Promise(resolve => setTimeout(resolve, 5_000));
      }
      if (!complete) throw new Error();
    }
    stage = "authenticated_report_recovery";
    const reportUrl = `${cfg.BASE_URL}/robinhood/v1/jobs/${handle.jobId}/report`;
    const unauthorized = await fetch(reportUrl);
    if (unauthorized.status !== 403) throw new Error();
    const recovered = await fetch(reportUrl, { headers: { "PULSE-RECOVERY-TOKEN": replayHandle.recoveryToken } });
    const recoveredBody = await recovered.json();
    if (recovered.status !== 200 || recoveredBody.report?.analysisProfile?.mode !== "live"
      || !recoveredBody.reportMarkdown || !["completed", "completed_partial"].includes(recoveredBody.job?.stage)) throw new Error();
    output(stage, { unauthenticatedStatus: unauthorized.status, authenticatedStatus: recovered.status,
      fullReportPresent: true, stage: recoveredBody.job.stage, chainId: recoveredBody.report.chainId });
    const after = await rpc.readContract({ address: CHAIN.asset, abi, functionName: "balanceOf", args: [buyer.address] });
    output("complete", { service: serviceName, transaction: receipt.transaction, reportJobId: handle.jobId,
      liveReport: true, recoverable: true, sameTransactionOnReplay: true,
      observedUSDGChange: formatUnits(before - after, 6), balanceUSDG: formatUnits(after, 6),
      hostingChanged: false, sharedSignerForOwnerApprovedLocalTestOnly: true });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().then(() => process.exit(0)).catch(() => {
  console.error(JSON.stringify({ failedStage: stage, message: "Qualification stopped. No fresh payment is created on rerun. Inspect the durable payment record before changing anything." }));
  process.exit(1);
});
