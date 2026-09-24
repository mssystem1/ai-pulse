import type { RobinhoodAttempt, RobinhoodJournal } from "@pulse/payments";
import { StoreRedis } from "./storeRedis.js";

/** Keep settlement tombstones independently of expiring jobs and report caches.
 * A lost/evicted journal is a payments incident: disable settlement and reconcile
 * on-chain history before reopening, never silently fall back to memory. */
export class RobinhoodPaymentJournal implements RobinhoodJournal {
  constructor(private readonly redis: StoreRedis) {}
  private key(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid payment journal ID");
    return `pulse:payments:robinhood:v1:${id}`;
  }
  get(id: string) { return this.redis.get<RobinhoodAttempt>(this.key(id)); }
  async claim(attempt: RobinhoodAttempt) {
    return await this.redis.set(this.key(attempt.id), attempt, { nx: true }) === "OK";
  }
  async replace(previous: RobinhoodAttempt, next: RobinhoodAttempt) {
    if (next.id !== previous.id) throw new Error("Payment journal identity cannot change");
    return Number(await this.redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]); return 1 else return 0 end",
      [this.key(previous.id)], [JSON.stringify(previous), JSON.stringify(next)],
    )) === 1;
  }
}
