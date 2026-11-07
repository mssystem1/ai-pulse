import { createHash, randomUUID } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { getNetwork, type AppConfig } from "@pulse/config";
import { createPaymentGate, validateSignedPayment, type SettlementRequest } from "@pulse/payments";
import { paymentPayer } from "./arcBudget.js";
import { asyncRoute } from "./httpResilience.js";
import { executionPublicClient } from "./onchainDiscovery.js";
import { verifyTerminalPurchaseReceipt } from "./terminalPayments.js";
import { TerminalStore, terminalAccess, type TerminalIndicatorPublication } from "./terminalStore.js";
import type { IndicatorOffer, IndicatorPurchase, IndicatorSale, IndicatorPaymentNetwork } from "./terminalIndicatorTypes.js";

export const INDICATOR_REGISTRY_OWNER = "0x" + "0".repeat(40);
const requestId = z.string().min(16).max(128).regex(/^[a-zA-Z\d_-]+$/);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export function indicatorOffer(raw: unknown, maxPrice = 1000, minPrice = 0.001): IndicatorOffer | undefined {
  if (raw === undefined) return undefined;
  const input = z.object({ priceUsdc: z.string().regex(/^(0|[1-9]\d{0,5})(\.\d{1,6})?$/), kind: z.literal("version-service").optional(), description: z.string().min(10).max(500).optional() }).strict().parse(raw);
  if (Number(input.priceUsdc) > maxPrice) throw Error("Creator price exceeds the configured maximum");
  if (Number(input.priceUsdc) === 0) return undefined;
  if (Number(input.priceUsdc) < minPrice) throw Error("Choose a free listing or a price above the configured settlement minimum");
  return { kind: "version-service", priceUsdc: Number(input.priceUsdc).toFixed(6).replace(/0+$/, "").replace(/\.$/, ""), description: input.description ?? "Managed installation of this exact open-formula version in Trading Terminal. Terminal access is separate. No automatic renewal, private formula or guaranteed return." };
}
export const indicatorAtomic = (price: string) => { const [whole, decimal = ""] = price.split("."); return (BigInt(whole) * 1_000_000n + BigInt(decimal.padEnd(6, "0"))).toString(); };
export function publicIndicatorPurchase(value: IndicatorPurchase, baseUrl: string) {
  const { nonce: _nonce, paymentId: _paymentId, preparedBlock: _preparedBlock, packageRef: _packageRef, ...safe } = value;
  const path = `/v1/terminal/indicators/purchases/${value.id}`;
  return { ...safe, priceUsd: value.priceUsdc, assetSymbol: getNetwork(value.network).paymentAsset.symbol, path, resource: `${baseUrl.replace(/\/$/, "")}/${value.network}${path}`, platformFeeAtomic: "0", creatorReceivesAtomic: value.amountAtomic };
}
type CommerceRuntime = { store: TerminalStore; now: () => number; cfg?: AppConfig };
export function indicatorPaymentNetworks(cfg?: AppConfig) {
  if (!cfg) return [];
  return (["xlayer", "base", "arbitrum"] as const).filter(key => {
    if (!cfg.enabledNetworks.includes(key)) return false;
    if (key === "xlayer") return cfg.X402_MOCK || cfg.hasOkxCredentials;
    const enabled = key === "base" ? cfg.FEATURE_BASE_PAYMENTS : cfg.FEATURE_ARBITRUM_PAYMENTS;
    return enabled && (cfg.X402_MOCK || Boolean(cfg.CDP_API_KEY_ID && cfg.CDP_API_KEY_SECRET));
  }).map(key => ({ key, network: getNetwork(key).caip2, asset: getNetwork(key).paymentAsset.address, symbol: getNetwork(key).paymentAsset.symbol }));
}
export type IndicatorCommerceDependencies = { paymentGate?: (cfg: AppConfig) => RequestHandler; blockNumber?: (network: IndicatorPaymentNetwork) => Promise<bigint>; verifyReceipt?: typeof verifyTerminalPurchaseReceipt };
export function indicatorCommerceStores(store: TerminalStore) {
  return { registry: new TerminalStore(store.storage, store.key("indicator-registry", "v1"), 365), commerce: new TerminalStore(store.storage, store.key("indicator-commerce", "v1"), 3650) };
}
/** Per-version, direct-to-creator service purchases. Formula bytes stay public. */
export function createIndicatorCommerceRoutes(runtime: CommerceRuntime, deps: IndicatorCommerceDependencies = {}) {
  const router = Router(), { registry, commerce } = indicatorCommerceStores(runtime.store), cfg = runtime.cfg;
  const owned = async (owner: string, listingId: string) => (await commerce.get(owner)).indicatorPurchases?.find(p => p.listingId === listingId && p.state === "granted");
  const finish = async (owner: string, quoteId: string, receipt: { settlementTx?: string; settledAt: string }) => {
    const original = (await commerce.get(owner)).indicatorPurchases?.find(p=>p.id===quoteId);
    if(!original)throw Error("Original service purchase is unavailable");
    const packageObject=await registry.storage.read<{bytes:string}>(registry.key("package",original.packageRef));
    if(!packageObject?.bytes||digest(packageObject.bytes)!==original.sha256)throw Error("Purchased package bytes need recovery; preserve the receipt");
    await registry.storage.write(registry.key("package",original.packageRef),packageObject,3650*86400);
    const updated = await commerce.mutate(owner, value => {
      const purchase = value.indicatorPurchases?.find(p => p.id === quoteId);
      if (!purchase || !["authorizing", "granted"].includes(purchase.state)) throw Error("Original paid authorization is unavailable; do not pay again");
      if (purchase.state === "granted") return false;
      purchase.state = "granted"; purchase.grantedAt = receipt.settledAt; purchase.settlementTx = receipt.settlementTx;
    });
    const purchase = updated.indicatorPurchases!.find(p => p.id === quoteId)!;
    const sale: IndicatorSale = { id: quoteId, listingId: purchase.listingId, publisher: purchase.publisher, buyer: owner, title: purchase.title, version: purchase.version, sha256: purchase.sha256, amountAtomic: purchase.amountAtomic, priceUsdc: purchase.priceUsdc, asset: purchase.asset, network: purchase.network, settlementTx: purchase.settlementTx, at: purchase.grantedAt!, simulated: purchase.simulated };
    // Receipt is the source of truth. A retry repairs the creator index after a crash.
    await registry.mutate(INDICATOR_REGISTRY_OWNER, value => { if (value.indicatorSales?.some(s => s.id === quoteId)) return false; value.indicatorSales = [...(value.indicatorSales ?? []), sale]; });
    return { entitled: true, purchase: publicIndicatorPurchase(purchase, cfg!.BASE_URL), recovered: true };
  };
  router.get("/v1/terminal/indicators/purchases", asyncRoute(async (_req, res) => {
    const owner = String(res.locals.terminalOwner).toLowerCase();
    const purchases = (await commerce.get(owner)).indicatorPurchases ?? [];
    const sales = ((await registry.get(INDICATOR_REGISTRY_OWNER)).indicatorSales ?? []).filter(s => s.publisher === owner);
    return res.json({ purchases: purchases.map(p => publicIndicatorPurchase(p, cfg?.BASE_URL ?? "")), sales, creatorReceivesPercent: 100, platformFeePercent: 0 });
  }));
  router.post("/v1/terminal/indicators/:id/quote", asyncRoute(async (req, res) => {
    if (!cfg) return res.status(503).json({ error: "Creator checkout is not configured; no payment requested" });
    const input = z.object({ requestId, network: z.enum(["xlayer","base","arbitrum"]) }).strict().parse(req.body), owner = String(res.locals.terminalOwner).toLowerCase();
    if (!indicatorPaymentNetworks(cfg).some(n=>n.key===input.network))return res.status(503).json({error:"The selected stablecoin payment route is disabled or unavailable; no payment requested"});
    if (!terminalAccess(await runtime.store.get(owner), runtime.now()).active) return res.status(403).json({ error: "An active Terminal pass is required to buy managed indicator installation" });
    if (await owned(owner, String(req.params.id))) return res.status(409).json({ error: "This wallet already purchased this version. Restore its installation; do not pay again.", entitled: true });
    const existing = (await commerce.get(owner)).indicatorPurchases?.find(p => p.requestId === input.requestId);
    if (existing) {
      if (existing.listingId !== req.params.id || existing.network !== input.network) return res.status(409).json({ error: "Request identity belongs to another indicator" });
      return res.json({ quote: publicIndicatorPurchase(existing, cfg.BASE_URL) });
    }
    const item = (await registry.get(INDICATOR_REGISTRY_OWNER)).indicatorPublications?.find(item => item.id === req.params.id);
    if (!item?.offer) return res.status(404).json({ error: "Paid indicator listing not found; free packages need no purchase" });
    if(Number(item.offer.priceUsdc)<cfg.INDICATOR_MARKET_MIN_PRICE_USDC||Number(item.offer.priceUsdc)>cfg.INDICATOR_MARKET_MAX_PRICE_USDC)return res.status(422).json({error:"This listing price is outside current settlement limits. Ask the creator for a new version; no payment requested."});
    const now = runtime.now(), asset = getNetwork(input.network).paymentAsset.address!;
    const quote: IndicatorPurchase = { id: "iqu_" + randomUUID().replaceAll("-", ""), requestId: input.requestId, owner, listingId: item.id, publisher: item.publisher, title: item.title, version: item.version, sha256: item.sha256, packageRef: item.packageRef, offer: item.offer, priceUsdc: item.offer.priceUsdc, amountAtomic: indicatorAtomic(item.offer.priceUsdc), network: input.network, asset, payee: item.publisher, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + cfg.INDICATOR_MARKET_QUOTE_TTL_SECONDS * 1000).toISOString(), state: "quoted", simulated: cfg.X402_MOCK };
    let result = quote;
    await commerce.mutate(owner, value => {
      const old = value.indicatorPurchases?.find(p => p.requestId === input.requestId);
      if (old) { if (old.listingId !== quote.listingId || old.network !== quote.network) throw Error("Purchase identity conflict"); result = old; return false; }
      if ((value.indicatorPurchases?.length ?? 0) >= 500) throw Error("Purchase history limit reached; contact support before buying");
      value.indicatorPurchases = [...(value.indicatorPurchases ?? []), quote];
    });
    return res.status(201).json({ quote: publicIndicatorPurchase(result, cfg.BASE_URL) });
  }));
  router.post("/v1/terminal/indicators/purchases/:id/recover", asyncRoute(async (req, res) => {
    const input = z.object({ transactionHash: z.string().regex(/^0x[\da-f]{64}$/i).optional() }).strict().parse(req.body), owner = String(res.locals.terminalOwner).toLowerCase();
    const purchase = (await commerce.get(owner)).indicatorPurchases?.find(p => p.id === req.params.id);
    if (!purchase || !cfg) return res.status(404).json({ error: "Original purchase not found for this wallet" });
    try {
      if (purchase.state === "granted") return res.json(await finish(owner, purchase.id, { settlementTx: purchase.settlementTx, settledAt: purchase.grantedAt! }));
      if (purchase.state !== "authorizing" || !input.transactionHash || purchase.simulated) throw Error("Preserve the original authorization and confirmed transaction; no new payment is requested");
      const receipt = await (deps.verifyReceipt ?? verifyTerminalPurchaseReceipt)(owner, { ...purchase, duration: "24h", paymentId: purchase.paymentId!, priceUsd: purchase.priceUsdc, state: "authorizing" }, input.transactionHash);
      return res.json(await finish(owner, purchase.id, receipt));
    } catch (cause) { return res.status(409).json({ error: cause instanceof Error ? cause.message : "Payment recovery required", doNotPayAgain: true }); }
  }));
  router.post("/v1/terminal/indicators/purchases/:id", asyncRoute(async (req, res, next) => {
    const owner = String(res.locals.terminalOwner).toLowerCase(), input = z.object({ requestId }).strict().parse(req.body);
    const purchase = (await commerce.get(owner)).indicatorPurchases?.find(p => p.id === req.params.id);
    if (!purchase || !cfg || purchase.requestId !== input.requestId) return res.status(404).json({ error: "Reviewed quote not found for this wallet" });
    if (purchase.state === "granted") return res.json(await finish(owner, purchase.id, { settlementTx: purchase.settlementTx, settledAt: purchase.grantedAt! }));
    if (purchase.state !== "quoted") return res.status(409).json({ error: "Original payment needs recovery; do not pay again", doNotPayAgain: true });
    if (Date.parse(purchase.expiresAt) <= runtime.now()) return res.status(409).json({ error: "Quote expired before authorization. Review a new quote." });
    if ((req as SettlementRequest).pulseNetworkKey !== purchase.network) return res.status(422).json({ error: "Use the exact stablecoin network and resource in the reviewed quote" });
    if (!indicatorPaymentNetworks(cfg).some(n => n.key === purchase.network)) return res.status(503).json({ error: "This payment route is currently unavailable; preserve the quote and do not sign a payment" });
    if (!terminalAccess(await runtime.store.get(owner), runtime.now()).active) return res.status(403).json({ error: "Terminal pass expired before purchase; no payment requested" });
    const item = (await registry.get(INDICATOR_REGISTRY_OWNER)).indicatorPublications?.find(i => i.id === purchase.listingId);
    if (!item || item.sha256 !== purchase.sha256 || JSON.stringify(item.offer) !== JSON.stringify(purchase.offer)) return res.status(409).json({ error: "Listing changed or was removed before payment" });
    const packageObject=await registry.storage.read<{bytes:string}>(registry.key("package",purchase.packageRef));
    if(!packageObject?.bytes||digest(packageObject.bytes)!==purchase.sha256)return res.status(503).json({error:"This package cannot be verified before payment. Contact its creator; no payment requested."});
    if (await owned(owner, purchase.listingId)) return res.status(409).json({ error: "Version already purchased; restore it", entitled: true });
    const dynamicCfg: AppConfig = { ...cfg, PAY_TO_ADDRESS: purchase.payee, routes: { [`POST ${req.path}`]: { name: "Indicator version service", priceUsd: Number(purchase.priceUsdc), description: purchase.offer.description } } };
    const header = req.get("PAYMENT-SIGNATURE") || req.get("X-PAYMENT");
    if (header) {
      let nonce: string | undefined;
      try {
        if (!cfg.X402_MOCK) {
          const payload = JSON.parse(Buffer.from(header, "base64").toString());
          validateSignedPayment(dynamicCfg, req as SettlementRequest, payload);
          if (paymentPayer(header) !== owner) throw Error("Paying wallet must match the signed-in owner");
          nonce = payload.payload?.authorization?.nonce ?? payload.authorization?.nonce;
          if (!/^0x[\da-f]{64}$/i.test(nonce ?? "")) throw Error("Payment authorization nonce required");
        }
      } catch { return res.status(400).json({ error: "Signed payment does not match this exact indicator quote", code: "indicator_payment_not_settled", doNotPayAgain: false }); }
      const paymentId = digest(cfg.X402_MOCK ? header : `${purchase.network}:${owner}:${purchase.asset}:${nonce}`);
      const preparedBlock = cfg.X402_MOCK ? undefined : (await (deps.blockNumber?.(purchase.network) ?? executionPublicClient(purchase.network).getBlockNumber({ cacheTime: 0 }))).toString();
      let claimed = false;
      try { await commerce.mutate(owner, value => {
        claimed = false;
        const current = value.indicatorPurchases!.find(p => p.id === purchase.id)!;
        if (current.state !== "quoted") return false;
        if (value.indicatorPurchases?.some(p => p.id !== purchase.id && p.listingId === purchase.listingId && p.state !== "quoted")) throw Error("This version already has a paid or processing purchase; restore the original receipt");
        current.state = "authorizing"; current.paymentId = paymentId; current.nonce = nonce; current.preparedBlock = preparedBlock; claimed = true;
      }); } catch (cause) { return res.status(409).json({ error: cause instanceof Error ? cause.message : "Original purchase requires recovery", doNotPayAgain: true }); }
      if (!claimed) return res.status(409).json({ error: "Original purchase is processing; recover it", doNotPayAgain: true });
      try { await registry.mutate(INDICATOR_REGISTRY_OWNER, value => {
        const previous = value.indicatorClaims?.[paymentId];
        if (previous && previous !== purchase.id) throw Error("Payment authorization belongs to another indicator purchase");
        value.indicatorClaims = { ...(value.indicatorClaims ?? {}), [paymentId]: purchase.id };
      }); } catch { return res.status(409).json({ error: "This authorization has already been used; no new payment is requested", doNotPayAgain: true }); }
    }
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode === 402 && (req as SettlementRequest).pulsePaymentFailure?.definitiveNoSettlement) {
        void (async () => {
          const pending = (await commerce.get(owner)).indicatorPurchases?.find(p => p.id === purchase.id);
          if (pending?.state === "authorizing") {
            await registry.mutate(INDICATOR_REGISTRY_OWNER, value => { if (pending.paymentId && value.indicatorClaims?.[pending.paymentId] === purchase.id) delete value.indicatorClaims[pending.paymentId]; });
            await commerce.mutate(owner, value => { const p = value.indicatorPurchases?.find(p => p.id === purchase.id); if (!p || p.state !== "authorizing" || p.paymentId !== pending.paymentId) return false; p.state = "quoted"; delete p.paymentId; delete p.nonce; delete p.preparedBlock; });
          }
          originalJson({ ...(body && typeof body === "object" ? body : {}), code: "indicator_payment_not_settled", doNotPayAgain: false });
        })().catch(next);
        return res;
      }
      return originalJson(body);
    }) as typeof res.json;
    const gate = (deps.paymentGate ?? createPaymentGate)(dynamicCfg);
    return gate(req, res, error => {
      if (error) return next(error);
      void (async () => {
        const settled = (req as SettlementRequest).pulseSettlement;
        if (!header || !cfg.X402_MOCK && settled?.result.success !== true) return res.status(503).json({ error: "Settlement is uncertain; recover the original purchase", doNotPayAgain: true });
        const transaction = settled?.result.transaction;
        try { return res.status(201).json({ ...await finish(owner, purchase.id, { settlementTx: typeof transaction === "string" ? transaction : undefined, settledAt: settled?.settledAt ?? new Date(runtime.now()).toISOString() }), recovered: false }); }
        catch { return res.status(503).json({ error: "Payment accepted; restore the original receipt before retrying", doNotPayAgain: true, ...(typeof transaction === "string" ? { transactionHash: transaction } : {}) }); }
      })().catch(next);
    });
  }));
  return { router, registry, commerce, owned };
}
