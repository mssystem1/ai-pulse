import { Router } from "express";
import { z } from "zod";
import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";

const EmailStart = z.object({ email: z.string().email().max(254), deviceId: z.string().min(8).max(512) });
const Session = z.object({ userToken: z.string().min(20).max(8192) });
const WalletInitialization = z.object({ blockchain: z.literal("ARC-TESTNET") });
const TypedData = Session.extend({ walletId: z.string().uuid(), data: z.string().min(2).max(100_000) });
const RawTransaction = Session.extend({ walletId: z.string().uuid(), rawTransaction: z.string().regex(/^0x[0-9a-fA-F]+$/).max(200_000) });
const ContractExecution = Session.extend({
  walletId: z.string().uuid(),
  contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  callData: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/).max(200_000),
  value: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
});
const ChallengeId = z.string().uuid();

function bearer(value: string | undefined): string {
  const token = value?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("Circle user session is missing");
  return token;
}

function safeError(error: unknown): { error: string; code?: number } {
  const candidate = error as {
    response?: { data?: { code?: unknown; message?: unknown; error?: unknown } };
    code?: unknown;
    message?: unknown;
  };
  const data = candidate.response?.data;
  const message = data?.message || data?.error || candidate.message || "Circle wallet request failed";
  const code = Number(data?.code ?? candidate.code);
  return Number.isFinite(code) ? { error: String(message), code } : { error: String(message) };
}

export function createCircleWalletRouter() {
  const router = Router();
  const apiKey = process.env.CIRCLE_API_KEY?.trim();
  const client = apiKey ? initiateUserControlledWalletsClient({ apiKey }) : null;

  router.get("/status", (_req, res) => res.set("Cache-Control", "no-store").json({ enabled: Boolean(client) }));

  router.post("/email/start", async (req, res) => {
    if (!client) return res.status(503).json({ error: "Circle email wallet is not configured" });
    const parsed = EmailStart.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid email address" });
    try {
      const response = await client.createDeviceTokenForEmailLogin(parsed.data);
      return res.set("Cache-Control", "no-store").json(response.data);
    } catch (error) { return res.status(502).json(safeError(error)); }
  });

  router.get("/wallets", async (req, res) => {
    if (!client) return res.status(503).json({ error: "Circle email wallet is not configured" });
    try {
      const response = await client.listWallets({ userToken: bearer(req.header("authorization")) });
      const supported = new Set<string>(["ARC-TESTNET"]);
      const wallets = (response.data?.wallets || []).filter((wallet) => supported.has(wallet.blockchain));
      return res.set("Cache-Control", "no-store").json({ wallets });
    } catch (error) { return res.status(502).json(safeError(error)); }
  });

  router.post("/wallets/initialize", async (req, res) => {
    if (!client) return res.status(503).json({ error: "Circle email wallet is not configured" });
    const parsed = WalletInitialization.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Select one supported Circle wallet network" });
    try {
      const response = await client.createUserPinWithWallets({
        userToken: bearer(req.header("authorization")),
        accountType: "EOA",
        // Circle rejects requests that mix mainnet and testnet blockchains.
        // Initialize only the network the user selected.
        blockchains: [parsed.data.blockchain],
        idempotencyKey: crypto.randomUUID(),
      });
      return res.set("Cache-Control", "no-store").json(response.data);
    } catch (error) { return res.status(502).json(safeError(error)); }
  });

  router.post("/wallets/create-arc", async (req, res) => {
    if (!client) return res.status(503).json({ error: "Circle email wallet is not configured" });
    try {
      const response = await client.createWallet({
        userToken: bearer(req.header("authorization")),
        accountType: "EOA",
        blockchains: ["ARC-TESTNET"],
        idempotencyKey: crypto.randomUUID(),
      });
      return res.set("Cache-Control", "no-store").json(response.data);
    } catch (error) { return res.status(502).json(safeError(error)); }
  });

  router.post("/sign/typed-data", async (req, res) => {
    if (!client) return res.status(503).json({ error: "Circle email wallet is not configured" });
    const parsed = TypedData.safeParse({ ...req.body, userToken: (() => { try { return bearer(req.header("authorization")); } catch { return ""; } })() });
    if (!parsed.success) return res.status(400).json({ error: "Invalid Circle typed-data signing request" });
    try {
      JSON.parse(parsed.data.data);
      const response = await client.signTypedData({ userToken: parsed.data.userToken, walletId: parsed.data.walletId, data: parsed.data.data, memo: "PULSE x402 payment authorization" });
      return res.set("Cache-Control", "no-store").json(response.data);
    } catch (error) { return res.status(502).json(safeError(error)); }
  });

  router.post("/sign/transaction", async (req, res) => {
    if (!client) return res.status(503).json({ error: "Circle email wallet is not configured" });
    const parsed = RawTransaction.safeParse({ ...req.body, userToken: (() => { try { return bearer(req.header("authorization")); } catch { return ""; } })() });
    if (!parsed.success) return res.status(400).json({ error: "Invalid Circle transaction signing request" });
    try {
      const response = await client.signTransaction({ userToken: parsed.data.userToken, walletId: parsed.data.walletId, rawTransaction: parsed.data.rawTransaction, memo: "PULSE transaction" });
      return res.set("Cache-Control", "no-store").json(response.data);
    } catch (error) { return res.status(502).json(safeError(error)); }
  });

  router.post("/transactions/contract-execution", async (req, res) => {
    if (!client) return res.status(503).json({ error: "Circle email wallet is not configured" });
    const parsed = ContractExecution.safeParse({ ...req.body, userToken: (() => { try { return bearer(req.header("authorization")); } catch { return ""; } })() });
    if (!parsed.success) return res.status(400).json({ error: "Invalid Circle contract-execution request" });
    if (parsed.data.value && BigInt(parsed.data.value) !== 0n) return res.status(400).json({ error: "Circle Arc contract execution does not accept native value in PULSE" });
    try {
      const response = await client.createUserTransactionContractExecutionChallenge({
        userToken: parsed.data.userToken,
        walletId: parsed.data.walletId,
        contractAddress: parsed.data.contractAddress,
        callData: parsed.data.callData as `0x${string}`,
        fee: { type: "level", config: { feeLevel: "MEDIUM" } },
        idempotencyKey: crypto.randomUUID(),
        refId: "pulse-arc-contract-execution",
      });
      return res.set("Cache-Control", "no-store").json(response.data);
    } catch (error) { return res.status(502).json(safeError(error)); }
  });

  router.get("/transactions/contract-execution/:challengeId", async (req, res) => {
    if (!client) return res.status(503).json({ error: "Circle email wallet is not configured" });
    const challengeId = ChallengeId.safeParse(req.params.challengeId);
    if (!challengeId.success) return res.status(400).json({ error: "Invalid Circle challenge id" });
    try {
      const userToken = bearer(req.header("authorization"));
      const response = await client.getUserChallenge({ userToken, challengeId: challengeId.data });
      const challenge = response.data?.challenge;
      if (!challenge) return res.status(502).json({ error: "Circle returned no challenge status" });
      const transactionId = challenge.correlationIds?.[0];
      if (!transactionId) return res.set("Cache-Control", "no-store").json({ challengeStatus: challenge.status });
      const transactionResponse = await client.getTransaction({ userToken, id: transactionId });
      const transaction = transactionResponse.data?.transaction;
      return res.set("Cache-Control", "no-store").json({
        challengeStatus: challenge.status,
        transactionId,
        transactionState: transaction?.state,
        txHash: transaction?.txHash,
        error: transaction?.errorReason || transaction?.errorDetails,
      });
    } catch (error) { return res.status(502).json(safeError(error)); }
  });

  return router;
}
