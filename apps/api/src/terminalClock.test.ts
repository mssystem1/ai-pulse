import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "@pulse/config";
import { createTerminalRoutes } from "./terminalRoutes.js";
import { grantTerminalPass, MemoryTerminalStorage, TerminalStore } from "./terminalStore.js";

const signer = privateKeyToAccount(`0x${"11".repeat(32)}`), OWNER = signer.address.toLowerCase();
const BORN = Date.parse("2026-11-04T12:00:00Z"), MINUTE = 60_000, DAY = 86_400_000;

/** A synthetic paid-pass ledger and loopback API only; no settlement or source calls. */
test("Terminal pass clocks use one server instant after asynchronous reads and renewals", async t => {
  let now = BORN, recipientAdvance = 0;
  class ReadClockStore extends TerminalStore {
    readAdvance = 0;
    override async get(owner: string) {
      const value = await super.get(owner);
      await Promise.resolve(); now += this.readAdvance; this.readAdvance = 0;
      return value;
    }
  }
  const state = new ReadClockStore(new MemoryTerminalStorage(), `terminal-clock-${Math.random()}`, 180);
  const purchase = (id: string, purchasedAt: number) => ({ requestId: id, duration: "24h" as const, priceUsd: "1.5", amountAtomic: "1500000", network: "base", asset: `0x${"33".repeat(20)}`, paymentId: id, purchasedAt: new Date(purchasedAt).toISOString(), simulated: true });
  await state.mutate(OWNER, value => { grantTerminalPass(value, purchase("clock_initial_pass", BORN - DAY + MINUTE)); });
  const cfg = { ...loadConfig(), NODE_ENV: "test" as const, FEATURE_TRADING_TERMINAL: true, FEATURE_TELEGRAM: true, X402_MOCK: true, QUEUE_PROVIDER: "memory" as const, STORAGE_PROVIDER: "memory" as const };
  const routes = createTerminalRoutes(cfg, { store: state, now: () => now, telegramRecipient: async () => { await Promise.resolve(); now += recipientAdvance; recipientAdvance = 0; return 123; } });
  const app = express(); app.use(express.json()); app.use(routes.publicRouter); app.use(routes.beforePayment);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/terminal`;
  const signIn = async () => {
    const challengeResponse = await fetch(`${base}/auth/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: OWNER }) });
    const challenge = await challengeResponse.json() as { challengeId: string; message: string };
    const response = await fetch(`${base}/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId: challenge.challengeId, signature: await signer.signMessage({ message: challenge.message }) }) });
    assert.equal(response.status, 200); return (await response.json() as { token: string }).token;
  };
  type ClockResponse = { serverNow: number; active?: boolean; expiresAt?: string; access?: { active: boolean; expiresAt: string }; grants: unknown[] };
  const read = async (path: "workspace" | "access", token: string) => {
    const response = await fetch(`${base}/${path}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
    return await response.json() as ClockResponse;
  };
  try {
    let token = await signIn();
    await t.test("workspace and access expose the authoritative remaining lifetime without mutating storage", async () => {
      const before = await state.get(OWNER), workspace = await read("workspace", token), access = await read("access", token);
      assert.equal(workspace.serverNow, BORN); assert.equal(access.serverNow, BORN);
      assert.equal(workspace.access!.active, true); assert.equal(access.active, true);
      assert.equal(workspace.access!.expiresAt, new Date(BORN + MINUTE).toISOString()); assert.equal(access.expiresAt, workspace.access!.expiresAt);
      assert.equal(Date.parse(access.expiresAt!) - access.serverNow, MINUTE);
      const after = await state.get(OWNER); assert.deepEqual(after, before); assert.equal("serverNow" in after, false);
    });
    await t.test("workspace samples after recipient lookup and consistently reports expiry crossed while awaiting it", async () => {
      now = BORN + MINUTE - 5; recipientAdvance = 10;
      const before = await state.get(OWNER), workspace = await read("workspace", token);
      assert.equal(workspace.serverNow, BORN + MINUTE + 5); assert.equal(workspace.access!.active, false);
      assert.ok(Date.parse(workspace.access!.expiresAt) <= workspace.serverNow);
      assert.deepEqual(await state.get(OWNER), before, "Crossing expiry only changes the projection, not the paid grant");
    });
    await t.test("access samples after its store read and turns inactive at the exact expiry instant", async () => {
      now = BORN + MINUTE - 1; state.readAdvance = 1;
      const access = await read("access", token);
      assert.equal(access.serverNow, BORN + MINUTE); assert.equal(access.active, false);
      assert.equal(Date.parse(access.expiresAt!) - access.serverNow, 0);
    });
    await t.test("an active renewal stacks from the previous expiry and its replay never extends it twice", async () => {
      now = BORN + MINUTE - 1;
      const renewal = purchase("clock_stacked_renewal", now);
      await state.mutate(OWNER, value => { grantTerminalPass(value, renewal); });
      const stacked = await state.get(OWNER), latest = stacked.grants.at(-1)!;
      assert.equal(latest.startsAt, new Date(BORN + MINUTE).toISOString()); assert.equal(latest.expiresAt, new Date(BORN + MINUTE + DAY).toISOString());
      await state.mutate(OWNER, value => { grantTerminalPass(value, renewal); });
      const access = await read("access", token), workspace = await read("workspace", token);
      assert.equal(access.serverNow, now); assert.equal(access.active, true); assert.equal(access.expiresAt, latest.expiresAt);
      assert.equal(workspace.access!.expiresAt, latest.expiresAt); assert.equal(workspace.access!.active, true); assert.equal(workspace.grants.length, 2);
      assert.equal(Date.parse(access.expiresAt!) - access.serverNow, DAY + 1);
      now += 2;
      const pastFirstExpiry = await read("access", token); assert.equal(pastFirstExpiry.active, true); assert.equal(pastFirstExpiry.expiresAt, latest.expiresAt);
    });
    await t.test("renewal after all access expires starts at purchase time and restores one full paid period", async () => {
      now = BORN + MINUTE + DAY + MINUTE; token = await signIn();
      const expired = await read("access", token); assert.equal(expired.active, false); assert.equal(expired.serverNow, now);
      const renewal = purchase("clock_after_expiry_renewal", now);
      await state.mutate(OWNER, value => { grantTerminalPass(value, renewal); });
      const access = await read("access", token), workspace = await read("workspace", token), saved = await state.get(OWNER), latest = saved.grants.at(-1)!;
      assert.equal(latest.startsAt, new Date(now).toISOString()); assert.equal(latest.expiresAt, new Date(now + DAY).toISOString());
      assert.equal(access.active, true); assert.equal(access.serverNow, now); assert.equal(Date.parse(access.expiresAt!) - access.serverNow, DAY);
      assert.equal(workspace.serverNow, access.serverNow); assert.equal(workspace.access!.expiresAt, access.expiresAt); assert.equal(workspace.access!.active, true);
      assert.equal(saved.grants.length, 3); assert.equal("serverNow" in saved, false);
    });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
