import assert from "node:assert/strict";
import test, { describe, it } from "node:test";
import { ArcBudgetExceededError, MemoryArcBudgetStore, paymentPayer } from "./arcBudget.js";

const now = new Date("2026-08-03T12:00:00.000Z");
const wallet = "0x1111111111111111111111111111111111111111";

describe("Arc live AI budget", () => {
  it("extracts payer identity from an x402 v2 authorization", () => {
    const header = Buffer.from(JSON.stringify({ x402Version: 2, payload: { authorization: { from: wallet } } })).toString("base64");
    assert.equal(paymentPayer(header), wallet);
    assert.equal(paymentPayer("not-base64"), null);
  });

  it("enforces per-IP hourly usage", async () => {
    const store = new MemoryArcBudgetStore({ walletHourly: 10, ipHourly: 2, walletDaily: 10, dailyCostMicrousd: 1_000_000 });
    await store.reserve({ wallet, ip: "203.0.113.1", estimatedCostMicrousd: 1, now });
    await store.reserve({ wallet: wallet.replace(/1$/, "2"), ip: "203.0.113.1", estimatedCostMicrousd: 1, now });
    await assert.rejects(() => store.reserve({ wallet: wallet.replace(/1$/, "3"), ip: "203.0.113.1", estimatedCostMicrousd: 1, now }), (error) => error instanceof ArcBudgetExceededError && error.dimension === "ip_hourly");
    await assert.rejects(() => store.checkIp("203.0.113.1", now), ArcBudgetExceededError);
  });

  it("enforces wallet hourly and daily limits across IPs", async () => {
    const store = new MemoryArcBudgetStore({ walletHourly: 1, ipHourly: 10, walletDaily: 2, dailyCostMicrousd: 1_000_000 });
    await store.reserve({ wallet, ip: "ip-a", estimatedCostMicrousd: 1, now });
    await assert.rejects(() => store.reserve({ wallet, ip: "ip-b", estimatedCostMicrousd: 1, now }), (error) => error instanceof ArcBudgetExceededError && error.dimension === "wallet_hourly");
    await store.reserve({ wallet, ip: "ip-b", estimatedCostMicrousd: 1, now: new Date("2026-08-03T13:00:00Z") });
    await assert.rejects(() => store.reserve({ wallet, ip: "ip-c", estimatedCostMicrousd: 1, now: new Date("2026-08-03T14:00:00Z") }), (error) => error instanceof ArcBudgetExceededError && error.dimension === "wallet_daily");
  });

  it("reserves worst-case daily cost and deduplicates reservation IDs", async () => {
    const store = new MemoryArcBudgetStore({ walletHourly: 10, ipHourly: 10, walletDaily: 10, dailyCostMicrousd: 100 });
    await store.reserve({ wallet, ip: "ip", estimatedCostMicrousd: 60, reservationId: "same", now });
    await store.reserve({ wallet, ip: "ip", estimatedCostMicrousd: 60, reservationId: "same", now });
    await assert.rejects(() => store.reserve({ wallet, ip: "ip", estimatedCostMicrousd: 41, reservationId: "new", now }), (error) => error instanceof ArcBudgetExceededError && error.dimension === "daily_cost");
  });
});

test("concurrent memory reservations cannot exceed the IP limit", async () => {
  const store = new MemoryArcBudgetStore({ walletHourly: 100, ipHourly: 3, walletDaily: 100, dailyCostMicrousd: 1_000_000 });
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => store.reserve({ wallet: `${wallet.slice(0, -1)}${index}`, ip: "shared", estimatedCostMicrousd: 1, now })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
});
