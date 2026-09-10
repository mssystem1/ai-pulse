import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { closeNativeRedisConnections, runNativeRedisCommand } from "./nativeRedis.js";
import { resetKvCircuitForTests, runKvCommand } from "./resilientKv.js";
import { StoreRedis } from "./storeRedis.js";

// A local RESP fixture tests actual TCP framing, pool lifecycle and disconnect
// behaviour. It does not emulate Lua: Lua integration needs a real Redis server.
async function respFixture(t: TestContext, handler: (args: string[], socket: Socket) => boolean) {
  const sockets = new Set<Socket>();
  let connectionCount = 0;
  const server = createServer(socket => {
    connectionCount++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length) {
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const count = Number(buffer.subarray(1, end).toString());
        let offset = end + 2;
        const args: string[] = [];
        for (let i = 0; i < count; i++) {
          const line = buffer.indexOf("\r\n", offset);
          if (line < 0) return;
          const size = Number(buffer.subarray(offset + 1, line).toString());
          offset = line + 2;
          if (buffer.length < offset + size + 2) return;
          args.push(buffer.subarray(offset, offset + size).toString());
          offset += size + 2;
        }
        buffer = buffer.subarray(offset);
        if (handler(args, socket)) continue;
        if (args[0].toUpperCase() === "INFO") bulk(socket, "loading:0\r\nredis_version:7.2.0\r\n");
        else socket.write("+OK\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  t.after(async () => {
    closeNativeRedisConnections(); resetKvCircuitForTests();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return { url: `redis://default:fixture-secret@127.0.0.1:${address.port}`, connectionCount: () => connectionCount };
}
function bulk(socket: Socket, value: string | null) {
  socket.write(value === null ? "$-1\r\n" : `$${Buffer.byteLength(value)}\r\n${value}\r\n`);
}

test("native TCP connection is shared and JSON/raw strings remain compatible", async t => {
  const values = new Map<string, string>();
  const fixture = await respFixture(t, (args, socket) => {
    if (args[0].toUpperCase() === "SET") { values.set(args[1], args[2]); socket.write("+OK\r\n"); return true; }
    if (args[0].toUpperCase() === "GET") { bulk(socket, values.get(args[1]) ?? null); return true; }
    return false;
  });
  const store = new StoreRedis(fixture.url);
  await Promise.all(Array.from({ length: 8 }, (_, i) => store.set(`key:${i}`, { symbol: "ETH", note: "中文", count: i })));
  assert.equal(fixture.connectionCount(), 1);
  assert.deepEqual(await store.get("key:3"), { symbol: "ETH", note: "中文", count: 3 });
  assert.equal(await runNativeRedisCommand(fixture.url, ["GET", "key:3"]), '{"symbol":"ETH","note":"中文","count":3}');
  assert.equal(await store.get("missing"), null);
});

test("a write whose response is lost is sent once, not replayed after reconnect", async t => {
  let writes = 0;
  const fixture = await respFixture(t, (args, socket) => {
    if (args[0].toUpperCase() === "INCR") { writes++; socket.destroy(); return true; }
    return false;
  });
  await assert.rejects(runKvCommand(["INCR", "counter"], "test", { provider: "redis", url: fixture.url }));
  assert.equal(writes, 1);
  assert.equal(fixture.connectionCount(), 1);
});

test("authentication failure never exposes credentials or calls Upstash", async t => {
  const fixture = await respFixture(t, (args, socket) => {
    if (args[0].toUpperCase() === "AUTH") { socket.write("-WRONGPASS invalid username-password pair\r\n"); return true; }
    return false;
  });
  let restCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { restCalls++; throw new Error("unexpected REST fallback"); }) as typeof fetch;
  try {
    await assert.rejects(runKvCommand(["GET", "key"], "test", { provider: "redis", url: fixture.url }), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /authentication/);
      assert.equal(error.message.includes("fixture-secret"), false);
      return true;
    });
    assert.equal(restCalls, 0);
  } finally { globalThis.fetch = original; }
});
