import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import type { RobinhoodGasJournal, RobinhoodGasSubmission } from "@pulse/payments";
import { StoreRedis } from "./storeRedis.js";

/** A distributed lock plus a non-expiring prepared-transaction fence. A lock
 * timeout does NOT discard the last signed nonce/hash. An unresolved reservation
 * requires reconciliation; it is never automatically reused or replaced. */
export class RedisRobinhoodGasJournal implements RobinhoodGasJournal {
  constructor(private readonly redis: StoreRedis) {}
  async exclusive<T>(signer: Address, run: (previous: RobinhoodGasSubmission | null, save: (next: RobinhoodGasSubmission) => Promise<void>) => Promise<T>): Promise<T> {
    if (!/^0x[\da-f]{40}$/i.test(signer)) throw new Error("Invalid facilitator signer");
    const key = `pulse:payments:robinhood:gas:v1:${signer.toLowerCase()}`;
    const lock = `${key}:lock`;
    const owner = randomUUID();
    if (await this.redis.set(lock, owner, { nx: true, ex: 120 }) !== "OK") throw new Error("Facilitator signer busy");
    try {
      const previous = await this.redis.get<RobinhoodGasSubmission>(key);
      return await run(previous, async next => {
        if (!Number.isSafeInteger(next.nonce) || next.nonce < 0 || !/^0x[\da-f]{64}$/i.test(next.transaction)) throw new Error("Invalid facilitator transaction reservation");
        const saved = await this.redis.eval(
          "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[2], ARGV[2]); return 1",
          [lock, key], [owner, JSON.stringify(next)],
        );
        if (Number(saved) !== 1) throw new Error("Facilitator signer lease lost before broadcast");
      });
    } finally {
      // A cleanup failure must not disguise the outcome of a submitted transfer.
      await this.redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", [lock], [owner]).catch(() => undefined);
    }
  }
}
