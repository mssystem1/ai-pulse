/** Bounded Circle mainnet payments. Reuses an encrypted durable authorization. */
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import { privateKeyToAccount } from "viem/accounts";
import { parseUnits, type Hex } from "viem";
import { PulseClient } from "../packages/sdk/src/index.js";
import type { AutopilotPass } from "../apps/api/src/autopilotPassStore.js";

type PaidResponse = { code?: string; history?: { jobId: string; recoveryToken: string }; job?: { id: string }; recoveryToken?: string; aiPass?: AutopilotPass };

const services = {
  risk: { path: "/v1/preflight", amount: "200000", mode: "risk" },
  "global-quick": { path: "/v1/analysis/spot/standard", amount: "200000", mode: "spot" },
  "global-pro": { path: "/v1/analysis/spot/premium", amount: "300000", mode: "spot" },
  "prediction-quick": { path: "/v1/analysis/prediction/standard", amount: "200000", mode: "prediction" },
  "prediction-pro": { path: "/v1/analysis/prediction/premium", amount: "300000", mode: "prediction" },
  "autopilot-24h": { path: "/v1/autopilot/pass/24h", amount: "1500000", mode: "pass" },
} as const;
let stage = "configuration";
const output = (check: string, result: unknown) => console.log(JSON.stringify({ check, result }));
async function main() {
  const serviceName = (process.argv.find(arg => arg.startsWith("--service="))?.slice(10) || "risk") as keyof typeof services;
  const service = services[serviceName]; if (!service) throw new Error();
  config({ quiet: true });
  process.env.AUTOMATION_WORKER_ENABLED = "0";
  process.env.REDIS_URL = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL;
  process.env.QUEUE_PROVIDER = "redis";
  process.env.PERSISTENCE_NAMESPACE = "pulse-arc-mainnet-qualification";
  if (service.mode === "pass") process.env.FEATURE_ARC_TRADING = "1";
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { StoreRedis } = await import("../apps/api/src/storeRedis.js");
  const { createApp } = await import("../apps/api/src/app.js");
  const cfg = { ...loadConfig(), BASE_URL: "http://127.0.0.1:8789", X402_MOCK: false, ARC_AI_MODE: "live" as const };
  const key = cfg.TEST_WALLET_PRIVATE_KEY as Hex, buyer = privateKeyToAccount(key);
  if (buyer.address.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase() || !cfg.hasXaiKey || cfg.STORAGE_PROVIDER !== "vercel_blob"
    || cfg.routes[`POST ${service.path}`]?.priceUsd !== Number(service.amount) / 1e6) throw new Error();
  const redis = new StoreRedis(cfg.REDIS_URL);
  const app = createApp(cfg, { startDurableWorker: service.mode !== "risk" && service.mode !== "pass" });
  const server = app.listen(8789, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  try {
    const url = `${cfg.BASE_URL}/arc${service.path}`;
    let requestBody: object = service.mode === "risk" ? { tokenAddress: "0x3600000000000000000000000000000000000000", chainId: "5042", lang: "en" }
      : { instId: "ETH-USDT", timeframe: "1H", lang: "en" };
    if (service.mode === "prediction") {
      const readiness = JSON.parse(await readFile("docs/ARC_MAINNET_API_READINESS.json", "utf8"));
      if (!readiness.ready || !readiness.predictionSelection) throw new Error();
      requestBody = readiness.predictionSelection;
    }
    if (service.mode === "pass") {
      const setup = JSON.parse(await readFile("packages/contracts/deployments/5042-autopilot-setup-qualification.json", "utf8"));
      if (!setup.data.registered || setup.owner.toLowerCase() !== buyer.address.toLowerCase()) throw new Error();
      requestBody = { owner: buyer.address, vault: setup.data.vault };
    }
    const body = JSON.stringify(requestBody);
    const post = (header?: string) => fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json",
      ...(header ? { "PAYMENT-SIGNATURE": header } : {}) }, signal: AbortSignal.timeout(240_000) });
    stage = "challenge";
    const challengeResponse = await post();
    if (challengeResponse.status !== 402 || !challengeResponse.headers.has("PAYMENT-REQUIRED")) { output(stage, { status: challengeResponse.status }); throw new Error(); }
    const challenge = JSON.parse(Buffer.from(challengeResponse.headers.get("PAYMENT-REQUIRED")!, "base64").toString());
    const requirement = challenge.accepts?.[0];
    if (challenge.x402Version !== 2 || challenge.accepts.length !== 1 || requirement.network !== "eip155:5042" || requirement.scheme !== "exact"
      || requirement.amount !== service.amount || requirement.asset.toLowerCase() !== "0x3600000000000000000000000000000000000000"
      || requirement.payTo.toLowerCase() !== cfg.PAY_TO_ADDRESS.toLowerCase() || requirement.extra?.name !== "GatewayWalletBatched"
      || requirement.extra?.version !== "1" || requirement.extra?.verifyingContract?.toLowerCase() !== "0x77777777dcc4d5a8b6e418fd04d8997ef11000ee"
      || challenge.resource?.url !== url) throw new Error();
    output(stage, { service: serviceName, chainId: 5042, amountUSDC: Number(service.amount) / 1e6, payTo: requirement.payTo });
    if (!process.argv.includes("--pay")) return;
    const balance = async () => {
      const response = await fetch(`${cfg.CIRCLE_GATEWAY_MAINNET_URL}/v1/balances`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "USDC", sources: [{ domain: 26, depositor: buyer.address }] }), signal: AbortSignal.timeout(20_000) });
      const body = await response.json() as { balances: Array<{ domain: number; balance: string }> };
      if (!response.ok || body.balances?.length !== 1 || body.balances[0].domain !== 26 || !/^\d+(?:\.\d{1,6})?$/.test(body.balances[0].balance || "")) throw new Error();
      return parseUnits(body.balances[0].balance, 6);
    };
    const before = await balance();
    const recoveryKey = `pulse:payments:arc:qualification:${serviceName}-v1:${buyer.address.toLowerCase()}`;
    const encryptionKey = createHash("sha256").update(`pulse-arc-mainnet-qualification:${key}`).digest();
    stage = "authorization_recovery";
    let envelope = await redis.get<{ iv: string; tag: string; ciphertext: string }>(recoveryKey);
    if (!envelope) {
      if (before < BigInt(service.amount)) throw new Error();
      const signed = await new BatchEvmScheme(buyer).createPaymentPayload(2, requirement);
      const header = Buffer.from(JSON.stringify({ ...signed, accepted: requirement, resource: challenge.resource })).toString("base64");
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ header, url, body, payTo: requirement.payTo }), "utf8"), cipher.final()]);
      await redis.set(recoveryKey, { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }, { nx: true });
      envelope = await redis.get(recoveryKey);
    }
    if (!envelope) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const saved = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString());
    if (saved.url !== url || saved.body !== body || saved.payTo.toLowerCase() !== requirement.payTo.toLowerCase()) throw new Error();
    stage = "paid_request";
    const paid = await post(saved.header), delivered = await paid.json() as PaidResponse;
    output(stage, { status: paid.status, receiptPresent: paid.headers.has("PAYMENT-RESPONSE"), code: delivered.code });
    if (!paid.ok || !paid.headers.has("PAYMENT-RESPONSE")) throw new Error();
    const receipt = JSON.parse(Buffer.from(paid.headers.get("PAYMENT-RESPONSE")!, "base64").toString());
    if (!receipt.success || receipt.network !== "eip155:5042" || receipt.payer?.toLowerCase() !== buyer.address.toLowerCase()) throw new Error();
    const handle = delivered.history || { jobId: delivered.job?.id, recoveryToken: delivered.recoveryToken };
    if (service.mode === "pass") {
      const pass = delivered.aiPass;
      if (paid.status !== 201 || pass?.network !== "arc" || !pass.pausedAt || pass.signalLimit !== 3 || pass.signalsUsed !== 0
        || pass.owner.toLowerCase() !== buyer.address.toLowerCase() || pass.vault.toLowerCase() !== (requestBody as { vault: string }).vault.toLowerCase()
        || Date.parse(pass.expiresAt) - Date.parse(pass.pausedAt) !== 86_400_000) throw new Error();
      const afterPaid = await balance();
      const charge = before - afterPaid;
      if (charge !== 0n && charge !== BigInt(service.amount)) throw new Error();
      const replay = await post(saved.header), replayBody = await replay.json() as PaidResponse;
      if (replay.status !== 201 || replayBody.aiPass?.expiresAt !== pass.expiresAt || replayBody.aiPass.signalsUsed !== pass.signalsUsed
        || replayBody.aiPass.signalLimit !== pass.signalLimit || afterPaid !== await balance()) throw new Error();
      await writeFile("packages/contracts/deployments/5042-autopilot-pass-qualification.json", JSON.stringify({ service: serviceName,
        paidUSDC: "1.50", owner: buyer.address, vault: (requestBody as { vault: string }).vault, finality: "gateway_batch_accepted",
        paused: true, signalLimit: 3, replayDidNotExtendPass: true, observedGatewayChangeUSDC: Number(charge) / 1e6, qualifiedAt: new Date().toISOString() }, null, 2));
      output("complete", { service: serviceName, paused: true, replayDidNotExtendPass: true }); return;
    }
    if (!handle.jobId || !handle.recoveryToken) throw new Error();
    stage = "report_delivery";
    const sdk = new PulseClient({ baseUrl: cfg.BASE_URL, network: "arc" });
    const deadline = Date.now() + 360_000;
    let lastStage = "";
    while (true) {
      const status = await sdk.getJob(handle.jobId, handle.recoveryToken);
      if (status.job.stage !== lastStage) { lastStage = status.job.stage; output(stage, { service: serviceName, jobId: handle.jobId, stage: lastStage }); }
      if (["completed", "completed_partial"].includes(lastStage)) break;
      if (["failed_terminal", "failed_retriable", "manual_reconciliation"].includes(lastStage) || Date.now() > deadline) throw new Error();
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    stage = "authenticated_sdk_recovery";
    const recovered = await sdk.getJobReport<any>(handle.jobId, handle.recoveryToken);
    if (recovered.report.analysisProfile?.mode !== "live" || (recovered.job.receipt as { settlementMode?: string } | undefined)?.settlementMode !== "gateway_batch"
      || recovered.job.network !== "eip155:5042") throw new Error();
    const unauthorized = await fetch(`${cfg.BASE_URL}/v1/jobs/${handle.jobId}/report`);
    if (unauthorized.status !== 403) throw new Error();
    stage = "same_payment_replay";
    const replay = await post(saved.header), replayBody = await replay.json() as PaidResponse;
    const replayHandle = replayBody.history || { jobId: replayBody.job?.id, recoveryToken: replayBody.recoveryToken };
    if (!replay.ok || replayHandle.jobId !== handle.jobId) { output(stage, { status: replay.status, sameJob: replayHandle.jobId === handle.jobId }); throw new Error(); }
    const after = await balance();
    const result = { service: serviceName, owner: buyer.address, paidUSDC: Number(service.amount) / 1e6, reportJobId: handle.jobId,
      stage: recovered.job.stage, liveReport: true, sdkRecovery: true, unauthorizedStatus: unauthorized.status, sameJobOnReplay: true,
      observedGatewayChangeUSDC: Number(before - after) / 1e6, finality: "gateway_batch_accepted", qualifiedAt: new Date().toISOString() };
    await writeFile(`packages/contracts/deployments/5042-${serviceName}-paid-qualification.json`, JSON.stringify(result, null, 2));
    output("complete", result);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().then(() => process.exit(0)).catch(() => { console.error(JSON.stringify({ failedStage: stage,
  message: "Arc qualification stopped; its encrypted authorization is retained. Reuse it rather than creating another payment." })); process.exit(1); });
