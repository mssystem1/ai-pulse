import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./export-test-wallet-browser-recovery.js',import.meta.url),'utf8');
const owner='0xa7d827622c4f9c884ca8f751b2060dd767f18683';
function run(values={},origin='https://app.ai-pulse.tech') {
  const reads=[];let downloaded,clicked=0;
  const context={location:{origin},localStorage:{getItem(key){reads.push(key);return values[key]??null;}},
    Blob:class{constructor(parts){downloaded=parts.join('');}},URL:{createObjectURL(){return 'blob:local';},revokeObjectURL(){}},
    document:{body:{appendChild(){}},createElement(){return {click(){clicked++;},remove(){}};}},setTimeout(){},console:{info(){}}};
  vm.runInNewContext(source,context);
  return {data:JSON.parse(downloaded),reads,clicked,downloaded};
}
test('exports wallet drafts and IDs without capabilities, unrelated owners or payment/session keys',()=>{
  const manifest={format:'pulse-indicator-v4',id:'test.flow',version:'1.0.0',title:'Flow',author:'Trader',graph:{nodes:[],plots:[],recoveryToken:'nested-secret'},authorization:'package-secret'};
  const handle={jobId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',recoveryToken:'recovery-secret',createdAt:'2026-11-01',label:'BTC',headers:{'PAYMENT-SIGNATURE':'payment-secret'}};
  const result=run({['pulse-indicator-created:'+owner]:JSON.stringify([manifest]),['pulse-indicator-draft:'+owner]:JSON.stringify({manifest,signature:'draft-secret'}),
    'pulse-indicators-v1':JSON.stringify([manifest]),'pulse:report-history:spot:base':JSON.stringify([handle]),'pulse:last-job:spot:base':JSON.stringify(handle),
    'pulse:pending-payment:base':'payment-secret','pulse:auth:token':'login-secret','pulse-indicator-created:0xother':JSON.stringify([manifest])});
  assert.equal(result.clicked,1);assert.equal(result.data.createdIndicators.length,1);assert.equal(result.data.savedDraft.id,'test.flow');assert.equal(result.data.reportReferences.length,1);
  assert(!/nested-secret|package-secret|recovery-secret|payment-secret|login-secret|draft-secret/.test(result.downloaded));
  assert(result.reads.every(key=>!key.includes('pending-payment')&&!key.includes('auth')&&!key.includes('0xother')));
});
test('survives corrupt local entries without clearing storage or concealing readable packages',()=>{
  const result=run({['pulse-indicator-created:'+owner]:'broken','pulse:report-history:risk:xlayer':'{}','pulse-indicators-v1':'[]'});
  assert.equal(result.data.warnings.length,1);assert.deepEqual(result.data.reportReferences,[]);assert.equal(result.clicked,1);
});
test('refuses another origin before reading any browser storage',()=>{
  assert.throws(()=>run({},'https://example.com'),/Open https/);
});
