import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AppConfig } from "@pulse/config";
import { createV6Router } from "./v6Routes.js";
import { ARC_USDC, arcMarketId } from "./arcMarkets.js";

test("Arc uses canonical settlement, includes native memes and separates duplicate tickers", async () => {
  const original=globalThis.fetch, target="0x"+"1".repeat(40), other="0x"+"2".repeat(40);
  const cfg={hasOkxCredentials:true,OKX_BASE_URL:"https://fixture.invalid",OKX_API_KEY:"fixture",OKX_SECRET_KEY:"fixture",OKX_PASSPHRASE:"fixture"} as AppConfig;
  const app=express();app.use(createV6Router(cfg)); const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve)); const origin="http://127.0.0.1:"+(server.address() as {port:number}).port;
  const routes:Array<{from:string;to:string}>=[];
  globalThis.fetch=async (input,init)=> {
    const u=new URL(String(input));if(u.hostname==="127.0.0.1")return original(input,init);
    if(u.hostname==="www.arcodex.fun")return Response.json({tokens:[{address:target,symbol:"MEME",name:"Arc meme",decimals:18,hasUsdc:true}, {address:other,symbol:"MEME",decimals:18}]});
    if(u.pathname.includes("public/instruments"))return Response.json({code:"0",data:["ETH","BTC"].map(baseCcy=>({instId:baseCcy+"-USDT",baseCcy,quoteCcy:"USDT",state:"live"}))});
    if(u.pathname.endsWith("all-tokens"))return Response.json({code:"0",data:[]});
    if(u.pathname.endsWith("/quote")) {
      const from=u.searchParams.get("fromTokenAddress")!,to=u.searchParams.get("toTokenAddress")!,amount=u.searchParams.get("amount")!;
      routes.push({from,to});return Response.json({code:"0",data:[{chainIndex:"5042",fromTokenAmount:amount,toTokenAmount:"1000000",fromToken:{tokenContractAddress:from,decimal:"6"},toToken:{tokenContractAddress:to,decimal:"18"}}]});
    }
    throw Error("Unexpected request: "+u.pathname);
  };
  try {
    const b=await (await fetch(origin+"/v1/trading/pairs?network=arc&limit=5000")).json() as {pairs:Array<{pair:string;token:{address:string}}>};
    assert.ok(b.pairs.some(p=>p.pair==="ETH-USDT"));assert.ok(b.pairs.some(p=>p.pair==="BTC-USDT"));
    assert.ok(b.pairs.some(p=>p.pair===arcMarketId({address:target,symbol:"MEME"})));
    assert.ok(b.pairs.some(p=>p.pair===arcMarketId({address:other,symbol:"MEME"})));
    const response=await fetch(origin+"/v1/trading/resolve-pair?network=arc&pair=ETH-USDT&custody=erc20");
    const resolved=await response.json() as {available:boolean;quote:{address:string};base:{address:string}};
    assert.equal(response.status,200);assert.equal(resolved.available,true);assert.equal(resolved.quote.address,ARC_USDC);
    assert.equal(resolved.base.address.toLowerCase(),"0x128cc466b61f542da60c70e3aa11c10e19b84edb");
    assert.equal(routes.length,2);assert.equal(routes[0].from,ARC_USDC);assert.equal(routes[1].to,ARC_USDC);
  } finally {globalThis.fetch=original;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
