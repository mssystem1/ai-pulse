// Rebuild the public projection from an already reviewed owner recovery plan.
// Reads local original encrypted reports, not a shared database inventory.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {decryptReport,type AnalysisJob,type StoredReport} from '../apps/api/src/jobs.js';
import {PublicActivityStore,verifiedJobResearchDelivery,type ResearchDelivery} from '../apps/api/src/publicActivity.js';
import {StoreRedis} from '../apps/api/src/storeRedis.js';
import {closeNativeRedisConnections} from '../apps/api/src/nativeRedis.js';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const option=(name:string)=>process.argv.find(value=>value.startsWith('--'+name+'='))?.slice(name.length+3);
const folder='.tmp/test-wallet-recovery',planBytes=readFileSync(folder+'/plan.json'),planHash=hash(planBytes);
assert.equal(option('plan-sha256'),planHash,'Use the exact reviewed owner recovery plan hash');
const plan=JSON.parse(planBytes.toString()),owner=process.env.TEST_WALLET_ADDRESS?.toLowerCase();assert.equal(plan.owner,owner);
const namespace=option('target-namespace');assert.equal(namespace,'pulse:production','Explicit deployed projection destination required');
const deliveries=new Map<string,ResearchDelivery>();let excluded=0,unverifiable=0,examined=0;
for(const op of plan.operations.filter((op:any)=>op.category==='job')){
  examined++;const job=JSON.parse(op.value) as AnalysisJob;assert.equal(job.payer.toLowerCase(),owner);
  if(!job.reportId||!['completed','completed_partial'].includes(job.stage)){excluded++;continue;}
  const sourceNamespace=op.key.slice(0,op.key.indexOf(':job:'));
  const saved=plan.operations.find((row:any)=>row.category==='report'&&row.key===sourceNamespace+':report:'+job.reportId);
  assert(saved,'Original report metadata is required');const metadata=JSON.parse(saved.value) as StoredReport;
  assert(plan.reportChecks.some((check:any)=>check.key===saved.key&&check.available));
  assert.match(metadata.id,/^[a-f\d-]{36}$/i);
  const envelope=readFileSync(resolve('DB_backup/test-wallet-recovery-2026-11-16/encrypted-reports',metadata.id+'.json'),'utf8');
  const bytes=decryptReport(envelope,process.env.REPORT_ENCRYPTION_KEY!);assert.equal(hash(bytes),metadata.checksum);
  const delivery=verifiedJobResearchDelivery(job,metadata,JSON.parse(bytes));
  if(!delivery){unverifiable++;continue;}deliveries.set(delivery.identity,delivery);
}
const projection={version:'wallet-public-activity-recovery-v1',owner,sourcePlanSha256:planHash,targetNamespace:namespace,deliveries:[...deliveries.values()].sort((a,b)=>a.identity.localeCompare(b.identity))};
const projectionBytes=JSON.stringify(projection,null,2)+'\n',projectionHash=hash(projectionBytes);
const preview=new PublicActivityStore();for(const delivery of projection.deliveries)await preview.record(delivery);
const summary={examined,excluded,unverifiable,uniqueVerifiedDeliveries:deliveries.size,projectionSha256:projectionHash,research:(await preview.snapshot()).research};
writeFileSync(folder+'/public-activity-plan.json',projectionBytes);
if(!process.argv.includes('--write')){console.log(JSON.stringify({mode:'preview',...summary}));}
else{
  assert.equal(option('projection-sha256'),projectionHash,'Review the public projection preview before publishing');
  const url=process.env.REDIS_PUBLIC_URL;assert(url);const redis=new StoreRedis(url),store=new PublicActivityStore(redis,namespace);
  try{
    // A coherent pair is required; never combine counters with a missing dedupe ledger.
    const coherence=await redis.eval(`local rows=redis.call('HGETALL',KEYS[2]);local count=0;for i=2,#rows,2 do count=count+cjson.decode(rows[i]).count end;return {redis.call('HLEN',KEYS[1]),count}`,[namespace+':public-activity:seen:v1',namespace+':public-activity:research:v1'],[]) as number[];
    assert.equal(Number(coherence[0]),Number(coherence[1]),'Existing public projection is inconsistent; preserve it for review before reconciliation');
    let added=0;for(const delivery of projection.deliveries)if(await store.record(delivery))added++;
    const snapshot=await store.snapshot(),outcome={at:new Date().toISOString(),...summary,added,research:snapshot.research,networks:snapshot.networks,paymentsMade:false,ordersActivated:false};
    writeFileSync(folder+'/public-activity-apply-results.json',JSON.stringify(outcome,null,2)+'\n');console.log(JSON.stringify({mode:'write',...outcome}));
  }finally{closeNativeRedisConnections();}
}
