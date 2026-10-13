import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createPaidFetch } from "./index.js";
const privateKey = `0x${"1".repeat(64)}`;

test("agent buyer refuses retired Arc testnet before fetching or signing", () => {
  assert.throws(() => createPaidFetch({ privateKey, network: "eip155:5042002" }), /retired/);
});

test("agent buyer rejects a testnet Gateway domain on an Arc mainnet service", async () => {
  let calls = 0;
  const paid = createPaidFetch({ privateKey, network: "eip155:5042", fetchImpl: (async () => {
    calls++;
    const required = { x402Version: 2, resource: { url: "https://pulse.example/arc/v1/preflight", description: "Risk Guard", mimeType: "application/json" }, accepts: [{ scheme: "exact", network: "eip155:5042", asset: "0x3600000000000000000000000000000000000000", amount: "200000", payTo: `0x${"2".repeat(40)}`, maxTimeoutSeconds: 300, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } }] };
    return Response.json(required, { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(required)).toString("base64") } });
  }) as typeof fetch });
  await assert.rejects(() => paid("https://pulse.example/arc/v1/preflight", { method: "POST", body: "{}" }), /Gateway signing domain/);
  assert.equal(calls, 1);
});

test("Base paid fetch preserves the exact POST body across a native-fetch 402 retry",async()=>{
  const bodies:string[]=[],payTo=`0x${"2".repeat(40)}`,server=createServer(async(req,res)=>{let body="";for await(const chunk of req)body+=chunk;bodies.push(body);res.setHeader("Content-Type","application/json");if(!req.headers["payment-signature"]){const required={x402Version:2,resource:{url:`http://127.0.0.1:${(server.address() as {port:number}).port}/base/v1/analysis/spot/standard`,description:"Global Quick",mimeType:"application/json"},accepts:[{scheme:"exact",network:"eip155:8453",asset:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",amount:"200000",payTo,maxTimeoutSeconds:300,extra:{name:"USD Coin",version:"2"}}]};res.statusCode=402;res.setHeader("PAYMENT-REQUIRED",Buffer.from(JSON.stringify(required)).toString("base64"));res.end(JSON.stringify(required));}else res.end('{"ok":true}');});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/base/v1/analysis/spot/standard`,body=JSON.stringify({instId:"SOL-USDT",timeframe:"1H",lang:"en"}),paid=createPaidFetch({privateKey,network:"eip155:8453",maxPaymentUsd:.20,expectedPayTo:payTo});const response=await paid(url,{method:"POST",headers:{"Content-Type":"application/json"},body});assert.equal(response.status,200);assert.deepEqual(bodies,[body,body]);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
