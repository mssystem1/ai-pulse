import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { z } from "zod";
import { decodeFunctionData, keccak256, parseAbi, parseTransaction, recoverTransactionAddress, parseEther, type Hex, type TransactionSerialized } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { kvConfigured, runKvCommand } from "./resilientKv.js";

const address = z.string().regex(/^0x[0-9a-f]{40}$/i);
const hex = z.string().regex(/^0x(?:[0-9a-f]{2})+$/i).max(262_144);
const recordSchema = z.object({
  owner: address, vault: address, pair: z.string().min(3).max(64),
  kind: z.enum(["buy_filled", "sell_partial_filled", "sell_filled"]),
  amount: z.string().regex(/^\d+$/),
  actionNonce: z.string().regex(/^\d+$/), policyVersion: z.string().regex(/^\d+$/),
  evidenceHash: z.string().regex(/^0x[0-9a-f]{64}$/i), evidenceUrl: z.string().max(2048),
  expiresAt: z.number().finite().positive(), createdAt: z.string().datetime(),
  data: hex, serializedTransaction: hex, txHash: z.string().regex(/^0x[0-9a-f]{64}$/i),
}).strict();
export type PendingArcAutopilotTrade = z.infer<typeof recordSchema>;
type Dependencies = { configured(): boolean; command(command: unknown[]): Promise<unknown> };
const executionAbi = parseAbi(["function execute(bytes32,uint64,uint64,address,address,address,uint256,uint256,bytes,bytes32)"]);

/** Private, encrypted write-ahead record. No signed payload enters strategy/UI telemetry. */
export class ArcAutopilotOutbox {
  private readonly signer: string;
  constructor(private readonly executorKey: Hex, private readonly dependencies: Dependencies = {
    configured: kvConfigured, command: command => runKvCommand(command, "Arc Autopilot transaction recovery"),
  }) { this.signer = privateKeyToAccount(executorKey).address; }

  private storageKey(owner: string, vault: string) {
    return `pulse:v6:arc:execution-outbox:${owner.toLowerCase()}:${vault.toLowerCase()}`;
  }
  private encryptionKey(storageKey: string) {
    return Buffer.from(hkdfSync("sha256", Buffer.from(this.executorKey.slice(2), "hex"),
      Buffer.from(storageKey), Buffer.from("PULSE Arc Autopilot signed transaction recovery v1"), 32));
  }
  private assertStorage() {
    if (!this.dependencies.configured()) throw new Error("Arc Autopilot execution requires durable transaction recovery storage");
  }
  private async validate(value: unknown, owner: string, vault: string) {
    const record = recordSchema.parse(value);
    const tx = parseTransaction(record.serializedTransaction as TransactionSerialized);
    const call = decodeFunctionData({ abi: executionAbi, data: record.data as Hex });
    if (record.owner.toLowerCase() !== owner.toLowerCase() || record.vault.toLowerCase() !== vault.toLowerCase()
      || tx.chainId !== 5042 || tx.to?.toLowerCase() !== vault.toLowerCase()
      || tx.data?.toLowerCase() !== record.data.toLowerCase() || (tx.value || 0n) !== 0n
      || !tx.gas || !tx.maxFeePerGas || tx.gas * tx.maxFeePerGas > parseEther("0.10")
      || String(call.args[1]) !== record.policyVersion || String(call.args[2]) !== record.actionNonce
      || String(call.args[6]) !== record.amount || call.args[9].toLowerCase() !== record.evidenceHash.toLowerCase()
      || keccak256(record.serializedTransaction as Hex).toLowerCase() !== record.txHash.toLowerCase()
      || (await recoverTransactionAddress({ serializedTransaction: record.serializedTransaction as TransactionSerialized })).toLowerCase() !== this.signer.toLowerCase())
      throw new Error("Arc Autopilot recovery transaction identity or gas limit is invalid");
    return record;
  }
  private encrypt(record: PendingArcAutopilotTrade, storageKey: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(storageKey), iv);
    cipher.setAAD(Buffer.from(storageKey));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record), "utf8"), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") });
  }
  private decrypt(stored: string, storageKey: string): unknown {
    const envelope = z.object({ v: z.literal(1), iv: z.string(), tag: z.string(), ciphertext: z.string().max(524_288) }).strict().parse(JSON.parse(stored));
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey(storageKey), Buffer.from(envelope.iv, "base64url"));
    decipher.setAAD(Buffer.from(storageKey));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]).toString("utf8"));
  }
  async read(owner: string, vault: string): Promise<PendingArcAutopilotTrade | null> {
    this.assertStorage();
    const storageKey = this.storageKey(owner, vault);
    const stored = await this.dependencies.command(["GET", storageKey]);
    if (stored === null) return null;
    if (typeof stored !== "string") throw new Error("Arc Autopilot recovery storage returned an invalid record");
    try { return await this.validate(this.decrypt(stored, storageKey), owner, vault); }
    catch { throw new Error("Arc Autopilot recovery record cannot be verified; preserve it for operator reconciliation"); }
  }
  async stage(input: Omit<PendingArcAutopilotTrade, "txHash" | "createdAt">) {
    this.assertStorage();
    const record = await this.validate({ ...input, txHash: keccak256(input.serializedTransaction as Hex), createdAt: new Date().toISOString() }, input.owner, input.vault);
    const storageKey = this.storageKey(input.owner, input.vault);
    const result = await this.dependencies.command(["SET", storageKey, this.encrypt(record, storageKey), "NX"]);
    if (result !== "OK") throw new Error("Arc Autopilot already has an unresolved transaction; no new trade was broadcast");
    return record;
  }
  async clear(record: PendingArcAutopilotTrade) {
    this.assertStorage();
    const storageKey = this.storageKey(record.owner, record.vault);
    const stored = await this.dependencies.command(["GET", storageKey]);
    if (stored == null) return;
    const current = await this.read(record.owner, record.vault);
    if (current?.txHash !== record.txHash) throw new Error("Arc Autopilot recovery transaction changed before settlement");
    const result = await this.dependencies.command(["EVAL", "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", "1", storageKey, stored]);
    if (result !== 1) throw new Error("Arc Autopilot recovery record changed before settlement");
  }
}
