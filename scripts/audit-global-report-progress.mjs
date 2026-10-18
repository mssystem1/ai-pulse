/** Local browser audit using public OHLCV and fake capabilities only. Start Vite on 5263 first. No payments, live models or broadcasts. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve('.tmp/global-stalled-job-2026-10-18/browser');fs.mkdirSync(root,{recursive:true});
import {prepareGlobalReport,reviewGlobalTargetReport,globalCompatibility} from '../packages/analysis/dist/index.js';
import {summarizeCandles} from '../packages/market/dist/index.js';
const source=JSON.parse(fs.readFileSync('packages/analysis/src/globalTargets.oct18-fixture.json','utf8'));
const markets=Object.entries(source.frames).map(([bar,rows])=>{
  const candles=rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,volumeCcy:0,confirmed:true}));
  return {source:'okx-public-spot',instId:'BTC-USDT',bar,fetchedAt:source.observedAt,candles,summary:summarizeCandles(candles),ticker:{instId:'BTC-USDT',priceCurrency:'USDT',last:candles.at(-1).close,open24h:0,high24h:0,low24h:0,vol24h:0,volCcy24h:0,change24hPct:0,ts:'0'}};
});
const original=prepareGlobalReport({market:markets.find(m=>m.bar==='1Dutc'),contextMarket:markets.find(m=>m.bar==='1Wutc'),hierarchyMarkets:markets,tier:'premium',targetPolicy:'legacy-pivots-v1'});
const raw={service:'spot_analysis_premium',tier:'premium',instId:'BTC-USDT',timeframe:'1Dutc',lang:'en',global:original,...globalCompatibility(original)};
const corrected=reviewGlobalTargetReport(original);
const origin=process.env.PULSE_BROWSER_ORIGIN||'http://127.0.0.1:5263',jobId='00000000-0000-4000-8000-000000000001',token='local-browser-fixture-only-00000000000000000000';
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw Error('This fixture audit accepts only a local frontend');
const pause=ms=>new Promise(r=>setTimeout(r,ms));const errors=[],requests=[],cases=[];let stage='generating_analysis',emptyReport=true,createdAt=Date.now()-70000,events=[];
const chrome=spawn(process.env.BROWSER_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--no-first-run','--disable-gpu','--disable-background-networking','--remote-debugging-port=9262',`--user-data-dir=${root}/profile-${Date.now()}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let socket;
try{
  let target;for(let i=0;i<50;i++){try{target=await(await fetch('http://127.0.0.1:9262/json/new?about:blank',{method:'PUT'})).json();break;}catch{await pause(200);}}assert.ok(target);
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();
  const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>reject(Error(method+' timeout')),20000);pending.set(key,{resolve:v=>{clearTimeout(timer);resolve(v)},reject});socket.send(JSON.stringify({id:key,method,params}));});
  socket.addEventListener('message',async event=>{
    const msg=JSON.parse(event.data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p?.reject(Error(JSON.stringify(msg.error))):p?.resolve(msg.result);return;}
    if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);
    if(msg.method!=='Fetch.requestPaused')return;
    const {request,requestId}=msg.params,url=new URL(request.url);const fulfill=async(body,status=200)=>call('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin},{name:'Access-Control-Allow-Headers',value:'*'},{name:'Access-Control-Allow-Methods',value:'GET, POST, OPTIONS'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
    try{
      if(url.pathname.startsWith('/v1/')||url.pathname==='/healthz'){
        requests.push({method:request.method,path:url.pathname});
        if(request.method==='OPTIONS'){await fulfill({},204);return;}
        if(url.pathname===`/v1/jobs/${jobId}`){await fulfill({job:{id:jobId,stage,createdAt:new Date(createdAt).toISOString(),updatedAt:events.at(-1)?.at||new Date(createdAt).toISOString(),events}});return;}
        if(url.pathname===`/v1/jobs/${jobId}/report`){await fulfill(emptyReport?{}:{report:raw});return;}
        if(url.pathname==='/v1/global/target-review'){await fulfill({report:corrected,paymentRequired:false,modelCalls:0});return;}
        if(url.pathname.endsWith('/retry')){await fulfill({alreadyProcessing:true});return;}
        if(url.pathname==='/healthz'){await fulfill({ok:true});return;}
        await fulfill({error:'Local visual fixture: provider reads unavailable'},503);return;
      }
      if(url.origin===origin||url.protocol==='data:'||url.protocol==='blob:')await call('Fetch.continueRequest',{requestId});else await call('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});
    }catch(error){errors.push(String(error));}
  });
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(200);}throw Error('Did not reach: '+expression+'; review='+await evaluate('document.querySelector(".global-target-review")?.textContent')+'; errors='+JSON.stringify(errors));};
  const shot=async name=>{await evaluate('document.querySelector(".paid-report-progress")?.scrollIntoView({block:"center"})');await pause(150);const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${root}/${name}.png`,Buffer.from(r.data,'base64'));};
  await call('Page.enable');await call('Runtime.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const setup=`localStorage.setItem('pulse:selected-network','base');localStorage.setItem('pulse:appearance','xlayer');localStorage.setItem('pulse:last-job:spot:base',${JSON.stringify(JSON.stringify({jobId,recoveryToken:token,createdAt:new Date(createdAt).toISOString()}))});`;
  await call('Page.addScriptToEvaluateOnNewDocument',{source:setup});
  for(const width of [1440,390]){
    stage='generating_analysis';events=[{stage,at:new Date(createdAt).toISOString()}];emptyReport=true;
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    await call('Page.navigate',{url:`${origin}/global`});await wait('Boolean(document.querySelector(".paid-report-progress"))');
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    assert.ok(await evaluate('document.querySelector(".paid-report-progress").textContent.includes("taking longer than usual")'));
    await shot(`processing-${width}`);cases.push({width,slowStage:true,overflow:false});
  }
  await evaluate('(()=>{const b=document.querySelector(".paid-report-progress button");b.click();b.click()})()');
  await wait('document.querySelector(".paid-report-progress button")?.disabled===true');
  assert.equal(requests.filter(r=>r.method==='POST'&&r.path.endsWith('/retry')).length,1);cases.push({manualRecoverySerialized:true});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  for(const next of ['fetching_context','calculating_features','generating_analysis','enriching_report','validating_report','saving_report']){
    stage=next;events.push({stage,at:new Date().toISOString()});await wait(`document.querySelector('.paid-report-progress [aria-current="step"]')?.textContent.includes(${JSON.stringify(({fetching_context:'Loading market data',calculating_features:'Calculating market structure',generating_analysis:'Writing AI analysis',enriching_report:'Checking asset context',validating_report:'Verifying and saving report',saving_report:'Verifying and saving report'})[next])})`);
    const visible=await evaluate('(()=>{const row=document.querySelector(".paid-report-progress [aria-current=step]"),list=row.closest("ol"),r=row.getBoundingClientRect(),l=list.getBoundingClientRect();return r.top>=l.top-1&&r.bottom<=l.bottom+1})()');
    // Allow the component's smooth scroll to settle before measuring.
    await pause(500);assert.equal(await evaluate('(()=>{const r=document.querySelector(".paid-report-progress [aria-current=step]").getBoundingClientRect(),l=document.querySelector(".paid-report-progress ol").getBoundingClientRect();return r.top>=l.top-1&&r.bottom<=l.bottom+1})()'),true);cases.push({stage:next,activeVisible:true});
  }
  await shot('saving-desktop');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".report-progress-track i")).animationName'),'none');cases.push({reducedMotion:true});
  for(const theme of ['base','arbitrum','arc-testnet','robinhood']){await evaluate(`document.documentElement.dataset.pulseTheme=${JSON.stringify(theme)}`);await shot(`processing-${theme}`);}
  stage='completed';events.push({stage,at:new Date().toISOString()});
  await wait('document.querySelector(".paid-report-progress")?.textContent.includes("recovery access is retained")');
  assert.equal(await evaluate('Boolean(localStorage.getItem("pulse:last-job:spot:base"))'),true);cases.push({emptyReportRetainsRecovery:true});
  emptyReport=false;await wait('Boolean(document.querySelector(".global-report"))');
  assert.equal(await evaluate('localStorage.getItem("pulse:last-job:spot:base")'),null);
  await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Review setup and targets · free").click()');
  await wait('document.querySelector(".global-target-review")?.textContent.includes("Showing a free setup and target review")');
  assert.equal(await evaluate('document.querySelectorAll("[data-trade-card]").length'),1);assert.equal(await evaluate('document.querySelector("[data-trade-card]").classList.contains("is-short")'),true);cases.push({completionOpensReport:true,freeReview:true});
  await evaluate('document.querySelector(".global-target-review").scrollIntoView({block:"start"})');const final=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${root}/corrected-review.png`,Buffer.from(final.data,'base64'));
  assert.deepEqual(errors,[]);assert.ok(!requests.some(r=>r.method==='POST'&&!['/v1/global/target-review',`/v1/jobs/${jobId}/retry`].includes(r.path)),'No payment, transaction or other POST');
  fs.writeFileSync(`${root}/validation.json`,JSON.stringify({cases,errors,payments:0,modelCalls:0,externalRequests:0},null,2));console.log(JSON.stringify({cases:cases.length,errors}));
}finally{socket?.close();chrome.kill();}
