import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWalletRecoveryPlan,validateWalletRecoveryPlan,digest} from './wallet-history-recovery.mjs';
import {mergeClosedOrderHistory} from './recover-closed-order-history.mjs';
const owner='0x'+'a'.repeat(40),other='0x'+'b'.repeat(40),now=1794850000000;
const record=(key,value,expiresAt=now+10000)=>({key,type:'string',payload:JSON.stringify(value),expiresAt});
const job={id:'job-a',payer:owner,idempotencyKey:'original-idempotency',stage:'manual_reconciliation',createdAt:'2026-11-01T00:00:00.000Z'};
test('selects only owner terminal jobs, original namespaces and unexpired data',()=>{
 const plan=buildWalletRecoveryPlan([record('pulse:production:job:job-a',job),record('pulse:local:job:other',{...job,id:'other',payer:other}),record('pulse:production:job:running',{...job,id:'running',stage:'payment_settled'}),record('pulse:production:job:expired',{...job,id:'expired'},now-1)],owner,now);
 assert.equal(plan.operations.filter(op=>op.category==='job').length,1);
 assert.equal(plan.operations.find(op=>op.category==='idempotency').value,'job-a');
 const index=plan.operations.find(op=>op.category==='payer-index');assert.equal(index.key,`pulse:production:payer-jobs:${digest(owner).slice(0,32)}`);
 assert.equal(plan.held.nonterminalJobs,1);assert.equal(plan.held.expired,1);
 assert.equal(plan.operations[0].expiresAt,now+10000);
});
test('restores owned strategies paused with original state archived, never imports queues or orders',()=>{
 const strategy={id:'base:0xvault',owner,status:'active',evaluations:[{id:'eval-1',evaluatedAt:'2026-09-01'}]};
 const plan=buildWalletRecoveryPlan([{key:'pulse:v6:autopilot:strategy-map',type:'hash',payload:[strategy.id,JSON.stringify(strategy),'foreign',JSON.stringify({...strategy,id:'foreign',owner:other})],expiresAt:null},record('pulse:production:jobs:ready',['job-a']),record('pulse:v6:automation:orders',[{owner,status:'active'}])],owner,now);
 const restored=plan.operations.find(op=>op.category==='paused-strategy');assert.equal(restored.items.length,1);assert.equal(JSON.parse(restored.items[0][1]).status,'paused');
 assert.equal(plan.held.originalStrategies[0].status,'active');assert.equal(plan.held.automationOrders.length,1);assert(!plan.operations.some(op=>op.key.includes(':jobs:')||op.key.includes(':automation:orders')));
 assert.equal(plan.operations.find(op=>op.category==='evaluation-journal').items.length,1);
});
test('merges only confirmed or failed owner activity and rejects foreign-owner tampering',()=>{
 const row={id:'a',owner,network:'base',status:'confirmed',updatedAt:'2026-11-01'};
 const plan=buildWalletRecoveryPlan([{key:`pulse:v6:activity-map:base:${owner}`,type:'hash',payload:['a',JSON.stringify(row),'b',JSON.stringify({...row,id:'b',owner:other}),'c',JSON.stringify({...row,id:'c',status:'pending'})],expiresAt:null}],owner,now);
 assert.equal(plan.operations[0].items.length,1);
 plan.operations[0].items[0][1]=JSON.stringify({...row,owner:other});assert.throws(()=>validateWalletRecoveryPlan(plan));
});
test('rejects redirected recovery keys and active strategy injection',()=>{
 const plan=buildWalletRecoveryPlan([record('pulse:production:job:job-a',job)],owner,now);
 plan.operations[0].key='pulse:production:jobs:ready';assert.throws(()=>validateWalletRecoveryPlan(plan));
 const strategy={id:'base:0xvault',owner,status:'active'};
 assert.throws(()=>validateWalletRecoveryPlan({version:'wallet-history-recovery-v1',owner,operations:[{category:'paused-strategy',kind:'hash',key:'pulse:v6:autopilot:strategy-map',items:[[strategy.id,JSON.stringify(strategy)]],expiresAt:null}]}));
});
test('holds completed jobs without their owned report instead of publishing broken history',()=>{
 const plan=buildWalletRecoveryPlan([record('pulse:production:job:job-a',{...job,stage:'completed',reportId:'missing-report'})],owner,now);
 assert.equal(plan.operations.length,0);assert.equal(plan.held.unreadableJobs.length,1);
});
test('closed order merge preserves newer rows, rejects live orders and foreign ownership',()=>{
 const old={id:'order-a',owner,status:'filled'},newer={...old,updatedAt:'2026-11-16'};
 const result=mergeClosedOrderHistory([newer],[old,{id:'order-b',owner,status:'cancelled'}],owner);
 assert.deepEqual(result.rows[0],newer);assert.equal(result.added,1);assert.equal(result.conflicts,1);
 for(const status of ['active','paused'])assert.throws(()=>mergeClosedOrderHistory([],[{...old,status}],owner));
 assert.throws(()=>mergeClosedOrderHistory([],[{...old,owner:other}],owner));
});
