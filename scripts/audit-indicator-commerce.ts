import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {createHash,createCipheriv,createDecipheriv,randomBytes,randomUUID} from "node:crypto";
import {generatePrivateKey,privateKeyToAccount} from "viem/accounts";
import {createPublicClient,http,decodeEventLog,parseAbi} from "viem";
import {createIndicatorPackage,createFormulaIndicatorPackage,exportIndicatorPackage} from "../packages/domain/src/indicatorMarket.js";
import {createPaidFetch} from "../packages/buyer/src/index.js";
import {grantTerminalPass,type TerminalStore} from "../apps/api/src/terminalStore.js";
import type {AppConfig} from "../packages/config/src/index.js";
import { getNetwork } from "../packages/config/src/index.js";
import { indicatorCommerceStores } from "../apps/api/src/terminalIndicatorCommerce.js";
import { BUILTIN_INDICATOR_DEPLOYMENTS } from "../packages/market/src/indicatorDeployments.js";

/** Real Base service purchase; the second creator's local access grant is an
 * explicit QA fixture. Its payout key is retained encrypted, never logged. */
export async function auditIndicatorCommerce({origin,cfg,store,buyerToken,folder,record}:{origin:string;cfg:AppConfig;store:TerminalStore;buyerToken:string;folder:URL;record:(name:string,detail?:Record<string,unknown>)=>void}){
  const encryptionKey=createHash("sha256").update(cfg.TEST_WALLET_PRIVATE_KEY+":indicator-creator-qa").digest();
  let creatorKey:`0x${string}`;
  try{const encrypted=JSON.parse(await readFile(new URL("qa-creator.enc.json",folder),"utf8")),decipher=createDecipheriv("aes-256-gcm",encryptionKey,Buffer.from(encrypted.iv,"base64"));decipher.setAuthTag(Buffer.from(encrypted.tag,"base64"));creatorKey=Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext,"base64")),decipher.final()]).toString() as `0x${string}`;}
  catch(error:any){if(error.code!=="ENOENT")throw error;creatorKey=generatePrivateKey();const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",encryptionKey,iv),bytes=Buffer.concat([cipher.update(creatorKey),cipher.final()]);await writeFile(new URL("qa-creator.enc.json",folder),JSON.stringify({iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),ciphertext:bytes.toString("base64")}));}
  const creator=privateKeyToAccount(creatorKey),buyer=privateKeyToAccount(cfg.TEST_WALLET_PRIVATE_KEY as `0x${string}`);assert.notEqual(creator.address,buyer.address);
  const request=async(path:string,body?:unknown,token=buyerToken,method=body===undefined?"GET":"POST")=>{const response=await fetch(origin+path,{method,headers:{"content-type":"application/json",authorization:`Bearer ${token}`},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(120000)});const data=await response.json();assert(response.ok,`Commerce ${response.status}: ${data.error??""}`);return data;};
  // Only the generated QA creator receives this synthetic local test grant.
  await store.mutate(creator.address,value=>{if(value.grants.length)return false;grantTerminalPass(value,{requestId:"indicator-commerce-creator-fixture",duration:"24h",priceUsd:"0",amountAtomic:"0",network:"fixture",asset:"fixture",paymentId:"qa-creator-access",purchasedAt:new Date().toISOString(),simulated:true});});
  const challenge=await request("/v1/terminal/auth/challenge",{wallet:creator.address});
  const creatorToken=(await request("/v1/terminal/auth/verify",{challengeId:challenge.challengeId,signature:await creator.signMessage({message:challenge.message})})).token;
  const manifest=createFormulaIndicatorPackage({id:"qa.service."+creator.address.slice(2).toLowerCase(),title:"QA weighted execution service",author:"PULSE QA creator",description:"Temporary QA service: actual custom weighted flow. Public formula; removed after validation.",version:"2.0.0",expression:"buy*2-sell",output:{label:"Weighted flow",unit:"volume",accumulation:"bar"}});
  const published=await request("/v1/terminal/indicators",{manifest,offer:{kind:"version-service",priceUsdc:"0.001",description:"Temporary QA managed installation of this custom indicator version."}},creatorToken);
  const listing=published.item;
  try{
  // Exercise actual configured payment challenges, never sign them. The
  // temporary unpurchased version is distinct from the paid recovery fixture.
  const quoteListing=(await request("/v1/terminal/indicators",{manifest:{...manifest,version:"3.0.0"},offer:{kind:"version-service",priceUsdc:"0.001",description:"Temporary unsigned payment-route validation only."}},creatorToken)).item;
  const testQuotes:string[]=[];
  try {
    const deployment=BUILTIN_INDICATOR_DEPLOYMENTS["pulse.weighted-flow"];
    const verified=await request(`/v1/terminal/indicators/${quoteListing.id}/registration`,{processor:deployment.processor,circuitId:deployment.circuitId,transactionHash:deployment.transactionHash},creatorToken);
    assert.equal(verified.item.registration.verified,true);assert.equal(verified.item.registration.circuitId,"3");record("creator_api_verifies_actual_xlayer_custom_numerical_circuit",{circuitId:"3",transaction:deployment.transactionHash,newTransaction:false});
    const catalog=await request("/v1/terminal/indicators"),routes=catalog.commerce.paymentNetworks;
    assert.deepEqual(routes.map((route:any)=>route.key).sort(),["arbitrum","base","xlayer"]);
    for(const route of routes){
      const quote=(await request(`/v1/terminal/indicators/${quoteListing.id}/quote`,{network:route.key,requestId:randomUUID()})).quote;testQuotes.push(quote.id);
      const response=await fetch(origin+`/${route.key}`+quote.path,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${buyerToken}`},body:JSON.stringify({requestId:quote.requestId}),signal:AbortSignal.timeout(90000)});
      assert.equal(response.status,402,`Unsigned ${route.key} challenge failed: ${response.status}`);
      const required=JSON.parse(Buffer.from(response.headers.get("PAYMENT-REQUIRED")!,"base64").toString()),option=required.accepts[0],network=getNetwork(route.key);
      assert.equal(required.accepts.length,1);assert.equal(option.network,network.caip2);assert.equal(option.asset.toLowerCase(),network.paymentAsset.address!.toLowerCase());assert.equal(option.amount,"1000");assert.equal(option.payTo.toLowerCase(),creator.address.toLowerCase());
      assert(required.resource.url.endsWith(`/${route.key}${quote.path}`));
      record("live_unsigned_indicator_quote_"+route.key,{token:network.paymentAsset.symbol,network:network.caip2,amountAtomic:option.amount,recipient:creator.address,paymentSigned:false});
    }
  } finally {
    await request(`/v1/terminal/indicators/${quoteListing.id}`,undefined,creatorToken,"DELETE");
    const {commerce}=indicatorCommerceStores(store);
    await commerce.mutate(buyer.address,value=>{value.indicatorPurchases=value.indicatorPurchases?.filter(p=>!testQuotes.includes(p.id)||p.state!=="quoted");});
  }
  let marker:any;const markerPath=new URL("service-purchase-v2.json",folder);
  try{marker=JSON.parse(await readFile(markerPath,"utf8"));}catch(error:any){if(error.code!=="ENOENT")throw error;marker={requestId:randomUUID(),attempted:false};}
  const existing=(await request("/v1/terminal/indicators/purchases")).purchases.find((p:any)=>p.listingId===listing.id);
  if(existing?.state==="granted")marker={...marker,quote:existing,transaction:existing.settlementTx};
  if(!marker.transaction){
    if(marker.attempted)throw Error("Prior service payment is uncertain; reconcile its saved quote/receipt instead of automatically paying again");
    const quote=(await request(`/v1/terminal/indicators/${listing.id}/quote`,{network:"base",requestId:marker.requestId})).quote;
    assert.equal(quote.amountAtomic,"1000");assert.equal(quote.payee.toLowerCase(),creator.address.toLowerCase());assert.equal(quote.network,"base");marker.quote=quote;await writeFile(markerPath,JSON.stringify(marker,null,2));
    assert(process.argv.includes("--spend"),"A new 0.001 USDC Base QA service purchase requires --spend");
    const paid=createPaidFetch({privateKey:cfg.TEST_WALLET_PRIVATE_KEY,network:"eip155:8453",rpcUrl:cfg.BASE_RPC_URL,maxPaymentUsd:.001,expectedPayTo:creator.address});
    marker.attempted=true;await writeFile(markerPath,JSON.stringify(marker,null,2));
    const response=await paid(origin+"/base"+quote.path,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${buyerToken}`},body:JSON.stringify({requestId:quote.requestId})});const data=await response.json();
    if(data.purchase?.settlementTx)marker.transaction=data.purchase.settlementTx;else if(data.transactionHash)marker.transaction=data.transactionHash;
    if(!response.ok)marker.error={status:response.status,message:String(data.error??"Payment rejected"),code:data.code,doNotPayAgain:data.doNotPayAgain};
    await writeFile(markerPath,JSON.stringify(marker,null,2));assert(response.ok,`Original indicator payment needs recovery; do not pay twice. HTTP ${response.status}: ${String(data.error??"").slice(0,200)}`);
  }
  assert.match(marker.transaction??"",/^0x[\da-f]{64}$/i);
  const rpc=createPublicClient({transport:http(cfg.BASE_RPC_URL)}),receipt=await rpc.waitForTransactionReceipt({hash:marker.transaction,timeout:90000});assert.equal(receipt.status,"success");
  let matched=false;for(const log of receipt.logs.filter(log=>log.address.toLowerCase()===marker.quote.asset.toLowerCase()))try{const event=decodeEventLog({abi:parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]),data:log.data,topics:log.topics});if(event.args.from.toLowerCase()===buyer.address.toLowerCase()&&event.args.to.toLowerCase()===creator.address.toLowerCase()&&event.args.value===1000n)matched=true;}catch{}
  assert(matched);record("real_base_creator_service_payment",{amountUSDC:"0.001",transaction:marker.transaction,creator:creator.address,creatorAccess:"explicit synthetic QA grant; buyer uses real paid pass"});
  const restored=await request(`/v1/terminal/indicators/${listing.id}`);assert(restored.item.entitled);assert.equal(exportIndicatorPackage(restored.manifest),exportIndicatorPackage(manifest));
  const replay=await request("/base"+marker.quote.path,{requestId:marker.quote.requestId});assert(replay.entitled);assert(replay.recovered);
  const purchases=await request("/v1/terminal/indicators/purchases"),sales=await request("/v1/terminal/indicators/purchases",undefined,creatorToken);assert.equal(purchases.purchases.filter((p:any)=>p.listingId===listing.id&&p.state==="granted").length,1);assert.equal(sales.sales.filter((s:any)=>s.listingId===listing.id).length,1);
  await request(`/v1/terminal/indicators/${listing.id}`,undefined,creatorToken,"DELETE");
  const after=await request(`/v1/terminal/indicators/${listing.id}`);assert(after.item.entitled);assert.equal(exportIndicatorPackage(after.manifest),exportIndicatorPackage(manifest));
  record("paid_custom_formula_receipt_replay_creator_sale_and_delisted_restore",{listingId:listing.id,formula:manifest.formula.expression});
  } finally {try{await request(`/v1/terminal/indicators/${listing.id}`,undefined,creatorToken,"DELETE");}catch{/* Only this generated QA listing is affected. */}
  const remaining=(await request("/v1/terminal/indicators",undefined,creatorToken)).items.filter((item:any)=>item.publisher===creator.address.toLowerCase()&&item.manifestId===manifest.id&&item.title===manifest.title);
  for(const item of remaining)await request(`/v1/terminal/indicators/${item.id}`,undefined,creatorToken,"DELETE");
  // Remove the generated creator's synthetic access fixture only. Its encrypted
  // payout key and immutable sale/receipt are retained for reconciliation.
  await store.storage.take(store.key("owner",creator.address.toLowerCase()));
  }
  await writeFile(new URL("commerce-validation.json",folder),JSON.stringify({at:new Date().toISOString(),passed:true,listingId:listing.id,transaction:(JSON.parse(await readFile(new URL("service-purchase-v2.json",folder),"utf8"))).transaction,amountAtomic:"1000",creator:creator.address,scope:"Real Base buyer payment and durable service entitlement; creator access was a synthetic local QA fixture, no exchange order or Telegram send"},null,2));
}
