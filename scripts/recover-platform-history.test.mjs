import test from 'node:test';
import assert from 'node:assert/strict';
import {platformRecoveryOwners,platformEvidenceOperations} from './recover-platform-history.mjs';
test('discovers history owners from job, report, activity and strategy sources without treating unrelated values as wallets',()=>{
 const a='0x'+'a'.repeat(40),b='0x'+'b'.repeat(40),c='0x'+'c'.repeat(40);
 const records=[{key:'pulse:production:job:a',type:'string',payload:JSON.stringify({payer:a})},{key:'pulse:production:report:b',type:'string',payload:JSON.stringify({ownerWallet:b})},{key:'pulse:v6:activity-map:base:'+c,type:'hash',payload:[]},{key:'pulse:v6:autopilot:strategy-map',type:'hash',payload:['s',JSON.stringify({owner:a})]},{key:'x',type:'string',payload:JSON.stringify({payer:'invalid'})}];
 assert.deepEqual(platformRecoveryOwners(records),[a,b,c]);
});
test('only unexpired immutable evidence bundles enter the additional-key plan',()=>{
 const record={key:'pulse:v6:autopilot:evidence:base:history-1',type:'string',payload:JSON.stringify({decision:{},evaluation:{},report:{}}),expiresAt:200};
 assert.equal(platformEvidenceOperations([record],100).length,1);
  assert.equal(platformEvidenceOperations([{...record,payload:JSON.stringify({decision:null,evaluation:{},report:null})}],100).length,1);
  assert.equal(platformEvidenceOperations([{...record,payload:JSON.stringify({decision:{},bias:'long',confidence:50,report:{}})}],100).length,1);
 assert.equal(platformEvidenceOperations([record],201).length,0);
 assert.equal(platformEvidenceOperations([{...record,key:'pulse:production:jobs:ready'}],100).length,0);
 assert.throws(()=>platformEvidenceOperations([{...record,payload:'{}'}],100));
});
