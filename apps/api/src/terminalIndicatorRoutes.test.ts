import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createIndicatorPackage, parseIndicatorPackage } from "@pulse/domain";
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
    const initial = await (await request()).json(); assert.equal(initial.items.length, 2); assert.equal(initial.items[0].publisher, null);
    const seed = await (await request("/pulse.executed-cvd")).json(); assert.equal(parseIndicatorPackage(seed.manifest).kernel, "executed-cvd-v1");
    const manifest = createIndicatorPackage({ id: "alice.flow", title: "Alice Flow", description: "A reusable executed-volume calculation.", author: "Alice", kernel: "executed-cvd-v1" });
    const published = await request("", "POST", { manifest }); assert.equal(published.status, 201); const item = (await published.json()).item;
    assert.equal(item.publisher, owner); assert.equal(item.canDelete, true); assert.equal(item.packageRef, undefined); assert.equal(item.publication.registered, false);
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
