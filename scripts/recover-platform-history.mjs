// Incident-only, owner-filtered history recovery. Dry-run by default.
// Original expiry and namespaces remain intact; no jobs/orders are activated.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildWalletRecoveryPlan,holdUnreadableJobs,validateWalletRecoveryPlan,verifyReportBodies,RECOVERY_MERGE_LUA,digest} from './wallet-history-recovery.mjs';
import {mergeClosedOrderHistory} from './recover-closed-order-history.mjs';
const folder='.tmp/platform-recovery';
export function platformRecoveryOwners(records){
 const owners=new Set(),add=owner=>{if(typeof owner==='string'&&/^0x[\da-f]{40}$/i.test(owner))owners.add(owner.toLowerCase());};
 for(const record of records){
  const keyOwner=/^pulse:v6:activity(?:-map)?:[^:]+:(0x[\da-f]{40})$/i.exec(record.key);if(keyOwner)add(keyOwner[1]);
  if(record.type==='string')try{const value=JSON.parse(record.payload);if(Array.isArray(value)){for(const item of value)add(item?.owner);}else{add(value?.payer);add(value?.ownerWallet);add(value?.owner);}}catch{}
  if(record.key==='pulse:v6:autopilot:strategy-map'&&record.type==='hash')for(let i=1;i<record.payload.length;i+=2)try{add(JSON.parse(record.payload[i]).owner);}catch{}
 }
 return [...owners].sort();
}
export function platformEvidenceOperations(records,now=Date.now()){
 return records.filter(row=>/^pulse:v6:autopilot:evidence:[a-zA-Z0-9:_-]+$/.test(row.key)&&row.type==='string'&&(row.expiresAt==null||row.expiresAt>now)).map(row=>{
  const value=JSON.parse(row.payload);assert(value&&typeof value==='object'&&['decision','report'].every(key=>Object.hasOwn(value,key))&&(Object.hasOwn(value,'evaluation')||Object.hasOwn(value,'bias')&&Object.hasOwn(value,'confidence')),'Expected original evidence bundle');
  return {category:'autopilot-evidence',kind:'string',key:row.key,value:row.payload,expiresAt:row.expiresAt??null};
 });
}
async function main(){
 mkdirSync(folder,{recursive:true});
 if(!process.argv.includes('--apply')){
  const rdb=JSON.parse(readFileSync(folder+'/rdb-records.json','utf8')),legacy=JSON.parse(readFileSync(folder+'/legacy-records.json','utf8')).records;
  const records=[...new Map([...rdb,...legacy].map(row=>[row.key,row])).values()],owners=platformRecoveryOwners(records),plans=[];
  for(const owner of owners){
   const plan=buildWalletRecoveryPlan(records,owner);plan.reportChecks=await verifyReportBodies(plan,records,process.env.REPORT_ENCRYPTION_KEY);
   const missing=new Set(plan.reportChecks.filter(row=>!row.available).map(row=>row.key));
   plan.operations=plan.operations.filter(op=>op.category!=='report'||!missing.has(op.key));holdUnreadableJobs(plan);validateWalletRecoveryPlan(plan);plans.push(plan);
  }
  const evidence=platformEvidenceOperations(records),plan={version:'platform-history-recovery-v1',generatedAt:new Date().toISOString(),plans,evidence};
  const bytes=JSON.stringify(plan,null,2)+'\n';writeFileSync(folder+'/plan.json',bytes);
  const categories={};for(const op of [...plans.flatMap(plan=>plan.operations),...evidence])categories[op.category]=(categories[op.category]??0)+(op.items?.length??1);
  const summary={ownerCount:owners.length,categories,planSha256:digest(bytes),reportsVerified:plans.flatMap(plan=>plan.reportChecks).filter(row=>row.available).length,closedOrders:plans.flatMap(plan=>plan.held.automationOrders).filter(row=>['filled','cancelled','failed'].includes(row.status)).length,activeOrdersHeld:plans.flatMap(plan=>plan.held.automationOrders).filter(row=>!['filled','cancelled','failed'].includes(row.status)).length,readOnly:true};
  writeFileSync(folder+'/plan-summary.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));return;
 }
 const bytes=readFileSync(folder+'/plan.json'),plan=JSON.parse(bytes);assert.equal(plan.version,'platform-history-recovery-v1');assert(process.argv.includes('--plan-sha256='+digest(bytes)),'Apply requires the reviewed platform plan hash');
 for(const item of plan.plans)validateWalletRecoveryPlan(item);
 assert.deepEqual(plan.evidence,platformEvidenceOperations(plan.evidence.map(op=>({key:op.key,type:'string',payload:op.value,expiresAt:op.expiresAt})),0),'Evidence key allowlist changed');
 const {runNativeRedisCommand,closeNativeRedisConnections}=await import('../apps/api/dist/nativeRedis.js');
 assert(process.env.REDIS_PUBLIC_URL);const command=(...args)=>runNativeRedisCommand(process.env.REDIS_PUBLIC_URL,args,20000),outcomes=[];
 try{
  assert.equal(await command('PING'),'PONG');const config=await command('CONFIG','GET','appendonly','maxmemory-policy'),pairs=Object.fromEntries(Array.from({length:config.length/2},(_,i)=>[config[2*i],config[2*i+1]]));assert.equal(pairs.appendonly,'yes');assert.equal(pairs['maxmemory-policy'],'noeviction');
  for(const item of plan.plans)for(const op of item.operations.filter(op=>op.category==='paused-strategy'))for(const [id] of op.items){const raw=await command('HGET',op.key,id);if(raw){const current=JSON.parse(raw);assert.equal(current.owner.toLowerCase(),item.owner);assert.notEqual(current.status,'active','Existing active strategy requires separate review; no records overwritten');}}
  const operations=[...plan.plans.flatMap(item=>item.operations),...plan.evidence];
  for(let start=0;start<operations.length;start+=4){
   const batch=operations.slice(start,start+4),results=await Promise.all(batch.map(op=>command('EVAL',RECOVERY_MERGE_LUA,1,op.key,JSON.stringify(op))));
   for(let i=0;i<batch.length;i++)outcomes.push({category:batch[i].category,key:batch[i].key,wrote:Number(results[i][0]),matched:Number(results[i][1]),conflicts:Number(results[i][2]),expired:Number(results[i][3])});
  }
  const orderKey='pulse:v6:automation:orders',cas=`local old=redis.call('GET',KEYS[1]);if (old or '')~=ARGV[1] then return 0 end;if old then redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL') else redis.call('SET',KEYS[1],ARGV[2]) end;return 1`;
  let orderResult;
  for(let attempt=0;attempt<12;attempt++){
   const raw=await command('GET',orderKey);let merged=raw?JSON.parse(raw):[],added=0,matched=0,conflicts=0;
   for(const item of plan.plans){const result=mergeClosedOrderHistory(merged,item.held.automationOrders.filter(row=>['filled','cancelled','failed'].includes(row.status)),item.owner);merged=result.rows;added+=result.added;matched+=result.matched;conflicts+=result.conflicts;}
   if(!added||Number(await command('EVAL',cas,1,orderKey,raw??'',JSON.stringify(merged)))===1){orderResult={added,matched,conflicts};break;}
  }
  assert(orderResult,'Concurrent order history writes prevented merge');
  const counts={};for(const row of outcomes){const value=counts[row.category]??{wrote:0,matched:0,conflicts:0,expired:0};for(const key of Object.keys(value))value[key]+=row[key];counts[row.category]=value;}
  const result={at:new Date().toISOString(),planSha256:digest(bytes),counts,orderResult,workersStarted:false,paymentsMade:false};writeFileSync(folder+'/apply-results.json',JSON.stringify({...result,outcomes},null,2)+'\n');console.log(JSON.stringify(result));
 }finally{closeNativeRedisConnections();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(String(error.message).replace(/rediss?:\/\/\S+/g,'[redacted]'));process.exitCode=1;});
