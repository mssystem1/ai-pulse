// Incident recovery: original owner-scoped history only, no workers or payments.
// Default writes a private plan; --apply requires the exact reviewed plan hash.
import assert from 'node:assert/strict';
import { createHash, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRdb } from './rdb-reader.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
const terminalStages = new Set(['completed','completed_partial','failed_terminal','manual_reconciliation']);
const namespaces = ['pulse:local','pulse:production'];
const json = value => { try { return JSON.parse(value); } catch { return null; } };
const live = (record, now) => record.expiresAt == null || record.expiresAt > now;
export function normalizeRdbRecord(record) {
  const text = value => Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  return { key:text(record.key), type:record.type, expiresAt:record.expiresAt,
    payload:record.type==='string'?text(record.value):['hash','zset'].includes(record.type)?record.value.flatMap(pair=>pair.map(text)):record.value.map(text),source:'september-10-rdb' };
}

export function buildWalletRecoveryPlan(records, owner, now=Date.now()) {
  owner=owner.toLowerCase();assert.match(owner,/^0x[0-9a-f]{40}$/);
  const pool=new Map(records.map(record=>[record.key,record]));
  const operations=[], reports=[], held={expired:0,nonterminalJobs:0,automationOrders:[],expiredPasses:[],originalStrategies:[]};
  const string=(category,r,value=r.payload)=>operations.push({category,kind:'string',key:r.key,value,expiresAt:r.expiresAt??null});
  const hash=(category,key,items,expiresAt=null)=>{if(items.length)operations.push({category,kind:'hash',key,items,expiresAt});};
  const ownedJobs=[];
  for(const r of pool.values()) {
    if(r.type!=='string')continue;
    const namespace=namespaces.find(n=>r.key.startsWith(n+':'));
    const value=json(r.payload);
    if(namespace && r.key===`${namespace}:job:${value?.id}` && value?.payer?.toLowerCase()===owner) {
      if(!live(r,now)){held.expired++;continue;}
      if(!terminalStages.has(value.stage)){held.nonterminalJobs++;continue;}
      string('job',r);ownedJobs.push({r,value,namespace});
    }
    if(namespace && r.key===`${namespace}:report:${value?.id}` && value?.ownerWallet?.toLowerCase()===owner) {
      if(!live(r,now)){held.expired++;continue;}
      string('report',r);reports.push({key:r.key,...value});
      if(value.blobPath===`kv-report:${value.id}`) {
        const body=pool.get(`${namespace}:report-body-fallback:${value.id}`);
        if(body?.type==='string'&&live(body,now)&&digest(body.payload)===value.checksum)string('report-body',body);
      }
    }
    if(r.key.startsWith('pulse:v6:autopilot:pass:')&&value?.owner?.toLowerCase()===owner)held.expiredPasses.push({key:r.key,value,source:r.source});
    if(r.key==='pulse:v6:automation:orders'&&Array.isArray(value))held.automationOrders=value.filter(item=>item.owner?.toLowerCase()===owner);
  }
  for(const {r,value,namespace} of ownedJobs) {
    if(value.idempotencyKey)string('idempotency',{...r,key:`${namespace}:idem:${value.idempotencyKey}`},value.id);
  }
  for(const namespace of namespaces) {
    const jobs=ownedJobs.filter(j=>j.namespace===namespace);
    if(jobs.length)operations.push({category:'payer-index',kind:'zset',key:`${namespace}:payer-jobs:${digest(owner).slice(0,32)}`,items:jobs.map(j=>[j.value.id,String(Date.parse(j.value.createdAt))]),expiresAt:jobs.some(j=>j.r.expiresAt==null)?null:Math.max(...jobs.map(j=>j.r.expiresAt))});
  }
  const activities=new Map();
  for(const r of pool.values()) {
    const match=/^pulse:v6:activity(-map)?:([^:]+):(0x[0-9a-f]{40})$/.exec(r.key);
    if(!match||match[3]!==owner||!live(r,now))continue;
    const rows=r.type==='hash'?r.payload.filter((_,i)=>i%2===1).map(json):json(r.payload);
    if(!Array.isArray(rows))continue;
    const entries=activities.get(match[2])??new Map();activities.set(match[2],entries);
    for(const row of rows) {
      if(!row?.id||row.owner?.toLowerCase()!==owner||!['confirmed','failed'].includes(row.status))continue;
      const previous=entries.get(row.id);
      if(!previous||Date.parse(row.updatedAt)>Date.parse(previous.updatedAt))entries.set(row.id,row);
    }
  }
  for(const [network,entries] of activities)hash('activity',`pulse:v6:activity-map:${network}:${owner}`,[...entries].map(([id,v])=>[id,JSON.stringify(v)]));
  const strategies=pool.get('pulse:v6:autopilot:strategy-map');
  if(strategies?.type==='hash') {
    const restored=[];
    for(let i=0;i<strategies.payload.length;i+=2) {
      const field=strategies.payload[i],value=json(strategies.payload[i+1]);
      if(value?.owner?.toLowerCase()!==owner||value.id!==field)continue;
      held.originalStrategies.push(value);
      restored.push([field,JSON.stringify({...value,status:'paused'})]);
      const key=`pulse:autopilot:evaluations:${field}`,journal=pool.get(key);
      if(journal?.type==='hash'&&live(journal,now))hash('evaluation-journal',key,Array.from({length:journal.payload.length/2},(_,n)=>[journal.payload[n*2],journal.payload[n*2+1]]),journal.expiresAt??null);
      else {
        const rows=new Map([...(value.evaluations??[]),...(value.evaluationPending??[])].filter(row=>row.id).map(row=>[row.id,JSON.stringify(row)]));
        hash('evaluation-journal',key,[...rows]);
      }
    }
    hash('paused-strategy',strategies.key,restored);
  }
  const plan={version:'wallet-history-recovery-v1',owner,generatedAt:new Date(now).toISOString(),operations,reports,held};
  holdUnreadableJobs(plan);validateWalletRecoveryPlan(plan);return plan;
}

export function holdUnreadableJobs(plan) {
  const reports=new Set(plan.operations.filter(op=>op.category==='report').map(op=>op.key));
  const held=plan.operations.filter(op=>op.category==='job').filter(op=>{const job=json(op.value),ns=op.key.slice(0,op.key.indexOf(':job:'));return (job.reportId||['completed','completed_partial'].includes(job.stage))&&!reports.has(`${ns}:report:${job.reportId}`);});
  const keys=new Set(held.map(op=>op.key));
  plan.held.unreadableJobs=[...(plan.held.unreadableJobs??[]),...held];
  plan.operations=plan.operations.filter(op=>!keys.has(op.key)&&!(op.category==='idempotency'&&keys.has(`${op.key.slice(0,op.key.indexOf(':idem:'))}:job:${op.value}`))).map(op=>op.category==='payer-index'?{...op,items:op.items.filter(([id])=>!keys.has(`${op.key.slice(0,op.key.indexOf(':payer-jobs:'))}:job:${id}`))}:op).filter(op=>!op.items||op.items.length);
}

export function validateWalletRecoveryPlan(plan) {
  assert.equal(plan.version,'wallet-history-recovery-v1');assert.match(plan.owner,/^0x[0-9a-f]{40}$/);
  const jobs=new Map(plan.operations.filter(op=>op.category==='job').map(op=>[json(op.value)?.id,json(op.value)]));
  const strategies=new Set(plan.operations.filter(op=>op.category==='paused-strategy').flatMap(op=>op.items.map(([id])=>id)));
  const reports=new Map(plan.operations.filter(op=>op.category==='report').map(op=>[json(op.value)?.id,json(op.value)]));
  for(const op of plan.operations) {
    assert(op.expiresAt===null||Number.isSafeInteger(op.expiresAt)&&op.expiresAt>0);
    const ns=namespaces.find(n=>op.key.startsWith(n+':'));
    if(op.category==='job'){const v=json(op.value);assert.equal(v.payer.toLowerCase(),plan.owner);assert(terminalStages.has(v.stage));assert.equal(op.key,`${ns}:job:${v.id}`);assert.equal(op.kind,'string');if(v.reportId||['completed','completed_partial'].includes(v.stage)){assert(plan.operations.some(r=>r.category==='report'&&r.key===`${ns}:report:${v.reportId}`),'Completed job requires its original owned report');if(v.receipt?.reportId)assert.equal(v.receipt.reportId,v.reportId);}}
    else if(op.category==='report'){const v=json(op.value);assert.equal(v.ownerWallet.toLowerCase(),plan.owner);assert.equal(op.key,`${ns}:report:${v.id}`);assert.equal(op.kind,'string');if(plan.reportChecks)assert(plan.reportChecks.some(r=>r.key===op.key&&r.available),'Report body must pass integrity checks');}
    else if(op.category==='report-body'){const id=op.key.split(':').at(-1),v=reports.get(id);assert(v&&v.blobPath===`kv-report:${id}`);assert.equal(digest(op.value),v.checksum);assert.equal(op.key,`${ns}:report-body-fallback:${id}`);}
    else if(op.category==='idempotency'){const job=jobs.get(op.value);assert(job);assert.equal(op.key,`${ns}:idem:${job.idempotencyKey}`);}
    else if(op.category==='payer-index'){assert.equal(op.kind,'zset');assert.equal(op.key,`${ns}:payer-jobs:${digest(plan.owner).slice(0,32)}`);for(const [id,score] of op.items){const job=jobs.get(id);assert(job);assert.equal(Number(score),Date.parse(job.createdAt));assert(plan.operations.some(v=>v.category==='job'&&v.key===`${ns}:job:${id}`));}}
    else if(op.category==='activity'){assert.equal(op.kind,'hash');for(const [id,raw] of op.items){const v=json(raw);assert.equal(v.owner.toLowerCase(),plan.owner);assert.equal(v.id,id);assert(['confirmed','failed'].includes(v.status));assert.equal(op.key,`pulse:v6:activity-map:${v.network}:${plan.owner}`);}}
    else if(op.category==='paused-strategy'){assert.equal(op.kind,'hash');assert.equal(op.key,'pulse:v6:autopilot:strategy-map');for(const [id,raw] of op.items){const v=json(raw);assert.equal(v.owner.toLowerCase(),plan.owner);assert.equal(v.id,id);assert.equal(v.status,'paused');}}
    else if(op.category==='evaluation-journal'){assert.equal(op.kind,'hash');assert(strategies.has(op.key.slice('pulse:autopilot:evaluations:'.length)));assert(op.key.startsWith('pulse:autopilot:evaluations:'));for(const [id,raw] of op.items)assert.equal(json(raw)?.id,id);}
    else throw Error('Unsupported recovery category');
  }
}

export const RECOVERY_MERGE_LUA=`local input=cjson.decode(ARGV[1]);local now=redis.call('TIME');local ms=tonumber(now[1])*1000+math.floor(tonumber(now[2])/1000)
if input.expiresAt~=cjson.null and input.expiresAt<=ms then return {0,0,0,1} end
local kind=redis.call('TYPE',KEYS[1]).ok;local fresh=kind=='none';local wrote=0;local matched=0;local conflicts=0
local expected=input.kind=='zset' and 'zset' or input.kind=='hash' and 'hash' or 'string'
if not fresh and kind~=expected then return {0,0,1,0} end
if input.kind=='string' then local old=redis.call('GET',KEYS[1]);if not old then redis.call('SET',KEYS[1],input.value);wrote=1 elseif old==input.value then matched=1 else conflicts=1 end
else for _,item in ipairs(input.items) do local old;if input.kind=='hash' then old=redis.call('HGET',KEYS[1],item[1]) else old=redis.call('ZSCORE',KEYS[1],item[1]) end
if not old then if input.kind=='hash' then redis.call('HSETNX',KEYS[1],item[1],item[2]) else redis.call('ZADD',KEYS[1],'NX',item[2],item[1]) end;wrote=wrote+1 elseif old==item[2] or input.kind=='zset' and tonumber(old)==tonumber(item[2]) then matched=matched+1 else conflicts=conflicts+1 end end end
if fresh and wrote>0 and input.expiresAt~=cjson.null then redis.call('PEXPIREAT',KEYS[1],input.expiresAt) end
return {wrote,matched,conflicts,0}`;

export async function verifyReportBodies(plan,records,key) {
  const results=[];
  for(let start=0;start<plan.reports.length;start+=4)await Promise.all(plan.reports.slice(start,start+4).map(async report=>{
    let available=false,reason;
    try {
      let body;
      if(report.blobPath.startsWith('kv-report:'))body=records.find(r=>r.key===report.key.replace(':report:',':report-body-fallback:'))?.payload;
      else {
        const url=new URL(report.blobPath);assert.equal(url.protocol,'https:');assert(url.hostname.endsWith('.public.blob.vercel-storage.com'));
        const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('blob unavailable');
        const envelope=await response.json();const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'base64url'),Buffer.from(envelope.iv,'base64url'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64url'));
        body=Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64url')),decipher.final()]).toString('utf8');
      }
      assert.equal(digest(body),report.checksum);JSON.parse(body);available=true;
    } catch {reason='body-unavailable-or-integrity-check-failed';}
    results.push({id:report.id,key:report.key,available,...(reason?{reason}:{})});
  }));
  return results;
}

async function main() {
  const owner=process.env.TEST_WALLET_ADDRESS?.toLowerCase();assert.match(owner??'',/^0x[0-9a-f]{40}$/);
  const folder=resolve('.tmp/test-wallet-recovery');mkdirSync(folder,{recursive:true});
  if(process.argv.includes('--apply')) {
    const bytes=readFileSync(resolve(folder,'plan.json'));
    assert(process.argv.includes('--plan-sha256='+digest(bytes)),'Apply requires the exact reviewed private plan SHA256');
    const plan=JSON.parse(bytes);assert.equal(plan.owner,owner);validateWalletRecoveryPlan(plan);
    assert(plan.reportChecks,'Verify report bodies before applying');
    const {runNativeRedisCommand,closeNativeRedisConnections}=await import('../apps/api/dist/nativeRedis.js');
    const url=process.env.REDIS_PUBLIC_URL;assert(url,'Explicit public recovery endpoint required');
    const command=(...args)=>runNativeRedisCommand(url,args,20000);
    const outcomes=[];
    try {
      assert.equal(await command('PING'),'PONG');
      const config=await command('CONFIG','GET','appendonly','maxmemory-policy');const pairs=Object.fromEntries(Array.from({length:config.length/2},(_,i)=>[config[i*2],config[i*2+1]]));assert.equal(pairs.appendonly,'yes');assert.equal(pairs['maxmemory-policy'],'noeviction');
      for(const op of plan.operations.filter(op=>op.category==='paused-strategy'))for(const [id] of op.items){const raw=await command('HGET',op.key,id);if(raw){const current=json(raw);assert.equal(current?.owner?.toLowerCase(),owner,'Existing strategy has a different owner');assert.notEqual(current.status,'active','An existing live strategy is active; review it before recovery. No strategy was overwritten.');}}
      for(const op of plan.operations) {
        const result=await command('EVAL',RECOVERY_MERGE_LUA,1,op.key,JSON.stringify(op));
        outcomes.push({category:op.category,key:op.key,wrote:Number(result[0]),matched:Number(result[1]),conflicts:Number(result[2]),expired:Number(result[3])});
      }
    } finally {closeNativeRedisConnections();writeFileSync(resolve(folder,'apply-results.json'),JSON.stringify({at:new Date().toISOString(),planSha256:digest(bytes),owner,outcomes},null,2)+'\n');}
    const counts={};for(const row of outcomes){const value=counts[row.category]??{wrote:0,matched:0,conflicts:0,expired:0};for(const kind of Object.keys(value))value[kind]+=row[kind];counts[row.category]=value;}
    console.log(JSON.stringify({owner,counts,workersStarted:false,paymentsMade:false}));return;
  }
  const rdbBytes=readFileSync('DB_backup/9615a8e6-7d88-414d-95d3-9402d9097406.rdb');assert.equal(digest(rdbBytes),'aa712b7b962efe4927bda78e3a978523754d19c7275d83be1980fd2774c9933f');
  const rdb=readRdb(rdbBytes).records.map(normalizeRdbRecord);
  const legacy=JSON.parse(readFileSync('.tmp/redis-repair/legacy-candidate-records.json','utf8'));assert.equal(legacy.owner,owner);
  const records=[...rdb,...legacy.records];
  const plan=buildWalletRecoveryPlan(records,owner);
  plan.reportChecks=await verifyReportBodies(plan,records,process.env.REPORT_ENCRYPTION_KEY);
  const unavailable=new Set(plan.reportChecks.filter(r=>!r.available).map(r=>r.key));
  plan.operations=plan.operations.filter(op=>op.category!=='report'||!unavailable.has(op.key));
  holdUnreadableJobs(plan);validateWalletRecoveryPlan(plan);
  const bytes=JSON.stringify(plan,null,2)+'\n';writeFileSync(resolve(folder,'plan.json'),bytes);
  const categories={};for(const op of plan.operations)categories[op.category]=(categories[op.category]??0)+(op.items?.length??1);
  const summary={owner,planSha256:digest(bytes),categories,reportBodies:{verified:plan.reportChecks.filter(r=>r.available).length,unavailable:unavailable.size},held:{expiredRecords:plan.held.expired,nonterminalJobs:plan.held.nonterminalJobs,unreadableJobs:plan.held.unreadableJobs.length,automationOrders:plan.held.automationOrders.length,expiredPasses:plan.held.expiredPasses.length},readOnly:true};
  writeFileSync(resolve(folder,'plan-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(String(error.message).replace(/rediss?:\/\/\S+/g,'[redacted]'));process.exitCode=1;});
