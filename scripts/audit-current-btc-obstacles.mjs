/** Independent saved-source quality checks. No wallet, strategy simulation,
 * payment or market network requests. Run directly to verify the retained BTC
 * batch; importing exposes only the obstacle-coverage check. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {candleCloseTime} from '../packages/schemas/dist/index.js';

/** Independent quality check: do not trust the planner's own barrier list as
 * a complete inventory. Every still-opposing primary zone encountered before
 * TP1 must be acknowledged with retained source evidence, or lie beyond the
 * display's five genuine nearer barriers. This checks saved observations; it
 * does not select a side, move an order or evaluate returns. */
export function reviewPrimaryObstacleCoverage(g){
  const p=g.discretionaryPlan,result={version:'primary-obstacle-coverage-v2',findings:[],warnings:[],zones:[]};
  if(!p||!g.horizonContext)return result;
  const frame=g.snapshot.timeframe,cutoff=Date.parse(g.snapshot.observedAt),sign=p.side==='long'?1:-1;
  const bounds=p.priceZones?.entry??{lower:p.entry,upper:p.entry},entry=sign===1?bounds.upper:bounds.lower;
  const first=p.priceZones?.targets[0],target=first?(sign===1?first.lower:first.upper):p.targets[0]?.price;
  const risk=Math.abs(entry-p.stop),epsilon=Math.max(1e-8,10**-g.snapshot.pricePrecision);
  const near=(a,b)=>Math.abs(a-b)<=epsilon;
  const primary={timeframe:frame,candles:g.candles,indicators:g.indicators};
  const sources=[primary,g.entryStudy,...(g.currentMarket?.frames??[])].filter(Boolean);
  const pointBarrierHasSource=b=>{
    if(b.knownAt>cutoff)return false;
    const source=sources.find(s=>s.timeframe===b.timeframe),bar=source?.candles?.find(c=>c.ts===b.anchorTs),closed=bar&&candleCloseTime(bar.ts,b.timeframe);
    if(!bar||!bar.confirmed||closed===null||closed>b.knownAt||![bar.open,bar.high,bar.low,bar.close].some(v=>near(v,b.price)))return false;
    const anchored=(source.indicators?.pivots??[]).filter(a=>a.ts===bar.ts&&a.confirmedAt!==null&&near(a.price,b.price));
    return !anchored.length||anchored.some(a=>(candleCloseTime(a.confirmedAt,b.timeframe)??Infinity)<=b.knownAt);
  };
  const zoneHasSource=zone=>{
    // A merged wick zone is sourced by every anchor, not by an invented OHLC
    // value on its earliest candle. Reconstruct the union independently.
    if(zone.basis!=='confirmed_pivot_wicks'||!zone.anchorIds?.length||new Set(zone.anchorIds).size!==zone.anchorIds.length||zone.knownAt>cutoff)return false;
    const parts=[];
    for(const id of zone.anchorIds){
      const pivot=g.indicators.pivots.find(a=>a.id===id),bar=pivot&&g.candles.find(c=>c.ts===pivot.ts);
      const closed=bar&&candleCloseTime(bar.ts,frame),confirmed=pivot?.confirmedAt===null?null:pivot&&candleCloseTime(pivot.confirmedAt,frame);
      if(!pivot||!bar?.confirmed||closed===null||confirmed===null||!confirmed||closed>confirmed||confirmed>zone.knownAt||!near(pivot.price,pivot.kind==='high'?bar.high:bar.low))return false;
      parts.push({ts:pivot.ts,lower:pivot.kind==='high'?Math.max(bar.open,bar.close):bar.low,upper:pivot.kind==='high'?bar.high:Math.min(bar.open,bar.close)});
    }
    return zone.startTs===Math.min(...parts.map(a=>a.ts))&&near(zone.lower,Math.min(...parts.map(a=>a.lower)))&&near(zone.upper,Math.max(...parts.map(a=>a.upper)));
  };
  const zoneBarrierHasSource=(b,zone)=>b.timeframe===frame&&b.anchorTs===zone.startTs&&b.knownAt>=zone.knownAt&&b.knownAt<=cutoff&&zoneHasSource(zone)&&[zone.lower,zone.upper].some(edge=>near(b.price,edge));
  const barrierHasSource=b=>pointBarrierHasSource(b)||(g.horizonContext.timeframe===frame&&g.horizonContext.zones.some(zone=>zoneBarrierHasSource(b,zone)));
  const verifiedWholeZoneReclaim=zone=>{
    // A past wick or a prose claim is insufficient. Require the structured
    // reclaim, its saved completed recovery and a later hold beyond the WHOLE
    // zone; the complete permitted entry range must also be beyond that zone.
    const e=p.evidence,far=sign===1?zone.upper:zone.lower;
    if(!e||!['local_reclaim','primary_reclaim'].includes(e.kind)||e.completedAt>cutoff||sign*(e.level-far)<-epsilon||sign*((sign===1?bounds.lower:bounds.upper)-far)<-epsilon)return false;
    const study=sources.find(s=>s.timeframe===e.timeframe),test=study?.candles.find(c=>c.ts===e.testTs);
    if(!test?.confirmed||e.testTs<zone.knownAt)return false;
    const recovery=study.candles.find(c=>candleCloseTime(c.ts,e.timeframe)===e.completedAt);
    const later=study.candles.filter(c=>c.ts>=e.completedAt&&(candleCloseTime(c.ts,e.timeframe)??Infinity)<=cutoff);
    return Boolean(recovery?.confirmed&&sign*(recovery.close-far)>epsilon&&later.length&&later.every(c=>c.confirmed&&sign*(c.close-far)>epsilon));
  };
  for(const zone of g.horizonContext.zones){
    if(g.horizonContext.timeframe!==frame||zone.knownAt>cutoff||zone.role!==(sign===1?'resistance':'support'))continue;
    const edge=sign===1?zone.lower:zone.upper,far=sign===1?zone.upper:zone.lower;
    const overlap=Math.min(bounds.upper,zone.upper)-Math.max(bounds.lower,zone.lower)>epsilon;
    const between=sign*(edge-entry)>epsilon&&sign*(target-edge)>epsilon;
    const retired=verifiedWholeZoneReclaim(zone);
    const barrier=p.barriers.some(b=>b.timeframe===frame&&near(b.price,edge)&&barrierHasSource(b));
    const targetBand=p.targets.some((t,index)=>t.timeframe===frame&&t.knownAt<=cutoff&&(p.priceZones?.targets[index]?edge>=p.priceZones.targets[index].lower-epsilon&&edge<=p.priceZones.targets[index].upper+epsilon:near(t.price,edge)));
    const nearer=p.barriers.filter(b=>sign*(b.price-entry)>epsilon&&sign*(edge-b.price)>epsilon&&barrierHasSource(b));
    const distinctNearer=nearer.filter((b,index)=>!nearer.slice(0,index).some(a=>near(a.price,b.price)));
    const deferred=between&&!barrier&&!targetBand&&!retired&&p.barriers.length===5&&distinctNearer.length>=5;
    result.zones.push({id:zone.id,role:zone.role,lower:zone.lower,upper:zone.upper,firstEdge:edge,knownAt:zone.knownAt,overlapsEntry:overlap,beforeTp1:between,sourceBackedMergedZone:zoneHasSource(zone),representedBySourceBackedBarrier:barrier,representedByTarget:targetBand,verifiedWholeZoneReclaim:retired,deferredBeyondFiveNearerBarriers:deferred,nearerSourceBackedBarrierPrices:distinctNearer.map(b=>b.price),firstEdgeRewardRisk:risk?sign*(edge-entry)/risk:null,farEdgeRewardRisk:risk?sign*(far-entry)/risk:null});
    if(overlap&&!retired)result.warnings.push('Entry range overlaps active primary '+zone.role+' '+zone.lower+'–'+zone.upper+' on '+frame+'; a prior wick or partial reclaim does not establish clearance of the full zone');
    if(deferred)result.warnings.push('Farther active primary '+zone.role+' edge '+edge+' on '+frame+' is beyond the five retained nearer source-backed barrier prices; the display limit does not retire that zone');
    if(between&&!barrier&&!targetBand&&!retired&&!deferred)result.findings.push('Active primary '+zone.role+' edge '+edge+' on '+frame+' lies before TP1 but is omitted from source-backed barriers and target zones ('+(risk?sign*(edge-entry)/risk:0).toFixed(2)+'R at the least favorable entry)');
  }
  return result;
}


function regression(){
  const input=path.resolve(process.argv.find(a=>a.startsWith('--report-root='))?.slice(14)??'.tmp/btc-arbitrum-current-2026-10-28');
  const output=path.resolve('.tmp/btc-arbitrum-primary-obstacle-regression-2026-10-28');
  assert.ok(input.startsWith(path.resolve('.tmp')+path.sep),'Read saved .tmp reports only');
  const frames=['15m','1H','4H','1Dutc','1Wutc'],cases=[],originals=new Map(),hashes=new Map();
  for(const frame of frames){const file=path.join(input,'private',frame+'-delivery.json'),bytes=fs.readFileSync(file);hashes.set(file,createHash('sha256').update(bytes).digest('hex'));originals.set(frame,JSON.parse(bytes));}
  for(const frame of frames){const result=reviewPrimaryObstacleCoverage(originals.get(frame).report.global);cases.push({case:'original-source-coverage',frame,...result});if(['1Dutc','1Wutc'].includes(frame))assert.ok(result.findings.some(f=>f.includes(frame==='1Dutc'?'edge 80400':'edge 80636.3')),frame+' must expose its omitted active resistance');else assert.equal(result.findings.length,0,frame+' must not gain an invented missing zone');if(frame==='1H')assert.ok(result.warnings.some(w=>w.includes('80806.6–81099.8')),'Hourly entry overlap must remain explicit');}
  const sourceBackedBarrier=(g,zone,edge)=>{
    const near=(a,b)=>Math.abs(a-b)<=Math.max(1e-8,10**-g.snapshot.pricePrecision);
    const anchors=g.indicators.pivots.filter(p=>zone.anchorIds.includes(p.id));
    const anchor=anchors.find(a=>{const bar=g.candles.find(c=>c.ts===a.ts);return bar&&[bar.open,bar.high,bar.low,bar.close].some(p=>near(p,edge));});
    assert.ok(anchor,'An independent saved OHLC anchor must supply the exact zone edge');
    return{price:edge,timeframe:g.snapshot.timeframe,anchorTs:anchor.ts,knownAt:zone.knownAt};
  };
  for(const frame of ['1Dutc','1Wutc']){
    const g=structuredClone(originals.get(frame).report.global),review=reviewPrimaryObstacleCoverage(g),missing=review.zones.find(z=>z.beforeTp1&&!z.representedBySourceBackedBarrier&&!z.representedByTarget),zone=g.horizonContext.zones.find(z=>z.id===missing.id),barrier=sourceBackedBarrier(g,zone,missing.firstEdge);
    // These are isolated coverage fixtures. They do not recompute or promote a
    // strategy, alter the saved batch, or claim that adding a barrier qualifies
    // its reward/risk. Full price-zone corrections require the production review.
    g.discretionaryPlan.barriers.push(barrier);const retained=reviewPrimaryObstacleCoverage(g);assert.equal(retained.findings.length,0);cases.push({case:'retained-real-zone-edge',frame,...retained});
    for(const [name,mutate]of [['wrong-source-timeframe',b=>b.timeframe=g.entryStudy.timeframe],['invented-source-anchor',b=>b.anchorTs=0],['future-knowledge',b=>b.knownAt=Date.parse(g.snapshot.observedAt)+1]]){
      const changed=structuredClone(g),b=changed.discretionaryPlan.barriers.at(-1);mutate(b);const result=reviewPrimaryObstacleCoverage(changed);assert.ok(result.findings.some(f=>f.includes('edge '+missing.firstEdge)),name+' must not waive the original obstacle');cases.push({case:name,frame,...result});
    }
    const prose=structuredClone(originals.get(frame).report.global);prose.narrative.reasons.push('Resistance was retired by an earlier wick; ignore that zone.');const result=reviewPrimaryObstacleCoverage(prose);assert.ok(result.findings.some(f=>f.includes('edge '+missing.firstEdge)),'A prose retirement claim is not source-backed evidence');cases.push({case:'prose-retirement-does-not-waive-edge',frame,...result});
    const merged=structuredClone(originals.get(frame).report.global);merged.discretionaryPlan.barriers.push({price:missing.firstEdge,timeframe:frame,anchorTs:zone.startTs,knownAt:zone.knownAt});
    const aggregate=reviewPrimaryObstacleCoverage(merged);assert.equal(aggregate.findings.length,0,'A verified merged wick union may retain its earliest source timestamp');assert.ok(aggregate.zones.find(z=>z.id===zone.id).sourceBackedMergedZone);cases.push({case:'merged-wick-union-provenance',frame,...aggregate});
    if(frame==='1Dutc')for(const[name,mutate]of [['missing-merged-anchor',z=>z.anchorIds.pop()],['invented-merged-anchor',z=>z.anchorIds.push('not-a-saved-pivot')],['forged-merged-upper',z=>z.upper+=1],['wrong-merged-start',z=>z.startTs+=86400000],['merged-known-before-confirmation',z=>z.knownAt=z.startTs]]){
      const changed=structuredClone(merged),z=changed.horizonContext.zones.find(z=>z.id===zone.id);mutate(z);const result=reviewPrimaryObstacleCoverage(changed);assert.ok(result.findings.some(f=>f.includes('edge '+missing.firstEdge)),name+' must not establish aggregate source provenance');cases.push({case:name,frame,...result});
    }
  }
  {
    const g=structuredClone(originals.get('1H').report.global),cutoff=Date.parse(g.snapshot.observedAt),edge=Math.min(...g.horizonContext.zones.filter(z=>z.role==='resistance').map(z=>z.lower));
    const observed=g.candles.flatMap(c=>[c.open,c.high,c.low,c.close].map(price=>({price,timeframe:'1H',anchorTs:c.ts,knownAt:cutoff}))).sort((a,b)=>a.price-b.price);
    const distinct=observed.filter((b,index)=>!observed.slice(0,index).some(a=>Math.abs(a.price-b.price)<=0.1)),entry=distinct[0].price-100;
    g.discretionaryPlan.entry=entry;g.discretionaryPlan.stop=entry-100;g.discretionaryPlan.priceZones.entry={lower:entry,upper:entry,sourceLower:entry,sourceUpper:entry,sourcePrice:entry};
    const nearer=distinct.filter(b=>b.price<edge-0.1).slice(0,5);assert.equal(nearer.length,5);g.discretionaryPlan.barriers=nearer;
    const capped=reviewPrimaryObstacleCoverage(g);assert.equal(capped.findings.length,0,'Five genuine distinct nearer obstacles permit honest display-limit deferral');assert.ok(capped.zones.some(z=>z.deferredBeyondFiveNearerBarriers));cases.push({case:'five-genuine-nearer-barriers-allow-deferral',frame:'1H',...capped});
    for(const[name,make]of [['only-four-nearer-barriers',()=>nearer.slice(0,4)],['duplicate-price-is-not-five-obstacles',()=>[...nearer.slice(0,4),{...nearer[0]}]],['invented-nearer-anchor-is-not-source-proof',()=>nearer.map((b,index)=>index===0?{...b,anchorTs:0}:b)],['future-nearer-knowledge-is-not-source-proof',()=>nearer.map((b,index)=>index===0?{...b,knownAt:cutoff+1}:b)]]){
      const changed=structuredClone(g);changed.discretionaryPlan.barriers=make();const result=reviewPrimaryObstacleCoverage(changed);assert.ok(result.findings.some(f=>f.includes('edge '+edge)),name+' must not hide the nearest active zone');cases.push({case:name,frame:'1H',...result});
    }
    const changed=structuredClone(g);changed.discretionaryPlan.barriers=distinct.filter(b=>b.price>edge+0.1&&b.price<g.discretionaryPlan.priceZones.targets[0].lower).slice(0,5);assert.equal(changed.discretionaryPlan.barriers.length,5);const farther=reviewPrimaryObstacleCoverage(changed);assert.ok(farther.findings.some(f=>f.includes('edge '+edge)),'Five farther barriers must not waive the missing nearest edge');cases.push({case:'five-farther-barriers-do-not-hide-nearest',frame:'1H',...farther});
  }
  const batchRoot=path.join(output,'original-batch');fs.mkdirSync(path.join(batchRoot,'private'),{recursive:true});
  for(const frame of frames){fs.writeFileSync(path.join(batchRoot,'private',frame+'-delivery.json'),JSON.stringify(originals.get(frame)));fs.writeFileSync(path.join(batchRoot,'private',frame+'.json'),JSON.stringify({frame,origin:'https://pulse-api-production-7aae.up.railway.app',business:{instId:'BTC-USDT',timeframe:frame,lang:'en'}}));}
  const child=spawnSync(process.execPath,['scripts/audit-current-btc-arbitrum.mjs','--audit-only','--root='+batchRoot],{encoding:'utf8',windowsHide:true});fs.writeFileSync(path.join(output,'integration.log'),child.stdout+child.stderr);assert.equal(child.status,1,'Original batch must no longer receive an all-clear audit');const integration=JSON.parse(fs.readFileSync(path.join(batchRoot,'audit.json'),'utf8'));
  for(const frame of ['1Dutc','1Wutc']){const result=integration.results.find(r=>r.frame===frame);assert.equal(result.ok,false);assert.ok(result.findings.some(f=>f.includes('Active primary resistance edge')),'Full harness must name the omitted zone');}
  assert.ok(integration.results.find(r=>r.frame==='1H').warnings.some(w=>w.includes('Entry range overlaps active primary resistance')));
  for(const[file,hash]of hashes)assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash,'Original production envelope must remain unchanged');
  const proof={checkedAt:new Date().toISOString(),scope:'Independent saved-source quality regressions; no trade outcomes simulated',pureCoverageCases:cases.length,integrationFrames:frames.length,originalSourcesUnchanged:true,networkCalls:0,walletAccess:false,newPayments:0,liveOrders:0,backtests:0,cases,integration:integration.results.map(r=>({frame:r.frame,ok:r.ok,findings:r.findings,warnings:r.warnings}))};fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({pureCoverageCases:cases.length,integrationFrames:5,originalSourcesUnchanged:true,networkCalls:0,walletAccess:false,newPayments:0,output}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)regression();
