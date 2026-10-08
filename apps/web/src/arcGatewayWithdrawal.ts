import { createPublicClient, defineChain, encodeFunctionData, fallback, formatUnits, hashTypedData, http, keccak256, pad, recoverTypedDataAddress, toHex } from "viem";
import type { Hex } from "viem";
import { ARC_GATEWAY_WALLET, WEB_NETWORKS, assertArcGatewayWallet, fetchArcGatewayBalanceAtomic, parseGatewayDepositAmount } from "./networks";
import type { InjectedProvider } from "./wallet";
import { walletErrorMessage } from "./walletErrors";

export const ARC_GATEWAY_MINTER = "0x2222222d7164433c4C09B0b0D809a9b52C04C205";
const API = "https://gateway-api.circle.com/v1";
const usdc = WEB_NETWORKS.arc.payment.address;
const chain = defineChain({ id: 5042, name: "Arc Mainnet", nativeCurrency: WEB_NETWORKS.arc.native, rpcUrls: { default: { http: [WEB_NETWORKS.arc.rpc] } } });
const client = () => createPublicClient({ chain, transport: fallback([http(WEB_NETWORKS.arc.rpc), http("https://rpc.quicknode.mainnet.arc.io")]) });
const walletAbi = [
  ...["availableBalance", "withdrawingBalance", "withdrawableBalance", "withdrawalBlock"].map(name => ({ type: "function", name, stateMutability: "view", inputs: [{ name: "token", type: "address" }, { name: "depositor", type: "address" }], outputs: [{ type: "uint256" }] } as const)),
  { type: "function", name: "withdrawalDelay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "initiateWithdrawal", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "value", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }], outputs: [] },
] as const;
const minterAbi = [
  { type: "function", name: "gatewayMint", stateMutability: "nonpayable", inputs: [{ name: "attestationPayload", type: "bytes" }, { name: "signature", type: "bytes" }], outputs: [] },
  { type: "function", name: "isTransferSpecHashUsed", stateMutability: "view", inputs: [{ name: "transferSpecHash", type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;
const types = {
  TransferSpec: [
    { name: "version", type: "uint32" }, { name: "sourceDomain", type: "uint32" }, { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" }, { name: "destinationContract", type: "bytes32" }, { name: "sourceToken", type: "bytes32" }, { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" }, { name: "destinationRecipient", type: "bytes32" }, { name: "sourceSigner", type: "bytes32" }, { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" }, { name: "salt", type: "bytes32" }, { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [{ name: "maxBlockHeight", type: "uint256" }, { name: "maxFee", type: "uint256" }, { name: "spec", type: "TransferSpec" }],
} as const;
const domain = { name: "GatewayWallet", version: "1" } as const;
export type WithdrawalSpec = { version: number; sourceDomain: number; destinationDomain: number; sourceContract: Hex; destinationContract: Hex; sourceToken: Hex; destinationToken: Hex; sourceDepositor: Hex; destinationRecipient: Hex; sourceSigner: Hex; destinationCaller: Hex; value: string; salt: Hex; hookData: Hex };
export type WithdrawalQuote = { owner: string; amount: string; maxFee: string; maxBlockHeight: string; spec: WithdrawalSpec; reviewedAt: number };
export type PendingWithdrawal = WithdrawalQuote & { signature: Hex; attestation?: Hex; attestationSignature?: Hex; mintHash?: Hex };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const key = (owner: string) => `pulse:arc:5042:gateway-withdrawal:${owner.toLowerCase()}`;
const address = (value: string) => {
  if (!/^0x[\da-f]{40}$/i.test(value) || /^0x0{40}$/i.test(value)) throw new Error("Invalid Gateway withdrawal wallet");
  return pad(value.toLowerCase() as Hex, { size: 32 });
};
const bytes32 = (value: unknown): Hex => {
  if (typeof value !== "string" || !/^0x(?:[\da-f]{40}|[\da-f]{64})$/i.test(value)) throw new Error("Invalid Gateway transfer address");
  return pad(value.toLowerCase() as Hex, { size: 32 });
};
const uint = (value: unknown): string => {
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value) || BigInt(value) >= 2n ** 256n) throw new Error("Invalid Gateway transfer amount or expiry");
  return BigInt(value).toString();
};

export function withdrawalSpec(owner: string, amount: string, salt: Hex): WithdrawalSpec {
  if (!/^0x[\da-f]{64}$/i.test(salt)) throw new Error("Invalid Gateway withdrawal salt");
  return { version: 1, sourceDomain: 26, destinationDomain: 26, sourceContract: address(ARC_GATEWAY_WALLET), destinationContract: address(ARC_GATEWAY_MINTER), sourceToken: address(usdc), destinationToken: address(usdc), sourceDepositor: address(owner), destinationRecipient: address(owner), sourceSigner: address(owner), destinationCaller: address(owner), value: parseGatewayDepositAmount(amount).toString(), salt, hookData: "0x" };
}
export function assertWithdrawalSpec(raw: unknown, expected: WithdrawalSpec): WithdrawalSpec {
  if (!raw || typeof raw !== "object") throw new Error("Gateway returned no withdrawal intent");
  const candidate = raw as Record<string, unknown>;
  for (const [name, value] of Object.entries(expected)) {
    const actual = name === "salt" || name === "hookData" ? String(candidate[name]).toLowerCase() : typeof value === "number" ? candidate[name] : name === "value" ? uint(candidate[name]) : bytes32(candidate[name]);
    if (actual !== (typeof value === "string" ? value.toLowerCase() : value)) throw new Error(`Gateway withdrawal ${name} mismatch; no signature or mint requested`);
  }
  return expected;
}
function typed(quote: WithdrawalQuote) {
  return { domain, types, primaryType: "BurnIntent" as const, message: { maxBlockHeight: BigInt(quote.maxBlockHeight), maxFee: BigInt(quote.maxFee), spec: { ...quote.spec, value: BigInt(quote.spec.value) } } };
}
async function gateway(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${API}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), redirect: "error" });
  if (!response.ok) throw new Error(`Circle Gateway ${path} failed (${response.status}); keep the pending withdrawal and retry it`);
  return response.json();
}
export function parseWithdrawalQuote(raw: unknown, owner: string, amount: string, spec: WithdrawalSpec): WithdrawalQuote {
  const list = Array.isArray(raw) ? raw : (raw as { body?: unknown[] } | null)?.body;
  if (!Array.isArray(list) || list.length !== 1) throw new Error("Gateway returned no single withdrawal estimate");
  const intent = (list[0] as { burnIntent?: { spec: unknown; maxFee: unknown; maxBlockHeight: unknown } })?.burnIntent;
  if (!intent) throw new Error("Gateway returned no withdrawal estimate");
  assertWithdrawalSpec(intent.spec, spec);
  return { owner: owner.toLowerCase(), amount, spec, maxFee: uint(intent.maxFee), maxBlockHeight: uint(intent.maxBlockHeight), reviewedAt: Date.now() };
}
async function estimateArcGatewayWithdrawal(owner: string, amount: string): Promise<WithdrawalQuote> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const spec = withdrawalSpec(owner, amount, salt);
  return parseWithdrawalQuote(await gateway("estimate", [{ spec }]), owner, amount, spec);
}
export async function prepareArcGatewayWithdrawal(owner: string, amount: string): Promise<WithdrawalQuote> {
  const quote = await estimateArcGatewayWithdrawal(owner, amount);
  const spec = quote.spec;
  if (await fetchArcGatewayBalanceAtomic(owner) < BigInt(spec.value) + BigInt(quote.maxFee)) throw new Error("Gateway available USDC must cover the withdrawal plus its maximum fee; reduce the amount");
  return quote;
}

/** Fee estimates are unsigned. Max never authorizes a transfer or starts the delayed fallback. */
export async function prepareMaxArcGatewayWithdrawal(owner: string): Promise<WithdrawalQuote> {
  const available = await fetchArcGatewayBalanceAtomic(owner);
  if (available <= 0n) throw new Error("No available Gateway USDC to withdraw");
  let amount = available;
  for (let attempt = 0; attempt < 5; attempt++) {
    const quote = await estimateArcGatewayWithdrawal(owner, formatUnits(amount, 6));
    const next = available - BigInt(quote.maxFee);
    if (next <= 0n) throw new Error("Gateway balance does not cover the withdrawal fee");
    if (amount <= next) {
      if (await fetchArcGatewayBalanceAtomic(owner) < amount + BigInt(quote.maxFee)) throw new Error("Gateway balance changed; refresh Max before reviewing withdrawal");
      return quote;
    }
    amount = next;
  }
  throw new Error("Gateway fee changed repeatedly; review a smaller withdrawal amount");
}
export function maxArcGatewayDepositAtomic(nativeBalance: bigint, gasPrice: bigint): bigint {
  if (nativeBalance < 0n || gasPrice <= 0n) throw new Error("Arc deposit balance or gas estimate is unavailable");
  const reserved = 470_000n * gasPrice * 2n;
  return nativeBalance > reserved ? (nativeBalance - reserved) / 1_000_000_000_000n : 0n;
}
export async function prepareMaxArcGatewayDeposit(owner: string): Promise<string> {
  address(owner);
  const rpc = await checkedClient();
  const [balance, gasPrice] = await Promise.all([rpc.getBalance({ address: owner as Hex }), rpc.getGasPrice()]);
  const maximum = maxArcGatewayDepositAtomic(balance, gasPrice);
  if (maximum <= 0n) throw new Error("Add wallet USDC on Arc Mainnet; the available balance does not cover approval and deposit gas");
  return formatUnits(maximum, 6);
}
export function readPendingWithdrawal(store: Store, owner: string): PendingWithdrawal | null {
  const raw = store.getItem(key(owner));
  if (!raw) return null;
  const pending = JSON.parse(raw) as PendingWithdrawal;
  if (pending.owner !== owner.toLowerCase() || !/^0x[\da-f]{130}$/i.test(pending.signature)) throw new Error("Saved Gateway withdrawal does not match this wallet");
  assertWithdrawalSpec(pending.spec, withdrawalSpec(owner, pending.amount, pending.spec.salt));
  uint(pending.maxFee); uint(pending.maxBlockHeight);
  if (pending.mintHash && !/^0x[\da-f]{64}$/i.test(pending.mintHash)) throw new Error("Invalid saved Gateway mint transaction");
  return pending;
}
function save(store: Store, pending: PendingWithdrawal) {
  // Persist BEFORE submitting a signed intent. No second withdrawal on ambiguous API errors.
  store.setItem(key(pending.owner), JSON.stringify(pending));
  if (!readPendingWithdrawal(store, pending.owner)) throw new Error("Gateway withdrawal recovery storage is unavailable");
}
export async function assertGatewayWallet(provider: InjectedProvider, owner: string) {
  await assertArcGatewayWallet(provider, owner);
}

/** Match the exact packed TransferSpec, including recipient, caller, amount and empty hooks. */
export function encodedWithdrawalSpec(spec: WithdrawalSpec): Hex {
  return ("0xca85def7" + [toHex(spec.version, { size: 4 }), toHex(spec.sourceDomain, { size: 4 }), toHex(spec.destinationDomain, { size: 4 }), ...[spec.sourceContract, spec.destinationContract, spec.sourceToken, spec.destinationToken, spec.sourceDepositor, spec.destinationRecipient, spec.sourceSigner, spec.destinationCaller], toHex(BigInt(spec.value), { size: 32 }), spec.salt, "0x00000000"].map(v => v.slice(2)).join("")) as Hex;
}
export function validateWithdrawalAttestation(raw: unknown, spec: WithdrawalSpec): { attestation: Hex; signature: Hex; expiry: bigint } {
  const body = raw as { attestation?: unknown; signature?: unknown };
  if (typeof body?.attestation !== "string" || !/^0x[\da-f]+$/i.test(body.attestation) || typeof body.signature !== "string" || !/^0x[\da-f]{130}$/i.test(body.signature)) throw new Error("Gateway returned invalid mint attestation; recovery kept");
  let data = body.attestation.toLowerCase().slice(2);
  if (data.startsWith("1e12db71")) {
    if (data.slice(8, 16) !== "00000001") throw new Error("Gateway returned multiple withdrawal attestations");
    data = data.slice(16);
  }
  if (!data.startsWith("ff6fb334") || data.length < 80) throw new Error("Unknown Gateway attestation format");
  const length = Number.parseInt(data.slice(72, 80), 16);
  const encoded = encodedWithdrawalSpec(spec).slice(2);
  if (length !== 340 || data.length !== 80 + length * 2 || data.slice(80) !== encoded) throw new Error("Gateway mint does not match the reviewed withdrawal; recovery kept");
  return { attestation: body.attestation as Hex, signature: body.signature as Hex, expiry: BigInt(`0x${data.slice(8, 72)}`) };
}
async function checkedClient() {
  const rpc = client();
  if (await rpc.getChainId() !== 5042) throw new Error("Gateway RPC returned the wrong chain");
  return rpc;
}
async function assertGatewayGasReserve(rpc: Awaited<ReturnType<typeof checkedClient>>, owner: string, gasLimit: bigint) {
  // Public RPC reads work in wallet browsers that restrict eth_gasPrice/eth_getBalance.
  const [balance, price] = await Promise.all([rpc.getBalance({ address: owner as Hex }), rpc.getGasPrice()]);
  if (price <= 0n) throw new Error("Arc gas estimate is unavailable; refresh before authorizing a withdrawal");
  const required = gasLimit * price * 2n;
  if (balance < required) {
    const reserve = formatUnits((required + 999_999_999_999n) / 1_000_000_000_000n, 6);
    throw new Error(`Add at least ${reserve} wallet USDC on Arc Mainnet for transaction gas. Gateway USDC cannot pay the mint fee. Refresh balances after funding this same wallet.`);
  }
}
function signingDeclined(error: unknown, depth = 0, seen = new Set<unknown>()): boolean {
  if (!error || typeof error !== "object" || depth > 5 || seen.has(error)) return false;
  seen.add(error);
  const value = error as Record<string, unknown>;
  return [4001,4100].includes(Number(value.code)) || ["message","originalError","error","cause","data"].some(key => signingDeclined(value[key],depth+1,seen));
}
export async function signArcGatewayWithdrawal(provider: InjectedProvider, quote: WithdrawalQuote): Promise<Hex> {
  await assertGatewayWallet(provider, quote.owner);
  const data = typed(quote);
  // Circle signs only name/version in EIP712Domain. Keep that explicit type
  // even when a mobile bridge needs the active chain as request metadata.
  const payload = { ...data, types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }] as const, ...types } };
  const serialize = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v);
  let signature: unknown;
  try {
    signature = await provider.request({ method: "eth_signTypedData_v4", params: [quote.owner, serialize(payload)] });
  } catch (error) {
    // Some OKX mobile bridges parse an omitted domain.chainId as NaN before
    // signing. Retry only this pre-signing validation error, never rejection,
    // an unknown signing outcome, or a real chain/account mismatch.
    const message = walletErrorMessage(error);
    if (signingDeclined(error) || !/provided chainId\s+["']?NaN["']?\s+must match the active chainId\s+["']?5042["']?/i.test(message)) throw error;
    await assertGatewayWallet(provider, quote.owner);
    if (Date.now() - quote.reviewedAt > 120_000) throw new Error("Withdrawal estimate expired; review a fresh fee estimate");
    const compatible = { ...payload, domain: { ...payload.domain, chainId: 5042 } };
    // chainId is NOT added to the declared EIP712Domain fields. The digest must
    // remain identical to Circle's chain-independent intent before prompting.
    if (hashTypedData(compatible) !== hashTypedData(payload)) throw new Error("Gateway wallet compatibility changed the signed withdrawal intent");
    signature = await provider.request({ method: "eth_signTypedData_v4", params: [quote.owner, serialize(compatible)] });
  }
  if (typeof signature !== "string" || !/^0x[\da-f]{130}$/i.test(signature)
    || (await recoverTypedDataAddress({ ...data, signature: signature as Hex })).toLowerCase() !== quote.owner.toLowerCase())
    throw new Error("Wallet did not sign Circle's original Gateway intent. Update or reconnect the wallet before retrying; no withdrawal was submitted.");
  return signature as Hex;
}
export async function withdrawArcGateway(provider: InjectedProvider, quote: WithdrawalQuote, store: Store) {
  const existing = readPendingWithdrawal(store, quote.owner);
  if (existing) throw new Error("Resume the existing Gateway withdrawal before starting another");
  assertWithdrawalSpec(quote.spec, withdrawalSpec(quote.owner, quote.amount, quote.spec.salt));
  if (Date.now() - quote.reviewedAt > 120_000) throw new Error("Withdrawal estimate expired; review a fresh fee estimate");
  await assertGatewayWallet(provider, quote.owner);
  const rpc = await checkedClient();
  if (await rpc.getBlockNumber() >= BigInt(quote.maxBlockHeight)) throw new Error("Withdrawal block expiry reached; request a new estimate");
  if (await fetchArcGatewayBalanceAtomic(quote.owner) < BigInt(quote.spec.value) + BigInt(quote.maxFee)) throw new Error("Gateway balance changed; review a smaller withdrawal");
  await assertGatewayGasReserve(rpc, quote.owner, 350_000n);
  // Gateway EIP-712 intentionally omits chainId/verifyingContract; the signed spec binds domain 26 and both contracts.
  const signature = await signArcGatewayWithdrawal(provider, quote);
  save(store, { ...quote, signature: signature as Hex });
  return resumeArcGatewayWithdrawal(provider, quote.owner, store);
}
export async function resumeArcGatewayWithdrawal(provider: InjectedProvider, owner: string, store: Store): Promise<{ hash?: Hex; recovered: boolean }> {
  const pending = readPendingWithdrawal(store, owner);
  if (!pending) throw new Error("No Gateway withdrawal to resume");
  if ((await recoverTypedDataAddress({ ...typed(pending), signature: pending.signature })).toLowerCase() !== owner.toLowerCase()) throw new Error("Invalid saved withdrawal signature");
  await assertGatewayWallet(provider, owner);
  const rpc = await checkedClient();
  const specHash = keccak256(encodedWithdrawalSpec(pending.spec));
  if (await rpc.readContract({ address: ARC_GATEWAY_MINTER, abi: minterAbi, functionName: "isTransferSpecHashUsed", args: [specHash] })) {
    store.removeItem(key(owner)); return { hash: pending.mintHash, recovered: true };
  }
  if (pending.mintHash) {
    // An unresolved hash is checked, never replaced with another mint transaction.
    const receipt = await rpc.waitForTransactionReceipt({ hash: pending.mintHash, timeout: 60_000 });
    if (receipt.status === "success") {
      if (!await rpc.readContract({ address: ARC_GATEWAY_MINTER, abi: minterAbi, functionName: "isTransferSpecHashUsed", args: [specHash] })) throw new Error("Receipt did not confirm this Gateway withdrawal; recovery kept");
      store.removeItem(key(owner)); return { hash: pending.mintHash, recovered: true };
    }
    delete pending.mintHash; save(store, pending);
  }
  if (!pending.attestation || !pending.attestationSignature) {
    const raw = await gateway("transfer", [{ burnIntent: { maxBlockHeight: pending.maxBlockHeight, maxFee: pending.maxFee, spec: pending.spec }, signature: pending.signature }]);
    const validated = validateWithdrawalAttestation(raw, pending.spec);
    pending.attestation = validated.attestation; pending.attestationSignature = validated.signature; save(store, pending);
  }
  const validated = validateWithdrawalAttestation({ attestation: pending.attestation, signature: pending.attestationSignature }, pending.spec);
  if (await rpc.getBlockNumber() >= validated.expiry) throw new Error("Mint attestation expired; recovery retained. Contact Circle support before creating another withdrawal.");
  await assertGatewayWallet(provider, owner);
  await assertGatewayGasReserve(rpc, owner, 350_000n);
  const data = encodeFunctionData({ abi: minterAbi, functionName: "gatewayMint", args: [validated.attestation, validated.signature] });
  await rpc.call({ account: owner as Hex, to: ARC_GATEWAY_MINTER, data });
  const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from: owner, to: ARC_GATEWAY_MINTER, data, value: "0x0", gas: "0x55730" }] });
  if (typeof hash !== "string" || !/^0x[\da-f]{64}$/i.test(hash)) throw new Error("Wallet returned no Gateway mint hash; recovery kept");
  pending.mintHash = hash as Hex; save(store, pending);
  const receipt = await rpc.waitForTransactionReceipt({ hash: pending.mintHash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error("Gateway mint reverted; resume this withdrawal to retry");
  if (!await rpc.readContract({ address: ARC_GATEWAY_MINTER, abi: minterAbi, functionName: "isTransferSpecHashUsed", args: [specHash] })) throw new Error("Receipt did not confirm this Gateway withdrawal; recovery kept");
  store.removeItem(key(owner)); return { hash: pending.mintHash, recovered: false };
}
export type GatewayWithdrawalStatus = { available: bigint; withdrawing: bigint; withdrawable: bigint; withdrawalBlock: bigint; currentBlock: bigint; delay: bigint };
export async function fetchGatewayWithdrawalStatus(owner: string): Promise<GatewayWithdrawalStatus> {
  address(owner); const rpc = await checkedClient();
  const values = await Promise.all([...["availableBalance", "withdrawingBalance", "withdrawableBalance", "withdrawalBlock"].map(functionName => rpc.readContract({ address: ARC_GATEWAY_WALLET, abi: walletAbi, functionName, args: [usdc, owner as Hex] }) as Promise<bigint>), rpc.getBlockNumber(), rpc.readContract({ address: ARC_GATEWAY_WALLET, abi: walletAbi, functionName: "withdrawalDelay" })]);
  return { available: values[0], withdrawing: values[1], withdrawable: values[2], withdrawalBlock: values[3], currentBlock: values[4], delay: values[5] };
}
export async function trustlessArcGatewayWithdrawal(provider: InjectedProvider, owner: string, amount: string | null, store: Store): Promise<Hex> {
  if (readPendingWithdrawal(store, owner)) throw new Error("Resolve the instant withdrawal before starting a contract fallback");
  await assertGatewayWallet(provider, owner);
  const status = await fetchGatewayWithdrawalStatus(owner);
  const value = amount === null ? status.withdrawable : parseGatewayDepositAmount(amount);
  if (value <= 0n) throw new Error("No Gateway USDC is ready to claim");
  if (amount !== null && status.withdrawing > 0n) throw new Error("An existing contract withdrawal is pending; adding funds would reset its waiting period");
  if (amount !== null && value > status.available) throw new Error("Insufficient onchain Gateway USDC for a contract withdrawal");
  const rpc = await checkedClient();
  await assertGatewayGasReserve(rpc, owner, 200_000n);
  const data = amount === null ? encodeFunctionData({ abi: walletAbi, functionName: "withdraw", args: [usdc] }) : encodeFunctionData({ abi: walletAbi, functionName: "initiateWithdrawal", args: [usdc, value] });
  await rpc.call({ account: owner as Hex, to: ARC_GATEWAY_WALLET, data });
  await assertGatewayWallet(provider, owner);
  const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from: owner, to: ARC_GATEWAY_WALLET, data, value: "0x0", gas: "0x30d40" }] });
  if (typeof hash !== "string" || !/^0x[\da-f]{64}$/i.test(hash)) throw new Error("Wallet returned no Gateway withdrawal hash");
  const receipt = await rpc.waitForTransactionReceipt({ hash: hash as Hex, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error("Gateway contract withdrawal reverted");
  return hash as Hex;
}
