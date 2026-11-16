// Closed order history only. Active/paused orders are never restored here:
// the runtime can reconcile a paused order back to active on-chain state.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {digest} from './wallet-history-recovery.mjs';
export function mergeClosedOrderHistory(current,originals,owner) {
  assert(Array.isArray(current));assert(Array.isArray(originals));
  const rows=structuredClone(current),byId=new Map(rows.map(row=>[row.id,row]));let added=0,matched=0,conflicts=0;
  for(const row of originals) {
    assert.equal(row.owner?.toLowerCase(),owner);assert.equal(typeof row.id,'string');assert(['filled','cancelled','failed'].includes(row.status),'Nonterminal order cannot be restored into live automation');
    const old=byId.get(row.id);
    if(old){if(JSON.stringify(old)===JSON.stringify(row))matched++;else conflicts++;continue;}
    rows.push(structuredClone(row));byId.set(row.id,row);added++;
  }
  return {rows,added,matched,conflicts};
}
async function main(){
 const bytes=readFileSync('.tmp/test-wallet-recovery/plan.json'),plan=JSON.parse(bytes),owner=process.env.TEST_WALLET_ADDRESS?.toLowerCase();assert.equal(plan.owner,owner);
 assert(process.argv.includes('--plan-sha256='+digest(bytes)),'Use the exact reviewed source-plan hash');
 const originals=plan.held.automationOrders.filter(row=>['filled','cancelled','failed'].includes(row.status));
 mergeClosedOrderHistory([],originals,owner);
 if(!process.argv.includes('--apply')){console.log(JSON.stringify({closedOrders:originals.length,activeOrPausedHeld:plan.held.automationOrders.length-originals.length,readOnly:true}));return;}
 const {runNativeRedisCommand,closeNativeRedisConnections}=await import('../apps/api/dist/nativeRedis.js');
 const command=(...args)=>runNativeRedisCommand(process.env.REDIS_PUBLIC_URL,args,20000),key='pulse:v6:automation:orders';
 const cas=`local old=redis.call('GET',KEYS[1]);if (old or '')~=ARGV[1] then return 0 end;if old then redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL') else redis.call('SET',KEYS[1],ARGV[2]) end;return 1`;
 try{
  for(let attempt=0;attempt<12;attempt++){
   const raw=await command('GET',key),current=raw?JSON.parse(String(raw)):[],merged=mergeClosedOrderHistory(current,originals,owner);
   if(!merged.added||Number(await command('EVAL',cas,1,key,raw??'',JSON.stringify(merged.rows)))===1){const result={owner,added:merged.added,matched:merged.matched,conflicts:merged.conflicts,activeOrPausedHeld:plan.held.automationOrders.length-originals.length,ordersActivated:0};writeFileSync('.tmp/test-wallet-recovery/closed-order-apply-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));return;}
  }throw Error('Concurrent order writes prevented recovery; no existing record was overwritten');
 }finally{closeNativeRedisConnections();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(String(error.message).replace(/rediss?:\/\/\S+/g,'[redacted]'));process.exitCode=1;});
