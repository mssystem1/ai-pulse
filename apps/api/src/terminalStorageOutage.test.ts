import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "@pulse/config";
import { createTerminalRoutes } from "./terminalRoutes.js";
import { MemoryTerminalStorage, TerminalStore } from "./terminalStore.js";
import { isKvUnavailableError, KvUnavailableError } from "./resilientKv.js";

test("known Terminal storage outage disables checkout without a storage probe and verify never mislabels it as a bad signature", async () => {
  const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
  let available = true, reads = 0, writes = 0, failure = "";
  class Storage extends MemoryTerminalStorage {
    availability() { return { available, retryAfterSeconds: available ? 0 : 120 }; }
    override async read<T>(key: string) { reads++; return super.read<T>(key); }
    override async write(key: string, value: unknown, ttl: number) { writes++; if (failure === "session" && key.includes(":session:")) throw new KvUnavailableError("private transport detail", 120); return super.write(key, value, ttl); }
    override async take<T>(key: string) { if (failure === "challenge") throw new KvUnavailableError("private transport detail", 120); return super.take<T>(key); }
  }
  const cfg = { ...loadConfig(), NODE_ENV: "test" as const, FEATURE_TRADING_TERMINAL: true, FEATURE_TELEGRAM: false, TERMINAL_BACKGROUND_PAUSED: true, QUEUE_PROVIDER: "memory" as const, STORAGE_PROVIDER: "memory" as const };
  const routes = createTerminalRoutes(cfg, { store: new TerminalStore(new Storage(), "outage-test", 180) });
  const app = express(); app.use(express.json()); app.use(routes.publicRouter);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    assert(isKvUnavailableError(error)); res.status(503).json({ code: error.code, recoverable: true });
  });
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, body: unknown) => fetch(origin + "/v1/terminal/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    for (const state of [false, true]) {
      available = state; const before = { reads, writes };
      const response = await fetch(origin + "/v1/terminal/catalog"), data = await response.json();
      assert.equal(data.available, state); assert.deepEqual({ reads, writes }, before, "Catalog status must not spend a Redis command");
      if (!state) { assert.equal(response.headers.get("retry-after"), "120"); assert.match(data.reason, /local indicator drafts/i); }
    }
    for (const stage of ["challenge", "session"]) {
      failure = "";
      const challenge = await (await post("auth/challenge", { wallet: signer.address })).json();
      failure = stage;
      const response = await post("auth/verify", { challengeId: challenge.challengeId, signature: await signer.signMessage({ message: challenge.message }) });
      assert.equal(response.status, 503, `${stage} storage loss must not return 401`);
      assert.equal((await response.json()).code, "KV_TEMPORARILY_UNAVAILABLE");
    }
    failure = "";
    const invalid = await post("auth/verify", { challengeId: "absent-but-valid-shaped-id", signature: `0x${"11".repeat(65)}` });
    assert.equal(invalid.status, 401);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
