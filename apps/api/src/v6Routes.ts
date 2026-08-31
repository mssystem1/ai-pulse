import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "@pulse/config";
import { analysisSymbolForExecutionToken, executionAssetAliases, getGenericOkxQuote, getGenericOkxSwap, getOkxTradeTokens, searchOkxDefiOpportunities } from "./okxDex.js";
import { reconcileV6Activity, recordV6Activity, v6ActivityPersistenceStatus } from "./v6Store.js";
import { asyncRoute } from "./httpResilience.js";
import { kvCircuitStatus } from "./resilientKv.js";
import { getOnchainAccountSnapshot } from "./onchainDiscovery.js";
import {
  executionContractAddress,
  executionContracts,
} from "./executionContracts.js";

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const HASH = /^0x[a-fA-F0-9]{64}$/;
const NETWORKS = {
  xlayer: { chainId: "196", prefix: "XLAYER", rpc: () => process.env.X_LAYER_RPC || "https://rpc.xlayer.tech" },
  base: { chainId: "8453", prefix: "BASE", rpc: () => process.env.BASE_RPC_URL || "https://mainnet.base.org" },
  arbitrum: { chainId: "42161", prefix: "ARBITRUM", rpc: () => process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc" },
} as const;

export const TradeSchema = z.object({
  network: z.enum(["xlayer", "base", "arbitrum"]),
  fromTokenAddress: z.string().regex(ADDRESS),
  toTokenAddress: z.string().regex(ADDRESS),
  amount: z.string().regex(/^\d{1,78}$/).refine((v) => BigInt(v) > 0n),
  userWalletAddress: z.string().regex(ADDRESS).optional(),
  slippagePercent: z.coerce.number().min(0.05).max(5).optional().default(0.5),
  slippageMode: z.enum(["auto", "manual"]).optional().default("auto"),
  maxAutoSlippagePercent: z.coerce.number().min(0.1).max(5).optional().default(1),
});

export function createV6Router(cfg: AppConfig) {
  const router = Router();

  router.get("/v1/trading/capabilities", (req, res) => {
    const network = String(req.query.network || "xlayer");
    if (network === "arc-testnet") return res.json({ product: "PULSE", network, analysis: true, spot: { visible: false, enabled: false }, autopilot: { visible: false, enabled: false }, reasons: { spot: "Arc Testnet is analysis/payment only", autopilot: "Arc Testnet is analysis/payment only" } });
    const chain = NETWORKS[network as keyof typeof NETWORKS];
    if (!chain) return res.status(400).json({ error: "Unsupported network" });
    const contracts = executionContracts(network as keyof typeof NETWORKS);
    const automationReady = process.env.AUTOMATION_WORKER_ENABLED === "1" && /^0x[a-fA-F0-9]{64}$/.test(cfg.AUTOMATION_EXECUTOR_PRIVATE_KEY || cfg.TEST_WALLET_PRIVATE_KEY || "");
    const autopilotRuntimeReady = automationReady && cfg.hasXaiKey && Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN && process.env.BLOB_READ_WRITE_TOKEN);
    res.json({
      product: "PULSE",
      network,
      chainId: Number(chain.chainId),
      analysis: { base: true, premium: true },
      payment: { x402: true },
      spot: { visible: cfg.FEATURE_TRADING, enabled: cfg.FEATURE_TRADING && cfg.hasOkxCredentials, market: cfg.hasOkxCredentials, limit: automationReady && Boolean(contracts.spotLimitFactory && contracts.oracleRouter && contracts.executionAdapter), bracket: automationReady && Boolean(contracts.spotBracketFactory && contracts.oracleRouter && contracts.executionAdapter), protectedOrders: automationReady && Boolean(contracts.spotFactory && contracts.oracleRouter && contracts.executionAdapter) },
      autopilot: { visible: cfg.FEATURE_AUTOPILOT, enabled: cfg.FEATURE_AUTOPILOT && autopilotRuntimeReady && Boolean(contracts.autopilotFactory && contracts.executionAdapter) && !cfg.AUTOPILOT_KILL_SWITCH },
      contracts,
      contractAddressSource: "published_release_with_environment_override",
      persistence: process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN ? "upstash_kv" : "memory-development",
      persistenceHealth: kvCircuitStatus(),
      reasons: {
        ...(!cfg.hasOkxCredentials ? { market: "Configure OKX Onchain OS credentials" } : {}),
        ...(!contracts.spotFactory ? { protectedOrders: `Configure ${chain.prefix}_SPOT_ORDER_FACTORY_ADDRESS` } : {}),
        ...(!contracts.spotBracketFactory ? { bracket: `Configure ${chain.prefix}_SPOT_BRACKET_FACTORY_ADDRESS` } : {}),
        ...(!contracts.autopilotFactory ? { autopilot: `Configure ${chain.prefix}_AUTOPILOT_VAULT_FACTORY_ADDRESS` } : {}),
        ...(!automationReady ? { automation: "Configure and enable the restricted keeper/executor worker" } : {}),
        ...(automationReady && !autopilotRuntimeReady ? { autopilot: "Autopilot requires live xAI, KV and private Blob evidence storage" } : {}),
      },
    });
  });

  router.get("/v1/trading/accounts", asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const owner = String(req.query.owner || "");
    const network = String(req.query.network || "");
    if (!ADDRESS.test(owner) || !(network in NETWORKS))
      return res.status(400).json({ error: "Valid owner and execution network are required" });
    try {
      const snapshot = await getOnchainAccountSnapshot(network as keyof typeof NETWORKS, owner, req.query.fresh === "1");
      res.setHeader("Cache-Control", "private, max-age=10, stale-if-error=300");
      return res.json({ ...snapshot, source: "factory_contract_multicall", etherscanRequired: false });
    } catch (error) {
      return res.status(503).json({ error: `On-chain account state is temporarily unavailable: ${error instanceof Error ? error.message : String(error)}`, retryable: true });
    }
  }));

  router.post("/v1/trading/quote", asyncRoute(async (req, res) => {
    const parsed = TradeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const chainId = NETWORKS[parsed.data.network].chainId;
      const quote = await getGenericOkxQuote(cfg, { ...parsed.data, chainId, slippagePercent: String(parsed.data.slippagePercent) });
      res.json({ service: "spot_quote", provider: "OKX Onchain OS", expiresAt: new Date(Date.now() + 30_000).toISOString(), quote });
    } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : String(error) }); }
  }));

  router.get("/v1/trading/tokens", asyncRoute(async (req, res) => {
    const network = String(req.query.network || "");
    const chain = NETWORKS[network as keyof typeof NETWORKS];
    const query = String(req.query.q || "").slice(0, 80);
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
    if (!chain) return res.status(400).json({ error: "Select X Layer, Base or Arbitrum" });
    try {
      const tokens = await getOkxTradeTokens(cfg, chain.chainId, query, limit);
      res.json({ network, chainId: chain.chainId, provider: "OKX Onchain OS", tokens });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  }));

  router.get("/v1/trading/pairs", asyncRoute(async (req, res) => {
    const network = String(req.query.network || "");
    const chain = NETWORKS[network as keyof typeof NETWORKS];
    const query = String(req.query.q || "").trim().toUpperCase().slice(0, 40);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 250);
    const erc20Custody = String(req.query.custody || "").toLowerCase() === "erc20";
    if (!chain) return res.status(400).json({ error: "Select X Layer, Base or Arbitrum" });
    const settlementSymbol = network === "xlayer" ? "USDT0" : "USDC";
    const excluded = new Set(["USDC", "USDT", "USDT0", "USDBC", "DAI", "USDS", "USD+", "USD₮0"]);
    try {
      const tokens = await getOkxTradeTokens(cfg, chain.chainId, "", 1_000);
      const ranked = tokens.flatMap((token) => {
        if (erc20Custody && token.address.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") return [];
        const analysisBase = analysisSymbolForExecutionToken(token.symbol, chain.chainId);
        if (!analysisBase || excluded.has(analysisBase.toUpperCase())) return [];
        const analysisPair = `${analysisBase}-USDT`;
        if (query && ![analysisPair, analysisBase, token.symbol, token.name].some((value) => String(value).toUpperCase().includes(query))) return [];
        const aliases = executionAssetAliases(analysisBase, chain.chainId);
        const aliasRank = aliases.indexOf(token.symbol.toUpperCase());
        return [{
          pair: analysisPair,
          analysisBase,
          executionPair: `${token.symbol}/${settlementSymbol}`,
          token,
          routeStatus: "checked-when-selected",
          rank: aliasRank < 0 ? Number.MAX_SAFE_INTEGER : aliasRank,
        }];
      });
      const preferred = new Map<string, (typeof ranked)[number]>();
      for (const candidate of ranked) {
        const current = preferred.get(candidate.pair);
        if (!current || candidate.rank < current.rank) preferred.set(candidate.pair, candidate);
      }
      const pairs = [...preferred.values()].slice(0, limit).map(({ rank: _rank, ...pair }) => pair);
      res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
      return res.json({ network, chainId: chain.chainId, settlementSymbol, custody: erc20Custody ? "erc20" : "wallet", provider: "OKX Onchain OS token catalog", pairs });
    } catch (error) {
      return res.status(502).json({ error: error instanceof Error ? error.message : String(error), retryable: true });
    }
  }));

  router.get("/v1/trading/resolve-pair", asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const network = String(req.query.network || "");
    const pair = String(req.query.pair || "").trim().toUpperCase();
    const chain = NETWORKS[network as keyof typeof NETWORKS];
    const [baseSymbol, quoteSymbol, extra] = pair.split("-");
    if (!chain || !baseSymbol || !quoteSymbol || extra)
      return res.status(400).json({ error: "Valid execution network and BASE-QUOTE pair are required" });
    const settlementSymbol = network === "xlayer" ? "USDT0" : "USDC";
    const erc20Custody = String(req.query.custody || "").toLowerCase() === "erc20";
    const aliases = executionAssetAliases(baseSymbol, chain.chainId);
    try {
      const [baseCandidates, quoteCandidates] = await Promise.all([
        getOkxTradeTokens(cfg, chain.chainId, baseSymbol, 100),
        getOkxTradeTokens(cfg, chain.chainId, settlementSymbol, 100),
      ]);
      const baseOptions = aliases.flatMap((alias) => baseCandidates.filter((token) => token.symbol.toUpperCase() === alias))
        .filter((token) => !erc20Custody || token.address.toLowerCase() !== "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")
        .filter((token, index, all) => all.findIndex((candidate) => candidate.address.toLowerCase() === token.address.toLowerCase()) === index);
      const base = baseOptions[0] || null;
      const quote = quoteCandidates.find((token) => token.address.toLowerCase() === (network === "xlayer"
        ? "0x779Ded0c9e1022225f8E0630b35a9b54bE713736"
        : network === "base"
          ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
          : "0xaf88d065e77c8cC2239327C5EDb3A432268e5831").toLowerCase()) || null;
      if (!base || !quote)
        return res.json({ network, pair, available: false, aliasesChecked: aliases, custody: erc20Custody ? "erc20" : "wallet", reason: `No verified ${baseSymbol} representation and ${settlementSymbol} settlement pair were found on this chain.` });
      const routeErrors: string[] = [];
      for (const option of baseOptions) {
        try {
          await getGenericOkxQuote(cfg, {
            chainId: chain.chainId,
            fromTokenAddress: quote.address,
            toTokenAddress: option.address,
            amount: String(10 ** Math.min(quote.decimals, 15)),
            slippagePercent: "1",
          });
          return res.json({ network, pair, available: true, base: option, quote, aliasesChecked: aliases, custody: erc20Custody ? "erc20" : "wallet", representationsChecked: baseOptions.map((item) => ({ symbol: item.symbol, address: item.address })), mapping: option.symbol.toUpperCase() === baseSymbol ? "native-symbol" : "verified-wrapper", explanation: `${pair} analysis executes as ${option.symbol}/${quote.symbol} on ${network}.` });
        } catch (error) {
          routeErrors.push(`${option.symbol} ${option.address}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return res.json({ network, pair, available: false, base, quote, aliasesChecked: aliases, representationsChecked: baseOptions.map((item) => ({ symbol: item.symbol, address: item.address })), reason: `Verified token representations exist, but none has a safe live OKX route on ${network}. ${routeErrors.join(" | ")}` });
    } catch (error) {
      return res.status(502).json({ error: error instanceof Error ? error.message : String(error), retryable: true });
    }
  }));

  router.get("/v1/defi/opportunities", asyncRoute(async (req, res) => {
    const network = String(req.query.network || "xlayer"); const symbol = String(req.query.symbol || "").trim().toUpperCase();
    const chain = NETWORKS[network as keyof typeof NETWORKS];
    if (!chain || !/^[A-Z0-9._-]{1,24}$/.test(symbol)) return res.status(400).json({ error: "Valid mainnet network and asset symbol are required" });
    try { const opportunities = await searchOkxDefiOpportunities(cfg, symbol, chain.chainId); res.json({ source: "OKX Onchain OS DeFi API", network, chainId: chain.chainId, symbol, observedAt: new Date().toISOString(), opportunities }); }
    catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : String(error) }); }
  }));

  router.post("/v1/trading/prepare-swap", asyncRoute(async (req, res) => {
    const parsed = TradeSchema.extend({ userWalletAddress: z.string().regex(ADDRESS) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const chainId = NETWORKS[parsed.data.network].chainId;
      let effectiveSlippage = parsed.data.slippagePercent;
      if (parsed.data.slippageMode === "auto") {
        const quote = await getGenericOkxQuote(cfg, {
          ...parsed.data,
          chainId,
          slippagePercent: String(parsed.data.slippagePercent),
        });
        const impact = Math.abs(Number(quote.priceImpactPercent || 0));
        const suggested = Number.isFinite(impact) ? Math.max(0.1, impact * 2 + 0.1) : 0.5;
        effectiveSlippage = Math.min(parsed.data.maxAutoSlippagePercent, suggested);
      }
      const prepared = await getGenericOkxSwap(cfg, {
        ...parsed.data,
        chainId,
        slippagePercent: String(Number(effectiveSlippage.toFixed(4))),
        autoSlippage: parsed.data.slippageMode === "auto",
        maxAutoSlippagePercent: String(parsed.data.maxAutoSlippagePercent),
      });
      const approvedRouter = executionContractAddress(parsed.data.network, "okxRouter");
      const approvalAddress = executionContractAddress(parsed.data.network, "okxApproval");
      const quotedFrom = String(prepared.quote?.fromToken?.address || "").toLowerCase();
      const quotedTo = String(prepared.quote?.toToken?.address || "").toLowerCase();
      if (!approvedRouter || prepared.tx.to.toLowerCase() !== approvedRouter.toLowerCase())
        throw new Error(`OKX prepared transaction target ${prepared.tx.to} is not the configured approved router ${approvedRouter || "missing"}`);
      if (!approvalAddress) throw new Error("OKX token approval contract is not configured");
      if (prepared.tx.from.toLowerCase() !== parsed.data.userWalletAddress.toLowerCase())
        throw new Error("OKX prepared transaction sender does not match the connected wallet");
      if (!/^0x[a-fA-F0-9]*$/.test(prepared.tx.data) || quotedFrom !== parsed.data.fromTokenAddress.toLowerCase() || quotedTo !== parsed.data.toTokenAddress.toLowerCase())
        throw new Error("OKX prepared transaction/quote assets do not match the request");
      const native = parsed.data.fromTokenAddress.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
      if ((!native && BigInt(prepared.tx.value) !== 0n) || (native && BigInt(prepared.tx.value) !== BigInt(parsed.data.amount)))
        throw new Error("OKX prepared transaction native value does not match the requested sell amount");
      res.json({ service: "spot_swap_prepared", provider: "OKX Onchain OS", approvalAddress, expiresAt: new Date(Date.now() + 30_000).toISOString(), ...prepared });
    } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : String(error) }); }
  }));

  router.get("/v1/trading/activity", asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const owner = String(req.query.address || ""); const network = String(req.query.network || "");
    if (!ADDRESS.test(owner) || !NETWORKS[network as keyof typeof NETWORKS]) return res.status(400).json({ error: "Valid address and mainnet network are required" });
    const activity = await reconcileV6Activity(owner, network, NETWORKS[network as keyof typeof NETWORKS].rpc());
    res.json({ activity, persistence: v6ActivityPersistenceStatus() });
  }));

  router.post("/v1/trading/activity", asyncRoute(async (req, res) => {
    // Browser activity is only an announcement. Confirmation is derived from the
    // chain receipt by reconcileV6Activity; clients cannot assert settlement.
    const schema = z.object({ owner: z.string().regex(ADDRESS), network: z.enum(["xlayer", "base", "arbitrum"]), source: z.enum(["wallet", "spot", "autopilot", "limit"]), kind: z.string().min(1).max(64), status: z.literal("pending"), txHash: z.string().regex(HASH), account: z.string().regex(ADDRESS).optional(), pair: z.string().max(64).optional(), executionPair: z.string().max(64).optional(), amount: z.string().regex(/^\d{1,78}$/).optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const activity = await recordV6Activity(parsed.data);
    const persistence = v6ActivityPersistenceStatus();
    res.status(persistence.state === "degraded" || persistence.state === "recovering" ? 202 : 201).json({ activity, persistence, recoverable: persistence.state === "degraded" || persistence.state === "recovering" });
  }));

  return router;
}
