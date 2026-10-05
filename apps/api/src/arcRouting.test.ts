import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { decodeFunctionData, encodeFunctionResult, erc20Abi } from "viem";
import type { AppConfig } from "@pulse/config";
import { createV6Router } from "./v6Routes.js";
import { createAutopilotAutomationRouter } from "./autopilotAutomation.js";
import { ARC_USDC, ARC_OKX_MARKETS, arcMarketId } from "./arcMarkets.js";

test("Arc execution requires OKX data, keeps cirBTC visible, and rejects indexed tokens", async () => {
  const original=globalThis.fetch, meme="0x"+"1".repeat(40);
  const cfg={hasOkxCredentials:true,OKX_BASE_URL:"https://fixture.invalid",OKX_API_KEY:"fixture",OKX_SECRET_KEY:"fixture",OKX_PASSPHRASE:"fixture"} as AppConfig;
  const app=express();app.use(express.json());app.use(createV6Router(cfg));app.use(createAutopilotAutomationRouter(cfg)); const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve)); const origin="http://127.0.0.1:"+(server.address() as {port:number}).port;
  const routes:Array<{from:string;to:string}>=[]; let stale=false, gapped=false;
  globalThis.fetch=async (input,init)=> {
    const u=new URL(String(input));if(u.hostname==="127.0.0.1")return original(input,init);
    assert.notEqual(u.hostname,"www.arcodex.fun","execution must never consume the Risk Guard token index");
    if(u.pathname.includes("public/instruments"))return Response.json({code:"0",data:["ETH","BTC","MEME"].map(baseCcy=>({instId:baseCcy+"-USDT",baseCcy,quoteCcy:"USDT",state:"live"}))});
    if(u.pathname.endsWith("all-tokens"))return Response.json({code:"0",data:[{tokenSymbol:"BTC",tokenContractAddress:meme,decimals:8}]});
    if(u.pathname.endsWith("/ticker"))return Response.json({code:"0",data:[{instId:u.searchParams.get("instId"),last:"100",open24h:"99",high24h:"110",low24h:"90",vol24h:"10",volCcy24h:"1000",ts:String(Date.now()-(stale?200_000:0))}]});
    if(u.pathname.endsWith("/candles")) {
      const end=Math.floor(Date.now()/3_600_000)*3_600_000;
      const data=Array.from({length:60},(_,i)=>[String(end-(60-i)*3_600_000),"99","101","98","100","1","100","100","1"]);
      if(gapped)data.splice(25,1);return Response.json({code:"0",data:data.reverse()});
    }
    if(u.pathname.endsWith("/quote")) {
      const from=u.searchParams.get("fromTokenAddress")!,to=u.searchParams.get("toTokenAddress")!,amount=u.searchParams.get("amount")!;
      routes.push({from,to});return Response.json({code:"0",data:[{chainIndex:"5042",fromTokenAmount:amount,toTokenAmount:"1000000",fromToken:{tokenContractAddress:from,decimal:"6"},toToken:{tokenContractAddress:to,decimal:"18"}}]});
    }
    if(u.hostname.includes("mainnet.arc.io")) {
      const requests=JSON.parse(String(init?.body));
      const response=(r:any)=> {
        if(r.method==="eth_chainId")return {jsonrpc:"2.0",id:r.id,result:"0x13b2"};
        assert.equal(r.method,"eth_call");const market=ARC_OKX_MARKETS.find(m=>m.address===r.params[0].to.toLowerCase())!;
        const call=decodeFunctionData({abi:erc20Abi,data:r.params[0].data});
        return {jsonrpc:"2.0",id:r.id,result:call.functionName==="symbol"?encodeFunctionResult({abi:erc20Abi,functionName:"symbol",result:market.symbol}):encodeFunctionResult({abi:erc20Abi,functionName:"decimals",result:market.decimals})};
      };
      return Response.json(Array.isArray(requests)?requests.map(response):response(requests));
    }
    throw Error("Unexpected request: "+u.pathname);
  };
  try {
    const read=async(path:string)=>{const r=await fetch(origin+path);return {status:r.status,body:await r.json() as any};};
    const catalog=await read("/v1/trading/pairs?network=arc&limit=5000");
    assert.equal(catalog.status,200);assert.deepEqual(catalog.body.pairs.map((p:any)=>p.pair),["BTC-USDT","ETH-USDT"]);
    assert.equal(catalog.body.pairs[0].token.symbol,"cirBTC");assert.equal(catalog.body.pairs[0].executionPair,"cirBTC/USDC");
    const search=await read("/v1/trading/pairs?network=arc&q=cirBTC");assert.equal(search.body.total,1);assert.equal(search.body.pairs[0].pair,"BTC-USDT");
    for(const market of ARC_OKX_MARKETS) {
      const resolved=await read("/v1/trading/resolve-pair?network=arc&pair="+market.pair+"&custody=erc20");
      assert.equal(resolved.status,200);assert.equal(resolved.body.available,true);assert.equal(resolved.body.quote.address,ARC_USDC);
      assert.equal(resolved.body.base.address.toLowerCase(),market.address);
      const history=await read("/v1/autopilot/market-readiness?network=arc&pair="+market.pair+"&timeframe=1H");
      assert.equal(history.body.ready,true);assert.equal(history.body.signalSource,"okx-public-spot");assert.equal(history.body.walletTransactionsSent,false);
    }
    assert.equal(routes.length,4);
    const indexed=await read("/v1/trading/resolve-pair?network=arc&pair="+arcMarketId({symbol:"MEME",address:meme}));assert.equal(indexed.body.available,false);
    const lookalike=await read("/v1/trading/resolve-pair?network=arc&pair=MEME-USDT");assert.equal(lookalike.body.available,false);
    const before=routes.length;
    const quote=await fetch(origin+"/v1/trading/quote",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({network:"arc",fromTokenAddress:ARC_USDC,toTokenAddress:meme,amount:"1000000"})});
    assert.notEqual(quote.status,200);assert.match((await quote.json() as any).error,/Risk Guard/);assert.equal(routes.length,before);
    const badHistory=await read("/v1/autopilot/market-readiness?network=arc&pair="+arcMarketId({symbol:"MEME",address:meme})+"&timeframe=1H");assert.equal(badHistory.status,400);
    stale=true;
    const noData=await read("/v1/trading/resolve-pair?network=arc&pair=BTC-USDT");assert.equal(noData.body.available,false);
    const noHistory=await read("/v1/autopilot/market-readiness?network=arc&pair=BTC-USDT&timeframe=1H");assert.equal(noHistory.body.ready,false);assert.match(noHistory.body.reason,/OKX market data/);
    stale=false;gapped=true;
    const gaps=await read("/v1/autopilot/market-readiness?network=arc&pair=BTC-USDT&timeframe=1H");assert.equal(gaps.body.ready,false);assert.match(gaps.body.reason,/completed OKX candles/);
  } finally {globalThis.fetch=original;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
