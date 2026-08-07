import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { API_BASE } from "./api";
import { WEB_NETWORKS, type WebNetworkKey } from "./networks";
import type { InjectedProvider } from "./wallet";

type CircleWallet = { id: string; address: string; blockchain: "ARC-TESTNET"; accountType?: string };
type CircleChallengeResult = { type: string; status: string; data?: { signature?: string; txHash?: string; signedTransaction?: string } };
type CircleSession = { userToken: string; encryptionKey: string; wallets: CircleWallet[]; activeNetwork: "arc-testnet" };
const SESSION_KEY = "pulse.circle.session";
const CIRCLE_NETWORK = "arc-testnet" as const;
let session: CircleSession | null = null;
let sdk: W3SSdk | null = null;

function appId(): string {
  const value = String((import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.VITE_CIRCLE_APP_ID || "").trim();
  if (!value) throw new Error("Circle email wallet is not configured: set VITE_CIRCLE_APP_ID");
  return value;
}

async function circleApi(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (session?.userToken) headers.set("Authorization", `Bearer ${session.userToken}`);
  const response = await fetch(`${API_BASE}/v1/circle/wallet${path}`, { ...init, headers, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = String(body.error || `Circle wallet request failed (${response.status})`);
    if (/smtp.*(?:not found|missing|config)/i.test(message)) {
      throw new Error("Circle email OTP is not configured yet. In Circle Console open Wallets → User Controlled → Configurator → Email, add SMTP credentials and send a test email, then retry.");
    }
    throw Object.assign(new Error(message), {
      code: typeof body.code === "number" ? body.code : Number(body.code) || undefined,
      status: response.status,
    });
  }
  return body;
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

async function listArcWallets(options: { waitForCreation?: boolean } = {}): Promise<CircleWallet[]> {
  const attempts = options.waitForCreation ? 12 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const listed = await circleApi("/wallets") as { wallets?: CircleWallet[] };
    const wallets = (listed.wallets || []).filter((wallet) => wallet.blockchain === "ARC-TESTNET" && wallet.accountType !== "SCA");
    if (wallets.length || attempt === attempts - 1) return wallets;
    await wait(1_000);
  }
  return [];
}

function execute(challengeId: string): Promise<CircleChallengeResult> {
  if (!sdk) throw new Error("Circle wallet SDK is not initialized");
  return new Promise((resolve, reject) => sdk!.execute(challengeId, (error, result) => error ? reject(error) : result ? resolve(result as CircleChallengeResult) : reject(new Error("Circle returned no challenge result"))));
}

function persist() {
  if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else window.sessionStorage.removeItem(SESSION_KEY);
}

function walletFor(key: WebNetworkKey): CircleWallet {
  if (key !== CIRCLE_NETWORK) throw new Error("Circle email wallet is available only on Arc Testnet in PULSE");
  const wallet = session?.wallets.find((item) => item.blockchain === "ARC-TESTNET");
  if (!wallet) throw new Error(`Circle EOA wallet is unavailable on ${WEB_NETWORKS[key].label}`);
  return wallet;
}

async function rpc(method: string, params: unknown[] = []) {
  if (!session) throw new Error("Circle wallet is disconnected");
  const network = WEB_NETWORKS[session.activeNetwork];
  const response = await fetch(network.rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || "Network RPC request failed");
  return body.result;
}

async function challenge(path: string, body: unknown) {
  const response = await circleApi(path, { method: "POST", body: JSON.stringify(body) });
  const challengeId = String(response.challengeId || "");
  if (!challengeId) throw new Error("Circle returned no signing challenge");
  return execute(challengeId);
}

async function executeContractTransaction(body: unknown): Promise<string> {
  const response = await circleApi("/transactions/contract-execution", { method: "POST", body: JSON.stringify(body) });
  const challengeId = String(response.challengeId || "");
  if (!challengeId) throw new Error("Circle returned no contract-execution challenge");
  await execute(challengeId);
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const status = await circleApi(`/transactions/contract-execution/${encodeURIComponent(challengeId)}`) as {
      challengeStatus?: string; transactionState?: string; txHash?: string; error?: string;
    };
    if (status.txHash) return status.txHash;
    if (["FAILED", "EXPIRED"].includes(String(status.challengeStatus))) throw new Error(status.error || `Circle challenge ${String(status.challengeStatus).toLowerCase()}`);
    if (["FAILED", "DENIED", "CANCELLED", "STUCK"].includes(String(status.transactionState))) throw new Error(status.error || `Circle transaction ${String(status.transactionState).toLowerCase()}`);
    await wait(1_000);
  }
  throw new Error("Circle accepted the transaction, but its blockchain hash is still pending. Refresh balances shortly before retrying.");
}

export function isCircleWalletConnected() { return Boolean(session); }

export function getCircleProvider(): InjectedProvider | null {
  if (!session) return null;
  return {
    selectedAddress: walletFor(session.activeNetwork).address,
    chainId: WEB_NETWORKS[session.activeNetwork].chainHex,
    async request({ method, params = [] }) {
      if (!session) throw new Error("Circle wallet is disconnected");
      const active = walletFor(session.activeNetwork);
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [active.address];
      if (method === "eth_chainId") return WEB_NETWORKS[session.activeNetwork].chainHex;
      if (method === "wallet_switchEthereumChain") {
        const chainHex = String((params[0] as { chainId?: unknown })?.chainId || "");
        const next = (Object.keys(WEB_NETWORKS) as WebNetworkKey[]).find((key) => WEB_NETWORKS[key].chainHex.toLowerCase() === chainHex.toLowerCase());
        if (next !== CIRCLE_NETWORK) throw Object.assign(new Error("Circle email wallet is available only on Arc Testnet in PULSE"), { code: 4902 });
        session.activeNetwork = next; persist(); return null;
      }
      if (method === "wallet_addEthereumChain") throw Object.assign(new Error("Circle Wallet networks are managed by Circle"), { code: 4200 });
      if (method === "eth_signTypedData_v4") {
        const raw = String(params[1] || params[0] || "");
        const result = await challenge("/sign/typed-data", { walletId: active.id, data: raw });
        const signature = result.data?.signature;
        if (!signature) throw new Error("Circle returned no typed-data signature");
        return signature;
      }
      // Read-only calls are sent directly to the selected public RPC. Contract
      // execution is intentionally added only after Circle's transaction path is certified.
      if (method === "eth_sendTransaction" || method === "eth_sendRawTransaction") {
        if (method === "eth_sendRawTransaction") return rpc(method, params);
        const tx = params[0] as Record<string, string> | undefined;
        if (!tx || String(tx.from || "").toLowerCase() !== active.address.toLowerCase()) throw new Error("Circle transaction source does not match the connected EOA");
        if (!tx.to) throw new Error("Circle contract execution requires a destination contract");
        return executeContractTransaction({
          walletId: active.id,
          contractAddress: tx.to,
          callData: tx.data || "0x",
          value: tx.value || "0x0",
        });
      }
      return rpc(method, params);
    },
    disconnect() { session = null; sdk = null; persist(); },
  };
}

export async function connectCircleWallet(email: string, preferred: WebNetworkKey) {
  preferred = CIRCLE_NETWORK;
  const id = appId();
  let loginResolve: ((value: { userToken: string; encryptionKey: string; refreshToken: string }) => void) | null = null;
  let loginReject: ((reason: unknown) => void) | null = null;
  const login = new Promise<{ userToken: string; encryptionKey: string; refreshToken: string }>((resolve, reject) => { loginResolve = resolve; loginReject = reject; });
  sdk = new W3SSdk({ appSettings: { appId: id } }, (error, result) => error ? loginReject?.(error) : result ? loginResolve?.(result) : loginReject?.(new Error("Circle returned no login session")));
  const deviceId = await sdk.getDeviceId();
  const start = await circleApi("/email/start", { method: "POST", body: JSON.stringify({ email, deviceId }) });
  sdk.updateConfigs({ appSettings: { appId: id }, loginConfigs: { deviceToken: String(start.deviceToken), deviceEncryptionKey: String(start.deviceEncryptionKey), otpToken: String(start.otpToken) } });
  sdk.verifyOtp();
  const auth = await login;
  session = { userToken: auth.userToken, encryptionKey: auth.encryptionKey, wallets: [], activeNetwork: CIRCLE_NETWORK };
  sdk.updateConfigs({ appSettings: { appId: id }, authentication: { userToken: auth.userToken, encryptionKey: auth.encryptionKey } });
  let wallets: CircleWallet[];
  try {
    // Circle requires first-time email users to be initialized after OTP
    // verification and before their wallets can be listed.
    const created = await circleApi("/wallets/initialize", {
      method: "POST",
      body: JSON.stringify({ blockchain: "ARC-TESTNET" }),
    });
    const challengeId = String(created.challengeId || "");
    if (!challengeId) throw new Error("Circle returned no EOA wallet creation challenge");
    await execute(challengeId);
    wallets = await listArcWallets({ waitForCreation: true });
  } catch (error) {
    // 155106 is Circle's documented "user was initialized" response. It is
    // the normal returning-user path. Load the existing wallet or create the
    // missing Arc wallet with Circle's dedicated wallet challenge.
    if ((error as { code?: number })?.code !== 155106) throw error;
    wallets = await listArcWallets();
    if (!wallets.length) {
      const created = await circleApi("/wallets/create-arc", { method: "POST", body: "{}" });
      const challengeId = String(created.challengeId || "");
      if (!challengeId) throw new Error("Circle returned no Arc Testnet wallet creation challenge");
      await execute(challengeId);
      wallets = await listArcWallets({ waitForCreation: true });
    }
  }
  session.wallets = wallets;
  if (!session.wallets.length) {
    throw new Error("Circle finished login but no Arc Testnet EOA is available. Check Circle Console → Wallets → User Controlled → Users; if this email was initialized previously without an Arc wallet, create an Arc Testnet EOA for that user or use a new email for this test.");
  }
  const active = walletFor(session.activeNetwork);
  persist();
  return { address: active.address, providerName: "Circle Wallet (email)", networkKey: session.activeNetwork, provider: getCircleProvider()! };
}

export function restoreCircleWallet() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || "null") as CircleSession | null;
    if (!stored?.userToken || !stored.wallets?.some((wallet) => wallet.blockchain === "ARC-TESTNET")) return null;
    stored.activeNetwork = CIRCLE_NETWORK;
    session = stored;
    sdk = new W3SSdk({ appSettings: { appId: appId() }, authentication: { userToken: stored.userToken, encryptionKey: stored.encryptionKey } });
    return { address: walletFor(stored.activeNetwork).address, providerName: "Circle Wallet (email)", networkKey: stored.activeNetwork, provider: getCircleProvider()! };
  } catch { session = null; return null; }
}
