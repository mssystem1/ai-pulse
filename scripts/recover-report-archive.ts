// Incident recovery only. Prepare a checksum-bound plan before applying it.
// Adds an owner-scoped, read-only archive; never creates jobs, access passes or orders.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalJson,decryptReport,encryptReport,type PaymentReceipt} from '../apps/api/src/jobs.js';
import {RecoveredReportArchive,validateArchivedReport,type ArchivedReport} from '../apps/api/src/recoveredReportArchive.js';
import {PublicActivityStore,researchDelivery,type ResearchDelivery} from '../apps/api/src/publicActivity.js';
import {StoreRedis} from '../apps/api/src/storeRedis.js';
import {closeNativeRedisConnections} from '../apps/api/src/nativeRedis.js';
const folder='.tmp/platform-recovery',backup='DB_backup/platform-recovery-2026-11-17';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const read=(file:string)=>JSON.parse(readFileSync(file,'utf8'));
const write=(file:string,value:unknown)=>writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const option=(name:string)=>process.argv.find(value=>value.startsWith('--'+name+'='))?.slice(name.length+3);
async function batches<T>(items:T[],run:(item:T)=>Promise<void>){for(let start=0;start<items.length;start+=4)await Promise.all(items.slice(start,start+4).map(run));}
const chains:Record<string,ArchivedReport['networkKey']>={'eip155:196':'xlayer','eip155:8453':'base','eip155:42161':'arbitrum','eip155:5042':'arc','eip155:4663':'robinhood','eip155:5042002':'arc-testnet'};
function plaintext(bytes:Buffer){const raw=bytes.toString('utf8'),value=JSON.parse(raw);return value.alg==='A256GCM'?decryptReport(raw,process.env.REPORT_ENCRYPTION_KEY!):raw;}
export function modeFor(body:any):ArchivedReport['mode']|null{
 if(/^spot_analysis_/.test(body.service))return 'spot';
 if(/^prediction_analysis_/.test(body.service))return 'prediction';
 if(/^fused_analysis_/.test(body.service)||body.service==='preflight')return 'risk';
 return null;
}
function labelFor(body:any,mode:ArchivedReport['mode']){
 const service=mode==='spot'?'Global':mode==='prediction'?'Prediction':'Risk Guard';
 return [service,body.instId||body.asset||body.predictionContext?.market?.question,body.timeframe,body.fixture||body.analysisProfile?.mode==='fixture'?'Fixture':null].filter(value=>typeof value==='string'&&value).join(' · ').slice(0,200);
}
async function prepare(){
 const records=read(backup+'/source-records.json').records as any[],blobRows=read(folder+'/original-report-blobs.json').blobs as any[];
 const blobs=new Map(blobRows.map(row=>[row.pathname.split('/').at(-1)!.replace(/\.json$/,''),row]));
 const jobs=records.filter(row=>row.type==='string'&&/:job:[\da-f-]{36}$/.test(row.key)).map(row=>({key:row.key,value:JSON.parse(row.payload)}));
 const rows=new Map<string,any>(),deliveries=new Map<string,ResearchDelivery>(),auditCounts:Record<string,number>={};
 const excluded:any[]=[];const owner=process.env.TEST_WALLET_ADDRESS!.toLowerCase();
 function delivery(job:any,body:any,metadata:any){
  if(body.fixture||body.analysisProfile?.mode!=='live'||metadata.id!==job.reportId||!['completed','completed_partial'].includes(job.stage))return;
  const receipt=job.receipt as PaymentReceipt;
  if(!receipt||receipt.payer?.toLowerCase()!==metadata.ownerWallet||receipt.reportId!==metadata.id)return;
  const mode=modeFor(body);if(!mode||mode!==job.mode)return;
  const fact=researchDelivery(receipt,mode==='spot'?'global':mode==='risk'?'risk':'prediction',receipt.completedAt||job.updatedAt,job.stage==='completed_partial');
  if(fact)deliveries.set(fact.identity,fact);
 }
 function add(metadata:any,body:any,evidence:any){
  const mode=modeFor(body);if(!mode){if(body.kind==='execution_lifecycle')auditCounts[metadata.ownerWallet]=(auditCounts[metadata.ownerWallet]||0)+1;else excluded.push({reportId:metadata.id,reason:'Unrecognized original document type'});return;}
  const row:ArchivedReport={version:'recovered-report-v1',id:`archive:${metadata.id}`,reportId:metadata.id,owner:metadata.ownerWallet.toLowerCase(),networkKey:evidence.networkKey??null,mode,tier:body.tier??evidence.job?.tier??null,label:labelFor(body,mode),createdAt:new Date(metadata.createdAt).toISOString(),metadata:{...metadata,ownerWallet:metadata.ownerWallet.toLowerCase(),createdAt:new Date(metadata.createdAt).toISOString()},originalJobId:evidence.job?.id??null,originalExpiresAt:evidence.originalExpiresAt??null,sourceNamespace:evidence.sourceNamespace??null,evidenceKind:evidence.kind};
  validateArchivedReport(row);
  const previous=rows.get(row.reportId);if(previous){assert.equal(previous.row.owner,row.owner);assert.equal(previous.row.metadata.checksum,row.metadata.checksum);return;}
  rows.set(row.reportId,{row,bodyFile:evidence.bodyFile,bodySha256:evidence.bodySha256,upload:evidence.upload??false,originalBlobPath:evidence.originalBlobPath??metadata.blobPath,source:evidence.source});
  if(evidence.job)delivery(evidence.job,body,row.metadata);
 }
 for(const record of records.filter(row=>row.type==='string'&&/:report:[\da-f-]{36}$/.test(row.key))){
  const metadata=JSON.parse(record.payload);assert.equal(record.key.split(':report:')[1],metadata.id,'Original Redis key must bind its report ID');
  const file=backup+'/report-files/'+metadata.id+'.json',bytes=readFileSync(file),text=plaintext(bytes);assert.equal(hash(text),metadata.checksum);
  const body=JSON.parse(text),job=jobs.find(row=>row.value.reportId===metadata.id&&row.value.payer?.toLowerCase()===metadata.ownerWallet.toLowerCase())?.value;
  if(job?.receipt){assert.equal(job.receipt.reportId,metadata.id);assert.equal(job.receipt.payer.toLowerCase(),metadata.ownerWallet.toLowerCase());assert.equal(chains[job.receipt.network],job.networkKey,'Original job and receipt networks must agree');}
  add(metadata,body,{kind:'redis-report',job,networkKey:job?.receipt?chains[job.receipt.network]:null,originalExpiresAt:record.expiresAt,sourceNamespace:record.key.split(':report:')[0],bodyFile:file,bodySha256:hash(bytes),source:record.key});
 }
 const local=read('.tmp/test-wallet-recovery/local-deliveries.json').entries as any[];
 for(const entry of [...new Map(local.filter(row=>row.checksumMatches).map(row=>[row.job.reportId,row])).values()]){
  const {job}=entry,metadata=entry.metadata;assert.equal(job.receipt.payer.toLowerCase(),owner);if(metadata.ownerWallet!==undefined)assert.equal(metadata.ownerWallet.toLowerCase(),owner,'Preserve original owner binding');assert.equal(job.receipt.reportId,metadata.id);assert.equal(job.reportId,metadata.id);assert.equal(hash(entry.body),metadata.checksum);
  assert.equal(job.receipt.settlementResult,'settled');assert.equal(job.receipt.verificationResult,'accepted_by_middleware');assert(chains[job.receipt.network]);
  const blob=blobs.get(metadata.id);if(!blob){excluded.push({reportId:metadata.id,reason:'Original storage URL unavailable'});continue;}
  const file=backup+'/report-files/'+metadata.id+'.json';let bytes:Buffer;
  if(existsSync(file))bytes=readFileSync(file);else{const url=new URL(blob.url);assert(url.protocol==='https:'&&url.hostname.endsWith('.public.blob.vercel-storage.com'));const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});assert(response.ok,'Original report Blob unavailable');bytes=Buffer.from(await response.arrayBuffer());assert.equal(hash(plaintext(bytes)),metadata.checksum);writeFileSync(file,bytes);}
  const text=plaintext(bytes);assert.equal(hash(text),metadata.checksum);
  const pathNamespace=blob.pathname.split('/')[1],sourceNamespace=pathNamespace==='pulse-production'?'pulse:production':pathNamespace==='pulse-local'?'pulse:local':pathNamespace;
  add({...metadata,ownerWallet:owner,blobPath:blob.url},JSON.parse(text),{kind:'saved-delivery',job,networkKey:chains[job.receipt.network],sourceNamespace,bodyFile:file,bodySha256:hash(bytes),source:entry.path});
 }
 // Two original paid local deliveries used in-memory storage. Preserve their exact
 // checksum-bound report bytes as a new encrypted archive copy, without a live job.
 for(const id of ['d3185616-efca-4adc-ae9a-2dc1406a44cb','db1f36c3-668a-4b1f-907e-b89b6d2ac3c8']){
  const job=read('.tmp/global-base-private/job-'+id+'.json'),saved=read('.tmp/global-base-private/report-'+job.reportId+'.json');
  assert.equal(saved.record.ownerWallet.toLowerCase(),owner);assert.equal(job.payer.toLowerCase(),owner);assert.equal(job.receipt.payer.toLowerCase(),owner);assert.equal(job.receipt.reportId,saved.record.id);
  const text=canonicalJson(saved.report);assert.equal(hash(text),saved.record.checksum);
  const file=backup+'/report-files/'+job.reportId+'.json';if(!existsSync(file))writeFileSync(file,encryptReport(text,process.env.REPORT_ENCRYPTION_KEY!));
  const bytes=readFileSync(file);assert.equal(hash(plaintext(bytes)),saved.record.checksum);
  const origin=new URL(blobRows[0].url).origin,url=origin+'/recovered-reports/2026-11-17/'+saved.record.id+'.json';
  add({...saved.record,blobPath:url},saved.report,{kind:'saved-delivery',job,networkKey:chains[job.receipt.network],sourceNamespace:null,bodyFile:file,bodySha256:hash(bytes),upload:true,originalBlobPath:saved.record.blobPath,source:'.tmp/global-base-private/job-'+id+'.json'});
 }
 const matchFile=folder+'/authenticated-history-matches.json';
 if(existsSync(matchFile)){
  const matches=read(matchFile),source='.tmp/global-20d-audit-2026-10-31';assert.equal(matches.owner,owner);
  assert.equal(hash(readFileSync(source+'/owned-history-manifest.json')),matches.manifestSha256);
  assert.equal(hash(readFileSync(source+'/owned-native-pulse-production-index.json')),matches.indexSha256);
  for(const capture of matches.targets){
   if(capture.matches.length!==1){excluded.push({jobId:capture.jobId,reason:'Original encrypted storage identity is missing or ambiguous'});continue;}
   const original=readFileSync(capture.file);assert.equal(hash(original),capture.sha256);
   const match=capture.matches[0],bytes=readFileSync(match.bodyFile),text=plaintext(bytes),body=JSON.parse(text);assert.equal(hash(bytes),match.bodySha256);assert.equal(hash(text),match.checksum);
   assert.equal(hash(canonicalJson(body)),capture.canonicalSha256);assert.equal(hash(canonicalJson(JSON.parse(original.toString()))),capture.canonicalSha256);
   assert(['base','xlayer','arbitrum','arc','robinhood'].includes(capture.network));
   // The original metadata is absent. Owner access is proven by the captured
   // wallet-authenticated export and an exact full-body match to one encrypted
   // production Blob. Its upload timestamp is retained as the archive clock;
   // no payment receipt, live job capability or original metadata is invented.
   const metadata={id:match.id,ownerWallet:owner,visibility:'private',blobPath:match.url,checksum:match.checksum,createdAt:new Date(match.uploadedAt).toISOString()};
   add(metadata,body,{kind:'authenticated-history',networkKey:capture.network,sourceNamespace:'pulse:production',bodyFile:match.bodyFile,bodySha256:match.bodySha256,source:capture.file});
   const added=rows.get(match.id);if(added?.row.evidenceKind==='authenticated-history'){added.row.originalJobId=capture.jobId;added.metadataReconstructed=true;added.createdAtBasis='original-blob-upload-time';}
  }
 }
 const entries=[...rows.values()].sort((a,b)=>a.row.reportId.localeCompare(b.row.reportId)),plan={version:'read-only-report-archive-recovery-v1',targetNamespace:'pulse:production',entries,deliveries:[...deliveries.values()].sort((a,b)=>a.identity.localeCompare(b.identity)),auditCounts,excluded};
 write(folder+'/report-history-plan.json',plan);
 const counts:Record<string,number>={};for(const {row} of entries)counts[row.owner]=(counts[row.owner]||0)+1;
 const summary={reports:entries.length,testWalletReports:counts[owner]??0,byOwner:counts,executionAuditFiles:Object.values(auditCounts).reduce((sum,count)=>sum+count,0),verifiedResearchDeliveries:deliveries.size,newEncryptedStorageCopies:entries.filter(row=>row.upload).length,excluded:excluded.length,planSha256:hash(readFileSync(folder+'/report-history-plan.json'))};
 write(folder+'/report-history-summary.json',summary);console.log(JSON.stringify(summary));
}
async function apply(){
 const bytes=readFileSync(folder+'/report-history-plan.json'),plan=JSON.parse(bytes.toString());assert.equal(option('plan-sha256'),hash(bytes));assert.equal(plan.version,'read-only-report-archive-recovery-v1');assert.equal(plan.targetNamespace,'pulse:production');assert(process.env.REDIS_PUBLIC_URL);
 const redis=new StoreRedis(process.env.REDIS_PUBLIC_URL),archive=new RecoveredReportArchive(redis,plan.targetNamespace),publicActivity=new PublicActivityStore(redis,plan.targetNamespace),results:any[]=[];
 try{
  // Check every record and local payload before any durable mutation.
  await batches<any>(plan.entries,async entry=>{validateArchivedReport(entry.row);const raw=readFileSync(entry.bodyFile);assert.equal(hash(raw),entry.bodySha256);assert.equal(hash(plaintext(raw)),entry.row.metadata.checksum);const previous=await archive.get(entry.row.owner,entry.row.id);if(previous)assert.deepEqual(previous,entry.row,'Preserve newer conflicting archive records');});
  const {runNativeRedisCommand}=await import('../apps/api/src/nativeRedis.js');const cfg=await runNativeRedisCommand(process.env.REDIS_PUBLIC_URL,['CONFIG','GET','appendonly','maxmemory-policy'],20000) as string[];const settings=Object.fromEntries(Array.from({length:cfg.length/2},(_,i)=>[cfg[i*2],cfg[i*2+1]]));assert.equal(settings.appendonly,'yes');assert.equal(settings['maxmemory-policy'],'noeviction');
  await batches<any>(plan.entries,async entry=>{
   if(entry.upload){
    const url=new URL(entry.row.metadata.blobPath),existing=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
    if(existing.ok)assert.equal(hash(Buffer.from(await existing.arrayBuffer())),entry.bodySha256,'Preserve an existing encrypted storage copy');
    else{assert.equal(existing.status,404);const {put}=await import('@vercel/blob');const uploaded=await put(url.pathname.slice(1),readFileSync(entry.bodyFile),{access:'public',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json',token:process.env.BLOB_READ_WRITE_TOKEN});assert.equal(uploaded.url,entry.row.metadata.blobPath);}
   }
   results.push({id:entry.row.id,owner:entry.row.owner,added:await archive.insertMissing(entry.row)});
  });
  const coherence=await redis.eval(`local rows=redis.call('HGETALL',KEYS[2]);local count=0;for i=2,#rows,2 do count=count+cjson.decode(rows[i]).count end;return {redis.call('HLEN',KEYS[1]),count}`,[plan.targetNamespace+':public-activity:seen:v1',plan.targetNamespace+':public-activity:research:v1'],[]) as number[];assert.equal(Number(coherence[0]),Number(coherence[1]));
  let publicDeliveriesAdded=0;for(const fact of plan.deliveries)if(await publicActivity.record(fact))publicDeliveriesAdded++;
  let verified=0;await batches<any>(plan.entries,async entry=>{assert.deepEqual(await archive.get(entry.row.owner,entry.row.id),entry.row);verified++;});
  const outcome={at:new Date().toISOString(),planSha256:hash(bytes),archiveRows:verified,archiveAdded:results.filter(row=>row.added).length,publicDeliveriesAdded,publicActivity:await publicActivity.snapshot(),results,paymentsMade:false,automationActivated:false,liveJobsCreated:false};
  write(folder+'/report-history-apply-results.json',outcome);console.log(JSON.stringify({...outcome,results:undefined,publicActivity:outcome.publicActivity.research}));
 }finally{closeNativeRedisConnections();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 mkdirSync(folder,{recursive:true});mkdirSync(resolve(backup,'report-files'),{recursive:true});
 if(process.argv.includes('--apply'))await apply();else await prepare();
}
