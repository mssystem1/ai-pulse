import assert from "node:assert/strict";
import test from "node:test";
import { createRecoverableRobinhoodFetch } from "./robinhoodPaymentRecovery.js";
import { readJobRecovery } from "./jobRecovery.js";

const url = "https://pulse.example/robinhood/v1/analysis/spot/standard";
const init = { method: "POST", headers: { "Content-Type": "application/json", "X-Request-Test": "preserved" }, body: JSON.stringify({ instId: "ETH-USDT", timeframe: "1H" }) };
class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
function fixture() {
  const storage = new MemoryStorage();
  let signs = 0;
  let pending = true;
  let crash = false;
  let queue = Promise.resolve();
  const submitted: string[] = [];
  const deps = {
    storage,
    exclusive: async <T>(_key: string, run: () => Promise<T>): Promise<T> => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try { return await run(); } finally { release(); }
    },
    sign: async () => ({ "PAYMENT-SIGNATURE": `fixture-${++signs}` }),
    fetch: (async (input: RequestInfo | URL) => {
      const request = new Request(input);
      const signature = request.headers.get("PAYMENT-SIGNATURE");
      assert.equal(request.headers.get("X-Request-Test"), "preserved");
      if (!signature) return Response.json({}, { status: 402 });
      assert.ok([...storage.data.values()].some(value => value.includes(signature)), "persist before submitting");
      submitted.push(signature);
      if (crash) throw new Error("Connection lost");
      if (pending) return Response.json({ retrySamePayment: true }, { status: 503 });
      return Response.json({ job: { id: "11111111-1111-1111-1111-111111111111" }, recoveryToken: "r".repeat(40) },
        { status: 202, headers: { "PAYMENT-RESPONSE": "fixture-receipt" } });
    }) as typeof fetch,
  };
  return { storage, deps, submitted, signs: () => signs, deliver: () => { pending = false; }, crash: () => { crash = true; },
    client: (wallet = "0x1111111111111111111111111111111111111111") => createRecoverableRobinhoodFetch(wallet, deps) };
}

test("reload retries the original authorization and saves job recovery before releasing the payment fence", async () => {
  const f = fixture();
  assert.equal((await f.client()(url, init)).status, 503);
  f.deliver();
  assert.equal((await f.client()(url, init)).status, 202);
  assert.equal(f.signs(), 1);
  assert.deepEqual(f.submitted, ["fixture-1", "fixture-1"]);
  assert.equal(readJobRecovery(f.storage, "robinhood", "spot")?.jobId, "11111111-1111-1111-1111-111111111111");
});
test("network failures retain the same payment; a second click does not sign again", async () => {
  const f = fixture(); f.crash();
  await assert.rejects(f.client()(url, init), /Connection lost/);
  await assert.rejects(f.client()(url, init), /Connection lost/);
  assert.equal(f.signs(), 1);
});
test("concurrent tabs serialize and successful double clicks reuse the same authorization", async () => {
  const f = fixture(); f.deliver();
  await Promise.all([f.client()(url, init), f.client()(url, init)]);
  assert.equal(f.signs(), 1);
  assert.deepEqual(f.submitted, ["fixture-1", "fixture-1"]);
});
test("changed parameters cannot silently start a second payment while the first is uncertain", async () => {
  const f = fixture(); await f.client()(url, init);
  await assert.rejects(f.client()(url, { ...init, body: JSON.stringify({ instId: "BTC-USDT" }) }), /Restore your original selection/);
  assert.equal(f.signs(), 1);
});
test("JSON key order and trailing slash do not lose an existing payment", async () => {
  const f = fixture(); await f.client()(url, init);
  await f.client()(`${url}/`, { ...init, body: JSON.stringify({ timeframe: "1H", instId: "ETH-USDT" }) });
  assert.equal(f.signs(), 1);
});
test("storage blocked fails before signing or submitting", async () => {
  const f = fixture(); f.storage.setItem = () => { throw new Error("Storage blocked"); };
  await assert.rejects(f.client()(url, init), /Storage blocked/);
  assert.equal(f.signs(), 0); assert.equal(f.submitted.length, 0);
});
test("corrupt recovery is not discarded to make a fresh charge", async () => {
  const f = fixture(); await f.client()(url, init);
  const key = [...f.storage.data.keys()].find(key => key.startsWith("pulse:pending-payment:"))!;
  f.storage.setItem(key, "invalid");
  await assert.rejects(f.client()(url, init), /Do not pay again/);
  assert.equal(f.signs(), 1);
});
test("wallets are isolated; completed delivery allows a different report", async () => {
  const f = fixture(); await f.client()(url, init);
  await f.client("0x2222222222222222222222222222222222222222")(url, init);
  assert.equal(f.signs(), 2);
  f.deliver(); await f.client()(url, init);
  await f.client()(url, { ...init, body: JSON.stringify({ instId: "BTC-USDT" }) });
  assert.equal(f.signs(), 3);
});

const passUrl = "https://pulse.example/robinhood/v1/autopilot/pass/24h";
const owner = "0x1111111111111111111111111111111111111111";
const vault1 = "0x2222222222222222222222222222222222222222";
const vault2 = "0x3333333333333333333333333333333333333333";
function passFixture() {
  const f = fixture();
  const submissions: Array<{ vault: string; signature: string }> = [];
  let pending = false;
  f.deps.fetch = (async (input: RequestInfo | URL) => {
    const req = new Request(input);
    if (req.method === "GET") return Response.json({ strategies: [{ vault: vault1 }] });
    const body = await req.json();
    const signature = req.headers.get("PAYMENT-SIGNATURE");
    if (!signature) return Response.json({}, { status: 402 });
    submissions.push({ vault: body.vault, signature });
    if (pending) return Response.json({ retrySamePayment: true }, { status: 503 });
    return Response.json({ aiPass: { owner, network: "robinhood", vault: body.vault, purchasedAt: "2026-10-04T08:00:00Z", expiresAt: "2026-10-05T08:00:00Z" } },
      { status: 201, headers: { "PAYMENT-RESPONSE": "receipt" } });
  }) as typeof fetch;
  const buy = (vault: string) => f.client()(passUrl, { method: "POST", body: JSON.stringify({ owner, vault }) });
  return { ...f, submissions, buy, pending: () => { pending = true; } };
}
test("successful passes release the service fence for a second vault while double clicks reuse payment", async () => {
  const f = passFixture();
  await f.buy(vault1); await f.buy(vault1);
  assert.equal(f.signs(), 1);
  await f.buy(vault2);
  assert.equal(f.signs(), 2);
  assert.equal([...f.storage.data.keys()].filter(key => key.includes(":receipt:")).length, 2);
});
test("legacy completed pass recovers its original vault before buying for another", async () => {
  const f = passFixture(); await f.buy(vault1);
  const key = [...f.storage.data.keys()].find(key => key.startsWith("pulse:pending-payment:") && !key.includes(":receipt:"))!;
  const legacy = JSON.parse(f.storage.getItem(key)!);
  delete legacy.recoveredAt; delete legacy.body; delete legacy.delivery;
  f.storage.setItem(key, JSON.stringify(legacy));
  await f.buy(vault2);
  assert.deepEqual(f.submissions, [{ vault: vault1, signature: "fixture-1" }, { vault: vault1, signature: "fixture-1" }, { vault: vault2, signature: "fixture-2" }]);
});
test("uncertain original pass replay blocks a different vault without a new signature", async () => {
  const f = passFixture(); f.pending(); await f.buy(vault1);
  await assert.rejects(f.buy(vault2), /Restore your original selection/);
  assert.equal(f.signs(), 1);
  assert.deepEqual(f.submissions.map(value => value.vault), [vault1, vault1]);
});
test("persisting a pass receipt must succeed before releasing its payment fence", async () => {
  const f = passFixture();
  const set = f.storage.setItem.bind(f.storage);
  f.storage.setItem = (key, value) => { if (key.includes(":receipt:")) throw new Error("Storage full"); set(key, value); };
  await assert.rejects(f.buy(vault1), /Storage full/);
  await assert.rejects(f.buy(vault2), /Storage full/);
  assert.equal(f.signs(), 1);
});
