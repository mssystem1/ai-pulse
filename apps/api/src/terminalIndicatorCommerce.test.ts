import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { getNetwork, loadConfig } from "@pulse/config";
import { createIndicatorPackage, exportIndicatorPackage } from "@pulse/domain";
import { createTerminalIndicatorRoutes } from "./terminalIndicatorRoutes.js";
import { TerminalStore, MemoryTerminalStorage, grantTerminalPass } from "./terminalStore.js";
import { indicatorAtomic, indicatorOffer, indicatorPaymentNetworks, indicatorCommerceStores } from "./terminalIndicatorCommerce.js";
import type { verifyTerminalPurchaseReceipt } from "./terminalPayments.js";
import type { IndicatorPaymentNetwork } from "./terminalIndicatorTypes.js";

const seller = "0x" + "11".repeat(20), buyer = "0x" + "22".repeat(20), stranger = "0x" + "33".repeat(20);
async function fixture(networks: IndicatorPaymentNetwork[] = ["base"], verifyReceipt?: typeof verifyTerminalPurchaseReceipt) {
  let now = Date.now(), settlements = 0;
  const cfg = { ...loadConfig(), NODE_ENV: "test" as const, X402_MOCK: true, FEATURE_TRADING_TERMINAL: true, FEATURE_BASE_PAYMENTS: true, FEATURE_ARBITRUM_PAYMENTS: true, enabledNetworks: networks };
  const store = new TerminalStore(new MemoryTerminalStorage(), randomUUID(), 180);
  for (const owner of [seller, buyer, stranger]) await store.mutate(owner, value => { grantTerminalPass(value, { requestId: randomUUID(), duration: "24h", priceUsd: "1.5", amountAtomic: "1500000", network: "base", asset: "USDC", paymentId: randomUUID(), purchasedAt: new Date(now).toISOString(), simulated: true }); });
  const app = express(); app.use(express.json({ limit: "1mb" })); app.use((req, res, next) => { res.locals.terminalOwner = req.get("x-owner") ?? buyer; (req as any).pulseNetworkKey = req.get("x-network") ?? "base"; next(); });
  app.use(createTerminalIndicatorRoutes({ store, cfg, now: () => now }, { verifyReceipt, paymentGate: dynamic => (req, res, next) => {
    const path = req.path, route = dynamic.routes[`POST ${path}`];
    assert.equal(dynamic.PAY_TO_ADDRESS, seller); assert.equal(route.priceUsd, .123456);
    if (!req.get("PAYMENT-SIGNATURE")) return res.status(402).json({ amount: "123456", payTo: seller });
    if(req.get("PAYMENT-SIGNATURE")==="rejected-before-settlement"){(req as any).pulsePaymentFailure={phase:"verification",definitiveNoSettlement:true};return res.status(402).json({error:"QA verification rejected"});}
    settlements++; (req as any).pulseSettlement = { result: { success: true, transaction: "0x" + "44".repeat(32) }, settledAt: new Date(now).toISOString() };
    setTimeout(next, 15);
  } }));
  app.use((error: Error, _req: unknown, res: express.Response, _next: unknown) => res.status(400).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/v1/terminal/indicators`;
  const request = (path = "", method = "GET", body?: unknown, owner = buyer, proof?: string, network = "base") => fetch(base + path, { method, headers: { "content-type": "application/json", "x-owner": owner, "x-network": network, ...(proof ? { "PAYMENT-SIGNATURE": proof } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const manifest = createIndicatorPackage({ id: "creator.test-flow", title: "Creator flow", author: "Creator", description: "Managed executed volume indicator installation.", kernel: "executed-cvd-v1" });
  const offer = { priceUsdc: "0.123456" }, published = await request("", "POST", { manifest, offer }, seller);
  assert.equal(published.status, 201); const item = (await published.json()).item;
  const quote = async (network: IndicatorPaymentNetwork = "base") => { const response = await request(`/${item.id}/quote`, "POST", { requestId: randomUUID(), network }); assert.equal(response.status, 201); return (await response.json()).quote; };
  return { request, item, manifest, quote, store, settlements: () => settlements, advance: (ms: number) => now += ms, close: async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); } };
}
test("creator stablecoin prices preserve six decimals and reject malformed or excessive prices", () => {
  assert.equal(indicatorAtomic(indicatorOffer({ priceUsdc: "0.000001" },1000,.000001)!.priceUsdc), "1");
  assert.throws(()=>indicatorOffer({priceUsdc:"0.000001"}),/settlement minimum/);
  assert.equal(indicatorAtomic("1000.123456"), "1000123456");
  assert.equal(indicatorOffer({ priceUsdc: "0" }), undefined);
  for (const priceUsdc of ["-1", "1e2", "0.1234567", "1001", "NaN"]) assert.throws(() => indicatorOffer({ priceUsdc }));
});

test("only configured creator payment routes are advertised", () => {
  const cfg = { ...loadConfig(), X402_MOCK: false, enabledNetworks: ["xlayer", "base", "arbitrum"] as IndicatorPaymentNetwork[], FEATURE_BASE_PAYMENTS: true, FEATURE_ARBITRUM_PAYMENTS: true, hasOkxCredentials: true, CDP_API_KEY_ID: "", CDP_API_KEY_SECRET: "" };
  assert.deepEqual(indicatorPaymentNetworks(cfg).map(n => n.key), ["xlayer"]);
  assert.deepEqual(indicatorPaymentNetworks({ ...cfg, hasOkxCredentials: false }), []);
  assert.deepEqual(indicatorPaymentNetworks({ ...cfg, CDP_API_KEY_ID: "configured", CDP_API_KEY_SECRET: "configured" }).map(n => n.key), ["xlayer", "base", "arbitrum"]);
});

for (const network of ["xlayer", "base", "arbitrum"] as const) {
  test(`creator checkout binds ${network} token, route and recipient and retains cross-network ownership`, async () => {
    const f = await fixture(["xlayer", "base", "arbitrum"]);
    try {
      const catalog = await (await f.request()).json();
      assert.equal(catalog.commerce.paymentNetworks.find((n: any) => n.key === network).asset, getNetwork(network).paymentAsset.address);
      const quote = await f.quote(network), wrong = network === "base" ? "xlayer" : "base";
      assert.equal(quote.network, network);
      assert.equal(quote.asset, getNetwork(network).paymentAsset.address);
      assert.equal(quote.assetSymbol, getNetwork(network).paymentAsset.symbol);
      assert.equal(quote.amountAtomic, "123456");
      assert(quote.resource.includes(`/${network}/v1/terminal/indicators/purchases/`));
      const conflicting = await f.request(`/${f.item.id}/quote`, "POST", { requestId: quote.requestId, network: wrong });
      assert.equal(conflicting.status, 409);
      assert.equal((await f.request(`/purchases/${quote.id}`, "POST", { requestId: quote.requestId }, buyer, "proof", wrong)).status, 422);
      assert.equal(f.settlements(), 0);
      assert.equal((await f.request(`/purchases/${quote.id}`, "POST", { requestId: quote.requestId }, buyer, "proof", network)).status, 201);
      assert.equal((await f.request(`/purchases/${quote.id}`, "POST", { requestId: quote.requestId }, buyer, "proof", network)).status, 200);
      assert.equal(f.settlements(), 1);
      const again = await f.request(`/${f.item.id}/quote`, "POST", { requestId: randomUUID(), network: wrong });
      assert.equal(again.status, 409);
      assert.equal((await again.json()).entitled, true);
      const sales = await (await f.request("/purchases", "GET", undefined, seller)).json();
      assert.equal(sales.sales[0].network, network);
      assert.equal(sales.sales[0].asset, getNetwork(network).paymentAsset.address);
    } finally { await f.close(); }
  });
}

test("disabled creator checkout refuses a quote before any settlement", async () => {
  const f = await fixture();
  try {
    const response = await f.request(`/${f.item.id}/quote`, "POST", { requestId: randomUUID(), network: "xlayer" });
    assert.equal(response.status, 503);
    assert.equal(f.settlements(), 0);
  } finally { await f.close(); }
});
test("definitive facilitator verification rejection releases only the unpaid authorization",async()=>{
  const f=await fixture();try{const q=await f.quote(),rejected=await f.request(`/purchases/${q.id}`,"POST",{requestId:q.requestId},buyer,"rejected-before-settlement");assert.equal(rejected.status,402);const body=await rejected.json();assert.equal(body.code,"indicator_payment_not_settled");assert.equal(body.doNotPayAgain,false);assert.equal(f.settlements(),0);const purchases=await (await f.request("/purchases")).json();assert.equal(purchases.purchases.find((p:any)=>p.id===q.id).state,"quoted");assert.equal((await f.request(`/purchases/${q.id}`,"POST",{requestId:q.requestId},buyer,"accepted-proof")).status,201);assert.equal(f.settlements(),1);}finally{await f.close();}
});
test("one creator payment grants version service, repairs retries and restores after delisting", async () => {
  const f = await fixture();
  try {
    const q = await f.quote(); assert.equal(q.payee, seller); assert.equal(q.amountAtomic, "123456"); assert.equal(q.platformFeeAtomic, "0");
    assert.equal((await f.request(`/purchases/${q.id}`, "POST", { requestId: q.requestId })).status, 402);
    assert.equal((await f.request(`/purchases/${q.id}`, "POST", { requestId: q.requestId }, stranger, "proof")).status, 404);
    assert.equal((await f.request(`/purchases/${q.id}`, "POST", { requestId: q.requestId }, buyer, "proof", "arbitrum")).status, 422);
    const paid = await f.request(`/purchases/${q.id}`, "POST", { requestId: q.requestId }, buyer, "proof"); assert.equal(paid.status, 201); assert((await paid.json()).entitled);
    assert.equal((await f.request(`/purchases/${q.id}`, "POST", { requestId: q.requestId }, buyer, "proof")).status, 200);
    assert.equal(f.settlements(), 1);
    const catalog = await (await f.request()).json(); assert.equal(catalog.items.find((i: any) => i.id === f.item.id).entitled, true);
    assert.equal((await f.request(`/${f.item.id}`, "DELETE", undefined, seller)).status, 200);
    const restored = await (await f.request(`/${f.item.id}`)).json(); assert.deepEqual(restored.manifest, f.manifest); assert.equal(restored.item.entitled, true);
    assert.equal((await f.request(`/${f.item.id}`, "GET", undefined, stranger)).status, 404);
    const sales = await (await f.request("/purchases", "GET", undefined, seller)).json(); assert.equal(sales.sales.length, 1); assert.equal(sales.sales[0].priceUsdc, "0.123456");
    const purchases = await (await f.request("/purchases")).json(); assert.equal(purchases.purchases[0].nonce, undefined); assert.equal(purchases.sales.length, 0);
    assert.equal((await f.request(`/purchases/${q.id}/recover`, "POST", {})).status, 200);
  } finally { await f.close(); }
});
test("simultaneous quotes for the same version cannot cause two settlements", async () => {
  const f = await fixture();
  try {
    const [a, b] = await Promise.all([f.quote(), f.quote()]);
    const responses = await Promise.all([a, b].map(q => f.request(`/purchases/${q.id}`, "POST", { requestId: q.requestId }, buyer, `proof-${q.id}`)));
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]); assert.equal(f.settlements(), 1);
  } finally { await f.close(); }
});
test("expired quotes and removed listings reject payment before settlement", async () => {
  const f = await fixture();
  try {
    const q = await f.quote(); f.advance(3600001);
    assert.equal((await f.request(`/purchases/${q.id}`, "POST", { requestId: q.requestId }, buyer, "proof")).status, 409);
    const second = await f.quote(); await f.request(`/${f.item.id}`, "DELETE", undefined, seller);
    assert.equal((await f.request(`/purchases/${second.id}`, "POST", { requestId: second.requestId }, buyer, "proof")).status, 409);
    assert.equal(f.settlements(), 0);
  } finally { await f.close(); }
});
test("creator version price is immutable and unrelated wallets cannot attach a deployment", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request("", "POST", { manifest: f.manifest, offer: { priceUsdc: "0.2" } }, seller)).status, 409);
    assert.equal((await f.request(`/${f.item.id}/registration`, "POST", { processor: seller, circuitId: "1" }, buyer)).status, 403);
  } finally { await f.close(); }
});

test("delisting keeps immutable version terms and permits only identical relisting for a pending quote", async () => {
  const f = await fixture();
  try {
    const q = await f.quote();
    assert.equal((await f.request(`/${f.item.id}`, "DELETE", undefined, seller)).status, 200);
    const changedFormula = await f.request("", "POST", { manifest: { ...f.manifest, title: "Changed same-version formula package" }, offer: { priceUsdc: "0.123456" } }, seller);
    assert.equal(changedFormula.status, 409);
    assert.equal((await f.request("", "POST", { manifest: f.manifest, offer: { priceUsdc: "0.2" } }, seller)).status, 409);
    const relisted = await f.request("", "POST", { manifest: f.manifest, offer: { priceUsdc: "0.123456" } }, seller);
    assert.equal(relisted.status, 201);
    assert.equal((await relisted.json()).item.id, f.item.id);
    // The original immutable quote still names the same bytes, terms and ID.
    assert.equal((await f.request(`/purchases/${q.id}`, "POST", { requestId: q.requestId }, buyer, "proof")).status, 201);
    assert.equal(f.settlements(), 1);
    assert.equal((await f.request(`/${f.item.id}`, "DELETE", undefined, seller)).status, 200);
    assert.equal((await f.request("", "POST", { manifest: f.manifest, offer: { priceUsdc: "0.123456" } }, seller)).status, 201);
    const restored = await (await f.request(`/${f.item.id}`)).json();
    assert.equal(restored.item.sha256, q.sha256);
    assert.deepEqual(restored.manifest, f.manifest);
  } finally { await f.close(); }
});

test("legacy delisting migrates version identity before removing its last catalog entry", async () => {
  const f = await fixture();
  try {
    const versions = new TerminalStore(f.store.storage, f.store.key("indicator-version-registry", "v1"), 3650);
    await f.store.storage.take(versions.key("owner", seller)); // Emulate a pre-ledger publication with no sales.
    assert.equal((await f.request(`/${f.item.id}`, "DELETE", undefined, seller)).status, 200);
    assert.equal((await f.request("", "POST", { manifest: { ...f.manifest, title: "Rewritten legacy version" }, offer: { priceUsdc: "0.123456" } }, seller)).status, 409);
    assert.equal((await f.request("", "POST", { manifest: f.manifest, offer: { priceUsdc: "0.123456" } }, seller)).status, 201);
  } finally { await f.close(); }
});

test("a purchased receipt restores its exact bytes even if a legacy catalog version was replaced", async () => {
  const f = await fixture();
  try {
    const q = await f.quote();
    assert.equal((await f.request(`/purchases/${q.id}`, "POST", { requestId: q.requestId }, buyer, "proof")).status, 201);
    const registry = new TerminalStore(f.store.storage, f.store.key("indicator-registry", "v1"), 365);
    const changed = { ...f.manifest, title: "Different legacy catalog bytes" }, bytes = exportIndicatorPackage(changed), sha256 = createHash("sha256").update(bytes).digest("hex");
    await registry.storage.write(registry.key("package", sha256), { bytes }, 3650 * 86400);
    await registry.mutate("0x" + "0".repeat(40), value => {
      const item = value.indicatorPublications!.find(p => p.id === f.item.id)!;
      item.sha256 = sha256; item.packageRef = sha256; item.title = changed.title;
    });
    const restored = await (await f.request(`/${f.item.id}`)).json();
    assert.deepEqual(restored.manifest, f.manifest);
    assert.equal(restored.item.sha256, q.sha256);
    assert.equal(restored.item.entitled, true);
    for (const privateKey of ["packageRef", "nonce", "paymentId", "preparedBlock", "requestId", "owner"]) assert.equal(privateKey in restored.item, false);
  } finally { await f.close(); }
});

test("publishing identical public bytes cannot shorten a purchased package's recovery retention", async () => {
  const f = await fixture();
  try {
    const packageTtls: number[] = [], write = f.store.storage.write.bind(f.store.storage);
    f.store.storage.write = async (key, value, ttl) => { if (key.includes(":terminal:package:")) packageTtls.push(ttl); await write(key, value, ttl); };
    const q = await f.quote();
    assert.equal((await f.request(`/purchases/${q.id}`, "POST", { requestId: q.requestId }, buyer, "proof")).status, 201);
    assert.equal((await f.request("", "POST", { manifest: f.manifest, offer: { priceUsdc: "0.123456" } }, stranger)).status, 201);
    assert(packageTtls.length >= 2);
    assert(packageTtls.every(ttl => ttl >= 3650 * 86400));
  } finally { await f.close(); }
});

test("failed reservation before the settlement adapter leaves an unpaid quote retryable",async()=>{
 const f=await fixture();try{
  const q=await f.quote(),compare=f.store.storage.compareAndSet.bind(f.store.storage);let fail=true;
  f.store.storage.compareAndSet=async(key,revision,value,ttl,index)=>{if(fail&&key.includes("indicator-registry")&&Object.keys(value.indicatorClaims??{}).length){fail=false;throw Error("Injected reservation outage");}return compare(key,revision,value,ttl,index);};
  const response=await f.request(`/purchases/${q.id}`,"POST",{requestId:q.requestId},buyer,"one-proof");
  assert.equal(response.status,409);assert.equal((await response.json()).doNotPayAgain,false);assert.equal(f.settlements(),0);
  assert.equal((await (await f.request("/purchases")).json()).purchases.find((p:any)=>p.id===q.id).state,"quoted");
  assert.equal((await f.request(`/purchases/${q.id}`,"POST",{requestId:q.requestId},buyer,"one-proof")).status,201);assert.equal(f.settlements(),1);
 }finally{await f.close();}
});

test("lost settlement acknowledgement recovers the saved network authorization after pass expiry without charging",async()=>{
 let verified=false;
 const f=await fixture(["base","arbitrum"],async(owner,purchase,hash)=>{assert.equal(owner,buyer);assert.equal(purchase.network,"arbitrum");assert.equal(purchase.asset,getNetwork("arbitrum").paymentAsset.address);assert.equal(purchase.amountAtomic,"123456");assert.equal(purchase.nonce,"0x"+"55".repeat(32));assert.equal(purchase.preparedBlock,"100");verified=true;return {settlementTx:hash,settledAt:new Date().toISOString()};});
 try{const q=await f.quote("arbitrum"),{commerce}=indicatorCommerceStores(f.store);await commerce.mutate(buyer,value=>{const p=value.indicatorPurchases!.find(p=>p.id===q.id)!;p.state="authorizing";p.simulated=false;p.nonce="0x"+"55".repeat(32);p.preparedBlock="100";p.paymentId="original-intent";});f.advance(25*3600000);
 const recovered=await f.request(`/purchases/${q.id}/recover`,"POST",{transactionHash:"0x"+"66".repeat(32)});assert.equal(recovered.status,200);assert.equal((await recovered.json()).entitled,true);assert(verified);assert.equal(f.settlements(),0);
 assert.equal((await f.request(`/purchases/${q.id}/recover`,"POST",{})).status,200);assert.equal(f.settlements(),0);
 }finally{await f.close();}
});
