// Bounded verification of restored records. Only wallet sign-in messages are
// signed. No payment headers, order endpoints, report retries or workers.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {privateKeyToAccount} from 'viem/accounts';
import {exportIndicatorPackage} from '../packages/domain/src/indicatorMarket.js';
import {runNativeRedisCommand,closeNativeRedisConnections} from '../apps/api/src/nativeRedis.js';
assert(process.argv.includes('--live'),'Use --live for bounded recovery verification');
const owner=privateKeyToAccount(process.env.TEST_WALLET_PRIVATE_KEY as `0x${string}`);assert.equal(owner.address.toLowerCase(),process.env.TEST_WALLET_ADDRESS?.toLowerCase());
const origin='https://pulse-api-production-7aae.up.railway.app',webOrigin='https://app.ai-pulse.tech',folder='.tmp/test-wallet-recovery';
const plan=JSON.parse(readFileSync(folder+'/plan.json','utf8')),receipts=JSON.parse(readFileSync(folder+'/receipt-plan.json','utf8')),checks:any[]=[];
const record=(check:string,details:any={})=>{const value={check,...details};checks.push(value);console.log(JSON.stringify(value));};
const command=(...args:any[])=>runNativeRedisCommand(process.env.REDIS_PUBLIC_URL!,args,20000);
async function request(path:string,body?:any,token?:string){const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{'content-type':'application/json',origin:webOrigin,...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});assert(response.ok,path+' returned HTTP '+response.status);return response.json();}
try{
 const health=await request('/healthz');assert.equal(health.dependencies.kv.state,'online');
 const challenge=await request('/v1/terminal/auth/challenge',{wallet:owner.address});assert(challenge.message.startsWith('PULSE Trading Terminal access\n'));assert(challenge.message.includes('\nOrigin: '+origin+'\n'));assert(challenge.message.includes('\nWallet: '+owner.address.toLowerCase()+'\n'));assert(challenge.message.includes('\nNonce: '+challenge.challengeId+'\n'));assert(challenge.message.endsWith('This signature does not authorize a payment, order, transfer or automatic renewal.'));
 const token=(await request('/v1/terminal/auth/verify',{challengeId:challenge.challengeId,signature:await owner.signMessage({message:challenge.message})})).token;
 const workspace=await request('/v1/terminal/workspace',undefined,token);assert(workspace.access.grants.some((g:any)=>g.requestId===receipts.grant.requestId&&g.expiresAt===receipts.grant.expiresAt));
 record('deployed_expired_pass_history',{historicalGrantFound:true,accessActive:workspace.access.active,expiresAt:workspace.access.expiresAt,telegramEnabled:workspace.telegram?.enabled});
 const purchases=await request('/v1/terminal/indicators/purchases',undefined,token);let restoredPackages=0;
 for(const item of receipts.receiptItems){const purchase=purchases.purchases.find((p:any)=>p.id===item.purchase.id);assert(purchase&&purchase.state==='granted');assert.equal(purchase.settlementTx,item.purchase.settlementTx);assert.equal(purchase.sha256,item.purchase.sha256);const restored=await request('/v1/terminal/indicators/'+purchase.listingId,undefined,token);assert(restored.item.entitled);assert.equal(exportIndicatorPackage(restored.manifest),item.bytes);restoredPackages++;}
 record('deployed_paid_indicator_restore',{purchases:restoredPackages,exactOriginalPackageBytes:true,paymentRequested:false});
 const unauthorized=await fetch(origin+'/v1/terminal/indicators/purchases',{headers:{origin:webOrigin},signal:AbortSignal.timeout(20000)});assert.equal(unauthorized.status,401);record('private_purchase_history_requires_authentication',{status:unauthorized.status});
 const jobs=plan.operations.filter((op:any)=>op.category==='job'&&op.key.startsWith('pulse:production:')).map((op:any)=>JSON.parse(op.value));
 let reportReads=0,historyRows=0;
 for(const networkKey of [...new Set(jobs.map((j:any)=>j.networkKey))]){
  const c=await request('/v1/report-history/challenge',{wallet:owner.address,networkKey});assert(c.message.startsWith('PULSE report history access\n'));assert(c.message.includes('Wallet: '+owner.address.toLowerCase()));assert(c.message.includes('Network: '+networkKey));assert(c.message.includes('Nonce: '+c.nonce));assert(c.message.endsWith('it cannot authorize a new payment or trading.'));
  const auth=await request('/v1/report-history/session',{wallet:owner.address,networkKey,nonce:c.nonce,signature:await owner.signMessage({message:c.message})});
  const history=await request('/v1/report-history',undefined,auth.sessionToken);historyRows+=history.reports.filter((row:any)=>jobs.some((j:any)=>j.id===row.id)).length;
  for(const job of jobs.filter((j:any)=>j.networkKey===networkKey&&j.reportId)){const response=await request('/v1/report-history/'+job.id+'/report',undefined,auth.sessionToken);assert(response.report&&typeof response.report==='object');assert.equal(response.metadata.id,job.reportId);reportReads++;}
 }
 record('deployed_report_history_and_bodies',{historyRows,readableReports:reportReads});
 const inspect=`local v=cjson.decode(ARGV[1]);local matched=0;local missing=0;local differs=0;local kind=redis.call('TYPE',KEYS[1]).ok;if kind=='none' then return {0,1,0} end;if v.kind=='string' then if kind~='string' then return {0,0,1} end;if redis.call('GET',KEYS[1])==v.value then matched=1 else differs=1 end else local expected=v.kind=='hash' and 'hash' or 'zset';if kind~=expected then return {0,0,1} end;for _,p in ipairs(v.items) do local actual;if v.kind=='hash' then actual=redis.call('HGET',KEYS[1],p[1]) else actual=redis.call('ZSCORE',KEYS[1],p[1]) end;if not actual then missing=missing+1 elseif actual==p[2] or v.kind=='zset' and tonumber(actual)==tonumber(p[2]) then matched=matched+1 else differs=differs+1 end end end;return {matched,missing,differs}`;
 const totals={matched:0,missing:0,differs:0};
 for(let start=0;start<plan.operations.length;start+=4){const results=await Promise.all(plan.operations.slice(start,start+4).map((op:any)=>command('EVAL',inspect,1,op.key,JSON.stringify(op))));for(const result of results){totals.matched+=Number(result[0]);totals.missing+=Number(result[1]);totals.differs+=Number(result[2]);}}
 assert.equal(totals.missing,0);assert.equal(totals.differs,0);record('restored_redis_records_exactly_match_plan',totals);
 const originals=plan.held.automationOrders.filter((o:any)=>['filled','cancelled','failed'].includes(o.status)),orders=JSON.parse(String(await command('GET','pulse:v6:automation:orders')));
 assert(originals.every((o:any)=>orders.some((v:any)=>v.id===o.id&&v.owner.toLowerCase()===plan.owner&&['filled','cancelled','failed'].includes(v.status))));
 const liveHeld=plan.held.automationOrders.filter((o:any)=>!['filled','cancelled','failed'].includes(o.status));assert(liveHeld.every((o:any)=>!orders.some((v:any)=>v.id===o.id)));
 record('closed_order_history',{restored:originals.length,activeOrdersHeld:liveHeld.length});
 writeFileSync(folder+'/validation.json',JSON.stringify({at:new Date().toISOString(),origin,checks,paymentsSigned:false,ordersPlaced:false,reportRegenerations:0},null,2)+'\n');
}catch(error){writeFileSync(folder+'/validation.json',JSON.stringify({at:new Date().toISOString(),checks,failure:error instanceof Error?error.message:'validation failed'},null,2)+'\n');console.error(error instanceof Error?error.message:'Validation failed');process.exitCode=1;}finally{closeNativeRedisConnections();}
