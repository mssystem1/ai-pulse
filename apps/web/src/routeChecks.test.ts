import assert from "node:assert/strict";
import test from "node:test";
import { createRouteChecks, routeSortRank, type RouteCheck } from "./routeChecks";

test("route checks deduplicate, expire and isolate network and custody", async () => {
  let time = 0, calls = 0;
  const check = createRouteChecks(async () => { calls++; return { status: "available" }; }, () => time);
  const first = check("arbitrum", "BTC-USDT", "wallet");
  assert.equal(check("arbitrum", "btc-usdt", "wallet"), first);
  await first;
  await check("base", "BTC-USDT", "wallet");
  await check("arbitrum", "BTC-USDT", "erc20");
  assert.equal(calls, 3);
  time = 60_001;
  await check("arbitrum", "BTC-USDT", "wallet");
  assert.equal(calls, 4);
});

test("route-first ordering updates on completion without losing chain/custody isolation", async () => {
  let time = 0, updates = 0;
  const check = createRouteChecks(async (_network, pair) => ({ status: pair === "CRV" ? "available" : "unavailable" }), () => time);
  const unsubscribe = check.subscribe(() => { updates++; });
  await check("arbitrum", "XBSP", "wallet");
  await check("arbitrum", "CRV", "wallet");
  assert.deepEqual(["XBSP", "CRV", "COMP"].sort((a,b) => routeSortRank(true,check.peek("arbitrum",a,"wallet"))-routeSortRank(true,check.peek("arbitrum",b,"wallet"))), ["CRV", "COMP", "XBSP"]);
  assert.equal(check.peek("base", "CRV", "wallet"), undefined);
  assert.equal(check.peek("arbitrum", "CRV", "erc20"), undefined);
  assert.ok(routeSortRank(false) > routeSortRank(true, {status:"unavailable"}));
  assert.equal(updates,2);
  unsubscribe(); time=60_001;
  assert.equal(check.peek("arbitrum", "CRV", "wallet"),undefined);
});

test("automatic catalog checks cap concurrency and recover after transport failure", async () => {
  let time = 0, active = 0, peak = 0;
  const release: Array<() => void> = [];
  const check = createRouteChecks(async (_network, pair) => {
    active++; peak = Math.max(peak, active);
    await new Promise<void>(resolve => release.push(resolve)); active--;
    if (pair === "FAIL") throw new Error("offline");
    return { status: "unavailable" } as RouteCheck;
  }, () => time);
  const requests = ["BTC", "ETH", "FAIL"].map(pair => check("arbitrum", pair, "wallet"));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(release.length, 2);
  release.shift()!(); release.shift()!();
  await new Promise(resolve => setTimeout(resolve, 0));
  release.shift()!();
  const results = await Promise.all(requests);
  assert.equal(peak, 2);
  assert.deepEqual(results.map(result => result.status), ["unavailable", "unavailable", "error"]);
  time = 15_001;
  const retry = check("arbitrum", "FAIL", "wallet");
  assert.notEqual(retry, requests[2]);
  await new Promise(resolve => setTimeout(resolve, 0)); release.shift()!(); await retry;
});
