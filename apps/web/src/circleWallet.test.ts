import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { connectCircleWallet, getCircleProvider, isCircleWalletConnected, restoreCircleWallet, type CircleWalletConnectionOptions } from "./circleWallet.js";

const SESSION_KEY = "pulse.circle.session.mainnet";
const address = `0x${"1".repeat(40)}`;
const wallet = { id: "mainnet-eoa", address, blockchain: "ARC", accountType: "EOA" };
const token = (name: string) => `offline-user-token-${name}`;

function storage(t: TestContext) {
  const values = new Map<string, string>();
  const before = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { hostname: "localhost", origin: "http://localhost:5173" },
    sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) },
    setTimeout: (callback: () => void) => { queueMicrotask(callback); return 0; },
  } });
  t.after(() => {
    getCircleProvider()?.disconnect?.();
    if (before) Object.defineProperty(globalThis, "window", before);
    else Reflect.deleteProperty(globalThis, "window");
  });
  return values;
}

function sdk(name: string, failInitialization = false): CircleWalletConnectionOptions {
  return { appId: "offline-public-app-id", createSdk(_appId, onLogin) {
    return {
      getDeviceId: async () => "offline-device-id",
      updateConfigs() {},
      verifyOtp() { onLogin(null, { userToken: token(name), encryptionKey: "offline-session-key", refreshToken: "offline-refresh-token" }); },
      execute(challengeId, callback) {
        if (failInitialization && challengeId === "initialize") callback?.(new Error("PIN challenge cancelled"), undefined);
        else callback?.(undefined, { type: "SIGN_MESSAGE", status: "COMPLETE", data: { signature: `offline-signature-${name}` } } as never);
      },
    };
  } };
}

function route(input: string | URL | Request) { return new URL(String(input)).pathname.replace("/v1/circle/wallet", ""); }
function defaultResponse(path: string) {
  if (path === "/status") return Response.json({ enabled: true });
  if (path === "/email/start") return Response.json({ deviceToken: "offline-device-token", deviceEncryptionKey: "offline-device-key", otpToken: "offline-otp-token" });
  if (path === "/wallets/initialize") return Response.json({ challengeId: "initialize" });
  if (path === "/wallets") return Response.json({ wallets: [wallet] });
  if (path === "/sign/message") return Response.json({ challengeId: "sign-message" });
  throw new Error(`Unexpected offline route ${path}`);
}

test("cancelled first-time Circle wallet initialization leaves no connected or persisted session", async t => {
  const values = storage(t);
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => defaultResponse(route(input)));
  await assert.rejects(connectCircleWallet("first@example.com", "arc", sdk("first", true)), /PIN challenge cancelled/);
  assert.equal(isCircleWalletConnected(), false);
  assert.equal(getCircleProvider(), null);
  assert.equal(values.has(SESSION_KEY), false);
});

test("OTP succeeds before wallet creation without committing an incomplete Circle connection", async t => {
  const values = storage(t);
  let release: ((response: Response) => void) | undefined;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  let started: (() => void) | undefined;
  const initializing = new Promise<void>(resolve => { started = resolve; });
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    if (route(input) === "/wallets/initialize") { started!(); return pending; }
    return defaultResponse(route(input));
  });
  const connection = connectCircleWallet("pending@example.com", "arc", sdk("pending"));
  await initializing;
  assert.equal(isCircleWalletConnected(), false);
  assert.equal(getCircleProvider(), null);
  assert.equal(values.has(SESSION_KEY), false);
  release!(Response.json({ error: "Initialization unavailable" }, { status: 502 }));
  await assert.rejects(connection, /Initialization unavailable/);
});

test("failed replacement login preserves the prior Circle wallet, SDK and authentication", async t => {
  const values = storage(t);
  const signedRequests: Array<{ token: string | null; walletId: string }> = [];
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const path = route(input);
    if (path === "/sign/message") signedRequests.push({ token: new Headers(init.headers).get("Authorization"), walletId: JSON.parse(String(init.body)).walletId });
    return defaultResponse(path);
  });
  await connectCircleWallet("original@example.com", "arc", sdk("original"));
  const saved = values.get(SESSION_KEY);
  await assert.rejects(connectCircleWallet("replacement@example.com", "arc", sdk("replacement", true)), /PIN challenge cancelled/);
  assert.equal(isCircleWalletConnected(), true);
  assert.equal(values.get(SESSION_KEY), saved);
  const provider = getCircleProvider()!;
  assert.equal(await provider.request({ method: "personal_sign", params: ["0x1234", address] }), "offline-signature-original");
  assert.deepEqual(signedRequests, [{ token: `Bearer ${token("original")}`, walletId: wallet.id }]);
});

test("returning testnet users create a mainnet EOA instead of selecting a testnet or smart-contract account", async t => {
  storage(t);
  let created = false;
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const path = route(input);
    if (path === "/wallets/initialize") return Response.json({ code: 155106, error: "User was initialized" }, { status: 502 });
    if (path === "/wallets/create-arc") {
      assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${token("returning")}`);
      created = true; return Response.json({ challengeId: "create-arc" });
    }
    if (path === "/wallets") return Response.json({ wallets: created ? [wallet] : [
      { ...wallet, blockchain: "ARC-TESTNET" }, { ...wallet, accountType: "SCA" }, { ...wallet, accountType: undefined },
    ] });
    return defaultResponse(path);
  });
  const connection = await connectCircleWallet("returning@example.com", "arc", sdk("returning"));
  assert.equal(created, true);
  assert.equal(connection.address, address);
  assert.equal(await connection.provider.request({ method: "eth_chainId" }), "0x13b2");
});

test("cached testnet and incompatible Circle accounts cannot restore a mainnet session", t => {
  const values = storage(t);
  for (const candidate of [{ ...wallet, blockchain: "ARC-TESTNET" }, { ...wallet, accountType: "SCA" }, { ...wallet, accountType: undefined }]) {
    values.set(SESSION_KEY, JSON.stringify({ userToken: "offline-session-token", encryptionKey: "offline-key", activeNetwork: "arc", wallets: [candidate] }));
    assert.equal(restoreCircleWallet(), null);
    assert.equal(isCircleWalletConnected(), false);
  }
});
