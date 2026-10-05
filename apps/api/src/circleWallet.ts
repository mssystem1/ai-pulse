import { Router } from "express";
import { z } from "zod";
import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { formatUnits, parseTransaction } from "viem";

const EmailStart = z.object({ email: z.string().email().max(254), deviceId: z.string().min(8).max(512) });
const Session = z.object({ userToken: z.string().min(20).max(8192) });
const WalletInitialization = z.object({ blockchain: z.literal("ARC") });
const TypedData = Session.extend({ walletId: z.string().uuid(), data: z.string().min(2).max(100_000) });
const SignMessage = Session.extend({ walletId: z.string().uuid(), message: z.string().min(1).max(100_000), encodedByHex: z.boolean().default(false) });
const RawTransaction = Session.extend({ walletId: z.string().uuid(), rawTransaction: z.string().regex(/^0x[0-9a-fA-F]+$/).max(200_000) });
const ContractExecution = Session.extend({
  walletId: z.string().uuid(),
  contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  callData: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).max(200_000),
  value: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
});
const ChallengeId = z.string().uuid();

export function validateArcTypedData(raw: string): void {
  const data = JSON.parse(raw);
  if (!data || Number(data.domain?.chainId) !== 5042) throw new Error("Circle signing requires an Arc mainnet typed-data domain (5042)");
}

export function validateArcTransaction(raw: `0x${string}`): void {
  if (parseTransaction(raw).chainId !== 5042) throw new Error("Circle transaction signing requires Arc mainnet chain 5042");
}

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
  const apiKey = process.env.CIRCLE_API_KEY_MAINNET?.trim() || process.env.CIRCLE_API_KEY?.trim();
  const testKey = /^TEST_API_KEY/i.test(apiKey || "");
  const mainnetEnabled = /^(1|true)$/.test(process.env.FEATURE_CIRCLE_MAINNET_WALLETS || "");
  const client = mainnetEnabled && apiKey && !testKey ? initiateUserControlledWalletsClient({ apiKey }) : null;
  const unavailable = testKey ? "Arc mainnet email wallets require a production Circle API key and matching App ID"
    : !mainnetEnabled ? "Arc mainnet email login is waiting for the production Circle app and subscription setup" : "Circle email wallet is not configured";

  router.get("/status", (_req, res) => res.set("Cache-Control", "no-store").json({ enabled: Boolean(client), network: "arc", blockchain: "ARC", ...(!client ? { reason: unavailable } : {}) }));
  router.use((_req, res, next) => client ? next() : res.status(503).json({ error: unavailable }));
  async function isArcWallet(userToken: string, walletId: string) {
    const response = await client!.getWallet({ userToken, id: walletId });
    return response.data?.wallet?.blockchain === "ARC" && response.data.wallet.accountType === "EOA";
  }

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
      const supported = new Set<string>(["ARC"]);
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
        blockchains: ["ARC"],
        idempotencyKey: crypto.randomUUID(),
      });
      return res.set("Cache-Control", "no-store").json(response.data);
    } catch (error) { return res.status(502).json(safeError(error)); }
  });

  router.post("/sign/typed-data", async (req, res) => {
    if (!client) return res.status(503).json({ error: "Circle email wallet is not configured" });
    const parsed = TypedData.safeParse({ ...req.body, userToken: (() => { try { return bearer(req.header("authorization")); } catch { return ""; } })() });
    if (!parsed.success) return res.status(400).json({ error: "Invalid Circle typed-data signing request" });
    try { validateArcTypedData(parsed.data.data); } catch { return res.status(400).json({ error: "Typed data must use Arc mainnet chain 5042" }); }
    try {
      if (!await isArcWallet(parsed.data.userToken, parsed.data.walletId)) return res.status(400).json({ error: "Select an Arc mainnet EOA wallet" });
      const response = await client.signTypedData({ userToken: parsed.data.userToken, walletId: parsed.data.walletId, data: parsed.data.data, memo: "PULSE x402 payment authorization" });
      return res.set("Cache-Control", "no-store").json(response.data);
    } catch (error) { return res.status(502).json(safeError(error)); }
  });

  router.post("/sign/message", async (req, res) => {
    const parsed = SignMessage.safeParse({ ...req.body, userToken: (() => { try { return bearer(req.header("authorization")); } catch { return ""; } })() });
    if (!parsed.success || (parsed.data.encodedByHex && !/^0x(?:[0-9a-fA-F]{2})+$/.test(parsed.data.message))) return res.status(400).json({ error: "Invalid Circle message signing request" });
    try {
      if (!await isArcWallet(parsed.data.userToken, parsed.data.walletId)) return res.status(400).json({ error: "Select an Arc mainnet EOA wallet" });
      const response = await client!.signMessage({ ...parsed.data, memo: "PULSE wallet authentication" });
      return res.set("Cache-Control", "no-store").json(response.data);
    } catch (error) { return res.status(502).json(safeError(error)); }
  });

  router.post("/sign/transaction", async (req, res) => {
    if (!client) return res.status(503).json({ error: "Circle email wallet is not configured" });
    const parsed = RawTransaction.safeParse({ ...req.body, userToken: (() => { try { return bearer(req.header("authorization")); } catch { return ""; } })() });
    if (!parsed.success) return res.status(400).json({ error: "Invalid Circle transaction signing request" });
    try { validateArcTransaction(parsed.data.rawTransaction as `0x${string}`); } catch { return res.status(400).json({ error: "Transaction must use Arc mainnet chain 5042" }); }
    try {
      if (!await isArcWallet(parsed.data.userToken, parsed.data.walletId)) return res.status(400).json({ error: "Select an Arc mainnet EOA wallet" });
      const response = await client.signTransaction({ userToken: parsed.data.userToken, walletId: parsed.data.walletId, rawTransaction: parsed.data.rawTransaction, memo: "PULSE transaction" });
      return res.set("Cache-Control", "no-store").json(response.data);
    } catch (error) { return res.status(502).json(safeError(error)); }
  });

  router.post("/transactions/contract-execution", async (req, res) => {
    if (!client) return res.status(503).json({ error: "Circle email wallet is not configured" });
    const parsed = ContractExecution.safeParse({ ...req.body, userToken: (() => { try { return bearer(req.header("authorization")); } catch { return ""; } })() });
    if (!parsed.success) return res.status(400).json({ error: "Invalid Circle contract-execution request" });
    try {
      if (!await isArcWallet(parsed.data.userToken, parsed.data.walletId)) return res.status(400).json({ error: "Select an Arc mainnet EOA wallet" });
      const response = await client.createUserTransactionContractExecutionChallenge({
        userToken: parsed.data.userToken,
        walletId: parsed.data.walletId,
        contractAddress: parsed.data.contractAddress,
        callData: parsed.data.callData as `0x${string}`,
        amount: formatUnits(BigInt(parsed.data.value || "0x0"), 18),
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
