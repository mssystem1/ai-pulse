import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AppConfig } from "@pulse/config";
import { createV6Router } from "./v6Routes.js";
import { CURATED_EXECUTION_TOKENS } from "./curatedExecutionTokens.js";

test("expanded execution catalogs preserve categories and resolve added deployments", async () => {
  const original = globalThis.fetch;
  const instruments = ["UNI", "KAITO", "AAVE", "XAAPL", "XSPY", "PAXG"].map(baseCcy => ({ instId: `${baseCcy}-USDT`, baseCcy, quoteCcy: "USDT", state: "live", instCategory: baseCcy.startsWith("X") ? "3" : "1" }));
  const cfg = { hasOkxCredentials:true, OKX_BASE_URL:"https://example.test", OKX_API_KEY:"test", OKX_SECRET_KEY:"test", OKX_PASSPHRASE:"test" } as AppConfig;
  const app = express(); app.use(createV6Router(cfg));
  const server = app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve => server.once("listening",resolve));
  const port = (server.address() as {port:number}).port;
  let quoteOutage = false;
  globalThis.fetch = async (input,init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return original(input,init);
    if (url.pathname.includes("public/instruments")) return Response.json({code:"0",data:instruments});
    if (url.pathname.includes("all-tokens")) return Response.json({code:"0",data:[
      {tokenSymbol:"AAPLx",tokenName:"Apple xStock",tokenContractAddress:"0x"+"1".repeat(40),decimals:18},
      {tokenSymbol:"SPYx",tokenName:"SPDR xStock",tokenContractAddress:"0x"+"2".repeat(40),decimals:18},
      {tokenSymbol:"PAXG",tokenName:"Pax Gold",tokenContractAddress:"0x"+"3".repeat(40),decimals:18},
      {tokenSymbol:"USDC",tokenName:"USD Coin",tokenContractAddress:"0xaf88d065e77c8cC2239327C5EDb3A432268e5831",decimals:6},
    ]});
    if (url.pathname.includes("/quote")) return quoteOutage ? Response.json({code:"50011",msg:"Rate limit"},{status:429}) : Response.json({code:"0",data:[{toTokenAmount:"1000000",fromToken:{tokenSymbol:"USDC",decimal:"6"},toToken:{tokenSymbol:"AAVE",decimal:"18"}}]});
    throw new Error("Unexpected external request: "+url.pathname);
  };
  try {
    const base = await (await fetch(`http://127.0.0.1:${port}/v1/trading/pairs?network=base&limit=1000`)).json() as {pairs:Array<{pair:string;assetClass:string}>};
    assert.ok(base.pairs.some(item=>item.pair==="UNI-USDT"));
    assert.ok(base.pairs.some(item=>item.pair==="KAITO-USDT"));
    const arb = await (await fetch(`http://127.0.0.1:${port}/v1/trading/pairs?network=arbitrum&limit=1000&custody=erc20`)).json() as {pairs:Array<{pair:string;assetClass:string}>};
    assert.equal(arb.pairs.find(item=>item.pair==="XAAPL-USDT")?.assetClass,"tokenized_stock");
    assert.equal(arb.pairs.find(item=>item.pair==="XSPY-USDT")?.assetClass,"tokenized_etf");
    assert.equal(arb.pairs.find(item=>item.pair==="PAXG-USDT")?.assetClass,"rwa");
    assert.ok(arb.pairs.some(item=>item.pair==="AAVE-USDT"));
    const resolved=await (await fetch(`http://127.0.0.1:${port}/v1/trading/resolve-pair?network=arbitrum&pair=AAVE-USDT&custody=erc20`)).json() as {available:boolean;base:{address:string}};
    assert.equal(resolved.available,true);
    assert.equal(resolved.base.address.toLowerCase(),"0xba5ddd1f9d7f570dc94a51479a000e3bce967196");
    quoteOutage = true;
    const outage = await fetch(`http://127.0.0.1:${port}/v1/trading/resolve-pair?network=arbitrum&pair=AAVE-USDT&custody=erc20`);
    assert.equal(outage.status,502,"rate limits must not be labeled as confirmed missing routes");
    const keys=CURATED_EXECUTION_TOKENS.map(token=>`${token.chainId}:${token.address.toLowerCase()}`);
    assert.equal(new Set(keys).size,keys.length);
  } finally { globalThis.fetch=original; await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
