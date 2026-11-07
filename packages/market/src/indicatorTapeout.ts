import { createHash } from "node:crypto";

/** Official TapeOut X Layer deployment, not the separate Fab X factory. */
export const INDICATOR_TAPEOUT_XLAYER = { chainId: 196 as const, factory: "0x1f09daefa827f02cbb40967cc91b259763760761", defaultProcessor: "0x839bdd6fa7a66416a609a735e11de5411b98574e", rpcUrls: ["https://rpc.xlayer.tech", "https://tapeout.net/rpc-xlayer"] as const };
export type IndicatorDeploymentPackage = { runtime: { inputBits: number; outputBits: number; netlist: string } };
export type IndicatorDeploymentReference = { processor: string; circuitId: string; transactionHash?: string };
export type VerifiedIndicatorDeployment = {
  version: "pulse-indicator-xlayer-v1"; chainId: 196; factory: string; processor: string; circuitId: string; blockNumber: string; blockHash: string; observedAt: number;
  codeHash: string; beacon: string; implementation: string; implementationCodeHash: string; netlistHash: string; vectorCount: number; verified: true; transactionHash?: string;
};
type Options = { fetchImpl?: typeof fetch; now?: number; timeoutMs?: number; rpcUrls?: readonly string[] };
const WORD = (v: number | bigint) => BigInt(v).toString(16).padStart(64, "0");
const ADDRESS = /^0x[0-9a-f]{40}$/i, HASH = /^0x[0-9a-f]{64}$/i, ZERO = `0x${"0".repeat(40)}`;
const BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
const TAPED_OUT = "0xc11215e417669c143c8a07aeb778034c0a0a85ebdf305d64a629b19a7a9ce031";
const sha = (hex: string) => `sha256:${createHash("sha256").update(Buffer.from(hex.slice(2), "hex")).digest("hex")}`;
function uint(value: unknown, max = (1n << 256n) - 1n): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value) || value.length > 66) throw Error("Indicator registration: invalid unsigned RPC word");
  const n = BigInt(value); if (n > max) throw Error("Indicator registration: unsigned word overflow"); return n;
}
function address(value: unknown): string {
  if (typeof value !== "string" || !/^0x0{24}[0-9a-f]{40}$/i.test(value)) throw Error("Indicator registration: invalid address ABI word");
  const a = `0x${value.slice(-40)}`.toLowerCase(); if (a === ZERO) throw Error("Indicator registration: zero contract address"); return a;
}
function shape(manifest: IndicatorDeploymentPackage) {
  const r = manifest?.runtime;
  if (!r || ![32, 64].includes(r.inputBits) || ![14, 32, 64].includes(r.outputBits) || typeof r.netlist !== "string" || !/^0x(?:00[0-9a-f]{12}){1,40000}$/.test(r.netlist)) throw Error("Indicator registration: invalid bounded NAND package");
  const count = (r.netlist.length - 2) / 14; if (count < r.outputBits) throw Error("Indicator registration: insufficient output signals");
  const gates: [number, number][] = [];
  for (let i = 0; i < count; i++) { const at = 2 + i * 14, a = parseInt(r.netlist.slice(at + 2, at + 8), 16), b = parseInt(r.netlist.slice(at + 8, at + 14), 16); if (a >= 2 + r.inputBits + i || b >= 2 + r.inputBits + i) throw Error("Indicator registration: noncausal NAND signal"); gates.push([a, b]); }
  return { ...r, gates, count };
}
function dynamicBytes(value: unknown, max: number): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]*$/i.test(value) || value.length < 130 || uint(`0x${value.slice(2, 66)}`) !== 32n) throw Error("Indicator registration: malformed dynamic-byte ABI");
  const n = Number(uint(`0x${value.slice(66, 130)}`, BigInt(max))), padded = Math.ceil(n / 32) * 64;
  if (value.length !== 130 + padded || /[^0]/.test(value.slice(130 + n * 2))) throw Error("Indicator registration: invalid byte length or padding");
  return `0x${value.slice(130, 130 + n * 2)}`.toLowerCase();
}
function packedInput(inputBits: number, buy: number, sell: number, previous: number) {
  const b = Buffer.alloc(inputBits / 8); b.writeUInt16LE(buy, 0); b.writeUInt16LE(sell, 2); if (inputBits === 64) b.writeInt32LE(previous, 4); return b;
}
function expectedOutput(compiled: ReturnType<typeof shape>, inputs: Buffer) {
  const signals = new Uint8Array(2 + compiled.inputBits + compiled.count); signals[1] = 1;
  for (let i = 0; i < compiled.inputBits; i++) signals[2 + i] = (inputs[i >>> 3] >>> (i & 7)) & 1;
  for (let i = 0; i < compiled.gates.length; i++) signals[2 + compiled.inputBits + i] = 1 - (signals[compiled.gates[i][0]] & signals[compiled.gates[i][1]]);
  const output = Buffer.alloc(Math.ceil(compiled.outputBits / 8)), start = signals.length - compiled.outputBits;
  for (let i = 0; i < compiled.outputBits; i++) output[i >>> 3] |= signals[start + i] << (i & 7); return `0x${output.toString("hex")}`;
}
function callBytes(selector: string, id: bigint, input: Buffer) { return `${selector}${WORD(id)}${WORD(64)}${WORD(input.length)}${input.toString("hex").padEnd(Math.ceil(input.length / 32) * 64, "0")}`; }
/** Exact transaction data to register this package's actual numerical circuit. */
export function indicatorTapeoutCalldata(manifest: IndicatorDeploymentPackage): string {
  const c = shape(manifest), raw = c.netlist.slice(2); return `0x7bd3ac1d${WORD(96)}${WORD(c.inputBits)}${WORD(c.outputBits)}${WORD(raw.length / 2)}${raw.padEnd(Math.ceil(raw.length / 64) * 64, "0")}`;
}
function reader(options: Options) {
  const endpoints = options.rpcUrls ?? INDICATOR_TAPEOUT_XLAYER.rpcUrls;
  if (endpoints.length !== 2 || new Set(endpoints).size !== 2 || endpoints.some(e => !/^https:\/\//.test(e))) throw Error("Indicator registration: two distinct HTTPS RPC endpoints required");
  const fetchImpl = options.fetchImpl ?? fetch, deadline = Date.now() + Math.max(1000, Math.min(options.timeoutMs ?? 30000, 60000)); let requests = 0;
  const rpc = async (endpoint: string, method: string, params: unknown[]): Promise<any> => {
    if (++requests > 80 || Date.now() >= deadline) throw Error("Indicator registration: public read bound exceeded");
    const response = await fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: requests, method, params }), signal: AbortSignal.timeout(Math.min(12000, deadline - Date.now())) });
    if (!response.ok) throw Error(`Indicator registration: public RPC HTTP ${response.status}`);
    const text = await response.text(); if (text.length > 1_300_000) throw Error("Indicator registration: RPC response size exceeded");
    const data = JSON.parse(text); if (data.error || data.result === undefined) throw Error("Indicator registration: public view failed"); return data.result;
  };
  const pin = async () => {
    const chains = await Promise.all(endpoints.map(e => rpc(e, "eth_chainId", []))); if (chains.some(c => uint(c) !== 196n)) throw Error("Indicator registration: wrong chain; X Layer 196 required");
    const heads = await Promise.all(endpoints.map(e => rpc(e, "eth_blockNumber", []))); const height = heads.map(h => uint(h)).reduce((a, b) => a < b ? a : b) - 2n;
    if (height <= 0n) throw Error("Indicator registration: invalid chain head"); return `0x${height.toString(16)}`;
  };
  return { endpoints, rpc, pin };
}

/** Registering a package is a public identity/logic check, not authentication of
 * market inputs or a claim that a financial strategy is profitable. Both public
 * endpoints must agree; their upstream independence is not established here. */
export async function verifyIndicatorDeployment(manifest: IndicatorDeploymentPackage, reference: IndicatorDeploymentReference, options: Options = {}): Promise<VerifiedIndicatorDeployment> {
  const c = shape(manifest), processor = reference.processor?.toLowerCase();
  if (!ADDRESS.test(processor) || processor === ZERO || !/^[1-9][0-9]{0,19}$/.test(reference.circuitId) || BigInt(reference.circuitId) >= 1n << 64n || reference.transactionHash !== undefined && !HASH.test(reference.transactionHash)) throw Error("Indicator registration: invalid processor, circuit ID or transaction hash");
  const id = BigInt(reference.circuitId), { endpoints, rpc, pin: choosePin } = reader(options), pin = await choosePin(), factory = INDICATOR_TAPEOUT_XLAYER.factory;
  const vectors = [[1, 1, 0], [120, 80, 20], [80, 120, -20], [65535, 1, 0], [1, 65535, 0], [32768, 32767, 1234]].map(([buy, sell, previous]) => packedInput(c.inputBits, buy, sell, previous));
  const reads = await Promise.all(endpoints.map(async endpoint => {
    const call = (to: string, data: string) => rpc(endpoint, "eth_call", [{ to, data }, pin]);
    const [block, registered, ownFactory, code, info, netlist, beaconWord] = await Promise.all([
      rpc(endpoint, "eth_getBlockByNumber", [pin, false]), call(factory, `0x5f5a364f${processor.slice(2).padStart(64, "0")}`), call(processor, "0xc45a0155"), rpc(endpoint, "eth_getCode", [processor, pin]),
      call(processor, `0x084d60f1${WORD(id)}`), call(processor, `0x3fc4be56${WORD(id)}`), rpc(endpoint, "eth_getStorageAt", [processor, BEACON_SLOT, pin]),
    ]);
    if (block?.number !== pin || !HASH.test(block?.hash ?? "") || uint(registered) !== 1n || address(ownFactory) !== factory || typeof code !== "string" || !/^0x[0-9a-f]{20,}$/i.test(code)) throw Error("Indicator registration: factory membership or processor code mismatch");
    if (info !== `0x${WORD(c.inputBits)}${WORD(c.outputBits)}${WORD(0)}${WORD(c.count)}` || dynamicBytes(netlist, 280000) !== c.netlist) throw Error("Indicator registration: actual circuit ports or netlist differ from package");
    const beacon = address(beaconWord), implementation = address(await call(beacon, "0x5c60da1b")), implementationCode = await rpc(endpoint, "eth_getCode", [implementation, pin]);
    if (typeof implementationCode !== "string" || !/^0x[0-9a-f]{20,}$/i.test(implementationCode)) throw Error("Indicator registration: missing circuit implementation code");
    const output = await Promise.all(vectors.map(v => call(processor, callBytes("0x934d06ea", id, v))));
    if (output.some((v, i) => dynamicBytes(v, 8) !== expectedOutput(c, vectors[i]))) throw Error("Indicator registration: deployed numeric outputs disagree with local circuit");
    if (reference.transactionHash) {
      const [receipt, transaction] = await Promise.all([rpc(endpoint, "eth_getTransactionReceipt", [reference.transactionHash]), rpc(endpoint, "eth_getTransactionByHash", [reference.transactionHash])]);
      if (!receipt || receipt.status !== "0x1" || receipt.to?.toLowerCase() !== processor || uint(receipt.blockNumber) > BigInt(pin) || !transaction || transaction.to?.toLowerCase() !== processor || transaction.input?.toLowerCase() !== indicatorTapeoutCalldata(manifest) || !receipt.logs?.some((log: any) => log.address?.toLowerCase() === processor && log.topics?.[0]?.toLowerCase() === TAPED_OUT && log.topics?.[1]?.toLowerCase() === `0x${WORD(id)}`)) throw Error("Indicator registration: transaction does not prove this successful circuit registration");
    }
    return { blockHash: block.hash.toLowerCase(), codeHash: sha(code), beacon, implementation, implementationCodeHash: sha(implementationCode) };
  }));
  if (JSON.stringify(reads[0]) !== JSON.stringify(reads[1])) throw Error("Indicator registration: RPC endpoints disagree at pinned block");
  const final = await Promise.all(endpoints.map(e => rpc(e, "eth_getBlockByNumber", [pin, false]))); if (final.some(b => b?.hash?.toLowerCase() !== reads[0].blockHash)) throw Error("Indicator registration: pinned block changed during verification");
  return { version: "pulse-indicator-xlayer-v1", chainId: 196, factory, processor, circuitId: reference.circuitId, blockNumber: BigInt(pin).toString(), ...reads[0], observedAt: options.now ?? Date.now(), netlistHash: sha(c.netlist), vectorCount: vectors.length, verified: true, ...(reference.transactionHash ? { transactionHash: reference.transactionHash.toLowerCase() } : {}) };
}
