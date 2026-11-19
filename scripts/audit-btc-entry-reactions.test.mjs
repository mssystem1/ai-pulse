import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),evidence='docs/evidence/btc-entry-reactions-2026-11-19';
const load=name=>JSON.parse(gunzipSync(fs.readFileSync(`${evidence}/${name}.json.gz`)));
test('offline replay rejects source, chronology, candle and refinement tampering',()=>{
 const dir=fs.mkdtempSync(path.join(root,'.tmp','btc-replay-negative-'));
 try{
  const cases=[
   ['wrong market',h=>{h.instId='ETH-USDT';}],
   ['missing parent interval',h=>{h.candles.splice(4,1);}],
   ['future capture',h=>{h.capturedAt=Date.now()+86400000;}],
   ['forged parent OHLC',h=>{h.candles[3].high+=1;}],
   ['raw response hash',h=>{h.requests[0].responseSha256='0'.repeat(64);}],
   ['missing minute',null,m=>{m.results[0].candles.splice(3,1);}],
   ['forged minute OHLC',null,m=>{m.results[0].candles[0].low-=1;}],
  ];
  for(const [label,alterHistory,alterMinutes] of cases){
   const history=load('later-15m'),minutes=load('later-1m');alterHistory?.(history);alterMinutes?.(minutes);
   const source=path.join(dir,'path.json'),fine=path.join(dir,'minutes.json'),out=path.join(dir,'result.json');
   fs.writeFileSync(source,JSON.stringify(history));fs.writeFileSync(fine,JSON.stringify(minutes));
   const r=spawnSync(process.execPath,['--import','tsx','scripts/audit-btc-entry-reactions.mjs',`--path=${source}`,`--minutes=${fine}`,`--out=${out}`],{cwd:root,encoding:'utf8',timeout:30000});
   assert.equal(r.error,undefined,label);assert.notEqual(r.status,0,label);assert.equal(fs.existsSync(out),false,label);
  }
 }finally{
  assert(path.resolve(dir).startsWith(path.resolve(root,'.tmp')+path.sep));
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
