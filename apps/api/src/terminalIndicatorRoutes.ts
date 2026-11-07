import { Router } from "express";
import { createHash } from "node:crypto";
import { indicatorMarketCatalog, parseIndicatorPackage, exportIndicatorPackage } from "@pulse/domain";
import type { TerminalRuntime } from "./terminalRuntime.js";
import { TerminalStore, type TerminalIndicatorPublication } from "./terminalStore.js";
import { asyncRoute } from "./httpResilience.js";
import type { AppConfig } from "@pulse/config";
import { z } from "zod";
import { BUILTIN_INDICATOR_DEPLOYMENTS } from "@pulse/market";
import { terminalAccess } from "./terminalStore.js";
import { createIndicatorCommerceRoutes, indicatorOffer, indicatorPaymentNetworks, type IndicatorCommerceDependencies } from "./terminalIndicatorCommerce.js";

const REGISTRY_OWNER = "0x" + "0".repeat(40), TTL = 365 * 86400;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
/** Shared catalog holds only intentionally published packages, never journals,
 * report evidence, authentication tokens or private workspace records. */
export function createTerminalIndicatorRoutes(runtime: Pick<TerminalRuntime, "store" | "now"> & { cfg?: AppConfig }, dependencies: IndicatorCommerceDependencies = {}) {
  const router = Router(), registry = new TerminalStore(runtime.store.storage, runtime.store.key("indicator-registry", "v1"), 365);
  const seeds = indicatorMarketCatalog();
  const checkout = createIndicatorCommerceRoutes(runtime, dependencies);
  const summary = (item: TerminalIndicatorPublication, owner: string, owned = false) => ({ ...Object.fromEntries(Object.entries(item).filter(([key]) => key !== "packageRef")), canDelete: item.publisher === owner, entitled: !item.offer || item.publisher === owner || owned, hosted: true, publication: item.registration ? { ...item.registration, registered: true } : { chainId: 196, registered: false } });
  const seedSummary = (m: typeof seeds[number]) => {
    const candidate=BUILTIN_INDICATOR_DEPLOYMENTS[m.id],registration=candidate?.netlistHash===`sha256:${digest(Buffer.from(m.runtime.netlist.slice(2),"hex"))}`?candidate:undefined;
    return { id: m.id, manifestId: m.id, version: m.version, title: m.title, description: m.description, author: m.author, kernel: m.kernel, publisher: null, createdAt: null, canDelete: false, hosted: false, entitled:true, ...(registration?{registration}:{}), publication: registration?{...registration,registered:true}:m.publication };
  };
  router.use("/v1/terminal/indicators", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); if (!/^0x[\da-f]{40}$/i.test(res.locals.terminalOwner ?? "")) return res.status(401).json({ error: "Sign in to your wallet workspace first" }); next(); });
  router.use(checkout.router);
  router.get("/v1/terminal/indicators", asyncRoute(async (_req, res) => {
    const items = (await registry.get(REGISTRY_OWNER)).indicatorPublications ?? [];
    const purchased = new Set(((await checkout.commerce.get(res.locals.terminalOwner)).indicatorPurchases ?? []).filter(p => p.state === "granted").map(p => p.listingId));
    res.json({ version: "pulse-indicator-catalog-v2", items: [...seeds.map(seedSummary), ...items.map(item => summary(item, res.locals.terminalOwner, purchased.has(item.id)))], limits: { total: 100, perPublisher: 20, minPriceUsdc: runtime.cfg?.INDICATOR_MARKET_MIN_PRICE_USDC ?? 0.001, maxPriceUsdc: runtime.cfg?.INDICATOR_MARKET_MAX_PRICE_USDC ?? 1000 }, hosting: "PULSE discovery; deployment identity is independently checked for registered X Layer circuits", commerce: { paymentNetworks: indicatorPaymentNetworks(runtime.cfg), creatorReceivesPercent: 100, platformFeePercent: 0, formulasPublic: true } });
  }));
  router.get("/v1/terminal/indicators/:id", asyncRoute(async (req, res) => {
    const id = String(req.params.id), seed = seeds.find(m => m.id === id);
    if (seed) return res.json({ item: seedSummary(seed), manifest: seed });
    if (!/^pmi_[\da-f]{32}$/.test(id)) return res.status(404).json({ error: "Indicator not found" });
    const published = (await registry.get(REGISTRY_OWNER)).indicatorPublications?.find(item => item.id === id);
    const purchased = await checkout.owned(res.locals.terminalOwner, id);
    if (!published && !purchased) return res.status(404).json({ error: "Indicator not found" });
    const item = published ?? { ...purchased!, id, manifestId: "purchased-version", description: purchased!.offer.description, author: purchased!.publisher, kernel: "purchased-version", createdAt: purchased!.createdAt };
    const stored = await registry.storage.read<{ bytes: string }>(registry.key("package", item.packageRef));
    const bytes = typeof stored?.bytes === "string" ? stored.bytes : null;
    if (!bytes || digest(bytes) !== item.sha256) return res.status(503).json({ error: "Published package could not be verified. Import its original export or contact its publisher." });
    return res.json({ item: summary(item, res.locals.terminalOwner, Boolean(purchased)), manifest: parseIndicatorPackage(bytes) });
  }));
  router.post("/v1/terminal/indicators", asyncRoute(async (req, res) => {
    if (!req.body || !Object.hasOwn(req.body, "manifest") || Object.keys(req.body).some(key => !["manifest", "offer"].includes(key))) return res.status(400).json({ error: "Provide one portable indicator manifest and optional creator offer" });
    if (runtime.cfg && !terminalAccess(await runtime.store.get(res.locals.terminalOwner), runtime.now()).active) return res.status(403).json({ error: "An active Terminal pass is required to publish" });
    let manifest;
    try { manifest = parseIndicatorPackage(req.body.manifest); } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid indicator package" }); }
    let offer;
    try { offer = indicatorOffer(req.body.offer, runtime.cfg?.INDICATOR_MARKET_MAX_PRICE_USDC, runtime.cfg?.INDICATOR_MARKET_MIN_PRICE_USDC); } catch { return res.status(400).json({ error: "Choose a free listing or a stablecoin price within the configured settlement minimum and maximum, with at most six decimal places" }); }
    if (manifest.id.startsWith("pulse.")) return res.status(400).json({ error: "Choose your own package ID; pulse.* is reserved for built-in tools" });
    const publisher = String(res.locals.terminalOwner).toLowerCase(), bytes = exportIndicatorPackage(manifest), sha256 = digest(bytes);
    const item: TerminalIndicatorPublication = { id: "pmi_" + digest(publisher + ":" + manifest.id + ":" + manifest.version).slice(0, 32), manifestId: manifest.id, version: manifest.version, title: manifest.title, description: manifest.description, author: manifest.author, kernel: manifest.kernel, publisher, createdAt: new Date(runtime.now()).toISOString(), sha256, packageRef: sha256, ...(offer ? { offer } : {}) };
    const current = (await registry.get(REGISTRY_OWNER)).indicatorPublications ?? [], prior = current.find(p => p.id === item.id);
    if (prior && (prior.sha256 !== sha256 || JSON.stringify(prior.offer) !== JSON.stringify(offer))) return res.status(409).json({ error: "This version already has different content or terms; increase its version" });
    // Reject known excess before writing package bytes. CAS below repeats these
    // checks to protect concurrent publishers from overwriting catalog entries.
    if (!prior && (current.length >= 100 || current.filter(p => p.publisher === publisher).length >= 20)) return res.status(409).json({ error: "Indicator catalog publication limit reached" });
    // Redis adapters decode top-level JSON strings. Wrap exact bytes so their
    // representation and checksum survive both memory and durable adapters.
    await registry.storage.write(registry.key("package", item.packageRef), { bytes }, TTL);
    let duplicate = false, storedItem = item;
    try { await registry.mutate(REGISTRY_OWNER, value => {
      const items = value.indicatorPublications ?? [], prior = items.find(p => p.id === item.id);
      if (prior) { if (prior.sha256 !== sha256 || JSON.stringify(prior.offer) !== JSON.stringify(offer)) throw Error("This version already has different content or terms; increase its version"); duplicate = true; storedItem = prior; return false; }
      if (items.length >= 100 || items.filter(p => p.publisher === publisher).length >= 20) throw Error("Indicator catalog publication limit reached");
      value.indicatorPublications = [...items, item];
    }); } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "Catalog changed. Retry publishing." }); }
    return res.status(duplicate ? 200 : 201).json({ item: summary(storedItem, publisher), manifest });
  }));
  router.post("/v1/terminal/indicators/:id/registration", asyncRoute(async (req, res) => {
    const input = z.object({ processor: z.string().regex(/^0x[\da-f]{40}$/i), circuitId: z.string().regex(/^[1-9]\d{0,18}$/), transactionHash: z.string().regex(/^0x[\da-f]{64}$/i).optional() }).strict().parse(req.body);
    const owner = String(res.locals.terminalOwner).toLowerCase(), item = (await registry.get(REGISTRY_OWNER)).indicatorPublications?.find(p => p.id === req.params.id);
    if (!item || item.publisher !== owner) return res.status(403).json({ error: "Only the publisher can attach a circuit deployment" });
    const stored = await registry.storage.read<{ bytes: string }>(registry.key("package", item.packageRef));
    if (!stored?.bytes || digest(stored.bytes) !== item.sha256) return res.status(503).json({ error: "Original package cannot be verified" });
    try {
      const { verifyIndicatorDeployment } = await import("@pulse/market");
      const registration = await verifyIndicatorDeployment(parseIndicatorPackage(stored.bytes), input);
      await registry.mutate(REGISTRY_OWNER, value => { const current = value.indicatorPublications?.find(p => p.id === item.id); if (!current || current.sha256 !== item.sha256) throw Error("Listing changed during verification"); current.registration = registration; });
      return res.json({ registration, item: summary({ ...item, registration }, owner) });
    } catch (cause) { return res.status(422).json({ error: cause instanceof Error ? cause.message : "X Layer deployment did not match this numerical package" }); }
  }));
  router.delete("/v1/terminal/indicators/:id", asyncRoute(async (req, res) => {
    const id = String(req.params.id), owner = String(res.locals.terminalOwner).toLowerCase();
    if (!/^pmi_[\da-f]{32}$/.test(id)) return res.status(404).json({ error: "Published indicator not found" });
    try { await registry.mutate(REGISTRY_OWNER, value => {
      const item = value.indicatorPublications?.find(p => p.id === id);
      if (!item || item.publisher !== owner) throw Error("Only the publishing wallet can remove this package");
      value.indicatorPublications = value.indicatorPublications!.filter(p => p.id !== id);
    }); } catch (error) { return res.status(403).json({ error: error instanceof Error ? error.message : "Removal not allowed" }); }
    return res.json({ removed: true, id });
  }));
  return router;
}
