import { Router } from "express";
import { createHash } from "node:crypto";
import { indicatorMarketCatalog, parseIndicatorPackage, exportIndicatorPackage } from "@pulse/domain";
import type { TerminalRuntime } from "./terminalRuntime.js";
import { TerminalStore, type TerminalIndicatorPublication } from "./terminalStore.js";
import { asyncRoute } from "./httpResilience.js";

const REGISTRY_OWNER = "0x" + "0".repeat(40), TTL = 365 * 86400;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
/** Shared catalog holds only intentionally published packages, never journals,
 * report evidence, authentication tokens or private workspace records. */
export function createTerminalIndicatorRoutes(runtime: Pick<TerminalRuntime, "store" | "now">) {
  const router = Router(), registry = new TerminalStore(runtime.store.storage, runtime.store.key("indicator-registry", "v1"), 365);
  const seeds = indicatorMarketCatalog();
  const summary = (item: TerminalIndicatorPublication, owner: string) => ({ ...Object.fromEntries(Object.entries(item).filter(([key]) => key !== "packageRef")), canDelete: item.publisher === owner, hosted: true, publication: { chainId: 196, registered: false } });
  const seedSummary = (m: typeof seeds[number]) => ({ id: m.id, manifestId: m.id, version: m.version, title: m.title, description: m.description, author: m.author, kernel: m.kernel, publisher: null, createdAt: null, canDelete: false, hosted: false, publication: m.publication });
  router.use("/v1/terminal/indicators", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); if (!/^0x[\da-f]{40}$/i.test(res.locals.terminalOwner ?? "")) return res.status(401).json({ error: "Sign in to your wallet workspace first" }); next(); });
  router.get("/v1/terminal/indicators", asyncRoute(async (_req, res) => {
    const items = (await registry.get(REGISTRY_OWNER)).indicatorPublications ?? [];
    res.json({ version: "pulse-indicator-catalog-v1", items: [...seeds.map(seedSummary), ...items.map(item => summary(item, res.locals.terminalOwner))], limits: { total: 100, perPublisher: 20 }, hosting: "PULSE catalog; portable local TAP-02 packages, not an onchain registry" });
  }));
  router.get("/v1/terminal/indicators/:id", asyncRoute(async (req, res) => {
    const id = String(req.params.id), seed = seeds.find(m => m.id === id);
    if (seed) return res.json({ item: seedSummary(seed), manifest: seed });
    if (!/^pmi_[\da-f]{32}$/.test(id)) return res.status(404).json({ error: "Indicator not found" });
    const item = (await registry.get(REGISTRY_OWNER)).indicatorPublications?.find(item => item.id === id);
    if (!item) return res.status(404).json({ error: "Indicator not found" });
    const stored = await registry.storage.read<{ bytes: string }>(registry.key("package", item.packageRef));
    const bytes = typeof stored?.bytes === "string" ? stored.bytes : null;
    if (!bytes || digest(bytes) !== item.sha256) return res.status(503).json({ error: "Published package could not be verified. Import its original export or contact its publisher." });
    return res.json({ item: summary(item, res.locals.terminalOwner), manifest: parseIndicatorPackage(bytes) });
  }));
  router.post("/v1/terminal/indicators", asyncRoute(async (req, res) => {
    if (!req.body || Object.keys(req.body).join() !== "manifest") return res.status(400).json({ error: "Provide one portable indicator manifest" });
    let manifest;
    try { manifest = parseIndicatorPackage(req.body.manifest); } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid indicator package" }); }
    if (manifest.id.startsWith("pulse.")) return res.status(400).json({ error: "Choose your own package ID; pulse.* is reserved for built-in tools" });
    const publisher = String(res.locals.terminalOwner).toLowerCase(), bytes = exportIndicatorPackage(manifest), sha256 = digest(bytes);
    const item: TerminalIndicatorPublication = { id: "pmi_" + digest(publisher + ":" + manifest.id + ":" + manifest.version).slice(0, 32), manifestId: manifest.id, version: manifest.version, title: manifest.title, description: manifest.description, author: manifest.author, kernel: manifest.kernel, publisher, createdAt: new Date(runtime.now()).toISOString(), sha256, packageRef: sha256 };
    const current = (await registry.get(REGISTRY_OWNER)).indicatorPublications ?? [], prior = current.find(p => p.id === item.id);
    if (prior && prior.sha256 !== sha256) return res.status(409).json({ error: "This version is already published with different content; increase its version" });
    // Reject known excess before writing package bytes. CAS below repeats these
    // checks to protect concurrent publishers from overwriting catalog entries.
    if (!prior && (current.length >= 100 || current.filter(p => p.publisher === publisher).length >= 20)) return res.status(409).json({ error: "Indicator catalog publication limit reached" });
    // Redis adapters decode top-level JSON strings. Wrap exact bytes so their
    // representation and checksum survive both memory and durable adapters.
    await registry.storage.write(registry.key("package", item.packageRef), { bytes }, TTL);
    let duplicate = false, storedItem = item;
    try { await registry.mutate(REGISTRY_OWNER, value => {
      const items = value.indicatorPublications ?? [], prior = items.find(p => p.id === item.id);
      if (prior) { if (prior.sha256 !== sha256) throw Error("This version is already published with different content; increase its version"); duplicate = true; storedItem = prior; return false; }
      if (items.length >= 100 || items.filter(p => p.publisher === publisher).length >= 20) throw Error("Indicator catalog publication limit reached");
      value.indicatorPublications = [...items, item];
    }); } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "Catalog changed. Retry publishing." }); }
    return res.status(duplicate ? 200 : 201).json({ item: summary(storedItem, publisher), manifest });
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
