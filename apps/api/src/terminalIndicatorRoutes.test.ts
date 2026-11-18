import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import { createGraphIndicatorPackage, createIndicatorPackage, exportIndicatorPackage, parseIndicatorPackage } from "@pulse/domain";
import { MemoryTerminalStorage, TerminalStore } from "./terminalStore.js";
import { createTerminalIndicatorRoutes } from "./terminalIndicatorRoutes.js";

test("Indicator catalog publishes immutable portable versions without exposing workspace data", async () => {
  const owner = "0x" + "11".repeat(20), other = "0x" + "22".repeat(20);
  class JsonDecodingStorage extends MemoryTerminalStorage {
    packageWrites = 0;
    override async write(key: string, value: unknown, ttl: number) {
      if (key.includes(":terminal:package:")) this.packageWrites++;
      return super.write(key, value, ttl);
    }
    override async read<T>(key: string): Promise<T | null> {
      const value = await super.read<unknown>(key);
      return (typeof value === "string" ? JSON.parse(value) : value) as T | null;
    }
  }
  const store = new TerminalStore(new JsonDecodingStorage(), "indicator-test", 180);
  await store.mutate(owner, value => { value.answers = [{ id: "private-answer", instId: "BTC-USDT", timeframe: "1H", question: "private", answer: "secret-journal-detail", sources: [], at: new Date().toISOString() }]; });
  const app = express(); app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => { res.locals.terminalOwner = req.headers["x-test-owner"]; next(); });
  app.use(createTerminalIndicatorRoutes({ store, now: Date.now }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/terminal/indicators`;
  const request = (path = "", method = "GET", body?: unknown, user: string | null = owner) => fetch(base + path, { method, headers: { "content-type": "application/json", ...(user ? { "x-test-owner": user } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await request("", "GET", undefined, null)).status, 401);
    const initial = await (await request()).json(); assert.equal(initial.items.length, 3); assert.equal(initial.items[0].publisher, null);
    assert.deepEqual(initial.items.map((item: any) => item.registration?.circuitId), ["1", "2", "3"]);
    assert(initial.items.every((item: any) => item.publication.registered === true && item.registration.blockHash && item.registration.vectorCount === 6));
    const seed = await (await request("/pulse.executed-cvd")).json(); assert.equal(parseIndicatorPackage(seed.manifest).kernel, "executed-cvd-v1");
    const manifest = createIndicatorPackage({ id: "alice.flow", title: "Alice Flow", description: "A reusable executed-volume calculation.", author: "Alice", kernel: "executed-cvd-v1" });
    const published = await request("", "POST", { manifest }); assert.equal(published.status, 201); const item = (await published.json()).item;
    assert.equal(item.calculation, "nand"); assert.equal(item.publisher, owner); assert.equal(item.canDelete, true); assert.equal(item.packageRef, undefined); assert.equal(item.publication.registered, false);
    assert.equal((await request("", "POST", { manifest })).status, 200);
    assert.equal((await request("", "POST", { manifest: { ...manifest, title: "Changed title" } })).status, 409);
    assert.equal((await request("", "POST", { manifest: { ...manifest, publication: { chainId: 196, registered: true } } })).status, 400);
    assert.equal((await request("", "POST", { manifest: { ...manifest, id: "pulse.fake" } })).status, 400);
    const loaded = await (await request(`/${item.id}`, "GET", undefined, other)).json(); assert.deepEqual(loaded.manifest, manifest); assert.equal(loaded.item.canDelete, false);
    const catalog = await (await request()).text(); assert(!catalog.includes("secret-journal-detail")); assert(!catalog.includes("private-answer"));
    assert.equal((await request(`/${item.id}`, "DELETE", undefined, other)).status, 403);
    assert.equal((await request(`/${item.id}`, "DELETE")).status, 200); assert.equal((await request(`/${item.id}`)).status, 404);
    // Concurrent distinct versions must not lose a catalog entry under CAS retries.
    const versions = ["2.0.0", "3.0.0", "4.0.0"].map(version => ({ ...manifest, version }));
    const responses = await Promise.all(versions.map(manifest => request("", "POST", { manifest }))); assert(responses.every(r => r.status === 201));
    assert.equal((await (await request()).json()).items.filter((i: { hosted: boolean }) => i.hosted).length, 3);
    const registry = new TerminalStore(store.storage, store.key("indicator-registry", "v1"), 365);
    await registry.mutate("0x" + "0".repeat(40), value => {
      const items = value.indicatorPublications!;
      value.indicatorPublications = [...items, ...Array.from({ length: 17 }, (_, i) => ({ ...items[0], id: `quota-${i}` }))];
    });
    const before = (store.storage as JsonDecodingStorage).packageWrites;
    assert.equal((await request("", "POST", { manifest: { ...manifest, version: "100.0.0" } })).status, 409);
    assert.equal((store.storage as JsonDecodingStorage).packageWrites, before, "Quota rejection must precede package-blob storage");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("legacy catalog runtime is derived only from checksum-validated package bytes and one bad item cannot break discovery", async () => {
  const owner = "0x" + "33".repeat(20), digest = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
  class CountingStorage extends MemoryTerminalStorage {
    packageReads = 0;
    override async read<T>(key: string): Promise<T | null> {
      if (key.includes(":terminal:package:")) this.packageReads++;
      return super.read<T>(key);
    }
  }
  const storage = new CountingStorage(), store = new TerminalStore(storage, "legacy-indicator-test", 180);
  const registry = new TerminalStore(storage, store.key("indicator-registry", "v1"), 365);
  const manifest = createGraphIndicatorPackage({
    id: "maxim.flow",
    title: "Actual graph package",
    description: "Kernel graph package used to verify legacy runtime derivation.",
    author: "Maxim",
    graph: {
      nodes: [
        { id: "buy", kind: "source", field: "buy" },
        { id: "sell", kind: "source", field: "sell" },
        { id: "delta", kind: "kernel", buy: "buy", sell: "sell" },
      ],
      plots: [{ id: "flow", node: "delta", label: "Flow", pane: "indicator", style: "line", unit: "volume", color: "#42a5f5" }],
      gapPolicy: "reset",
      warmup: "full-window",
    },
  });
  const validBytes = exportIndicatorPackage(manifest), validSha = digest(validBytes);
  const badChecksumBytes = "{\"not\":\"a manifest\"}", badParseBytes = "not-json";
  const badParseSha = digest(badParseBytes);
  const legacy = [
    { id: "pmi_" + "a".repeat(32), manifestId: manifest.id, version: manifest.version, title: "Old Maxim listing", description: "Legacy listing without stored calculation.", author: "Maxim", kernel: "executed-cvd-v1", publisher: owner, createdAt: "2026-01-01T00:00:00.000Z", sha256: validSha, packageRef: validSha, offer: { priceUsdc: "0.25" } },
    { id: "pmi_" + "b".repeat(32), manifestId: "maxim.bad-checksum", version: "1.0.0", title: "Hybrid runtime unavailable", description: "Bytes do not match this listing checksum.", author: "Maxim", kernel: "formula-v1", publisher: owner, createdAt: "2026-01-02T00:00:00.000Z", sha256: validSha, packageRef: "bad-checksum", offer: { priceUsdc: "0.50" }, calculation: "invalid-legacy-value" },
    { id: "pmi_" + "c".repeat(32), manifestId: "maxim.unparseable", version: "1.0.0", title: "Host runtime unavailable", description: "Bytes are checksummed but not a valid package.", author: "Maxim", kernel: "formula-v1", publisher: owner, createdAt: "2026-01-03T00:00:00.000Z", sha256: badParseSha, packageRef: badParseSha, offer: { priceUsdc: "0.75" } },
  ];
  legacy.push(...Array.from({ length: 98 }, (_, i) => ({
    id: "pmi_" + (i + 1).toString(16).padStart(32, "0"), manifestId: `maxim.legacy-${i}`, version: "1.0.0",
    title: "Legacy package", description: "No stored calculation or package bytes.", author: "Maxim", kernel: "formula-v1",
    publisher: owner, createdAt: "2026-01-04T00:00:00.000Z", sha256: "0".repeat(64), packageRef: `missing-${i}`,
  })) as any);
  await storage.write(registry.key("package", validSha), { bytes: validBytes }, 3600);
  await storage.write(registry.key("package", "bad-checksum"), { bytes: badChecksumBytes }, 3600);
  await storage.write(registry.key("package", badParseSha), { bytes: badParseBytes }, 3600);
  await registry.mutate("0x" + "0".repeat(40), value => { value.indicatorPublications = legacy as any; });

  const app = express(); app.use(express.json());
  app.use((_req, res, next) => { res.locals.terminalOwner = owner; next(); });
  app.use(createTerminalIndicatorRoutes({ store, now: Date.now }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/terminal/indicators`;
  try {
    const response = await fetch(base), payload = await response.json() as { items: Array<Record<string, any>> };
    assert.equal(response.status, 200, "bad legacy bytes must not fail the catalog request");
    assert.equal(payload.items.length, 104, "unexpectedly over-limit legacy rows remain visible");
    const byId = new Map(payload.items.map(item => [item.id, item]));
    const derived = byId.get(legacy[0].id)!;
    assert.equal(derived.calculation, "hybrid", "runtime comes from parsed graph nodes, not stale catalog title/kernel fields");
    assert.equal(derived.sha256, validSha); assert.equal(derived.offer.priceUsdc, "0.25"); assert.equal(derived.packageRef, undefined);
    assert.equal(byId.get(legacy[1].id)!.calculation, undefined, "checksum mismatch remains unavailable");
    assert.equal(byId.get(legacy[2].id)!.calculation, undefined, "checksummed but invalid package remains unavailable");
    assert.equal(byId.get(legacy.at(-1)!.id)!.calculation, undefined);
    assert.equal(storage.packageReads, 100, "fallback reads are capped at the published catalog maximum per request");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
