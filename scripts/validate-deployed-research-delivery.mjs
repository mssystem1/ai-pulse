/** Five-service audit continuation. --execute buys only its explicit matrix.
 * A saved signed attempt is never replaced automatically. No trading actions. */
import assert from 'node:assert/strict';
import{config}from'dotenv';
import{existsSync,readFileSync,writeFileSync,mkdirSync}from'node:fs';
import{createPaidFetch}from'../packages/buyer/dist/index.js';
import{getNetwork}from'../packages/config/dist/index.js';
import{createPublicClient,http,parseAbi,decodeEventLog}from'viem';
import{privateKeyToAccount}from'viem/accounts';
config({quiet:true});
const origin='https://pulse-api-production-7aae.up.railway.app',root='.tmp/asp-audit',execute=process.argv.includes('--execute'),wallet=process.env.TEST_WALLET_ADDRESS,key=process.env.TEST_WALLET_PRIVATE_KEY;
assert.equal(privateKeyToAccount(key).address.toLowerCase(),wallet.toLowerCase());
const selection=JSON.parse(readFileSync(root+'/public/prediction-selection.json','utf8'));
const chosen=process.argv.find(arg=>arg.startsWith('--network='))?.slice(10)||'xlayer';assert.ok(['xlayer','base','arbitrum','arc'].includes(chosen));
const services=[['prediction-quick','/v1/analysis/prediction/standard',.20],['prediction-pro','/v1/analysis/prediction/premium',.30],...(process.argv.includes('--risk')?[['risk','/v1/preflight',.20]]:[])];
const budget=services.reduce((sum,[,,price])=>sum+price,0);assert.ok(budget<=.700001);
console.log(JSON.stringify({network:chosen,wallet,services,maximum:budget,execute}));if(!execute)process.exit(0);
mkdirSync(root+'/private',{recursive:true});mkdirSync(root+'/deliverables',{recursive:true});
// Discovery was already fetched for this audit; every fresh live challenge
// is still bound independently to the configured merchant, asset and price.
const metadata=JSON.parse(readFileSync(root+'/public/metadata.json','utf8')),merchant=process.env.PAY_TO_ADDRESS;assert.equal(metadata.asp.payTo.toLowerCase(),merchant.toLowerCase());
const net=getNetwork(chosen),rpcUrl=process.env[chosen.toUpperCase()+'_RPC_URL']||net.rpcUrls[0],client=createPublicClient({transport:http(rpcUrl,{timeout:20000,retryCount:0})});assert.equal(await client.getChainId(),net.chainId);
const abi=parseAbi(['function balanceOf(address) view returns(uint256)','event Transfer(address indexed from,address indexed to,uint256 value)']);
const results=[];
for(const[service,path,price]of services){
 const label=chosen+'-'+service,file=root+'/private/'+label+'.json',url=origin+'/'+chosen+path,body=JSON.stringify(service==='risk'?{tokenAddress:net.paymentAsset.address,chainId:String(net.chainId),lang:'en'}:selection.body);
 let state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{url,body,network:chosen,service,price};const save=()=>writeFileSync(file,JSON.stringify(state,null,2));assert.equal(state.url,url);assert.equal(state.body,body);
 try{
  if(!state.accepted){
   assert.ok(!state.signature,'Signed request needs reconciliation; never repay automatically');
   assert.ok(await client.readContract({address:net.paymentAsset.address,abi,functionName:'balanceOf',args:[wallet]})>=BigInt(Math.round(price*1e6)),'Insufficient settlement token');
   if(chosen==='arc'){
    const response=await fetch('https://gateway-api.circle.com/v1/balances',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'USDC',sources:[{domain:26,depositor:wallet}]}),signal:AbortSignal.timeout(20000)}),balances=await response.json();
    assert.ok(response.ok&&Number(balances.balances?.find(item=>item.domain===26)?.balance)>=price,'Insufficient Gateway USDC; no authorization signed');
   }
   let signed=0;
   const guarded=async(input,init)=>{
    const request=new Request(input,init),signature=request.headers.get('payment-signature');assert.equal(request.url,url);assert.equal(request.method,'POST');assert.deepEqual(await request.clone().json(),JSON.parse(body));
    if(signature){assert.equal(++signed,1);state.signature=signature;save();}
    let response;if(signature)response=await fetch(request);else{const retry=request.clone();try{response=await fetch(request);}catch{response=await fetch(retry);}}
    if(signature){state.httpStatus=response.status;state.accepted=await response.clone().json().catch(()=>null);state.receipt=response.headers.get('payment-response');save();}
    const required=response.headers.get('payment-required');if(response.status===402&&required){const challenge=JSON.parse(Buffer.from(required,'base64').toString()),accept=challenge.accepts?.[0];assert.equal(challenge.resource.url,url);assert.equal(challenge.accepts.length,1);assert.equal(accept.network,net.caip2);assert.equal(accept.asset.toLowerCase(),net.paymentAsset.address.toLowerCase());assert.equal(accept.payTo.toLowerCase(),merchant.toLowerCase());assert.equal(accept.amount,String(Math.round(price*1e6)));}
    return response;
   };
   await createPaidFetch({privateKey:key,rpcUrl,network:net.caip2,maxPaymentUsd:price,expectedPayTo:merchant,fetchImpl:guarded})(url,{method:'POST',headers:{'Content-Type':'application/json'},body});
  }
  assert.equal(state.httpStatus,service==='risk'?200:202);assert.ok(state.receipt);const receipt=JSON.parse(Buffer.from(state.receipt,'base64').toString());assert.equal(receipt.success,true);assert.equal(receipt.network,net.caip2);
  const accepted=state.accepted,jobId=accepted.job?.id||accepted.history?.jobId,recoveryToken=accepted.recoveryToken||accepted.history?.recoveryToken;assert.ok(jobId&&recoveryToken);
  console.log(JSON.stringify({check:'Paid research accepted',label,jobId,transaction:receipt.transaction,price}));
  const headers={'PULSE-RECOVERY-TOKEN':recoveryToken},statusUrl=origin+'/v1/jobs/'+jobId;let job;
  for(let attempt=0;attempt<150;attempt++){const response=await fetch(statusUrl,{headers,signal:AbortSignal.timeout(30000)});if(response.status===503){await new Promise(r=>setTimeout(r,3000));continue;}assert.equal(response.status,200);job=(await response.json()).job;state.job=job;save();if(['completed','completed_partial'].includes(job.stage))break;if(['failed_retriable','failed_terminal','manual_reconciliation'].includes(job.stage))throw Error('Paid job requires recovery: '+job.stage);await new Promise(r=>setTimeout(r,3000));}
  assert.ok(['completed','completed_partial'].includes(job?.stage));
  const response=await fetch(statusUrl+'/report',{headers});assert.equal(response.status,200);const delivered=await response.json();writeFileSync(root+'/private/'+label+'-delivery.json',JSON.stringify(delivered,null,2));
  assert.ok(delivered.reportMarkdown?.length>1000,'Paid report incomplete');
  const expectedSections=service==='risk'?['intelligence']:service==='prediction-pro'?['analysis','predictionContext','underlyingSpot']:['analysis','predictionContext'];
  for(const section of expectedSections)assert.ok(delivered.delivery?.sections?.includes(section),'Missing promised section: '+section);
  for(const section of delivered.delivery.sections)assert.ok(delivered.reportMarkdown.includes('## '+section.replace(/([a-z])([A-Z])/g,'$1 $2')),'Missing report section: '+section);
  if(service!=='risk')assert.ok(JSON.stringify(delivered.report).includes(selection.id),'Paid report must retain the selected market identity');
  const reopened=await fetch(statusUrl+'/report',{headers});assert.equal(reopened.status,200);assert.deepEqual((await reopened.json()).report,delivered.report);assert.equal((await fetch(statusUrl+'/report')).status,403);
  const mcp=await fetch(origin+'/'+chosen+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:8355,method:'tools/call',params:{name:'job_report',arguments:{jobId,recoveryToken}}})});assert.equal(mcp.status,200);assert.deepEqual((await mcp.json()).result.structuredContent.report,delivered.report);
  let transferVerified=false;
  if(chosen!=='arc'){const mined=await client.waitForTransactionReceipt({hash:receipt.transaction,timeout:60000});assert.equal(mined.status,'success');transferVerified=mined.logs.some(log=>{if(log.address.toLowerCase()!==net.paymentAsset.address.toLowerCase())return false;try{const d=decodeEventLog({abi,data:log.data,topics:log.topics});return d.eventName==='Transfer'&&d.args.from.toLowerCase()===wallet.toLowerCase()&&d.args.to.toLowerCase()===merchant.toLowerCase()&&d.args.value===BigInt(Math.round(price*1e6));}catch{return false;}});assert.ok(transferVerified);}
  writeFileSync(root+'/deliverables/'+label+'.md',delivered.reportMarkdown);
  results.push({label,ok:true,price,jobId,stage:job.stage,transaction:receipt.transaction,markdownBytes:Buffer.byteLength(delivered.reportMarkdown),sections:delivered.delivery.sections,fullDelivery:true,freeRecovery:true,mcpRecovery:true,transferVerified});
 }catch(error){results.push({label,ok:false,price,jobId:state.accepted?.job?.id||state.accepted?.history?.jobId,stage:state.job?.stage,httpStatus:state.httpStatus,error:error.shortMessage||error.message});}
 writeFileSync(root+'/'+chosen+'-research-results.json',JSON.stringify({checkedAt:new Date().toISOString(),wallet,budget,results},null,2));console.log(JSON.stringify(results.at(-1)));
}
process.exitCode=results.some(r=>!r.ok)?1:0;
